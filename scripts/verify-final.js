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
  console.log('=== Final Verification ===\n');

  // 1. Media library
  const media = await get('/api/upload/files?fields[0]=id&fields[1]=name&pagination[pageSize]=500');
  console.log('Media library files:', Array.isArray(media) ? media.length : 'error');

  // 2. Posts with featuredImage relation populated
  let withImage = 0, withoutImage = 0, withUrl = 0;
  let page = 1;
  const noImage = [];
  while (true) {
    const r = await get('/api/blog-posts?pagination[page]=' + page + '&pagination[pageSize]=100&fields[0]=slug&fields[1]=system&fields[2]=featuredImageUrl&populate=featuredImage');
    if (!r.data || r.data.length === 0) break;
    for (const p of r.data) {
      if (p.featuredImage && p.featuredImage.id) withImage++;
      else withoutImage++;
      if (p.featuredImageUrl) withUrl++;
      if (!p.featuredImage && !p.featuredImageUrl) {
        noImage.push(p.system + '/' + p.slug);
      }
    }
    if (page >= r.meta.pagination.pageCount) break;
    page++;
  }
  console.log('Posts with featuredImage (media relation):', withImage);
  console.log('Posts without featuredImage:', withoutImage);
  console.log('Posts with featuredImageUrl (text field):', withUrl);

  if (noImage.length > 0) {
    console.log('\nPosts with NO image at all:');
    noImage.forEach(p => console.log('  ' + p));
  }

  // 3. Sample post with full data
  const sample = await get('/api/blog-posts?filters[system][$eq]=rca&pagination[pageSize]=1&populate=featuredImage,category,tags');
  if (sample.data && sample.data[0]) {
    const p = sample.data[0];
    console.log('\n--- Sample Post ---');
    console.log('Title:', p.title);
    console.log('featuredImageUrl:', p.featuredImageUrl);
    console.log('featuredImage.url:', p.featuredImage ? p.featuredImage.url : 'null');
    console.log('featuredImage.name:', p.featuredImage ? p.featuredImage.name : 'null');
    console.log('Category:', p.category ? p.category.name : 'none');
  }

  console.log('\n=== Done ===');
}

main().catch(e => console.error(e));
