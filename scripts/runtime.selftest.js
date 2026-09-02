'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  absoluteHttpBaseUrl,
  compactFailure,
  correlationToken,
  explicitBoolean,
  optionalLabel,
  positiveInteger,
  projectFile,
  redactText,
  sanitizeUrl,
  targetPolicy,
} = require('./runtime');

const root = path.resolve(__dirname, '..');
const localBaseUrl = 'http://127.0.0.1:4010';

assert.equal(positiveInteger('REQUEST_TIMEOUT_MS', undefined, 10_000), 10_000);
assert.equal(positiveInteger('REQUEST_TIMEOUT_MS', '2500', 10_000), 2500);
assert.throws(
  () => positiveInteger('REQUEST_TIMEOUT_MS', '0', 10_000),
  /positive integer/
);
assert.equal(explicitBoolean('NEWMAN_ALLOW_EXTERNAL_TARGET', undefined), false);
assert.equal(explicitBoolean('NEWMAN_ALLOW_EXTERNAL_TARGET', ''), false);
assert.equal(explicitBoolean('NEWMAN_ALLOW_EXTERNAL_TARGET', 'true'), true);
assert.equal(explicitBoolean('NEWMAN_ALLOW_EXTERNAL_TARGET', 'false'), false);
for (const value of ['TRUE', '1', 'yes', ' true ', 'line-break\ntrue']) {
  assert.throws(
    () => explicitBoolean('NEWMAN_ALLOW_EXTERNAL_TARGET', value),
    /exact literal true or false/
  );
}

assert.deepEqual(targetPolicy(localBaseUrl, localBaseUrl, undefined), {
  baseUrl: localBaseUrl,
  ownsLocalApi: true,
  targetClass: 'local-fixture',
  externalTargetAuthorized: false,
});
assert.deepEqual(targetPolicy(`${localBaseUrl}/`, localBaseUrl, 'true'), {
  baseUrl: localBaseUrl,
  ownsLocalApi: true,
  targetClass: 'local-fixture',
  externalTargetAuthorized: false,
});
for (const authorization of [undefined, '', 'false']) {
  assert.throws(
    () => targetPolicy('https://staging.example.test', localBaseUrl, authorization),
    /require explicit authorization/
  );
}
assert.deepEqual(targetPolicy('https://staging.example.test/', localBaseUrl, 'true'), {
  baseUrl: 'https://staging.example.test',
  ownsLocalApi: false,
  targetClass: 'explicit-external',
  externalTargetAuthorized: true,
});
for (const authorization of ['TRUE', '1', 'yes', ' true ']) {
  assert.throws(
    () => targetPolicy('https://staging.example.test', localBaseUrl, authorization),
    /exact literal true or false/
  );
}

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
  absoluteHttpBaseUrl('base_url', '  HTTPS://EXAMPLE.TEST:443/api/  '),
  'https://example.test/api'
);
for (const value of [
  'localhost:3000',
  'https://:443',
  'https://example.test:0/api',
  'https://user:password@example.test',
  'https://example.test/api?access_token=secret',
  'https://example.test/api#fragment',
  'https://example.test/api\nadmin',
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
assert.equal(sanitizeUrl('file:///home/runner/private.json'), 'file:<redacted>');
assert.equal(sanitizeUrl('data:text/plain,private-payload'), 'data:<redacted>');

const redacted = redactText(
  'Authorization=Bearer abc123 https://example.test/posts?token=secret ' +
    'file:///home/runner/private.json ' +
    'data:text/html,<h1>private-payload</h1> ' +
    'javascript:alert("dialog-secret")'
);
for (const secret of [
  'abc123',
  '?token=secret',
  'private.json',
  'private-payload',
  'dialog-secret',
]) {
  assert.equal(redacted.includes(secret), false);
}
assert.equal(redacted.includes('file:<redacted>'), true);
assert.equal(redacted.includes('data:<redacted>'), true);
assert.equal(redacted.includes('javascript:<redacted>'), true);

const failure = compactFailure({
  parent: { name: 'Read Posts' },
  source: { name: 'GET /posts' },
  error: {
    name: 'AssertionError',
    message:
      'password=secret at https://example.test/posts?access_token=secret file:///home/runner/private.json',
  },
  at: 'file:///home/runner/work/private-test.js:42:7',
});
assert.deepEqual(failure, {
  parent: 'Read Posts',
  source: 'GET /posts',
  error: 'AssertionError',
  message: 'password=<redacted> at https://example.test/posts file:<redacted>',
  at: 'file:<redacted>',
});

console.log('newman runtime contract: ok');
