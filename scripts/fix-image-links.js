'use strict';

/**
 * Fix the files_related_mph table: set related_id for each featuredImage relation.
 * Also re-link any posts that were missed.
 *
 * Run with Strapi STOPPED.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../.tmp/data.db');
const BLOG_DIR = path.resolve(__dirname, '../../src/MainBundle/Resources/views/common/asigurari/blog');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// 1. Get all posts with their featured_image_url
const posts = db.prepare('SELECT id, document_id, slug, system, featured_image_url FROM blog_posts').all();
console.log(`Posts: ${posts.length}`);

// 2. Get all files (build name -> id map)
const files = db.prepare('SELECT id, name FROM files').all();
const fileByName = {};
for (const f of files) {
  fileByName[f.name] = f.id;
}
console.log(`Files in DB: ${files.length}`);

// 3. Delete all existing broken featuredImage relations (related_id is null)
const deleted = db.prepare("DELETE FROM files_related_mph WHERE field = 'featuredImage'").run();
console.log(`Deleted ${deleted.changes} old featuredImage relations`);

// 4. Re-create relations with correct related_id
const insertRel = db.prepare(`
  INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
  VALUES (?, ?, 'api::blog-post.blog-post', 'featuredImage', 1)
`);

let linked = 0, skipped = 0;

const linkAll = db.transaction(() => {
  for (const post of posts) {
    if (!post.featured_image_url) {
      skipped++;
      continue;
    }

    // Extract filename from URL path
    const fileName = path.basename(post.featured_image_url);
    const fileId = fileByName[fileName];

    if (!fileId) {
      console.log(`  No file for: ${post.system}/${post.slug} -> ${fileName}`);
      skipped++;
      continue;
    }

    insertRel.run(fileId, post.id);
    linked++;
  }
});

linkAll();

console.log(`\nLinked: ${linked}, Skipped: ${skipped}`);

// 5. Verify
const relCount = db.prepare("SELECT COUNT(*) as cnt FROM files_related_mph WHERE field = 'featuredImage' AND related_id IS NOT NULL").get().cnt;
console.log(`\nVerification: ${relCount} valid featuredImage relations`);

// Sample
const samples = db.prepare(`
  SELECT bp.slug, bp.system, f.name as file_name, frm.related_id, frm.file_id
  FROM files_related_mph frm
  JOIN blog_posts bp ON bp.id = frm.related_id
  JOIN files f ON f.id = frm.file_id
  WHERE frm.field = 'featuredImage'
  LIMIT 5
`).all();
console.log('\nSamples:');
samples.forEach(s => console.log(`  ${s.system}/${s.slug} -> ${s.file_name} (post:${s.related_id}, file:${s.file_id})`));

db.close();
console.log('\nDone! Restart Strapi to verify.');
