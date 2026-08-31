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

function positiveTotal(counter, label) {
  if (!counter || !Number.isInteger(counter.total) || counter.total <= 0) {
    throw new Error(`${label} does not prove executed work`);
  }
  if (!Number.isInteger(counter.failed) || counter.failed !== 0) {
    throw new Error(`${label} contains failed work: ${counter.failed}`);
  }
  return counter.total;
}

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

const requests = positiveTotal(manifest.stats?.requests, 'request statistics');
const assertions = positiveTotal(manifest.stats?.assertions, 'assertion statistics');
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
if (!/<testcase(?:\s|>)/.test(junit)) throw new Error('Newman JUnit report contains no testcase evidence');

console.log(`validated Newman evidence: requests=${requests}, assertions=${assertions}, executions=${manifest.executions.length}`);
