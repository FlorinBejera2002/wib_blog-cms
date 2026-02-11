'use strict';

const http = require('http');
const fs = require('fs');
const token = fs.readFileSync(__dirname + '/../.api_token', 'utf8').trim();

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: 'localhost', port: 1337, path,
      headers: { Authorization: 'Bearer ' + token },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(d); } });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Verification ===\n');

  // 1. Total posts
  const all = await get('/api/blog-posts?pagination[pageSize]=1');
  console.log('Total posts:', all.meta.pagination.total);

  // 2. Per-system count
  const systems = ['rca','casco','travel','home','life','health','malpraxis','cmr','breakdown','accidents','common'];
  let sum = 0;
  for (const s of systems) {
    const r = await get('/api/blog-posts?filters[system][$eq]=' + s + '&pagination[pageSize]=1');
    const t = r.meta.pagination.total;
    sum += t;
    console.log('  ' + s + ': ' + t);
  }
  console.log('  Sum: ' + sum);

  // 3. Posts with images
  let withImg = 0, withoutImg = 0;
  let page = 1;
  while (true) {
    const r = await get('/api/blog-posts?pagination[page]=' + page + '&pagination[pageSize]=100&fields[0]=featuredImageUrl&fields[1]=slug');
    for (const p of r.data) {
      if (p.featuredImageUrl) withImg++; else withoutImg++;
    }
    if (page >= r.meta.pagination.pageCount) break;
    page++;
  }
  console.log('\nPosts with featuredImageUrl:', withImg);
  console.log('Posts without featuredImageUrl:', withoutImg);

  // 4. Sample post detail
  const sample = await get('/api/blog-posts?filters[slug][$eq]=5-motive-pentru-care-autovehiculele-sunt-respinse-la-itp-si-cum-sa-le-previi&populate=featuredImage,category,tags');
  if (sample.data && sample.data[0]) {
    const p = sample.data[0];
    console.log('\n--- Sample Post ---');
    console.log('Title:', p.title);
    console.log('System:', p.system);
    console.log('Slug:', p.slug);
    console.log('featuredImageUrl:', p.featuredImageUrl);
    console.log('featuredImageAlt:', p.featuredImageAlt);
    console.log('Content blocks:', p.content ? p.content.length : 0);
    console.log('TOC items:', p.tocItems ? p.tocItems.length : 0);
    console.log('Category:', p.category ? p.category.name : 'none');
    console.log('Reading time:', p.readingTime, 'min');
    console.log('Review status:', p.reviewStatus);
  }

  // 5. Check a common article (Pattern 2 parser)
  const sample2 = await get('/api/blog-posts?filters[slug][$eq]=10-intrebari-pe-care-sa-le-adresezi-inainte-de-a-cumpara-o-asigurare&populate=category');
  if (sample2.data && sample2.data[0]) {
    const p = sample2.data[0];
    console.log('\n--- Sample Common Post ---');
    console.log('Title:', p.title);
    console.log('System:', p.system);
    console.log('featuredImageUrl:', p.featuredImageUrl);
    console.log('Content blocks:', p.content ? p.content.length : 0);
    console.log('TOC items:', p.tocItems ? p.tocItems.length : 0);
    console.log('Category:', p.category ? p.category.name : 'none');
  }

  console.log('\n=== Done ===');
}

main().catch(e => console.error(e));
