'use strict';

/**
 * Upload all blog images to Strapi media library and update posts with image references.
 *
 * Usage:
 *   node scripts/upload-images.js
 *   node scripts/upload-images.js --dry-run
 *   node scripts/upload-images.js --system=rca
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const API_TOKEN = fs.existsSync(path.join(__dirname, '..', '.api_token'))
  ? fs.readFileSync(path.join(__dirname, '..', '.api_token'), 'utf8').trim()
  : process.env.STRAPI_API_TOKEN || '';

const IMAGES_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/public/images/asigurari/blog');
const BLOG_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/views/common/asigurari/blog');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SYSTEM_FILTER = (args.find(a => a.startsWith('--system=')) || '').split('=')[1] || null;

// =========================================================================
// HTTP helpers
// =========================================================================

function apiGet(apiPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, STRAPI_URL);
    http.get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ error: data }); }
      });
    }).on('error', reject);
  });
}

function apiPut(apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, STRAPI_URL);
    const payload = JSON.stringify(body);
    const req = http.request({
      method: 'PUT',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${API_TOKEN}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Upload a file to Strapi media library using multipart/form-data.
 * We build the multipart request manually since we only have Node.js built-ins.
 */
function uploadFile(filePath, altText) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath);
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

    const fileInfo = JSON.stringify({ alternativeText: altText || fileName, name: fileName });

    // Build multipart body
    const parts = [];

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="${fileName}"\r\n` +
      `Content-Type: image/webp\r\n\r\n`
    ));
    parts.push(fileContent);
    parts.push(Buffer.from('\r\n'));

    // fileInfo part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="fileInfo"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      fileInfo + '\r\n'
    ));

    // Closing boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const url = new URL('/api/upload', STRAPI_URL);
    const req = http.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        Authorization: `Bearer ${API_TOKEN}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: Array.isArray(parsed) ? parsed[0] : parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: { raw: data.substring(0, 500) } });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// =========================================================================
// Parse Twig files to extract image paths per article
// =========================================================================

function extractImagePaths(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const images = { featured: null, featuredAlt: '', inline: [] };

  // Pattern 1: article_data with 'image': asset('...')
  const featuredMatch = content.match(/'image'\s*:\s*asset\(\s*'([^']*)'\s*\)/);
  if (featuredMatch) {
    images.featured = featuredMatch[1];
  }

  // Pattern 2: blog_macros.blog_content( title, asset('...'), alt, ...
  if (!images.featured) {
    const macroImgMatch = content.match(/blog_macros\.blog_content\(\s*'[^']*'\s*,\s*asset\(\s*'([^']*)'\s*\)/);
    if (macroImgMatch) {
      images.featured = macroImgMatch[1];
    }
  }

  // Featured image alt
  const altMatch = content.match(/'image_alt'\s*:\s*'([^']*)'/);
  if (altMatch) {
    images.featuredAlt = altMatch[1];
  } else {
    // Pattern 2: third argument after asset()
    const macroAltMatch = content.match(/blog_macros\.blog_content\(\s*'[^']*'\s*,\s*asset\([^)]*\)\s*,\s*'([^']*)'/);
    if (macroAltMatch) {
      images.featuredAlt = macroAltMatch[1];
    }
  }

  // Inline images in content_sections/subsections
  const inlineRegex = /'src'\s*:\s*asset\(\s*'([^']*)'\s*\)[\s\S]*?'alt'\s*:\s*'([^']*)'/g;
  let inlineMatch;
  while ((inlineMatch = inlineRegex.exec(content)) !== null) {
    images.inline.push({ path: inlineMatch[1], alt: inlineMatch[2] });
  }

  // Also check for section-level images: 'image': { 'src': asset('...'), 'alt': '...' }
  // These are already captured by the regex above

  return images;
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('  Blog Image Upload & Post Update');
  console.log('='.repeat(70));
  if (DRY_RUN) console.log('\n  *** DRY RUN ***\n');

  // Step 1: Get all posts from Strapi
  console.log('\n--- Fetching all posts from Strapi ---');
  let allPosts = [];
  let page = 1;
  while (true) {
    const res = await apiGet(`/api/blog-posts?pagination[page]=${page}&pagination[pageSize]=100&fields[0]=slug&fields[1]=system&fields[2]=featuredImageAlt&populate=featuredImage`);
    if (!res.data || res.data.length === 0) break;
    allPosts = allPosts.concat(res.data);
    if (page >= res.meta.pagination.pageCount) break;
    page++;
  }
  console.log(`  Found ${allPosts.length} posts in Strapi`);

  // Step 2: Build a map of all image files on disk
  console.log('\n--- Scanning image files ---');
  const imageFileMap = {}; // relative path -> absolute path
  const systems = fs.readdirSync(IMAGES_DIR).filter(d => fs.statSync(path.join(IMAGES_DIR, d)).isDirectory());
  let totalImages = 0;
  for (const sys of systems) {
    const sysDir = path.join(IMAGES_DIR, sys);
    const files = fs.readdirSync(sysDir).filter(f => f.endsWith('.webp') || f.endsWith('.jpg') || f.endsWith('.png'));
    for (const f of files) {
      const relPath = `bundles/main/images/asigurari/blog/${sys}/${f}`;
      imageFileMap[relPath] = path.join(sysDir, f);
      totalImages++;
    }
    console.log(`  ${sys}: ${files.length} images`);
  }
  console.log(`  Total: ${totalImages} images`);

  // Step 3: For each post, find its Twig file, extract image paths, upload, and update
  console.log('\n--- Processing posts ---\n');

  // Track uploaded images to avoid duplicates
  const uploadedImages = {}; // relPath -> strapi media ID
  const stats = { uploaded: 0, linked: 0, skipped: 0, failed: 0, errors: [] };

  for (let i = 0; i < allPosts.length; i++) {
    const post = allPosts[i];
    const prefix = `[${i + 1}/${allPosts.length}] ${post.system}/${post.slug}`;

    // Find the Twig file
    const twigDir = post.system === 'malpraxis' ? 'rcp' : post.system;
    const twigPath = path.join(BLOG_DIR, twigDir, post.slug + '.html.twig');

    if (!fs.existsSync(twigPath)) {
      console.log(`${prefix} → SKIP (no twig file)`);
      stats.skipped++;
      continue;
    }

    try {
      const images = extractImagePaths(twigPath);

      if (!images.featured) {
        console.log(`${prefix} → SKIP (no featured image)`);
        stats.skipped++;
        continue;
      }

      // Check if post already has a featured image
      if (post.featuredImage && post.featuredImage.url) {
        console.log(`${prefix} → SKIP (already has image)`);
        stats.skipped++;
        continue;
      }

      // Resolve the image file on disk
      const imgAbsPath = imageFileMap[images.featured];
      if (!imgAbsPath) {
        console.log(`${prefix} → SKIP (image not found: ${images.featured})`);
        stats.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`${prefix} → WOULD upload ${path.basename(imgAbsPath)} + ${images.inline.length} inline`);
        stats.linked++;
        continue;
      }

      // Upload featured image (or reuse if already uploaded)
      let mediaId;
      if (uploadedImages[images.featured]) {
        mediaId = uploadedImages[images.featured];
      } else {
        const uploadRes = await uploadFile(imgAbsPath, images.featuredAlt || post.slug);
        if (uploadRes.status === 200 || uploadRes.status === 201) {
          mediaId = uploadRes.data.id;
          uploadedImages[images.featured] = mediaId;
          stats.uploaded++;
        } else {
          const errMsg = JSON.stringify(uploadRes.data).substring(0, 200);
          console.log(`${prefix} → FAIL upload (${uploadRes.status}: ${errMsg})`);
          stats.failed++;
          stats.errors.push({ post: `${post.system}/${post.slug}`, error: `Upload failed: ${errMsg}` });
          continue;
        }
      }

      // Update the post with the featured image
      const updateRes = await apiPut(`/api/blog-posts/${post.documentId}`, {
        data: {
          featuredImage: mediaId,
          featuredImageAlt: images.featuredAlt || '',
        },
      });

      if (updateRes.status === 200) {
        console.log(`${prefix} → OK (media ID: ${mediaId})`);
        stats.linked++;
      } else {
        const errMsg = JSON.stringify(updateRes.data).substring(0, 200);
        console.log(`${prefix} → FAIL update (${updateRes.status}: ${errMsg})`);
        stats.failed++;
        stats.errors.push({ post: `${post.system}/${post.slug}`, error: `Update failed: ${errMsg}` });
      }

      // Delay to avoid Windows EBUSY temp file locking
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.log(`${prefix} → ERROR: ${err.message}`);
      stats.failed++;
      stats.errors.push({ post: `${post.system}/${post.slug}`, error: err.message });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  Image Upload Summary');
  console.log('='.repeat(70));
  console.log(`  Images uploaded:  ${stats.uploaded}`);
  console.log(`  Posts linked:     ${stats.linked}`);
  console.log(`  Skipped:          ${stats.skipped}`);
  console.log(`  Failed:           ${stats.failed}`);

  if (stats.errors.length > 0) {
    console.log('\n  Errors:');
    for (const err of stats.errors) {
      console.log(`    - ${err.post}: ${err.error}`);
    }
  }

  console.log('\n  Done!\n');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
