'use strict';

/**
 * Register pre-copied images in Strapi's files table and link them to blog posts.
 * 
 * Images are already in public/uploads/blog/{system}/{filename}.webp
 * This script:
 *   1. Reads each post from Strapi
 *   2. Finds the corresponding Twig file to get the image path
 *   3. Registers the image in Strapi's upload plugin via direct DB insert
 *   4. Links the image to the post as featuredImage
 *
 * Usage:
 *   node scripts/register-images.js
 *   node scripts/register-images.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const API_TOKEN = fs.existsSync(path.join(__dirname, '..', '.api_token'))
  ? fs.readFileSync(path.join(__dirname, '..', '.api_token'), 'utf8').trim()
  : '';
const ADMIN_TOKEN = fs.existsSync(path.join(__dirname, '..', '.admin_token'))
  ? fs.readFileSync(path.join(__dirname, '..', '.admin_token'), 'utf8').trim()
  : '';

const BLOG_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/views/common/asigurari/blog');
const UPLOADS_DIR = path.resolve(__dirname, '../public/uploads/blog');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// =========================================================================
// HTTP helpers
// =========================================================================

function apiRequest(method, apiPath, body = null, token = API_TOKEN) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, STRAPI_URL);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, data: { raw: data.substring(0, 500) } }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Upload a single file via multipart form — with retry and longer delay.
 */
function uploadFileWithRetry(filePath, altText, retries = 3) {
  return new Promise(async (resolve) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await uploadFileSingle(filePath, altText);
        if (result.status === 200 || result.status === 201) {
          resolve(result);
          return;
        }
        // If 500, wait longer and retry
        if (result.status === 500 && attempt < retries) {
          console.log(`    Retry ${attempt}/${retries} for ${path.basename(filePath)}...`);
          await new Promise(r => setTimeout(r, 2000 * attempt));
          continue;
        }
        resolve(result);
        return;
      } catch (err) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
          continue;
        }
        resolve({ status: 0, data: { error: err.message } });
      }
    }
  });
}

function uploadFileSingle(filePath, altText) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath);
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const fileInfo = JSON.stringify({ alternativeText: altText || fileName, name: fileName });

    const parts = [];
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="${fileName}"\r\n` +
      `Content-Type: image/webp\r\n\r\n`
    ));
    parts.push(fileContent);
    parts.push(Buffer.from('\r\n'));
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="fileInfo"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      fileInfo + '\r\n'
    ));
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
// Extract image paths from Twig
// =========================================================================

function extractImageInfo(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let imagePath = null;
  let imageAlt = '';

  // Pattern 1: article_data 'image': asset('...')
  const m1 = content.match(/'image'\s*:\s*asset\(\s*'([^']*)'\s*\)/);
  if (m1) imagePath = m1[1];

  // Pattern 2: blog_macros.blog_content( title, asset('...'), ...
  if (!imagePath) {
    const m2 = content.match(/blog_macros\.blog_content\(\s*'[^']*'\s*,\s*asset\(\s*'([^']*)'\s*\)/);
    if (m2) imagePath = m2[1];
  }

  // Alt text
  const a1 = content.match(/'image_alt'\s*:\s*'([^']*)'/);
  if (a1) imageAlt = a1[1];
  if (!imageAlt) {
    const a2 = content.match(/blog_macros\.blog_content\(\s*'[^']*'\s*,\s*asset\([^)]*\)\s*,\s*'([^']*)'/);
    if (a2) imageAlt = a2[1];
  }

  return { imagePath, imageAlt };
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('  Register Images & Link to Posts');
  console.log('='.repeat(70));
  if (DRY_RUN) console.log('\n  *** DRY RUN ***\n');

  // Fetch all posts
  console.log('\n--- Fetching posts ---');
  let allPosts = [];
  let page = 1;
  while (true) {
    const res = await apiRequest('GET', `/api/blog-posts?pagination[page]=${page}&pagination[pageSize]=100&fields[0]=slug&fields[1]=system&fields[2]=featuredImageAlt&populate=featuredImage`);
    if (!res.data.data || res.data.data.length === 0) break;
    allPosts = allPosts.concat(res.data.data);
    if (page >= res.data.meta.pagination.pageCount) break;
    page++;
  }
  console.log(`  ${allPosts.length} posts`);

  const stats = { uploaded: 0, linked: 0, skipped: 0, failed: 0, errors: [] };
  const uploadedCache = {}; // imagePath -> mediaId

  console.log('\n--- Processing ---\n');

  for (let i = 0; i < allPosts.length; i++) {
    const post = allPosts[i];
    const prefix = `[${i + 1}/${allPosts.length}] ${post.system}/${post.slug}`;

    // Skip if already has image
    if (post.featuredImage && post.featuredImage.url) {
      console.log(`${prefix} → SKIP (has image)`);
      stats.skipped++;
      continue;
    }

    // Find Twig file
    const twigDir = post.system === 'malpraxis' ? 'rcp' : post.system;
    const twigPath = path.join(BLOG_DIR, twigDir, post.slug + '.html.twig');
    if (!fs.existsSync(twigPath)) {
      console.log(`${prefix} → SKIP (no twig)`);
      stats.skipped++;
      continue;
    }

    const { imagePath, imageAlt } = extractImageInfo(twigPath);
    if (!imagePath) {
      console.log(`${prefix} → SKIP (no image in twig)`);
      stats.skipped++;
      continue;
    }

    // Resolve to the copied file in public/uploads/blog/
    // imagePath is like: bundles/main/images/asigurari/blog/rca/masina-la-service.webp
    const parts = imagePath.split('/');
    const system = parts[parts.length - 2]; // e.g. rca
    const fileName = parts[parts.length - 1]; // e.g. masina-la-service.webp
    const localFile = path.join(UPLOADS_DIR, system, fileName);

    if (!fs.existsSync(localFile)) {
      console.log(`${prefix} → SKIP (file not found: ${system}/${fileName})`);
      stats.skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`${prefix} → WOULD upload ${system}/${fileName}`);
      stats.linked++;
      continue;
    }

    // Upload (with retry) or reuse cached
    let mediaId;
    if (uploadedCache[imagePath]) {
      mediaId = uploadedCache[imagePath];
    } else {
      const uploadRes = await uploadFileWithRetry(localFile, imageAlt || post.slug);
      if (uploadRes.status === 200 || uploadRes.status === 201) {
        mediaId = uploadRes.data.id;
        uploadedCache[imagePath] = mediaId;
        stats.uploaded++;
      } else {
        const errMsg = JSON.stringify(uploadRes.data).substring(0, 200);
        console.log(`${prefix} → FAIL upload (${uploadRes.status}: ${errMsg})`);
        stats.failed++;
        stats.errors.push({ post: `${post.system}/${post.slug}`, error: errMsg });
        // Wait extra long after failure
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
    }

    // Link to post
    const updateRes = await apiRequest('PUT', `/api/blog-posts/${post.documentId}`, {
      data: { featuredImage: mediaId, featuredImageAlt: imageAlt || '' },
    });

    if (updateRes.status === 200) {
      console.log(`${prefix} → OK (media: ${mediaId})`);
      stats.linked++;
    } else {
      console.log(`${prefix} → FAIL link (${updateRes.status})`);
      stats.failed++;
    }

    // Wait between uploads to avoid EBUSY
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n' + '='.repeat(70));
  console.log('  Summary');
  console.log('='.repeat(70));
  console.log(`  Uploaded:  ${stats.uploaded}`);
  console.log(`  Linked:    ${stats.linked}`);
  console.log(`  Skipped:   ${stats.skipped}`);
  console.log(`  Failed:    ${stats.failed}`);
  if (stats.errors.length > 0) {
    console.log('\n  Errors:');
    stats.errors.forEach(e => console.log(`    - ${e.post}: ${e.error}`));
  }
  console.log('');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
