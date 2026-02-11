'use strict';

/**
 * Delete all files from Strapi media library.
 * These are leftover from failed upload attempts — we use featuredImageUrl instead.
 */

const http = require('http');
const fs = require('fs');
const token = fs.readFileSync(__dirname + '/../.api_token', 'utf8').trim();

function apiRequest(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:1337');
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { Authorization: 'Bearer ' + token },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: d.substring(0, 200) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // Get all file IDs
  console.log('Fetching media library...');
  const res = await new Promise((resolve, reject) => {
    http.get({
      hostname: 'localhost', port: 1337,
      path: '/api/upload/files?fields[0]=id&fields[1]=name&pagination[pageSize]=500',
      headers: { Authorization: 'Bearer ' + token },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(d); } });
    }).on('error', reject);
  });

  if (!Array.isArray(res)) {
    console.log('Unexpected response:', JSON.stringify(res).substring(0, 300));
    return;
  }

  console.log('Found', res.length, 'files to delete\n');

  let deleted = 0, failed = 0;
  for (let i = 0; i < res.length; i++) {
    const file = res[i];
    const r = await apiRequest('DELETE', '/api/upload/files/' + file.id);
    if (r.status === 200) {
      deleted++;
      if (deleted % 50 === 0) console.log('  Deleted', deleted, '/', res.length);
    } else {
      failed++;
      console.log('  FAIL delete ID', file.id, ':', r.status);
    }
    await new Promise(r => setTimeout(r, 30));
  }

  console.log('\nDone:', deleted, 'deleted,', failed, 'failed');
}

main().catch(e => console.error(e));
