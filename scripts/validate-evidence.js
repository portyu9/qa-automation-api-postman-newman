'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_LOCAL_API_URL } = require('./local-api');

const root = path.resolve(__dirname, '..');
const NONE = '<none>';

function readText(file, label) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`${label} is missing: ${file}`);
    throw error;
  }
  if (content.trim().length === 0) throw new Error(`${label} is empty: ${file}`);
  return content;
}

function projectJson(relative, label) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the repository root: ${relative}`);
  }
  return JSON.parse(readText(resolved, label));
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function readMinimum(name, fallback) {
  return process.env[name] ? positiveInteger(process.env[name], name) : fallback;
}

function validateCounter(counter, label, minimum = 1) {
  if (!counter || !Number.isInteger(counter.total) || counter.total < minimum) {
    throw new Error(`${label} execution floor failed: total=${counter?.total}, minimum=${minimum}`);
  }
  for (const field of ['pending', 'failed']) {
    if (!Number.isInteger(counter[field]) || counter[field] !== 0) {
      throw new Error(`${label} contains ${field} work: ${counter[field]}`);
    }
  }
  return counter.total;
}

function xmlIntegerAttribute(source, element, attribute) {
  const match = source.match(new RegExp(`<${element}\\b[^>]*\\b${attribute}="(\\d+)"`, 'i'));
  if (!match) throw new Error(`Newman JUnit report is missing ${element}.${attribute}`);
  return Number(match[1]);
}

function expectedNullable(name) {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) return undefined;
  return process.env[name] === NONE ? null : process.env[name];
}

function validateExpectedInput(manifest, envName, key) {
  const expected = expectedNullable(envName);
  if (expected === undefined) return;
  const actual = manifest.inputs?.[key] ?? null;
  if (actual !== expected) {
    throw new Error(`Newman input mismatch for ${key}: expected=${expected ?? 'null'}, actual=${actual ?? 'null'}`);
  }
}

function validateTargetEvidence(manifest) {
  const targetClass = manifest.inputs?.targetClass;
  const baseUrl = manifest.inputs?.baseUrl;
  const authorized = manifest.inputs?.externalTargetAuthorized;

  if (targetClass === 'local-fixture') {
    if (baseUrl !== DEFAULT_LOCAL_API_URL) {
      throw new Error(`local target evidence must use ${DEFAULT_LOCAL_API_URL}, got ${baseUrl}`);
    }
    if (authorized !== false) {
      throw new Error('local target evidence must record externalTargetAuthorized=false');
    }
    return;
  }

  if (targetClass === 'explicit-external') {
    if (typeof baseUrl !== 'string' || !baseUrl || baseUrl === DEFAULT_LOCAL_API_URL) {
      throw new Error('external target evidence must contain a non-local baseUrl');
    }
    if (authorized !== true) {
      throw new Error('external target evidence must record externalTargetAuthorized=true');
    }
    return;
  }

  throw new Error(`unknown Newman target classification: ${targetClass}`);
}

function enabledEnvironmentValue(environment, key) {
  if (!Array.isArray(environment?.values)) throw new Error('Evidence environment is missing values');
  const matches = environment.values.filter((entry) => entry?.key === key && entry.enabled !== false);
  if (matches.length !== 1) throw new Error(`Evidence environment must contain exactly one enabled ${key}`);
  return matches[0].value;
}

function validatePostsFullProfile(manifest, iterations, requests) {
  if (manifest.inputs?.targetClass !== 'local-fixture') {
    throw new Error('posts-full execution profile requires the deterministic local fixture');
  }
  if (requests !== iterations * 5) {
    throw new Error(`posts-full request topology mismatch: iterations=${iterations}, requests=${requests}`);
  }

  const environment = projectJson(manifest.inputs?.environment, 'evidence environment');
  let expectedPostIds;
  if (manifest.inputs?.iterationData === null) {
    expectedPostIds = [positiveInteger(enabledEnvironmentValue(environment, 'post_id'), 'environment post_id')];
  } else {
    const rows = projectJson(manifest.inputs.iterationData, 'evidence iteration data');
    if (!Array.isArray(rows)) throw new Error('Evidence iteration data must be an array');
    expectedPostIds = rows.map((row, index) => positiveInteger(row?.post_id, `iteration row ${index} post_id`));
  }
  if (expectedPostIds.length !== iterations) {
    throw new Error(`posts-full iteration identity mismatch: expectedCases=${expectedPostIds.length}, iterations=${iterations}`);
  }

  const byIteration = new Map();
  for (const execution of manifest.executions) {
    if (!Number.isInteger(execution.iteration) || execution.iteration < 0) {
      throw new Error(`posts-full execution is missing a valid iteration index: ${execution.iteration}`);
    }
    const entries = byIteration.get(execution.iteration) || [];
    entries.push(execution);
    byIteration.set(execution.iteration, entries);
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const entries = byIteration.get(iteration) || [];
    if (entries.length !== 5) {
      throw new Error(`posts-full iteration ${iteration} contains ${entries.length} request records instead of 5`);
    }
    const expected = [
      { method: 'GET', path: '/health', statusCode: 200 },
      { method: 'GET', path: '/posts', statusCode: 200 },
      { method: 'GET', path: `/posts/${expectedPostIds[iteration]}`, statusCode: 200 },
      { method: 'POST', path: '/posts', statusCode: 201 },
      { method: 'GET', path: `/posts/${101 + iteration}`, statusCode: 200 },
    ];
    for (let index = 0; index < expected.length; index += 1) {
      const actual = entries[index];
      const contract = expected[index];
      if (
        actual.method !== contract.method ||
        actual.path !== contract.path ||
        actual.statusCode !== contract.statusCode
      ) {
        throw new Error(
          `posts-full execution identity mismatch at iteration=${iteration}, request=${index}: ` +
            `expected=${contract.method} ${contract.path} ${contract.statusCode}, ` +
            `actual=${actual.method} ${actual.path} ${actual.statusCode}`,
        );
      }
    }
  }
}

const minimumIterations = readMinimum('MIN_NEWMAN_ITERATIONS', 1);
const minimumRequests = readMinimum('MIN_NEWMAN_REQUESTS', 5);
const minimumAssertions = readMinimum('MIN_NEWMAN_ASSERTIONS', 19);

const manifestPath = path.join('reports', 'run-manifest.json');
const junitPath = path.join('reports', 'newman-junit.xml');
const manifest = JSON.parse(readText(manifestPath, 'Newman run manifest'));
const junit = readText(junitPath, 'Newman JUnit report');

if (manifest.schemaVersion !== 1) throw new Error('Newman run manifest schemaVersion must be 1');
if (process.env.TEST_RUN_ID && manifest.runId !== process.env.TEST_RUN_ID) {
  throw new Error('Newman run manifest runId does not match the current execution');
}
validateTargetEvidence(manifest);
if (process.env.EXPECTED_TARGET_CLASS && manifest.inputs?.targetClass !== process.env.EXPECTED_TARGET_CLASS) {
  throw new Error(`Newman target classification mismatch: expected=${process.env.EXPECTED_TARGET_CLASS}, actual=${manifest.inputs?.targetClass}`);
}
validateExpectedInput(manifest, 'EXPECTED_NEWMAN_COLLECTION', 'collection');
validateExpectedInput(manifest, 'EXPECTED_NEWMAN_ENVIRONMENT', 'environment');
validateExpectedInput(manifest, 'EXPECTED_NEWMAN_ITERATION_DATA', 'iterationData');
validateExpectedInput(manifest, 'EXPECTED_NEWMAN_FOLDER', 'folder');

const iterations = validateCounter(manifest.stats?.iterations, 'iteration statistics', minimumIterations);
const items = validateCounter(manifest.stats?.items, 'item statistics', minimumRequests);
const requests = validateCounter(manifest.stats?.requests, 'request statistics', minimumRequests);
const tests = validateCounter(manifest.stats?.tests, 'test-script statistics', minimumRequests);
const assertions = validateCounter(manifest.stats?.assertions, 'assertion statistics', minimumAssertions);

if (items !== requests || tests !== requests) {
  throw new Error(`Newman work counters do not reconcile: items=${items}, requests=${requests}, tests=${tests}`);
}
if (requests % iterations !== 0 || assertions % iterations !== 0) {
  throw new Error(`Newman iteration totals do not reconcile: iterations=${iterations}, requests=${requests}, assertions=${assertions}`);
}

if (!Array.isArray(manifest.executions) || manifest.executions.length === 0) {
  throw new Error('Newman execution ledger contains no request evidence');
}
if (manifest.executions.length !== requests) {
  throw new Error(`Newman execution ledger/request count mismatch: ledger=${manifest.executions.length}, requests=${requests}`);
}
for (const execution of manifest.executions) {
  if (execution.transportError !== null) throw new Error(`Newman execution contains a transport error: ${execution.transportError}`);
  if (!Number.isInteger(execution.statusCode) || execution.statusCode < 100 || execution.statusCode > 599) {
    throw new Error('Newman execution contains an invalid or missing HTTP status code');
  }
  if (typeof execution.method !== 'string' || !/^[A-Z]+$/.test(execution.method)) {
    throw new Error(`Newman execution contains an invalid method: ${execution.method}`);
  }
  if (typeof execution.path !== 'string' || !execution.path.startsWith('/')) {
    throw new Error(`Newman execution contains an invalid sanitized path: ${execution.path}`);
  }
  if (!Number.isFinite(execution.responseTimeMs) || execution.responseTimeMs < 0) {
    throw new Error(`Newman execution contains invalid response timing: ${execution.responseTimeMs}`);
  }
}
if (!Array.isArray(manifest.failures) || manifest.failures.length !== 0) {
  throw new Error(`Newman run manifest contains ${Array.isArray(manifest.failures) ? manifest.failures.length : 'invalid'} failures`);
}

if (process.env.EXPECTED_EXECUTION_PROFILE === 'posts-full') {
  validatePostsFullProfile(manifest, iterations, requests);
} else if (process.env.EXPECTED_EXECUTION_PROFILE) {
  throw new Error(`Unknown EXPECTED_EXECUTION_PROFILE: ${process.env.EXPECTED_EXECUTION_PROFILE}`);
}

const junitRequestExecutions = xmlIntegerAttribute(junit, 'testsuites', 'tests');
const junitTestcases = (junit.match(/<testcase(?:\s|>)/g) || []).length;
const junitFailures = (junit.match(/<failure(?:\s|>)/g) || []).length;
const junitErrors = (junit.match(/<error(?:\s|>)/g) || []).length;
if (junitFailures !== 0 || junitErrors !== 0) {
  throw new Error(`Newman JUnit contains failure/error evidence: failures=${junitFailures}, errors=${junitErrors}`);
}
if (junitRequestExecutions !== requests) {
  throw new Error(`Newman JUnit/request count mismatch: junit=${junitRequestExecutions}, requests=${requests}`);
}
const assertionsPerIteration = assertions / iterations;
if (junitTestcases !== assertionsPerIteration) {
  throw new Error(
    `Newman JUnit assertion view does not reconcile with iteration-normalized assertions: ` +
      `junitTestcases=${junitTestcases}, assertionsPerIteration=${assertionsPerIteration}`,
  );
}

console.log(
  `validated Newman evidence: iterations=${iterations}, requests=${requests}, assertions=${assertions}, ` +
    `junitTestcases=${junitTestcases}, executions=${manifest.executions.length}, target=${manifest.inputs.targetClass}, ` +
    `profile=${process.env.EXPECTED_EXECUTION_PROFILE || 'generic'}`,
);
