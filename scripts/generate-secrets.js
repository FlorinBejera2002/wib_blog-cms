'use strict';

/**
 * Generate all required secrets for Strapi .env file.
 *
 * Usage: node scripts/generate-secrets.js
 *
 * Copy the output into your .env file.
 */

const crypto = require('crypto');

function generateSecret() {
  return crypto.randomBytes(32).toString('base64');
}

function generateAppKeys() {
  return [
    generateSecret(),
    generateSecret(),
    generateSecret(),
    generateSecret(),
  ].join(',');
}

console.log('# Generated Strapi Secrets');
console.log('# Copy these values into your .env file');
console.log('#');
console.log(`APP_KEYS=${generateAppKeys()}`);
console.log(`API_TOKEN_SALT=${generateSecret()}`);
console.log(`ADMIN_JWT_SECRET=${generateSecret()}`);
console.log(`TRANSFER_TOKEN_SALT=${generateSecret()}`);
console.log(`JWT_SECRET=${generateSecret()}`);
console.log(`WEBHOOK_SECRET=${generateSecret()}`);
console.log('#');
console.log('# Remember to also set WEBHOOK_SECRET in Symfony parameters.yml as cms_webhook_secret');
