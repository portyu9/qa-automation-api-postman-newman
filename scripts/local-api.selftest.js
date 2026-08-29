'use strict';

const assert = require('node:assert/strict');
const { startLocalApi, stopLocalApi } = require('./local-api');

async function main() {
  let server;
  try {
    server = await startLocalApi(0);
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const posts = await fetch(`${baseUrl}/posts`);
    assert.equal(posts.status, 200);
    const collection = await posts.json();
    assert.ok(Array.isArray(collection) && collection.length >= 3);

    const item = await fetch(`${baseUrl}/posts/42`, {
      headers: { 'x-request-id': 'fixture-contract-42' },
    });
    assert.equal(item.status, 200);
    assert.equal(item.headers.get('x-request-id'), 'fixture-contract-42');
    assert.equal((await item.json()).id, 42);

    const created = await fetch(`${baseUrl}/posts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'fixture-create-1',
      },
      body: JSON.stringify({ userId: 7, title: 'created', body: 'fixture contract' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('x-request-id'), 'fixture-create-1');
    const createdBody = await created.json();
    assert.deepEqual(createdBody, {
      userId: 7,
      id: 101,
      title: 'created',
      body: 'fixture contract',
    });

    const reread = await fetch(`${baseUrl}/posts/${createdBody.id}`);
    assert.equal(reread.status, 200);
    assert.deepEqual(await reread.json(), createdBody);

    const collectionAfterCreate = await fetch(`${baseUrl}/posts`);
    assert.equal(collectionAfterCreate.status, 200);
    assert.ok((await collectionAfterCreate.json()).some((entry) => entry.id === createdBody.id));

    console.log('local API fixture contract: ok');
  } finally {
    await stopLocalApi(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
