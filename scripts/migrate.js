'use strict';

/**
 * Migration script: Static Twig blog articles → Strapi CMS
 *
 * Parses all .html.twig article files from the Symfony blog directory,
 * extracts article_data structures, and creates blog posts in Strapi.
 *
 * Usage:
 *   node scripts/migrate.js
 *   node scripts/migrate.js --dry-run
 *   node scripts/migrate.js --system=rca
 *   node scripts/migrate.js --limit=5
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// =========================================================================
// Configuration
// =========================================================================

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const API_TOKEN = fs.existsSync(path.join(__dirname, '..', '.api_token'))
  ? fs.readFileSync(path.join(__dirname, '..', '.api_token'), 'utf8').trim()
  : process.env.STRAPI_API_TOKEN || '';

const BLOG_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/views/common/asigurari/blog');

const SYSTEM_DIRS = [
  'rca', 'casco', 'travel', 'home', 'life', 'health',
  'malpraxis', 'cmr', 'breakdown', 'accidents', 'common', 'rcp',
];

const SKIP_FILES = ['_blocks', 'macros', 'blog.html.twig'];

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SYSTEM_FILTER = (args.find(a => a.startsWith('--system=')) || '').split('=')[1] || null;
const LIMIT = parseInt((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10);

// =========================================================================
// HTTP helper
// =========================================================================

function apiRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, STRAPI_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// =========================================================================
// Twig parser — extracts article_data from .html.twig files
// =========================================================================

function parseTwigFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};

  // Extract meta title from {% block title %}
  const titleMatch = content.match(/\{%\s*block\s+title\s*%\}([\s\S]*?)\{%\s*endblock/);
  if (titleMatch) {
    result.metaTitle = titleMatch[1].replace(/\{\{.*?\}\}/g, '').replace(/\s+/g, ' ').trim();
  }

  // Extract meta description
  const metaDescMatch = content.match(/name="description"\s+content="([^"]*)"/);
  if (metaDescMatch) {
    result.metaDescription = metaDescMatch[1].trim();
  }

  // PATTERN 1: {% set article_data = { ... } %}
  const setStart = content.indexOf("{% set article_data");
  if (setStart !== -1) {
    return parseArticleDataPattern(content, setStart, result);
  }

  // PATTERN 2: {{ blog_macros.blog_content( title, image, image_alt, intro, sections, toc, conclusion ) }}
  const macroStart = content.indexOf('blog_macros.blog_content(');
  if (macroStart !== -1) {
    return parseMacroCallPattern(content, macroStart, result);
  }

  // Fallback
  return extractFallbackContent(content, result);
}

/**
 * Parse PATTERN 1: {% set article_data = { ... } %}
 * Used by rca, casco, travel, life, rcp, etc.
 */
function parseArticleDataPattern(content, setStart, result) {
  const afterSet = content.indexOf('{', content.indexOf('{', setStart) + 1);
  let braceDepth = 1;
  let pos = afterSet + 1;
  while (pos < content.length && braceDepth > 0) {
    if (content[pos] === '{') braceDepth++;
    else if (content[pos] === '}') braceDepth--;
    pos++;
  }

  const hashContent = content.substring(afterSet, pos);

  result.title = extractStringValue(hashContent, 'title');

  const imageMatch = hashContent.match(/'image'\s*:\s*asset\(\s*'([^']*)'\s*\)/);
  if (imageMatch) result.imagePath = imageMatch[1];

  result.imageAlt = extractStringValue(hashContent, 'image_alt');
  result.introText = extractStringValue(hashContent, 'intro_text');

  result.tocItems = [];
  const tocRegex = /\{\s*'href'\s*:\s*'([^']*)'\s*,\s*'title'\s*:\s*'([^']*)'\s*\}/g;
  let tocMatch;
  while ((tocMatch = tocRegex.exec(hashContent)) !== null) {
    result.tocItems.push({ href: tocMatch[1], title: tocMatch[2] });
  }

  result.contentSections = parseContentSections(hashContent);
  result.conclusion = extractStringValue(hashContent, 'conclusion');

  return result;
}

/**
 * Parse PATTERN 2: {{ blog_macros.blog_content( title, image, image_alt, intro, sections, toc, conclusion ) }}
 * Used by common, home, health, accidents, breakdown, cmr articles.
 * Arguments are passed directly to the macro, not via article_data.
 */
function parseMacroCallPattern(content, macroStart, result) {
  // Find the full macro call: blog_macros.blog_content( ... ) }}
  // We need to find the matching closing parenthesis
  const parenStart = content.indexOf('(', macroStart);
  let parenDepth = 1;
  let pos = parenStart + 1;
  while (pos < content.length && parenDepth > 0) {
    if (content[pos] === '(') parenDepth++;
    else if (content[pos] === ')') parenDepth--;
    pos++;
  }

  const macroArgs = content.substring(parenStart + 1, pos - 1);

  // The macro arguments are positional:
  // 1. title (string)
  // 2. image (asset call)
  // 3. image_alt (string)
  // 4. intro_text (string)
  // 5. content_sections (array of objects)
  // 6. toc_items (array of objects)
  // 7. conclusion (string or null)

  // Extract title — first string argument
  const titleMatch = macroArgs.match(/^\s*'((?:[^'\\]|\\.)*)'/s);
  if (titleMatch) {
    result.title = titleMatch[1].replace(/\\'/g, "'");
  }

  // Extract image path
  const imageMatch = macroArgs.match(/asset\(\s*'([^']*)'\s*\)/);
  if (imageMatch) result.imagePath = imageMatch[1];

  // Extract image_alt — the string after the asset() call
  // Find the second standalone string after the asset call
  const afterAsset = macroArgs.indexOf(')', macroArgs.indexOf('asset(')) + 1;
  const afterAssetStr = macroArgs.substring(afterAsset);
  const altMatch = afterAssetStr.match(/,\s*'((?:[^'\\]|\\.)*)'/s);
  if (altMatch) {
    result.imageAlt = altMatch[1].replace(/\\'/g, "'");
  }

  // Extract intro_text — the long string after image_alt
  // It's the 4th positional argument
  const introMatch = afterAssetStr.match(/,\s*'(?:[^'\\]|\\.)*'\s*,\s*'((?:[^'\\]|\\.)*)'/s);
  if (introMatch) {
    result.introText = introMatch[1].replace(/\\'/g, "'");
  }

  // Extract content_sections — the array [ { ... }, { ... } ]
  // Find the first top-level [ after the intro text
  result.contentSections = parseContentSections(macroArgs);

  // Extract toc_items — the second top-level array
  result.tocItems = [];
  // Find toc items by looking for {'title': '...', 'href': '...'} or {'href': '...', 'title': '...'}
  const tocRegex1 = /\{\s*'title'\s*:\s*'([^']*)'\s*,\s*'href'\s*:\s*'([^']*)'\s*\}/g;
  const tocRegex2 = /\{\s*'href'\s*:\s*'([^']*)'\s*,\s*'title'\s*:\s*'([^']*)'\s*\}/g;
  let tocM;

  // First check for content_sections toc (href, title order)
  const contentSectionsEnd = findContentSectionsEnd(macroArgs);
  const afterSections = contentSectionsEnd > 0 ? macroArgs.substring(contentSectionsEnd) : macroArgs;

  while ((tocM = tocRegex1.exec(afterSections)) !== null) {
    result.tocItems.push({ href: tocM[2], title: tocM[1] });
  }
  if (result.tocItems.length === 0) {
    while ((tocM = tocRegex2.exec(afterSections)) !== null) {
      result.tocItems.push({ href: tocM[1], title: tocM[2] });
    }
  }

  // If still no toc items, try from the full macro args (some have toc before sections)
  if (result.tocItems.length === 0) {
    const tocRegex3 = /\{\s*'title'\s*:\s*'([^']*)'\s*,\s*'href'\s*:\s*'([^']*)'\s*\}/g;
    while ((tocM = tocRegex3.exec(macroArgs)) !== null) {
      // Only add if href starts with #
      if (tocM[2].startsWith('#')) {
        result.tocItems.push({ href: tocM[2], title: tocM[1] });
      }
    }
  }

  return result;
}

/**
 * Find where the content_sections array ends in the macro args.
 */
function findContentSectionsEnd(text) {
  // Find the first [ that starts the content_sections array
  // It comes after the 4th string argument (intro_text)
  // Look for the pattern: intro_text string, then [
  let stringCount = 0;
  let i = 0;
  let inString = false;

  // Skip to after the 4th string argument
  while (i < text.length && stringCount < 4) {
    if (text[i] === "'" && (i === 0 || text[i - 1] !== '\\')) {
      inString = !inString;
      if (!inString) stringCount++;
    }
    i++;
  }

  // Now find the first [
  while (i < text.length && text[i] !== '[') i++;
  if (i >= text.length) return -1;

  // Find matching ]
  let bracketDepth = 1;
  i++;
  while (i < text.length && bracketDepth > 0) {
    if (text[i] === '[') bracketDepth++;
    else if (text[i] === ']') bracketDepth--;
    i++;
  }

  return i;
}

/**
 * Extract a simple string value: 'key': 'value'
 * Handles multi-line values and pipe-separated paragraphs.
 */
function extractStringValue(text, key) {
  // Match 'key': 'value' where value can contain escaped quotes
  const regex = new RegExp("'" + key + "'\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'", 's');
  const match = text.match(regex);
  if (match) {
    return match[1].replace(/\\'/g, "'").replace(/\\n/g, '\n');
  }
  return '';
}

/**
 * Parse content_sections from article_data hash or macro args.
 * Each section has: id, heading, content, subsections[], lists[], additional_content
 */
function parseContentSections(hashContent) {
  const sections = [];

  // Try Pattern 1: 'content_sections': [
  let csStart = hashContent.indexOf("'content_sections'");
  let arrStart;

  if (csStart !== -1) {
    arrStart = hashContent.indexOf('[', csStart);
  } else {
    // Pattern 2: direct array argument — find the first [ that contains objects with 'id' and 'heading'
    // Skip past the 4 string arguments (title, asset, alt, intro)
    let stringCount = 0;
    let i = 0;
    let inString = false;
    while (i < hashContent.length && stringCount < 4) {
      if (hashContent[i] === "'" && (i === 0 || hashContent[i - 1] !== '\\')) {
        inString = !inString;
        if (!inString) stringCount++;
      }
      i++;
    }
    // Find the next [
    while (i < hashContent.length && hashContent[i] !== '[') i++;
    arrStart = i < hashContent.length ? i : -1;
  }

  if (arrStart === -1 || arrStart >= hashContent.length) return sections;

  // Find the matching ]
  let bracketDepth = 1;
  let pos = arrStart + 1;
  while (pos < hashContent.length && bracketDepth > 0) {
    if (hashContent[pos] === '[') bracketDepth++;
    else if (hashContent[pos] === ']') bracketDepth--;
    pos++;
  }

  const sectionsStr = hashContent.substring(arrStart + 1, pos - 1);

  // Split into individual section objects by finding top-level { }
  const sectionObjects = splitTopLevelObjects(sectionsStr);

  for (const sectionStr of sectionObjects) {
    const section = {};

    section.id = extractStringValue(sectionStr, 'id');
    section.heading = extractStringValue(sectionStr, 'heading');
    section.content = extractStringValue(sectionStr, 'content');
    section.additionalContent = extractStringValue(sectionStr, 'additional_content');

    // Parse lists: 'lists': [ { 'title': '...', 'items': ['...', '...'], 'ordered': false } ]
    section.lists = [];
    const listsStart = sectionStr.indexOf("'lists'");
    if (listsStart !== -1) {
      const listsArrStart = sectionStr.indexOf('[', listsStart);
      if (listsArrStart !== -1) {
        let listBracketDepth = 1;
        let listPos = listsArrStart + 1;
        while (listPos < sectionStr.length && listBracketDepth > 0) {
          if (sectionStr[listPos] === '[') listBracketDepth++;
          else if (sectionStr[listPos] === ']') listBracketDepth--;
          listPos++;
        }
        const listsStr = sectionStr.substring(listsArrStart + 1, listPos - 1);
        const listObjects = splitTopLevelObjects(listsStr);

        for (const listStr of listObjects) {
          const list = {};
          list.title = extractStringValue(listStr, 'title');
          list.ordered = listStr.includes("'ordered': true");
          list.items = [];

          // Find 'items': [ ... ]
          const itemsStart = listStr.indexOf("'items'");
          if (itemsStart !== -1) {
            const itemsArrStart = listStr.indexOf('[', itemsStart);
            if (itemsArrStart !== -1) {
              let itemBracketDepth = 1;
              let itemPos = itemsArrStart + 1;
              while (itemPos < listStr.length && itemBracketDepth > 0) {
                if (listStr[itemPos] === '[') itemBracketDepth++;
                else if (listStr[itemPos] === ']') itemBracketDepth--;
                itemPos++;
              }
              const itemsStr = listStr.substring(itemsArrStart + 1, itemPos - 1);
              // Extract each string item
              const itemRegex = /'((?:[^'\\]|\\.)*)'/g;
              let itemMatch;
              while ((itemMatch = itemRegex.exec(itemsStr)) !== null) {
                const val = itemMatch[1].replace(/\\'/g, "'");
                if (val !== 'true' && val !== 'false' && val.length > 2) {
                  list.items.push(val);
                }
              }
            }
          }

          if (list.items.length > 0) {
            section.lists.push(list);
          }
        }
      }
    }

    // Parse section-level image
    const sectionImgMatch = sectionStr.match(/'image'\s*:\s*\{[\s\S]*?'src'\s*:\s*asset\(\s*'([^']*)'\s*\)[\s\S]*?'alt'\s*:\s*'([^']*)'/);
    if (sectionImgMatch) {
      section.imageSrc = sectionImgMatch[1];
      section.imageAlt = sectionImgMatch[2];
    }

    // Parse subsections
    section.subsections = [];
    const subStart = sectionStr.indexOf("'subsections'");
    if (subStart !== -1) {
      const subArrStart = sectionStr.indexOf('[', subStart);
      if (subArrStart !== -1) {
        let subBracketDepth = 1;
        let subPos = subArrStart + 1;
        while (subPos < sectionStr.length && subBracketDepth > 0) {
          if (sectionStr[subPos] === '[') subBracketDepth++;
          else if (sectionStr[subPos] === ']') subBracketDepth--;
          subPos++;
        }
        const subsStr = sectionStr.substring(subArrStart + 1, subPos - 1);
        const subObjects = splitTopLevelObjects(subsStr);

        for (const subStr of subObjects) {
          const sub = {};
          sub.subheading = extractStringValue(subStr, 'subheading');
          sub.content = extractStringValue(subStr, 'content');
          sub.additionalContent = extractStringValue(subStr, 'additional_content');

          // Check for subsection image
          const subImgMatch = subStr.match(/'image'\s*:\s*\{[\s\S]*?'src'\s*:\s*asset\(\s*'([^']*)'\s*\)[\s\S]*?'alt'\s*:\s*'([^']*)'/);
          if (subImgMatch) {
            sub.imageSrc = subImgMatch[1];
            sub.imageAlt = subImgMatch[2];
          }

          // Check for subsection lists
          sub.lists = [];
          const subListsStart = subStr.indexOf("'lists'");
          if (subListsStart !== -1) {
            const subListsArrStart = subStr.indexOf('[', subListsStart);
            if (subListsArrStart !== -1) {
              let slBracketDepth = 1;
              let slPos = subListsArrStart + 1;
              while (slPos < subStr.length && slBracketDepth > 0) {
                if (subStr[slPos] === '[') slBracketDepth++;
                else if (subStr[slPos] === ']') slBracketDepth--;
                slPos++;
              }
              const subListsStr = subStr.substring(subListsArrStart + 1, slPos - 1);
              const subListObjects = splitTopLevelObjects(subListsStr);
              for (const slStr of subListObjects) {
                const sl = {};
                sl.title = extractStringValue(slStr, 'title');
                sl.ordered = slStr.includes("'ordered': true");
                sl.items = [];
                const slItemsStart = slStr.indexOf("'items'");
                if (slItemsStart !== -1) {
                  const slItemsArrStart = slStr.indexOf('[', slItemsStart);
                  if (slItemsArrStart !== -1) {
                    let siBracketDepth = 1;
                    let siPos = slItemsArrStart + 1;
                    while (siPos < slStr.length && siBracketDepth > 0) {
                      if (slStr[siPos] === '[') siBracketDepth++;
                      else if (slStr[siPos] === ']') siBracketDepth--;
                      siPos++;
                    }
                    const siStr = slStr.substring(slItemsArrStart + 1, siPos - 1);
                    const siRegex = /'((?:[^'\\]|\\.)*)'/g;
                    let siMatch;
                    while ((siMatch = siRegex.exec(siStr)) !== null) {
                      const val = siMatch[1].replace(/\\'/g, "'");
                      if (val !== 'true' && val !== 'false' && val.length > 2) {
                        sl.items.push(val);
                      }
                    }
                  }
                }
                if (sl.items.length > 0) sub.lists.push(sl);
              }
            }
          }

          // Legacy: check for simple 'items' array (without 'lists' wrapper)
          if (sub.lists.length === 0) {
            const simpleListMatch = subStr.match(/'items'\s*:\s*\[([\s\S]*?)\]/);
            if (simpleListMatch) {
              const items = [];
              const itemRegex = /'((?:[^'\\]|\\.)*)'/g;
              let itemMatch;
              while ((itemMatch = itemRegex.exec(simpleListMatch[1])) !== null) {
                const val = itemMatch[1].replace(/\\'/g, "'");
                if (val.length > 2) items.push(val);
              }
              if (items.length > 0) {
                sub.lists.push({ title: '', ordered: false, items });
              }
            }
          }

          section.subsections.push(sub);
        }
      }
    }

    sections.push(section);
  }

  return sections;
}

/**
 * Split a string into top-level { } objects (not nested ones).
 */
function splitTopLevelObjects(str) {
  const objects = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (str[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(str.substring(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

/**
 * Fallback for articles that don't use article_data structure.
 */
function extractFallbackContent(content, result) {
  // Try to extract any meaningful content
  const workareaMatch = content.match(/\{%\s*block\s+workarea_content\s*%\}([\s\S]*?)\{%\s*endblock/);
  if (workareaMatch) {
    result.rawHtml = workareaMatch[1]
      .replace(/\{\{.*?\}\}/g, '')
      .replace(/\{%.*?%\}/g, '')
      .trim();
  }
  return result;
}

// =========================================================================
// Convert parsed article data → Strapi rich text (HTML string for blocks)
// =========================================================================

/**
 * Helper: add pipe-separated paragraphs to blocks array.
 */
function addParagraphs(blocks, text) {
  const paragraphs = text.split('|');
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (trimmed) {
      blocks.push({
        type: 'paragraph',
        children: parseInlineHtml(trimmed),
      });
    }
  }
}

function buildRichTextContent(parsed) {
  const blocks = [];

  // Intro text paragraphs
  if (parsed.introText) {
    const paragraphs = parsed.introText.split('|');
    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (trimmed) {
        blocks.push({
          type: 'paragraph',
          children: parseInlineHtml(trimmed),
        });
      }
    }
  }

  // Content sections
  if (parsed.contentSections) {
    for (const section of parsed.contentSections) {
      // Section heading (h2)
      if (section.heading) {
        blocks.push({
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: section.heading }],
        });
      }

      // Section content paragraphs
      if (section.content) {
        addParagraphs(blocks, section.content);
      }

      // Section-level lists
      if (section.lists && section.lists.length > 0) {
        for (const list of section.lists) {
          if (list.title) {
            blocks.push({
              type: 'paragraph',
              children: [{ type: 'text', text: list.title, bold: true }],
            });
          }
          blocks.push({
            type: 'list',
            format: list.ordered ? 'ordered' : 'unordered',
            children: list.items.map(item => ({
              type: 'list-item',
              children: parseInlineHtml(item.replace(/\\'/g, "'")),
            })),
          });
        }
      }

      // Section additional_content
      if (section.additionalContent) {
        addParagraphs(blocks, section.additionalContent);
      }

      // Subsections
      if (section.subsections) {
        for (const sub of section.subsections) {
          // Subsection heading (h3)
          if (sub.subheading) {
            blocks.push({
              type: 'heading',
              level: 3,
              children: [{ type: 'text', text: sub.subheading }],
            });
          }

          // Subsection content
          if (sub.content) {
            addParagraphs(blocks, sub.content);
          }

          // Subsection lists
          if (sub.lists && sub.lists.length > 0) {
            for (const list of sub.lists) {
              if (list.title) {
                blocks.push({
                  type: 'paragraph',
                  children: [{ type: 'text', text: list.title, bold: true }],
                });
              }
              blocks.push({
                type: 'list',
                format: list.ordered ? 'ordered' : 'unordered',
                children: list.items.map(item => ({
                  type: 'list-item',
                  children: parseInlineHtml(item.replace(/\\'/g, "'")),
                })),
              });
            }
          }

          // Subsection additional_content
          if (sub.additionalContent) {
            addParagraphs(blocks, sub.additionalContent);
          }
        }
      }
    }
  }

  // Conclusion
  if (parsed.conclusion) {
    const paragraphs = parsed.conclusion.split('|');
    for (const p of paragraphs) {
      const trimmed = p.trim();
      if (trimmed) {
        blocks.push({
          type: 'paragraph',
          children: parseInlineHtml(trimmed),
        });
      }
    }
  }

  // Fallback for raw HTML articles
  if (blocks.length === 0 && parsed.rawHtml) {
    blocks.push({
      type: 'paragraph',
      children: [{ type: 'text', text: parsed.rawHtml.substring(0, 2000) }],
    });
  }

  return blocks;
}

/**
 * Parse inline HTML (links, bold, italic) into Strapi text nodes.
 * Converts <a href="..."><strong>text</strong></a> into proper nodes.
 */
function parseInlineHtml(text) {
  const children = [];

  // Split by HTML tags while keeping them
  const parts = text.split(/(<a\s[^>]*>[\s\S]*?<\/a>|<strong>[\s\S]*?<\/strong>|<b>[\s\S]*?<\/b>|<em>[\s\S]*?<\/em>|<i>[\s\S]*?<\/i>)/);

  for (const part of parts) {
    if (!part) continue;

    // Check for <a href="...">...<strong>text</strong>...</a>
    const linkMatch = part.match(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (linkMatch) {
      const href = linkMatch[1];
      const innerText = linkMatch[2].replace(/<\/?strong>|<\/?b>|<\/?em>|<\/?i>/g, '').trim();
      const isBold = /<strong>|<b>/.test(linkMatch[2]);

      const node = { type: 'text', text: innerText, bold: isBold || undefined };
      // Strapi blocks don't support links inside paragraphs directly in all versions
      // Store as bold text with the URL context preserved
      if (isBold) {
        children.push({ type: 'text', text: innerText, bold: true });
      } else {
        children.push({ type: 'text', text: innerText });
      }
      continue;
    }

    // Check for standalone <strong>text</strong>
    const boldMatch = part.match(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/);
    if (boldMatch) {
      children.push({ type: 'text', text: boldMatch[1], bold: true });
      continue;
    }

    // Check for <em>text</em>
    const italicMatch = part.match(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/);
    if (italicMatch) {
      children.push({ type: 'text', text: italicMatch[1], italic: true });
      continue;
    }

    // Plain text
    if (part.trim()) {
      children.push({ type: 'text', text: part });
    }
  }

  // Ensure at least one child
  if (children.length === 0) {
    children.push({ type: 'text', text: text });
  }

  // Clean undefined properties
  return children.map(c => {
    const clean = { type: c.type, text: c.text };
    if (c.bold) clean.bold = true;
    if (c.italic) clean.italic = true;
    return clean;
  });
}

// =========================================================================
// Build Strapi payload
// =========================================================================

function buildStrapiPayload(parsed, system, slug, categoryDocId) {
  const content = buildRichTextContent(parsed);

  // Build excerpt from intro text
  let excerpt = '';
  if (parsed.introText) {
    excerpt = parsed.introText.replace(/\|/g, ' ').replace(/<[^>]*>/g, '').trim();
    if (excerpt.length > 490) excerpt = excerpt.substring(0, 490) + '...';
  } else if (parsed.title) {
    excerpt = parsed.title;
  }

  // Estimate reading time
  let wordCount = 0;
  const countWords = (blocks) => {
    for (const b of blocks) {
      if (b.children) {
        for (const c of b.children) {
          if (c.text) wordCount += c.text.split(/\s+/).filter(Boolean).length;
          if (c.children) countWords([c]);
        }
      }
    }
  };
  countWords(content);
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  const payload = {
    title: parsed.title || slug,
    slug: slug,
    excerpt: excerpt || slug,
    content: content,
    system: system === 'rcp' ? 'malpraxis' : system,
    metaTitle: (parsed.metaTitle || parsed.title || slug).substring(0, 70),
    metaDescription: (parsed.metaDescription || excerpt || '').substring(0, 160),
    tocItems: parsed.tocItems || [],
    readingTime: readingTime,
    reviewStatus: 'approved',
    authorName: 'Echipa asigurari.ro',
    featuredImageAlt: parsed.imageAlt || '',
  };

  if (categoryDocId) {
    payload.category = categoryDocId;
  }

  return { data: payload };
}

// =========================================================================
// Main migration
// =========================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('  Blog Migration: Static Twig → Strapi CMS');
  console.log('='.repeat(70));

  if (DRY_RUN) console.log('\n  *** DRY RUN — no data will be sent to Strapi ***\n');
  if (SYSTEM_FILTER) console.log(`  Filtering by system: ${SYSTEM_FILTER}\n`);
  if (LIMIT) console.log(`  Limit: ${LIMIT} articles\n`);

  if (!API_TOKEN && !DRY_RUN) {
    console.error('ERROR: No API token found. Create .api_token file or set STRAPI_API_TOKEN env var.');
    process.exit(1);
  }

  // 1. Fetch categories from Strapi to get documentIds
  console.log('\n--- Fetching categories from Strapi ---');
  const catMap = {};
  if (!DRY_RUN) {
    const catRes = await apiRequest('GET', '/api/categories?pagination[pageSize]=100');
    if (catRes.data && catRes.data.data) {
      for (const cat of catRes.data.data) {
        catMap[cat.slug] = cat.documentId;
        console.log(`  ${cat.slug} → ${cat.documentId}`);
      }
    }
  }

  // Map rcp → malpraxis category
  if (catMap['malpraxis']) {
    catMap['rcp'] = catMap['malpraxis'];
  }

  // 2. Scan all article files
  console.log('\n--- Scanning article files ---');
  const articles = [];

  for (const system of SYSTEM_DIRS) {
    if (SYSTEM_FILTER && system !== SYSTEM_FILTER) continue;

    const systemDir = path.join(BLOG_DIR, system);
    if (!fs.existsSync(systemDir)) {
      console.log(`  ${system}: directory not found, skipping`);
      continue;
    }

    const files = fs.readdirSync(systemDir).filter(f => {
      if (!f.endsWith('.html.twig')) return false;
      for (const skip of SKIP_FILES) {
        if (f.includes(skip)) return false;
      }
      return true;
    });

    console.log(`  ${system}: ${files.length} articles`);

    for (const file of files) {
      articles.push({
        system,
        slug: file.replace('.html.twig', ''),
        filePath: path.join(systemDir, file),
        fileName: file,
      });
    }
  }

  console.log(`\n  TOTAL: ${articles.length} articles to migrate`);

  // 3. Process each article
  const stats = { total: 0, success: 0, skipped: 0, failed: 0, errors: [] };
  const maxArticles = LIMIT > 0 ? Math.min(LIMIT, articles.length) : articles.length;

  console.log('\n--- Migrating articles ---\n');

  for (let i = 0; i < maxArticles; i++) {
    const article = articles[i];
    stats.total++;

    const prefix = `[${i + 1}/${maxArticles}] ${article.system}/${article.slug}`;

    try {
      // Parse the Twig file
      const parsed = parseTwigFile(article.filePath);

      if (!parsed || (!parsed.title && !parsed.introText && !parsed.rawHtml)) {
        console.log(`${prefix} → SKIP (no parseable content)`);
        stats.skipped++;
        continue;
      }

      // Build Strapi payload
      const categoryDocId = catMap[article.system] || null;
      const payload = buildStrapiPayload(parsed, article.system, article.slug, categoryDocId);

      if (DRY_RUN) {
        const contentBlocks = payload.data.content.length;
        console.log(`${prefix} → OK (title: "${(payload.data.title || '').substring(0, 60)}...", blocks: ${contentBlocks}, reading: ${payload.data.readingTime}min)`);
        stats.success++;
        continue;
      }

      // POST to Strapi
      const res = await apiRequest('POST', '/api/blog-posts', payload);

      if (res.status === 200 || res.status === 201) {
        const postId = res.data?.data?.id || res.data?.data?.documentId || '?';
        console.log(`${prefix} → CREATED (ID: ${postId})`);
        stats.success++;
      } else {
        const errMsg = res.data?.error?.message || JSON.stringify(res.data?.error || res.data).substring(0, 200);
        console.log(`${prefix} → FAIL (${res.status}: ${errMsg})`);
        stats.failed++;
        stats.errors.push({ article: `${article.system}/${article.slug}`, error: errMsg });
      }

      // Small delay to not overwhelm Strapi
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      console.log(`${prefix} → ERROR: ${err.message}`);
      stats.failed++;
      stats.errors.push({ article: `${article.system}/${article.slug}`, error: err.message });
    }
  }

  // 4. Summary
  console.log('\n' + '='.repeat(70));
  console.log('  Migration Summary');
  console.log('='.repeat(70));
  console.log(`  Total processed: ${stats.total}`);
  console.log(`  Success:         ${stats.success}`);
  console.log(`  Skipped:         ${stats.skipped}`);
  console.log(`  Failed:          ${stats.failed}`);

  if (stats.errors.length > 0) {
    console.log('\n  Errors:');
    for (const err of stats.errors) {
      console.log(`    - ${err.article}: ${err.error}`);
    }
  }

  console.log('\n' + (DRY_RUN ? '  Dry run complete. Run without --dry-run to migrate.' : '  Migration complete!'));
  console.log('  Original Twig files are UNTOUCHED.\n');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
