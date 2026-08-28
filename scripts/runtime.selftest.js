'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { compactFailure, positiveInteger, projectFile } = require('./runtime');

const root = path.resolve(__dirname, '..');

assert.equal(positiveInteger('REQUEST_TIMEOUT_MS', undefined, 10_000), 10_000);
assert.equal(positiveInteger('REQUEST_TIMEOUT_MS', '2500', 10_000), 2500);
assert.throws(() => positiveInteger('REQUEST_TIMEOUT_MS', '0', 10_000), /positive integer/);
assert.equal(projectFile(root, 'collections/jsonplaceholder.postman_collection.json', 'collection'), path.join(root, 'collections/jsonplaceholder.postman_collection.json'));
assert.throws(() => projectFile(root, '../outside.json', 'collection'), /inside the repository root/);

const failure = compactFailure({
  parent: { name: 'Read Posts' },
  source: { name: 'GET /posts' },
  error: { name: 'AssertionError', message: 'schema mismatch' },
});
assert.deepEqual(failure, {
  parent: 'Read Posts',
  source: 'GET /posts',
  error: 'AssertionError',
  message: 'schema mismatch',
  at: null,
});

console.log('newman runtime contract: ok');
