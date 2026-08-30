'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  absoluteHttpBaseUrl,
  compactFailure,
  correlationToken,
  optionalLabel,
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
assert.equal(correlationToken('TEST_RUN_ID', ' newman:contract-42 ', 'fallback'), 'newman:contract-42');
assert.equal(correlationToken('TEST_RUN_ID', '', 'fallback'), 'fallback');
for (const value of ['unsafe run id', 'line-break\nheader', 'x'.repeat(129)]) {
  assert.throws(() => correlationToken('TEST_RUN_ID', value, 'fallback'), /TEST_RUN_ID/);
}
assert.equal(optionalLabel('NEWMAN_FOLDER', ' Posts - read '), 'Posts - read');
assert.equal(optionalLabel('NEWMAN_FOLDER', '   '), null);
for (const value of ['line-break\nfolder', 'x'.repeat(201)]) {
  assert.throws(() => optionalLabel('NEWMAN_FOLDER', value), /NEWMAN_FOLDER/);
}
assert.equal(
  projectFile(
    root,
    'collections/posts-api.postman_collection.json',
    'collection'
  ),
  path.join(root, 'collections/posts-api.postman_collection.json')
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
  'https://:443',
  'https://example.test:0/api',
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
assert.equal(sanitizeUrl('https://user:password@'), '<invalid-url>');
assert.equal(sanitizeUrl('about:blank'), 'about:blank');
assert.equal(sanitizeUrl('data:text/plain,private-payload'), 'data:<redacted>');
assert.equal(sanitizeUrl('file:///tmp/private-report.json'), 'file:<redacted>');
assert.equal(
  redactText(
    'Authorization=Bearer abc123 https://example.test/posts?token=secret data:text/plain,private-payload'
  ).includes('private-payload'),
  false
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
      'password=secret at https://example.test/posts?access_token=secret data:text/plain,private-payload',
  },
});
assert.deepEqual(failure, {
  parent: 'Read Posts',
  source: 'GET /posts',
  error: 'AssertionError',
  message: 'password=<redacted> at https://example.test/posts data:<redacted>',
  at: null,
});

console.log('newman runtime contract: ok');
