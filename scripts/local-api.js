'use strict';

const http = require('node:http');

const host = '127.0.0.1';
const port = Number(process.env.LOCAL_API_PORT || 4010);

function post(id, userId = 1, title = `post-${id}`, body = 'deterministic local fixture') {
  return { userId, id, title, body };
}

function sendJson(res, statusCode, payload, requestId) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
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

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${host}:${port}`);
  const requestId = req.headers['x-request-id'];

  try {
    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' }, requestId);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/posts') {
      return sendJson(res, 200, [post(1), post(2, 2), post(3, 3)], requestId);
    }

    const itemMatch = requestUrl.pathname.match(/^\/posts\/(\d+)$/);
    if (req.method === 'GET' && itemMatch) {
      const id = Number(itemMatch[1]);
      return sendJson(res, 200, post(id), requestId);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/posts') {
      const payload = await readJson(req);
      return sendJson(
        res,
        201,
        {
          userId: Number(payload.userId),
          id: 101,
          title: String(payload.title || ''),
          body: String(payload.body || ''),
        },
        requestId
      );
    }

    return sendJson(res, 404, { error: 'not_found' }, requestId);
  } catch (error) {
    console.error(error);
    return sendJson(res, 400, { error: 'invalid_request' }, requestId);
  }
});

server.listen(port, host, () => {
  console.log(`local API listening on http://${host}:${port}`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
