'use strict';

/**
 * Standalone seed script for populating Strapi with sample data.
 *
 * Usage: npm run seed
 *
 * This script creates:
 * - Sample tags
 * - A sample blog post per category
 *
 * Categories are auto-seeded by the bootstrap in src/index.js.
 * Run this AFTER the first `npm run develop` so the DB and categories exist.
 */

const http = require('http');
const https = require('https');

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
// You must create a full-access API token in Strapi admin first
const API_TOKEN = process.env.STRAPI_API_TOKEN || '';

if (!API_TOKEN) {
  console.error('ERROR: Set STRAPI_API_TOKEN environment variable first.');
  console.error('Create a full-access token in Strapi Admin → Settings → API Tokens');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${API_TOKEN}`,
};

/**
 * Make an HTTP request to Strapi API.
 */
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, STRAPI_URL);
    const lib = url.protocol === 'https:' ? https : http;

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function seedTags() {
  console.log('\n--- Seeding Tags ---');

  const tags = [
    { name: 'Ghid complet', slug: 'ghid-complet' },
    { name: 'Sfaturi utile', slug: 'sfaturi-utile' },
    { name: 'Legislatie', slug: 'legislatie' },
    { name: 'Economisire', slug: 'economisire' },
    { name: 'Comparatie', slug: 'comparatie' },
    { name: 'ITP', slug: 'itp' },
    { name: 'Despagubiri', slug: 'despagubiri' },
    { name: 'Masini electrice', slug: 'masini-electrice' },
    { name: 'Calatorie', slug: 'calatorie' },
    { name: 'Familie', slug: 'familie' },
    { name: 'Protectie', slug: 'protectie' },
    { name: 'Sanatate', slug: 'sanatate' },
  ];

  for (const tag of tags) {
    const res = await request('POST', '/api/tags', { data: tag });
    if (res.status === 200 || res.status === 201) {
      console.log(`  Created tag: ${tag.name}`);
    } else {
      console.log(`  Tag "${tag.name}": ${res.data?.error?.message || 'already exists or error'}`);
    }
  }
}

async function seedSamplePost() {
  console.log('\n--- Seeding Sample Blog Post ---');

  // Get the RCA category ID
  const catRes = await request('GET', '/api/categories?filters[slug][$eq]=rca');
  const rcaCategoryId =
    catRes.data?.data?.[0]?.id || catRes.data?.data?.[0]?.documentId || null;

  if (!rcaCategoryId) {
    console.log('  RCA category not found. Run `npm run develop` first to seed categories.');
    return;
  }

  // Get tag IDs
  const tagRes = await request('GET', '/api/tags?filters[slug][$in][0]=ghid-complet&filters[slug][$in][1]=sfaturi-utile');
  const tagIds = (tagRes.data?.data || []).map((t) => t.id || t.documentId);

  const samplePost = {
    data: {
      title: 'Ghid complet RCA 2025: Tot ce trebuie sa stii despre asigurarea auto obligatorie',
      slug: 'ghid-complet-rca-2025-asigurare-auto-obligatorie',
      excerpt:
        'Afla tot ce trebuie sa stii despre asigurarea RCA in 2025: ce acopera, cum alegi cel mai bun pret, ce documente ai nevoie si cum faci o reclamatie in caz de accident.',
      content: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              text: 'Asigurarea RCA (Raspundere Civila Auto) este obligatorie pentru orice vehicul inmatriculat in Romania. In acest ghid complet, iti explicam tot ce trebuie sa stii despre RCA in 2025.',
            },
          ],
        },
        {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: 'Ce este asigurarea RCA?' }],
        },
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              text: 'RCA este o asigurare obligatorie care acopera daunele pe care le cauzezi altor persoane sau bunuri in cazul unui accident rutier. Fara RCA valabil, nu ai voie sa circuli pe drumurile publice si risti amenzi semnificative.',
            },
          ],
        },
        {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: 'Ce acopera asigurarea RCA?' }],
        },
        {
          type: 'list',
          format: 'unordered',
          children: [
            {
              type: 'list-item',
              children: [{ type: 'text', text: 'Daune materiale cauzate altor vehicule sau proprietati' }],
            },
            {
              type: 'list-item',
              children: [{ type: 'text', text: 'Vatamari corporale suferite de alte persoane' }],
            },
            {
              type: 'list-item',
              children: [{ type: 'text', text: 'Cheltuieli medicale si de spitalizare ale victimelor' }],
            },
            {
              type: 'list-item',
              children: [{ type: 'text', text: 'Daune morale in cazul vatamarii corporale grave' }],
            },
          ],
        },
        {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: 'Cum alegi cel mai bun pret RCA?' }],
        },
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              text: 'Pretul RCA variaza in functie de mai multi factori: varsta soferului, istoricul de daune (clasa bonus-malus), tipul vehiculului, capacitatea cilindrica si asiguratorul ales. Cel mai simplu mod de a gasi cel mai bun pret este sa compari ofertele mai multor asiguratori pe asigurari.ro.',
            },
          ],
        },
      ],
      system: 'rca',
      metaTitle: 'Ghid complet RCA 2025 - Asigurare auto obligatorie | asigurari.ro',
      metaDescription:
        'Tot ce trebuie sa stii despre RCA in 2025: acoperire, preturi, documente necesare si cum faci o reclamatie.',
      tocItems: [
        { href: '#ce-este-rca', title: 'Ce este asigurarea RCA?' },
        { href: '#ce-acopera-rca', title: 'Ce acopera asigurarea RCA?' },
        { href: '#pret-rca', title: 'Cum alegi cel mai bun pret RCA?' },
      ],
      reviewStatus: 'approved',
      authorName: 'Echipa asigurari.ro',
      category: rcaCategoryId,
      tags: tagIds,
    },
  };

  const res = await request('POST', '/api/blog-posts', samplePost);
  if (res.status === 200 || res.status === 201) {
    console.log(`  Created sample post: "${samplePost.data.title}"`);
  } else {
    console.log(`  Sample post: ${res.data?.error?.message || 'already exists or error'}`);
  }
}

async function main() {
  console.log(`Seeding Strapi at ${STRAPI_URL}...`);

  try {
    // Verify connection
    const health = await request('GET', '/_health');
    if (health.status !== 200 && health.status !== 204) {
      console.error('Cannot connect to Strapi. Is it running?');
      process.exit(1);
    }

    await seedTags();
    await seedSamplePost();

    console.log('\nSeed complete!');
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
}

main();
