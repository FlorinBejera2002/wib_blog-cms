'use strict';

/**
 * Import ALL blog images into Strapi DB + public/uploads.
 * Skips images already in DB by name. Handles duplicate filenames
 * across categories by using system prefix in the hash.
 *
 * Run with Strapi STOPPED.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../.tmp/data.db');
const UPLOADS_DIR = path.resolve(__dirname, '../public/uploads');
const IMAGES_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/public/images/asigurari/blog');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// 1. Get existing files from DB
const existingFiles = db.prepare('SELECT id, name, hash FROM files').all();
const existingByHash = new Set(existingFiles.map(f => f.hash));
console.log(`Existing files in DB: ${existingFiles.length}`);

// 2. Scan all images on disk
const systems = fs.readdirSync(IMAGES_DIR).filter(d => fs.statSync(path.join(IMAGES_DIR, d)).isDirectory());
const allImages = [];
for (const sys of systems) {
  const files = fs.readdirSync(path.join(IMAGES_DIR, sys)).filter(f => f.endsWith('.webp'));
  for (const f of files) {
    allImages.push({ system: sys, fileName: f, filePath: path.join(IMAGES_DIR, sys, f) });
  }
}
console.log(`Total images on disk: ${allImages.length}`);

// 3. Helper: get webp dimensions
function getImageDimensions(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const type = buf.toString('ascii', 12, 16);
      if (type === 'VP8 ' && buf.length > 30) {
        return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
      } else if (type === 'VP8L' && buf.length > 25) {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
      } else if (type === 'VP8X' && buf.length > 30) {
        return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
      }
    }
  } catch (e) {}
  return { width: null, height: null };
}

// 4. Insert missing images
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const now = new Date().toISOString();
const insertStmt = db.prepare(`
  INSERT INTO files (
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

let inserted = 0, skipped = 0;

const importAll = db.transaction(() => {
  for (const img of allImages) {
    // Build a unique hash: system + filename + content md5
    const contentHash = crypto.createHash('md5').update(fs.readFileSync(img.filePath)).digest('hex').substring(0, 10);
    const uniqueHash = img.system + '_' + img.fileName.replace('.webp', '') + '_' + contentHash;

    // Skip if this exact hash already exists
    if (existingByHash.has(uniqueHash)) {
      skipped++;
      continue;
    }

    // Also check if an older-format hash exists for this file (from previous import)
    const oldHash = img.fileName.replace('.webp', '') + '_' + contentHash;
    if (existingByHash.has(oldHash)) {
      skipped++;
      continue;
    }

    // Copy file to uploads
    const destFile = path.join(UPLOADS_DIR, uniqueHash + '.webp');
    const urlPath = '/uploads/' + uniqueHash + '.webp';

    if (!fs.existsSync(destFile)) {
      fs.copyFileSync(img.filePath, destFile);
    }

    const { width, height } = getImageDimensions(img.filePath);
    const fileSize = parseFloat((fs.statSync(img.filePath).size / 1024).toFixed(2));
    const docId = crypto.randomBytes(16).toString('hex').substring(0, 24);
    const altText = img.fileName.replace('.webp', '').replace(/-/g, ' ');

    insertStmt.run({
      document_id: docId,
      name: img.fileName,
      alternative_text: altText,
      caption: null,
      width, height,
      formats: null,
      hash: uniqueHash,
      ext: '.webp',
      mime: 'image/webp',
      size: fileSize,
      url: urlPath,
      preview_url: null,
      provider: 'local',
      provider_metadata: null,
      folder_path: '/' + img.system,
      created_at: now,
      updated_at: now,
      published_at: now,
      locale: null,
    });

    inserted++;
  }
});

importAll();

const totalFiles = db.prepare('SELECT COUNT(*) as c FROM files').get().c;
console.log(`\nInserted: ${inserted}`);
console.log(`Skipped (already existed): ${skipped}`);
console.log(`Total files in DB now: ${totalFiles}`);

// Verify per-system
for (const sys of systems) {
  const count = db.prepare("SELECT COUNT(*) as c FROM files WHERE folder_path = ?").get('/' + sys).c;
  const diskCount = fs.readdirSync(path.join(IMAGES_DIR, sys)).filter(f => f.endsWith('.webp')).length;
  // Also count files with folder_path '/' that belong to this system (from old import)
  const oldCount = db.prepare("SELECT COUNT(*) as c FROM files WHERE folder_path = '/' AND hash LIKE ?").get(sys + '_%').c;
  console.log(`  ${sys}: ${count + oldCount} in DB / ${diskCount} on disk`);
}

// Total on disk
const totalDisk = fs.readdirSync(UPLOADS_DIR).filter(f => f.endsWith('.webp')).length;
console.log(`\nTotal files on disk (uploads): ${totalDisk}`);

db.close();
console.log('\nDone! Restart Strapi to see all images.');
