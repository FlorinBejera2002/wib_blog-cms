'use strict';

/**
 * Upload all blog images to Strapi media library, one at a time.
 * Then link each post's featuredImage relation to the uploaded media.
 *
 * Handles Windows EBUSY issue with long delays between uploads.
 *
 * Usage:
 *   node scripts/upload-all-images.js
 *   node scripts/upload-all-images.js --dry-run
 *   node scripts/upload-all-images.js --skip-upload   (only link posts, images already uploaded)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const STRAPI_URL = 'http://localhost:1337';
const API_TOKEN = fs.readFileSync(path.join(__dirname, '..', '.api_token'), 'utf8').trim();
const IMAGES_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/public/images/asigurari/blog');
const BLOG_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/views/common/asigurari/blog');

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_UPLOAD = process.argv.includes('--skip-upload');
const DELAY_MS = 2500; // 2.5s between uploads to avoid EBUSY
const MAX_RETRIES = 3;

// =========================================================================
// HTTP helpers
// =========================================================================

function apiGet(apiPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, STRAPI_URL);
    http.get({
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(d); } });
    }).on('error', reject);
  });
}

function apiPut(apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, STRAPI_URL);
    const payload = JSON.stringify(body);
    const req = http.request({
      method: 'PUT',
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${API_TOKEN}`,
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, data: d }); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function uploadFile(filePath, altText) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath);
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const fileInfo = JSON.stringify({ alternativeText: altText || '', name: fileName });

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
      hostname: url.hostname, port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        Authorization: `Bearer ${API_TOKEN}`,
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          resolve({ status: res.statusCode, data: Array.isArray(parsed) ? parsed[0] : parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: { raw: d.substring(0, 300) } });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function uploadWithRetry(filePath, altText) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await uploadFile(filePath, altText);
    if (result.status === 200 || result.status === 201) {
      return result;
    }
    if (attempt < MAX_RETRIES) {
      const wait = DELAY_MS * attempt;
      console.log(`    retry ${attempt}/${MAX_RETRIES} in ${wait}ms...`);
      await sleep(wait);
    } else {
      return result;
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// =========================================================================
// Twig image extraction
// =========================================================================

function extractImageInfo(twigPath) {
  const content = fs.readFileSync(twigPath, 'utf8');
  let imgPath = null, imgAlt = '';

  const m1 = content.match(/'image'\s*:\s*asset\(\s*'([^']*)'\s*\)/);
  if (m1) imgPath = m1[1];
  if (!imgPath) {
    const m2 = content.match(/blog_macros\.blog_content\(\s*'[^']*'\s*,\s*asset\(\s*'([^']*)'\s*\)/);
    if (m2) imgPath = m2[1];
  }

  const a1 = content.match(/'image_alt'\s*:\s*'([^']*)'/);
  if (a1) imgAlt = a1[1];
  if (!imgAlt) {
    const a2 = content.match(/blog_macros\.blog_content\(\s*'[^']*'\s*,\s*asset\([^)]*\)\s*,\s*'([^']*)'/);
    if (a2) imgAlt = a2[1];
  }

  return { imgPath, imgAlt };
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('  Upload Blog Images to Strapi & Link to Posts');
  console.log('='.repeat(70));
  if (DRY_RUN) console.log('  *** DRY RUN ***');
  if (SKIP_UPLOAD) console.log('  *** SKIP UPLOAD (link only) ***');

  // 1. Inventory all images on disk
  console.log('\n--- Scanning images ---');
  const allImages = []; // { system, fileName, filePath }
  const systems = fs.readdirSync(IMAGES_DIR).filter(d => fs.statSync(path.join(IMAGES_DIR, d)).isDirectory());
  for (const sys of systems) {
    const files = fs.readdirSync(path.join(IMAGES_DIR, sys)).filter(f => f.endsWith('.webp'));
    for (const f of files) {
      allImages.push({ system: sys, fileName: f, filePath: path.join(IMAGES_DIR, sys, f) });
    }
  }
  console.log(`  ${allImages.length} images found\n`);

  // 2. Check what's already in Strapi media library
  console.log('--- Checking existing media ---');
  let existingMedia = [];
  const mediaRes = await apiGet('/api/upload/files?fields[0]=id&fields[1]=name&pagination[pageSize]=500');
  if (Array.isArray(mediaRes)) {
    existingMedia = mediaRes;
  }
  const existingByName = {};
  for (const m of existingMedia) {
    existingByName[m.name] = m.id;
  }
  console.log(`  ${existingMedia.length} files already in media library\n`);

  // 3. Upload missing images
  const uploadedMap = { ...existingByName }; // fileName -> mediaId
  let uploaded = 0, skippedExisting = 0, failedUpload = 0;

  if (!SKIP_UPLOAD) {
    console.log('--- Uploading images (one at a time) ---\n');
    for (let i = 0; i < allImages.length; i++) {
      const img = allImages[i];
      const prefix = `[${i + 1}/${allImages.length}]`;

      if (existingByName[img.fileName]) {
        skippedExisting++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`${prefix} WOULD upload ${img.system}/${img.fileName}`);
        uploaded++;
        continue;
      }

      const result = await uploadWithRetry(img.filePath, img.fileName.replace('.webp', '').replace(/-/g, ' '));
      if (result.status === 200 || result.status === 201) {
        uploadedMap[img.fileName] = result.data.id;
        uploaded++;
        if (uploaded % 10 === 0) console.log(`${prefix} uploaded ${uploaded} so far...`);
      } else {
        failedUpload++;
        const err = JSON.stringify(result.data).substring(0, 150);
        console.log(`${prefix} FAIL ${img.system}/${img.fileName}: ${err}`);
      }

      // Critical: wait between uploads to avoid Windows EBUSY
      await sleep(DELAY_MS);
    }

    console.log(`\n  Uploaded: ${uploaded}, Skipped (existing): ${skippedExisting}, Failed: ${failedUpload}\n`);
  }

  // 4. Fetch all posts and link featuredImage
  console.log('--- Linking posts to media ---\n');
  let allPosts = [];
  let page = 1;
  while (true) {
    const r = await apiGet(`/api/blog-posts?pagination[page]=${page}&pagination[pageSize]=100&fields[0]=slug&fields[1]=system&fields[2]=featuredImageUrl&fields[3]=featuredImageAlt&populate=featuredImage`);
    if (!r.data || r.data.length === 0) break;
    allPosts = allPosts.concat(r.data);
    if (page >= r.meta.pagination.pageCount) break;
    page++;
  }
  console.log(`  ${allPosts.length} posts\n`);

  let linked = 0, skippedLink = 0, failedLink = 0;

  for (let i = 0; i < allPosts.length; i++) {
    const post = allPosts[i];
    const prefix = `[${i + 1}/${allPosts.length}]`;

    // Skip if already has featuredImage media relation
    if (post.featuredImage && post.featuredImage.id) {
      skippedLink++;
      continue;
    }

    // Get image filename from featuredImageUrl
    if (!post.featuredImageUrl) {
      skippedLink++;
      continue;
    }

    const fileName = path.basename(post.featuredImageUrl);
    const mediaId = uploadedMap[fileName];

    if (!mediaId) {
      // Image might have same name in different category — try twig extraction
      const twigDir = post.system === 'malpraxis' ? 'rcp' : post.system;
      const twigPath = path.join(BLOG_DIR, twigDir, post.slug + '.html.twig');
      if (fs.existsSync(twigPath)) {
        const { imgPath } = extractImageInfo(twigPath);
        if (imgPath) {
          const exactName = path.basename(imgPath);
          if (uploadedMap[exactName]) {
            // Found it
            if (DRY_RUN) {
              console.log(`${prefix} WOULD link ${post.system}/${post.slug} -> ${exactName}`);
              linked++;
              continue;
            }
            const r = await apiPut(`/api/blog-posts/${post.documentId}`, { data: { featuredImage: uploadedMap[exactName] } });
            if (r.status === 200) { linked++; } else { failedLink++; }
            await sleep(50);
            continue;
          }
        }
      }
      skippedLink++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`${prefix} WOULD link ${post.system}/${post.slug} -> ${fileName} (ID: ${mediaId})`);
      linked++;
      continue;
    }

    const r = await apiPut(`/api/blog-posts/${post.documentId}`, { data: { featuredImage: mediaId } });
    if (r.status === 200) {
      linked++;
      if (linked % 20 === 0) console.log(`  ... linked ${linked}`);
    } else {
      failedLink++;
      console.log(`${prefix} FAIL link ${post.slug}: ${r.status}`);
    }
    await sleep(50);
  }

  console.log('\n' + '='.repeat(70));
  console.log('  Summary');
  console.log('='.repeat(70));
  console.log(`  Images uploaded:  ${uploaded}`);
  console.log(`  Images skipped:   ${skippedExisting}`);
  console.log(`  Images failed:    ${failedUpload}`);
  console.log(`  Posts linked:     ${linked}`);
  console.log(`  Posts skipped:    ${skippedLink}`);
  console.log(`  Posts link fail:  ${failedLink}`);
  console.log('');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
