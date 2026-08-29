'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assets = [
  'collections/posts-api.postman_collection.json',
  'postman_environment.json',
  'schemas/post-schema.json',
  'data/posts.json',
];

for (const relative of assets) {
  const file = path.join(root, relative);
  JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`valid JSON: ${relative}`);
}

const environment = JSON.parse(fs.readFileSync(path.join(root, 'postman_environment.json'), 'utf8'));
if (!Array.isArray(environment.values)) {
  throw new Error('Postman environment must contain a values array');
}

const enabled = environment.values.filter((entry) => entry?.enabled !== false);
const keys = new Set();
for (const entry of enabled) {
  if (typeof entry?.key !== 'string' || !entry.key.trim()) {
    throw new Error('Enabled Postman environment values must have non-empty string keys');
  }
  const key = entry.key.trim();
  if (keys.has(key)) {
    throw new Error(`Postman environment contains duplicate enabled key: ${key}`);
  }
  keys.add(key);
}

if (!keys.has('base_url')) {
  throw new Error('Postman environment must define exactly one enabled base_url value');
}

const secretPattern = /(token|secret|password|api[_-]?key|authorization)/i;
const suspicious = enabled.filter(
  (entry) => secretPattern.test(entry.key) && String(entry.value || '').trim() !== ''
);
if (suspicious.length) {
  throw new Error(`Environment contains committed secret-like values: ${suspicious.map((x) => x.key).join(', ')}`);
}
