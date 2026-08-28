'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  absoluteHttpBaseUrl,
  compactFailure,
  positiveInteger,
  projectFile,
  redactText,
  sanitizeUrl,
} = require('./runtime');

const root = path.resolve(__dirname, '..');

assert.equal(positiveInteger('REQUEST_TIMEOUT_MS', undefined, 10_000), 10_000);
assert.equal(positiveInteger('REQUEST_TIMEOUT_MS', '2500', 10_000), 2500);
assert.throws(
  () => positiveInteger('REQUEST_TIMEOUT_MS', '0', 10_000),
  /positive integer/
);
assert.equal(
  projectFile(
    root,
    'collections/jsonplaceholder.postman_collection.json',
    'collection'
  ),
  path.join(root, 'collections/jsonplaceholder.postman_collection.json')
);
assert.throws(
  () => projectFile(root, '../outside.json', 'collection'),
  /inside the repository root/
);

assert.equal(
  absoluteHttpBaseUrl('base_url', 'https://example.test/api/'),
  'https://example.test/api'
);
for (const value of [
  'localhost:3000',
  'https://user:password@example.test',
  'https://example.test/api?access_token=secret',
  'https://example.test/api#fragment',
]) {
  assert.throws(() => absoluteHttpBaseUrl('base_url', value), /base_url/);
}

assert.equal(
  sanitizeUrl(
    'https://user:password@example.test/posts?access_token=secret#fragment'
  ),
  'https://example.test/posts'
);
assert.equal(
  redactText(
    'Authorization=Bearer abc123 https://example.test/posts?token=secret'
  ).includes('abc123'),
  false
);

const failure = compactFailure({
  parent: { name: 'Read Posts' },
  source: { name: 'GET /posts' },
  error: {
    name: 'AssertionError',
    message:
      'password=secret at https://example.test/posts?access_token=secret',
  },
});
assert.deepEqual(failure, {
  parent: 'Read Posts',
  source: 'GET /posts',
  error: 'AssertionError',
  message: 'password=<redacted> at https://example.test/posts',
  at: null,
});

console.log('newman runtime contract: ok');
