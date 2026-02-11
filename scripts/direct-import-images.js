'use strict';

/**
 * Directly import blog images into Strapi by:
 * 1. Copying files to public/uploads/
 * 2. Inserting records into SQLite files table
 * 3. Linking posts to their featuredImage via the files_related_mph table
 *
 * This bypasses the upload API entirely, avoiding the Windows EBUSY issue.
 *
 * IMPORTANT: Run this with Strapi STOPPED to avoid DB lock conflicts.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../.tmp/data.db');
const UPLOADS_DIR = path.resolve(__dirname, '../public/uploads');
const IMAGES_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/public/images/asigurari/blog');
const BLOG_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/views/common/asigurari/blog');

// =========================================================================
// Image info from Twig
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

function getImageDimensions(filePath) {
  // Basic webp header parsing for dimensions
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const type = buf.toString('ascii', 12, 16);
      if (type === 'VP8 ' && buf.length > 30) {
        // Lossy
        const w = (buf.readUInt16LE(26) & 0x3FFF);
        const h = (buf.readUInt16LE(28) & 0x3FFF);
        return { width: w, height: h };
      } else if (type === 'VP8L' && buf.length > 25) {
        // Lossless
        const bits = buf.readUInt32LE(21);
        const w = (bits & 0x3FFF) + 1;
        const h = ((bits >> 14) & 0x3FFF) + 1;
        return { width: w, height: h };
      } else if (type === 'VP8X' && buf.length > 30) {
        // Extended
        const w = 1 + ((buf[24]) | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + ((buf[27]) | (buf[28] << 8) | (buf[29] << 16));
        return { width: w, height: h };
      }
    }
  } catch (e) {}
  return { width: null, height: null };
}

// =========================================================================
// Main
// =========================================================================

function main() {
  console.log('='.repeat(70));
  console.log('  Direct Image Import into Strapi DB');
  console.log('='.repeat(70));

  // Open DB
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // 1. Discover DB schema for files
  console.log('\n--- Checking DB schema ---');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const tableNames = tables.map(t => t.name);
  console.log('Tables:', tableNames.join(', '));

  // Find the files table
  const filesTable = tableNames.find(t => t === 'files') || tableNames.find(t => t.includes('file'));
  if (!filesTable) {
    console.error('No files table found!');
    process.exit(1);
  }
  console.log('Files table:', filesTable);

  // Get columns
  const cols = db.prepare(`PRAGMA table_info(${filesTable})`).all();
  console.log('Columns:', cols.map(c => c.name + '(' + c.type + ')').join(', '));

  // Find the relation table for files
  const relTable = tableNames.find(t => t.includes('files_related') || t.includes('file_morph'));
  console.log('Relation table:', relTable || 'NOT FOUND');
  if (relTable) {
    const relCols = db.prepare(`PRAGMA table_info(${relTable})`).all();
    console.log('Relation columns:', relCols.map(c => c.name + '(' + c.type + ')').join(', '));
  }

  // Check existing files count
  const existingCount = db.prepare(`SELECT COUNT(*) as cnt FROM ${filesTable}`).get().cnt;
  console.log('Existing files in DB:', existingCount);

  // Find blog_posts table
  const postsTable = tableNames.find(t => t.includes('blog_post') && !t.includes('component') && !t.includes('link'));
  console.log('Posts table:', postsTable || 'NOT FOUND');
  if (postsTable) {
    const postCols = db.prepare(`PRAGMA table_info(${postsTable})`).all();
    console.log('Post columns:', postCols.map(c => c.name).join(', '));
  }

  // 2. Scan all images
  console.log('\n--- Scanning images ---');
  const allImages = [];
  const systems = fs.readdirSync(IMAGES_DIR).filter(d => fs.statSync(path.join(IMAGES_DIR, d)).isDirectory());
  for (const sys of systems) {
    const files = fs.readdirSync(path.join(IMAGES_DIR, sys)).filter(f => f.endsWith('.webp'));
    for (const f of files) {
      allImages.push({ system: sys, fileName: f, filePath: path.join(IMAGES_DIR, sys, f) });
    }
  }
  console.log(`  ${allImages.length} images found`);

  // 3. Copy files and insert DB records
  console.log('\n--- Importing images ---');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const now = new Date().toISOString();
  const insertedMap = {}; // "system/fileName" -> file DB id

  // Check what's already uploaded (by name)
  const existingFiles = db.prepare(`SELECT id, name FROM ${filesTable}`).all();
  const existingByName = {};
  for (const f of existingFiles) {
    existingByName[f.name] = f.id;
  }

  let inserted = 0, skipped = 0;

  const insertStmt = db.prepare(`
    INSERT INTO ${filesTable} (
      document_id, name, alternative_text, caption, width, height,
      formats, hash, ext, mime, size, url, preview_url,
      provider, provider_metadata, folder_path,
      created_at, updated_at, published_at, locale
    ) VALUES (
      @document_id, @name, @alternative_text, @caption, @width, @height,
      @formats, @hash, @ext, @mime, @size, @url, @preview_url,
      @provider, @provider_metadata, @folder_path,
      @created_at, @updated_at, @published_at, @locale
    )
  `);

  const insertMany = db.transaction(() => {
    for (const img of allImages) {
      const key = `${img.system}/${img.fileName}`;

      // Generate unique hash for the file
      const hash = crypto.createHash('md5').update(fs.readFileSync(img.filePath)).digest('hex').substring(0, 10);
      const uniqueName = img.fileName.replace('.webp', '') + '_' + hash;

      // Destination: /uploads/{uniqueName}.webp
      const destFile = path.join(UPLOADS_DIR, uniqueName + '.webp');
      const urlPath = '/uploads/' + uniqueName + '.webp';

      // Skip if already exists by original name
      if (existingByName[img.fileName]) {
        insertedMap[key] = existingByName[img.fileName];
        skipped++;
        continue;
      }

      // Copy file
      fs.copyFileSync(img.filePath, destFile);

      // Get dimensions
      const { width, height } = getImageDimensions(img.filePath);
      const fileSize = (fs.statSync(img.filePath).size / 1024).toFixed(2);

      const docId = crypto.randomBytes(16).toString('hex').substring(0, 24);
      const altText = img.fileName.replace('.webp', '').replace(/-/g, ' ');

      insertStmt.run({
        document_id: docId,
        name: img.fileName,
        alternative_text: altText,
        caption: null,
        width: width,
        height: height,
        formats: null,
        hash: uniqueName,
        ext: '.webp',
        mime: 'image/webp',
        size: parseFloat(fileSize),
        url: urlPath,
        preview_url: null,
        provider: 'local',
        provider_metadata: null,
        folder_path: '/',
        created_at: now,
        updated_at: now,
        published_at: now,
        locale: null,
      });

      const fileId = db.prepare(`SELECT id FROM ${filesTable} WHERE hash = ?`).get(uniqueName).id;
      insertedMap[key] = fileId;
      inserted++;
    }
  });

  insertMany();
  console.log(`  Inserted: ${inserted}, Skipped: ${skipped}`);

  // 4. Link posts to their featured images
  console.log('\n--- Linking posts to images ---');

  if (!relTable) {
    console.log('  No relation table found — cannot link. You may need to do this via API after restart.');
    db.close();
    return;
  }

  // Get all posts
  const posts = db.prepare(`SELECT id, document_id, slug, system, featured_image_url FROM ${postsTable}`).all();
  console.log(`  ${posts.length} posts`);

  // Check existing relations
  const existingRels = db.prepare(`SELECT * FROM ${relTable} WHERE field = 'featuredImage' LIMIT 5`).all();
  console.log(`  Existing featuredImage relations: ${existingRels.length}`);

  // Get relation table columns to understand structure
  const relCols2 = db.prepare(`PRAGMA table_info(${relTable})`).all();
  const relColNames = relCols2.map(c => c.name);
  console.log('  Relation columns:', relColNames.join(', '));

  // Sample existing relation to understand format
  const sampleRel = db.prepare(`SELECT * FROM ${relTable} LIMIT 1`).get();
  if (sampleRel) {
    console.log('  Sample relation:', JSON.stringify(sampleRel));
  }

  let linked = 0, skippedLink = 0;

  for (const post of posts) {
    if (!post.featured_image_url) {
      skippedLink++;
      continue;
    }

    // Extract system/fileName from the URL
    const urlParts = post.featured_image_url.split('/');
    const imgFileName = urlParts[urlParts.length - 1];
    const imgSystem = urlParts[urlParts.length - 2];
    const key = `${imgSystem}/${imgFileName}`;

    const fileId = insertedMap[key];
    if (!fileId) {
      skippedLink++;
      continue;
    }

    // Check if relation already exists
    const existing = db.prepare(
      `SELECT id FROM ${relTable} WHERE file_id = ? AND related_type = ? AND field = 'featuredImage'`
    ).get(fileId, 'api::blog-post.blog-post');

    if (existing) {
      skippedLink++;
      continue;
    }

    // Insert relation
    try {
      db.prepare(`
        INSERT INTO ${relTable} (file_id, related_type, field, ${relColNames.includes('order') ? '"order"' : 'file_order'})
        VALUES (?, 'api::blog-post.blog-post', 'featuredImage', 1)
      `).run(fileId);
      linked++;
    } catch (e) {
      console.log(`  Error linking ${post.slug}: ${e.message}`);
      // Try to understand the table better
      break;
    }
  }

  console.log(`\n  Linked: ${linked}, Skipped: ${skippedLink}`);

  // Summary
  const finalCount = db.prepare(`SELECT COUNT(*) as cnt FROM ${filesTable}`).get().cnt;
  console.log('\n' + '='.repeat(70));
  console.log('  Done!');
  console.log(`  Files in media library: ${finalCount}`);
  console.log('  Restart Strapi to see changes.');
  console.log('='.repeat(70));

  db.close();
}

main();
