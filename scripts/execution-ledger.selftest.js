'use strict';

const assert = require('node:assert/strict');
const { ExecutionLedger } = require('./execution-ledger');

const ledger = new ExecutionLedger({ maxEntries: 2 });
ledger.record(
  {
    cursor: { iteration: 3, position: 7 },
    request: {
      method: 'get',
      url: { toString: () => 'https://user:secret@example.test/posts/42?token=sensitive#fragment' },
    },
    response: { code: 200, responseTime: 12.5 },
  },
  null
);
ledger.record(
  {
    cursor: { iteration: 3, position: 8 },
    request: { method: 'post', url: { toString: () => 'not a valid url' } },
  },
  new TypeError('transport detail must not be retained')
);
ledger.record(
  {
    cursor: { iteration: 9, position: 9 },
    request: { method: 'delete', url: { toString: () => 'https://example.test/ignored' } },
  },
  null
);

assert.deepEqual(ledger.snapshot(), [
  {
    iteration: 3,
    position: 8,
    method: 'POST',
    path: '<invalid-url>',
    statusCode: null,
    responseTimeMs: null,
    transportError: 'TypeError',
  },
  {
    iteration: 9,
    position: 9,
    method: 'DELETE',
    path: '/ignored',
    statusCode: null,
    responseTimeMs: null,
    transportError: null,
  },
]);

console.log('execution ledger self-test passed');
