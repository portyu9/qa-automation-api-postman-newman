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

function readJson(relative) {
  const file = path.join(root, relative);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`valid JSON: ${relative}`);
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function flattenRequests(items, parent = []) {
  const requests = [];
  for (const item of items || []) {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error('Every Postman item must have a non-empty name');
    }
    const lineage = [...parent, item.name.trim()];
    if (Array.isArray(item.item)) {
      requests.push(...flattenRequests(item.item, lineage));
      continue;
    }
    if (!item.request || typeof item.request !== 'object') {
      throw new Error(`Postman leaf item is missing a request: ${lineage.join(' > ')}`);
    }
    const rawUrl = typeof item.request.url === 'string' ? item.request.url : item.request.url?.raw;
    requests.push({
      name: item.name.trim(),
      lineage,
      method: String(item.request.method || '').toUpperCase(),
      url: rawUrl,
    });
  }
  return requests;
}

const collection = readJson('collections/posts-api.postman_collection.json');
const environment = readJson('postman_environment.json');
readJson('schemas/post-schema.json');
const data = readJson('data/posts.json');

if (collection?.info?.schema !== 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json') {
  throw new Error('Postman collection must remain on the Newman-compatible v2.1 schema');
}
if (collection?.info?.name !== 'Posts API Quality Contract') {
  throw new Error(`Unexpected governed collection name: ${collection?.info?.name}`);
}

const requests = flattenRequests(collection.item);
const expectedRequests = new Map([
  ['Health preflight', { method: 'GET', url: '{{base_url}}/health' }],
  ['List posts', { method: 'GET', url: '{{base_url}}/posts' }],
  ['Get post by id', { method: 'GET', url: '{{base_url}}/posts/{{post_id}}' }],
  ['Create post', { method: 'POST', url: '{{base_url}}/posts' }],
  ['Read created post', { method: 'GET', url: '{{base_url}}/posts/{{created_post_id}}' }],
]);
if (requests.length !== expectedRequests.size) {
  throw new Error(`Governed collection request count changed: expected=${expectedRequests.size}, actual=${requests.length}`);
}
const requestNames = new Set();
for (const request of requests) {
  if (requestNames.has(request.name)) throw new Error(`Duplicate governed request name: ${request.name}`);
  requestNames.add(request.name);
  const expected = expectedRequests.get(request.name);
  if (!expected) throw new Error(`Unexpected governed request: ${request.lineage.join(' > ')}`);
  if (request.method !== expected.method || request.url !== expected.url) {
    throw new Error(
      `Governed request identity changed for ${request.name}: ` +
      `expected=${expected.method} ${expected.url}, actual=${request.method} ${request.url}`,
    );
  }
}
for (const expectedName of expectedRequests.keys()) {
  if (!requestNames.has(expectedName)) throw new Error(`Governed request is missing: ${expectedName}`);
}

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

const enabledBaseUrls = enabled.filter((entry) => entry.key === 'base_url');
if (enabledBaseUrls.length !== 1) {
  throw new Error('Postman environment must define exactly one enabled base_url value');
}
if (enabledBaseUrls[0].value !== 'http://127.0.0.1:4010') {
  throw new Error('Committed Postman environment must retain the deterministic loopback base_url');
}

const environmentByKey = new Map(enabled.map((entry) => [entry.key, entry.value]));
positiveInteger(environmentByKey.get('post_id'), 'environment post_id');
positiveInteger(environmentByKey.get('user_id'), 'environment user_id');
positiveInteger(environmentByKey.get('max_response_time_ms'), 'environment max_response_time_ms');
if (String(environmentByKey.get('run_id') || '') !== '') {
  throw new Error('Committed run_id must remain empty; execution injects the correlation value');
}

if (!Array.isArray(data) || data.length < 3) {
  throw new Error('Iteration data must contain at least three governed cases');
}
for (const [index, row] of data.entries()) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`Iteration data row ${index} must be an object`);
  }
  positiveInteger(row.post_id, `iteration data row ${index} post_id`);
  positiveInteger(row.user_id, `iteration data row ${index} user_id`);
}

const secretPattern = /(token|secret|password|api[_-]?key|authorization)/i;
const suspicious = enabled.filter(
  (entry) => secretPattern.test(entry.key) && String(entry.value || '').trim() !== ''
);
if (suspicious.length) {
  throw new Error(`Environment contains committed secret-like values: ${suspicious.map((x) => x.key).join(', ')}`);
}

console.log(`governed Postman assets: requests=${requests.length}, iterationRows=${data.length}`);
