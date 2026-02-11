'use strict';

/**
 * Set featuredImageUrl on all blog posts by reading the Twig source files.
 * Images stay on the Symfony server — we just store the asset path.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const STRAPI_URL = 'http://localhost:1337';
const API_TOKEN = fs.readFileSync(path.join(__dirname, '..', '.api_token'), 'utf8').trim();
const BLOG_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/views/common/asigurari/blog');

function api(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, STRAPI_URL);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_TOKEN}` },
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, d: JSON.parse(d) }); } catch (e) { resolve({ s: res.statusCode, d }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractImageInfo(twigPath) {
  const content = fs.readFileSync(twigPath, 'utf8');
  let imgPath = null, imgAlt = '';

  // Pattern 1: article_data
  const m1 = content.match(/'image'\s*:\s*asset\(\s*'([^']*)'\s*\)/);
  if (m1) imgPath = m1[1];
  // Pattern 2: macro call
  if (!imgPath) {
    const m2 = content.match(/blog_macros\.blog_content\(\s*'[^']*'\s*,\s*asset\(\s*'([^']*)'\s*\)/);
    if (m2) imgPath = m2[1];
  }
  // Alt
  const a1 = content.match(/'image_alt'\s*:\s*'([^']*)'/);
  if (a1) imgAlt = a1[1];
  if (!imgAlt) {
    const a2 = content.match(/blog_macros\.blog_content\(\s*'[^']*'\s*,\s*asset\([^)]*\)\s*,\s*'([^']*)'/);
    if (a2) imgAlt = a2[1];
  }
  return { imgPath, imgAlt };
}

async function main() {
  console.log('Setting featuredImageUrl on all posts...\n');

  // Fetch all posts
  let posts = [];
  let page = 1;
  while (true) {
    const r = await api('GET', `/api/blog-posts?pagination[page]=${page}&pagination[pageSize]=100&fields[0]=slug&fields[1]=system&fields[2]=featuredImageUrl&fields[3]=featuredImageAlt`);
    if (!r.d.data || r.d.data.length === 0) break;
    posts = posts.concat(r.d.data);
    if (page >= r.d.meta.pagination.pageCount) break;
    page++;
  }
  console.log(`Found ${posts.length} posts\n`);

  let updated = 0, skipped = 0, failed = 0;

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const prefix = `[${i + 1}/${posts.length}] ${p.system}/${p.slug}`;

    // Skip if already set
    if (p.featuredImageUrl) {
      skipped++;
      continue;
    }

    const twigDir = p.system === 'malpraxis' ? 'rcp' : p.system;
    const twigPath = path.join(BLOG_DIR, twigDir, p.slug + '.html.twig');
    if (!fs.existsSync(twigPath)) {
      console.log(`${prefix} → SKIP (no twig)`);
      skipped++;
      continue;
    }

    const { imgPath, imgAlt } = extractImageInfo(twigPath);
    if (!imgPath) {
      console.log(`${prefix} → SKIP (no image)`);
      skipped++;
      continue;
    }

    // Convert asset path to URL: bundles/main/images/... → /bundles/main/images/...
    const imageUrl = '/' + imgPath;

    const r = await api('PUT', `/api/blog-posts/${p.documentId}`, {
      data: { featuredImageUrl: imageUrl, featuredImageAlt: imgAlt || '' },
    });

    if (r.s === 200) {
      updated++;
      if (updated % 20 === 0) console.log(`  ... ${updated} updated`);
    } else {
      console.log(`${prefix} → FAIL (${r.s})`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
