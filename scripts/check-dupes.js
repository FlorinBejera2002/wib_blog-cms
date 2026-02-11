'use strict';

const http = require('http');
const fs = require('fs');
const token = fs.readFileSync(__dirname + '/../.api_token', 'utf8').trim();

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: 'localhost', port: 1337, path: p,
      headers: { Authorization: 'Bearer ' + token },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(d); } });
    }).on('error', reject);
  });
}

async function main() {
  // Check Strapi media library for duplicates
  console.log('=== Strapi Media Library ===\n');
  
  let allMedia = [];
  let page = 1;
  while (true) {
    const r = await get('/api/upload/files?pagination[page]=' + page + '&pagination[pageSize]=100');
    if (!Array.isArray(r) || r.length === 0) break;
    allMedia = allMedia.concat(r);
    if (r.length < 100) break;
    page++;
  }
  console.log('Total files in media library:', allMedia.length);

  // Check for duplicate names
  const nameMap = {};
  for (const m of allMedia) {
    const name = m.name || m.hash || 'unknown';
    if (!nameMap[name]) nameMap[name] = [];
    nameMap[name].push({ id: m.id, url: m.url });
  }

  const dupes = Object.entries(nameMap).filter(([k, v]) => v.length > 1);
  console.log('Unique names:', Object.keys(nameMap).length);
  console.log('Duplicate names:', dupes.length);

  if (dupes.length > 0) {
    console.log('\nDuplicates:');
    dupes.slice(0, 20).forEach(([name, items]) => {
      console.log('  ' + name + ' (' + items.length + 'x): IDs=' + items.map(i => i.id).join(','));
    });
    if (dupes.length > 20) console.log('  ... and ' + (dupes.length - 20) + ' more');
  }

  // Also check on-disk duplicates
  console.log('\n=== On-Disk Images ===\n');
  const imgDir = require('path').resolve(__dirname, '../../src/MainBundle/Resources/public/images/asigurari/blog');
  const filesByHash = {};
  const crypto = require('crypto');
  const path = require('path');
  
  const systems = fs.readdirSync(imgDir).filter(d => fs.statSync(path.join(imgDir, d)).isDirectory());
  let totalFiles = 0;
  
  for (const sys of systems) {
    const sysDir = path.join(imgDir, sys);
    const files = fs.readdirSync(sysDir).filter(f => f.endsWith('.webp'));
    for (const f of files) {
      totalFiles++;
      const filePath = path.join(sysDir, f);
      const hash = crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
      if (!filesByHash[hash]) filesByHash[hash] = [];
      filesByHash[hash].push(sys + '/' + f);
    }
  }

  const contentDupes = Object.entries(filesByHash).filter(([k, v]) => v.length > 1);
  console.log('Total image files:', totalFiles);
  console.log('Unique by content (MD5):', Object.keys(filesByHash).length);
  console.log('Duplicate content (same file, different path):', contentDupes.length);

  if (contentDupes.length > 0) {
    let dupeCount = 0;
    console.log('\nIdentical files:');
    contentDupes.forEach(([hash, paths]) => {
      dupeCount += paths.length - 1;
      console.log('  [' + hash.substring(0, 8) + '] (' + paths.length + 'x):');
      paths.forEach(p => console.log('    ' + p));
    });
    console.log('\nTotal removable duplicates:', dupeCount, 'files');
  }
}

main().catch(e => console.error(e));
