'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  validateCollection,
  validateEnvironment,
  validateIterationData,
  validatePostSchema,
} = require('./validate-assets');

const root = path.resolve(__dirname, '..');

function load(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireFailure(action, expected) {
  try {
    action();
  } catch (error) {
    if (!String(error?.message || error).includes(expected)) {
      throw new Error(`expected failure containing ${JSON.stringify(expected)}, got ${error?.message || error}`);
    }
    return;
  }
  throw new Error(`expected validation failure containing ${JSON.stringify(expected)}`);
}

function findRequest(items, name) {
  for (const item of items || []) {
    if (item?.name === name && item.request) return item;
    const nested = findRequest(item?.item, name);
    if (nested) return nested;
  }
  return null;
}

function testScript(item) {
  const event = (item?.event || []).find((candidate) => candidate?.listen === 'test');
  if (!event?.script?.exec) throw new Error(`missing test script fixture for ${item?.name}`);
  return event.script.exec;
}

function main() {
  const collection = load('collections/posts-api.postman_collection.json');
  const environment = load('postman_environment.json');
  const data = load('data/posts.json');
  const schema = load('schemas/post-schema.json');

  validatePostSchema(schema);
  const topology = validateCollection(collection);
  validateEnvironment(environment);
  validateIterationData(data);
  if (topology.requests !== 5 || topology.assertionsPerIteration !== 19) {
    throw new Error(`clean topology mismatch: ${JSON.stringify(topology)}`);
  }

  const weakenedRequired = clone(schema);
  weakenedRequired.required = weakenedRequired.required.filter((field) => field !== 'id');
  requireFailure(() => validatePostSchema(weakenedRequired), 'required fields changed');

  const weakenedType = clone(schema);
  weakenedType.properties.id.type = 'number';
  requireFailure(() => validatePostSchema(weakenedType), 'id must remain an integer with minimum 1');

  const brokenHeader = clone(collection);
  const listPosts = findRequest(brokenHeader.item, 'List posts');
  listPosts.request.header.find((header) => header.key === 'X-Request-Id').value = '{{other_id}}';
  requireFailure(() => validateCollection(brokenHeader), 'header contract changed for x-request-id');

  const renamedAssertion = clone(collection);
  const createPost = findRequest(renamedAssertion.item, 'Create post');
  const createExec = testScript(createPost);
  createExec[1] = createExec[1].replace(
    'Created representation matches request and schema',
    'Created representation exists',
  );
  requireFailure(() => validateCollection(renamedAssertion), 'Create post test contract changed');

  const removedSchemaAssertion = clone(collection);
  const getPost = findRequest(removedSchemaAssertion.item, 'Get post by id');
  const getExec = testScript(getPost);
  const schemaLine = getExec.findIndex((line) => line.includes('pm.response.to.have.jsonSchema'));
  if (schemaLine < 0) throw new Error('fixture lacks Get post JSON Schema assertion');
  getExec[schemaLine] = '  // schema assertion intentionally removed by regression fixture';
  requireFailure(() => validateCollection(removedSchemaAssertion), 'missing governed primitives');

  const brokenCorrelation = clone(collection);
  const prerequest = brokenCorrelation.event.find((event) => event.listen === 'prerequest').script.exec;
  const requestIdLine = prerequest.findIndex((line) => line.includes("pm.variables.set('request_id'"));
  if (requestIdLine < 0) throw new Error('fixture lacks request_id prerequest primitive');
  prerequest.splice(requestIdLine, 1);
  requireFailure(() => validateCollection(brokenCorrelation), 'collection prerequest script is missing governed primitives');

  const externalEnvironment = clone(environment);
  externalEnvironment.values.find((entry) => entry.key === 'base_url').value = 'https://example.test';
  requireFailure(() => validateEnvironment(externalEnvironment), 'deterministic loopback base_url');

  requireFailure(() => validateIterationData(data.slice(0, 2)), 'at least three governed cases');

  console.log('Postman governed asset validator self-test: ok');
}

main();
