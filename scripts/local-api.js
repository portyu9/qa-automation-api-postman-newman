'use strict';

const http = require('node:http');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4010;
const DEFAULT_LOCAL_API_URL = `http://${HOST}:${DEFAULT_PORT}`;

function post(id, userId = 1, title = `post-${id}`, body = 'deterministic local fixture') {
  return { userId, id, title, body };
}

function sendJson(res, statusCode, payload, requestId) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(requestId ? { 'x-request-id': requestId } : {}),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function createLocalApiServer(port = DEFAULT_PORT) {
  const createdPosts = new Map();
  let nextPostId = 101;

  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${HOST}:${port}`);
    const requestId = req.headers['x-request-id'];

    try {
      if (req.method === 'GET' && requestUrl.pathname === '/health') {
        return sendJson(res, 200, { status: 'ok' }, requestId);
      }

      if (req.method === 'GET' && requestUrl.pathname === '/posts') {
        return sendJson(
          res,
          200,
          [post(1), post(2, 2), post(3, 3), ...createdPosts.values()],
          requestId
        );
      }

      const itemMatch = requestUrl.pathname.match(/^\/posts\/(\d+)$/);
      if (req.method === 'GET' && itemMatch) {
        const id = Number(itemMatch[1]);
        return sendJson(res, 200, createdPosts.get(id) || post(id), requestId);
      }

      if (req.method === 'POST' && requestUrl.pathname === '/posts') {
        const payload = await readJson(req);
        const created = {
          userId: Number(payload.userId),
          id: nextPostId++,
          title: String(payload.title || ''),
          body: String(payload.body || ''),
        };
        createdPosts.set(created.id, created);
        return sendJson(res, 201, created, requestId);
      }

      return sendJson(res, 404, { error: 'not_found' }, requestId);
    } catch (error) {
      console.error(error);
      return sendJson(res, 400, { error: 'invalid_request' }, requestId);
    }
  });
}

function startLocalApi(port = DEFAULT_PORT) {
  const server = createLocalApiServer(port);
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

function stopLocalApi(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  const port = Number(process.env.LOCAL_API_PORT || DEFAULT_PORT);
  const server = await startLocalApi(port);
  console.log(`local API listening on http://${HOST}:${port}`);

  const shutdown = async () => {
    try {
      await stopLocalApi(server);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_LOCAL_API_URL,
  DEFAULT_PORT,
  createLocalApiServer,
  startLocalApi,
  stopLocalApi,
};
