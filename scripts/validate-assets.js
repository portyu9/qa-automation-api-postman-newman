'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assets = [
  'collections/jsonplaceholder.postman_collection.json',
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
const secretPattern = /(token|secret|password|api[_-]?key|authorization)/i;
const suspicious = environment.values.filter(
  (entry) => secretPattern.test(entry.key) && String(entry.value || '').trim() !== ''
);
if (suspicious.length) {
  throw new Error(`Environment contains committed secret-like values: ${suspicious.map((x) => x.key).join(', ')}`);
}
