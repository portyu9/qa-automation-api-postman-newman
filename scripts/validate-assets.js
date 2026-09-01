'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const COLLECTION_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const POST_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema#';

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

function scriptFor(events, listen) {
  const matches = (events || []).filter((event) => event?.listen === listen);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${listen} script, found ${matches.length}`);
  }
  const exec = matches[0]?.script?.exec;
  if (!Array.isArray(exec) || exec.some((line) => typeof line !== 'string')) {
    throw new Error(`${listen} script must contain a string exec array`);
  }
  return exec.join('\n');
}

function testNames(script) {
  return [...script.matchAll(/pm\.test\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function requireExactTestNames(script, expected, label) {
  const actual = testNames(script);
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(
      `${label} test contract changed: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`,
    );
  }
}

function requireScriptPrimitives(script, required, label) {
  const missing = required.filter((fragment) => !script.includes(fragment));
  if (missing.length) {
    throw new Error(`${label} script is missing governed primitives: ${missing.join(', ')}`);
  }
}

function headerMap(request, label) {
  if (!Array.isArray(request?.header)) throw new Error(`${label} request must contain headers`);
  const entries = request.header.filter((header) => header?.disabled !== true);
  const headers = new Map();
  for (const entry of entries) {
    const key = String(entry?.key || '').trim().toLowerCase();
    if (!key) throw new Error(`${label} contains a header without a key`);
    if (headers.has(key)) throw new Error(`${label} contains duplicate enabled header ${key}`);
    headers.set(key, String(entry?.value ?? ''));
  }
  return headers;
}

function requireRequestHeaders(request, label, { jsonBody = false } = {}) {
  const headers = headerMap(request, label);
  const expected = new Map([
    ['accept', 'application/json'],
    ['x-test-run-id', '{{run_id}}'],
    ['x-request-id', '{{request_id}}'],
  ]);
  if (jsonBody) expected.set('content-type', 'application/json');
  for (const [name, value] of expected) {
    if (headers.get(name) !== value) {
      throw new Error(`${label} header contract changed for ${name}: ${headers.get(name) ?? '<missing>'}`);
    }
  }
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
      request: item.request,
      testScript: scriptFor(item.event, 'test'),
    });
  }
  return requests;
}

function validatePostSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Post schema must be a JSON object');
  }
  if (schema.$schema !== POST_SCHEMA_DRAFT) {
    throw new Error(`Post schema draft changed: ${schema.$schema}`);
  }
  if (schema.type !== 'object') throw new Error(`Post schema type must be object, got ${schema.type}`);
  if (schema.additionalProperties !== true) {
    throw new Error('Post schema must remain forward-compatible with additional provider fields');
  }

  const required = schema.required;
  const governedRequired = ['body', 'id', 'title', 'userId'];
  if (!Array.isArray(required)) throw new Error('Post schema must define required fields');
  const normalizedRequired = [...new Set(required)].sort();
  if (
    normalizedRequired.length !== governedRequired.length ||
    normalizedRequired.some((field, index) => field !== governedRequired[index])
  ) {
    throw new Error(
      `Post schema required fields changed: expected=${governedRequired.join(',')}, actual=${normalizedRequired.join(',')}`,
    );
  }

  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('Post schema must define properties');
  }
  for (const field of ['id', 'userId']) {
    if (properties[field]?.type !== 'integer' || properties[field]?.minimum !== 1) {
      throw new Error(`Post schema ${field} must remain an integer with minimum 1`);
    }
  }
  for (const field of ['title', 'body']) {
    if (properties[field]?.type !== 'string') {
      throw new Error(`Post schema ${field} must remain a string`);
    }
  }
}

function validateCollection(collection) {
  if (collection?.info?.schema !== COLLECTION_SCHEMA) {
    throw new Error('Postman collection must remain on the Newman-compatible v2.1 schema');
  }
  if (collection?.info?.name !== 'Posts API Quality Contract') {
    throw new Error(`Unexpected governed collection name: ${collection?.info?.name}`);
  }

  const prerequest = scriptFor(collection.event, 'prerequest');
  requireScriptPrimitives(
    prerequest,
    [
      "pm.environment.get('run_id')",
      "pm.environment.set('run_id'",
      "pm.variables.set('request_id'",
      "pm.variables.set('generated_title'",
      '{{$guid}}',
    ],
    'collection prerequest',
  );

  const collectionTests = scriptFor(collection.event, 'test');
  const globalTests = ['Response time is within the collection budget', 'Response is JSON'];
  requireExactTestNames(collectionTests, globalTests, 'collection-level');
  requireScriptPrimitives(
    collectionTests,
    [
      "pm.environment.get('max_response_time_ms')",
      'pm.response.responseTime',
      "pm.response.headers.get('Content-Type')",
      'application\\/json',
    ],
    'collection-level',
  );

  const requests = flattenRequests(collection.item);
  const expectedRequests = new Map([
    [
      'Health preflight',
      {
        lineage: ['Runtime - preflight', 'Health preflight'],
        method: 'GET',
        url: '{{base_url}}/health',
        tests: ['Health endpoint is ready', 'Request correlation is echoed by the target'],
        primitives: [
          'pm.response.to.have.status(200)',
          "to.deep.equal({ status: 'ok' })",
          "pm.response.headers.get('x-request-id')",
          "pm.variables.get('request_id')",
        ],
      },
    ],
    [
      'List posts',
      {
        lineage: ['Posts - read', 'List posts'],
        method: 'GET',
        url: '{{base_url}}/posts',
        tests: ['Status is 200', 'Body is a non-empty post array matching schema'],
        primitives: [
          'pm.response.to.have.status(200)',
          "pm.globals.get('post_schema')",
          "to.be.an('array').that.is.not.empty",
          'pm.response.to.have.jsonSchema',
        ],
      },
    ],
    [
      'Get post by id',
      {
        lineage: ['Posts - read', 'Get post by id'],
        method: 'GET',
        url: '{{base_url}}/posts/{{post_id}}',
        tests: ['Status is 200', 'Post matches schema and requested id'],
        primitives: [
          'pm.response.to.have.status(200)',
          "pm.iterationData.has('post_id')",
          "pm.globals.get('post_schema')",
          'pm.response.to.have.jsonSchema',
          'pm.expect(body.id).to.equal(Number(expectedPostId))',
        ],
      },
    ],
    [
      'Create post',
      {
        lineage: ['Posts - write', 'Create post'],
        method: 'POST',
        url: '{{base_url}}/posts',
        jsonBody: true,
        tests: ['Status is 201', 'Created representation matches request and schema'],
        primitives: [
          'pm.response.to.have.status(201)',
          "pm.iterationData.has('user_id')",
          "pm.globals.get('post_schema')",
          'pm.response.to.have.jsonSchema',
          "pm.variables.get('generated_title')",
          'pm.expect(body.userId).to.equal(Number(expectedUserId))',
          "pm.collectionVariables.set('created_post_id'",
          "pm.collectionVariables.set('created_post_title'",
        ],
      },
    ],
    [
      'Read created post',
      {
        lineage: ['Posts - write', 'Read created post'],
        method: 'GET',
        url: '{{base_url}}/posts/{{created_post_id}}',
        tests: ['Created state can be consumed by the next request'],
        primitives: [
          'pm.response.to.have.status(200)',
          "pm.globals.get('post_schema')",
          'pm.response.to.have.jsonSchema',
          "pm.collectionVariables.get('created_post_id')",
          "pm.collectionVariables.get('created_post_title')",
          "pm.collectionVariables.unset('created_post_id')",
          "pm.collectionVariables.unset('created_post_title')",
        ],
      },
    ],
  ]);

  if (requests.length !== expectedRequests.size) {
    throw new Error(`Governed collection request count changed: expected=${expectedRequests.size}, actual=${requests.length}`);
  }
  const requestNames = new Set();
  let requestSpecificAssertions = 0;
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
    if (JSON.stringify(request.lineage) !== JSON.stringify(expected.lineage)) {
      throw new Error(
        `Governed request folder lineage changed for ${request.name}: ` +
          `expected=${expected.lineage.join(' > ')}, actual=${request.lineage.join(' > ')}`,
      );
    }
    requireRequestHeaders(request.request, request.name, { jsonBody: expected.jsonBody === true });
    requireExactTestNames(request.testScript, expected.tests, request.name);
    requireScriptPrimitives(request.testScript, expected.primitives, request.name);
    requestSpecificAssertions += expected.tests.length;

    if (request.name === 'Create post') {
      if (request.request?.body?.mode !== 'raw' || typeof request.request?.body?.raw !== 'string') {
        throw new Error('Create post must retain a raw JSON request body');
      }
      requireScriptPrimitives(
        request.request.body.raw,
        ['{{generated_title}}', '{{user_id}}', 'generated by Newman contract test'],
        'Create post request body',
      );
    }
  }
  for (const expectedName of expectedRequests.keys()) {
    if (!requestNames.has(expectedName)) throw new Error(`Governed request is missing: ${expectedName}`);
  }

  const assertionsPerIteration = globalTests.length * requests.length + requestSpecificAssertions;
  if (assertionsPerIteration !== 19) {
    throw new Error(`Governed assertion topology changed: expected=19, actual=${assertionsPerIteration}`);
  }
  return { requests: requests.length, assertionsPerIteration };
}

function validateEnvironment(environment) {
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

  const secretPattern = /(token|secret|password|api[_-]?key|authorization)/i;
  const suspicious = enabled.filter(
    (entry) => secretPattern.test(entry.key) && String(entry.value || '').trim() !== ''
  );
  if (suspicious.length) {
    throw new Error(`Environment contains committed secret-like values: ${suspicious.map((x) => x.key).join(', ')}`);
  }
}

function validateIterationData(data) {
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
}

function main() {
  const collection = readJson('collections/posts-api.postman_collection.json');
  const environment = readJson('postman_environment.json');
  const schema = readJson('schemas/post-schema.json');
  const data = readJson('data/posts.json');

  validatePostSchema(schema);
  const topology = validateCollection(collection);
  validateEnvironment(environment);
  validateIterationData(data);

  console.log(
    `governed Postman assets: requests=${topology.requests}, ` +
      `assertionsPerIteration=${topology.assertionsPerIteration}, iterationRows=${data.length}`,
  );
}

if (require.main === module) main();

module.exports = {
  validateCollection,
  validateEnvironment,
  validateIterationData,
  validatePostSchema,
};
