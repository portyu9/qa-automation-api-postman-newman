'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
if (process.env.EXPECTED_TARGET_CLASS && manifest.inputs?.targetClass !== process.env.EXPECTED_TARGET_CLASS) {
  throw new Error(`Newman target classification mismatch: expected=${process.env.EXPECTED_TARGET_CLASS}, actual=${manifest.inputs?.targetClass}`);
}

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
}
if (!Array.isArray(manifest.failures) || manifest.failures.length !== 0) {
  throw new Error(`Newman run manifest contains ${Array.isArray(manifest.failures) ? manifest.failures.length : 'invalid'} failures`);
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
    `junitTestcases=${junitTestcases}, executions=${manifest.executions.length}`,
);
