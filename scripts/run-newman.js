'use strict';

const fs = require('node:fs');
const path = require('node:path');
const newman = require('newman');
const { ExecutionLedger } = require('./execution-ledger');
const {
  DEFAULT_LOCAL_API_URL,
  startLocalApi,
  stopLocalApi,
} = require('./local-api');
const {
  absoluteHttpBaseUrl,
  compactFailure,
  correlationToken,
  explicitBoolean,
  optionalLabel,
  positiveInteger,
  projectFile,
  redactText,
} = require('./runtime');

const root = path.resolve(__dirname, '..');
const collectionPath = projectFile(
  root,
  process.env.NEWMAN_COLLECTION || 'collections/posts-api.postman_collection.json',
  'NEWMAN_COLLECTION'
);
const environmentPath = projectFile(
  root,
  process.env.NEWMAN_ENVIRONMENT || 'postman_environment.json',
  'NEWMAN_ENVIRONMENT'
);
const schemaPath = projectFile(root, 'schemas/post-schema.json', 'schema');
const reportsDir = path.resolve(root, 'reports');
const iterationData = process.env.NEWMAN_ITERATION_DATA
  ? projectFile(root, process.env.NEWMAN_ITERATION_DATA, 'NEWMAN_ITERATION_DATA')
  : undefined;
const folder = optionalLabel('NEWMAN_FOLDER', process.env.NEWMAN_FOLDER);

fs.mkdirSync(reportsDir, { recursive: true });
const environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8'));
if (!Array.isArray(environment.values)) {
  throw new Error('Postman environment must contain a values array');
}

const enabledBaseUrls = environment.values.filter(
  (entry) => entry.key === 'base_url' && entry.enabled !== false
);
if (enabledBaseUrls.length !== 1) {
  throw new Error('Postman environment must define exactly one enabled base_url value');
}
const baseUrlEntry = enabledBaseUrls[0];
baseUrlEntry.value = absoluteHttpBaseUrl(
  'base_url',
  process.env.NEWMAN_BASE_URL || baseUrlEntry.value
);
const ownsLocalApi = baseUrlEntry.value === DEFAULT_LOCAL_API_URL;
const externalTargetAuthorized = explicitBoolean(
  'NEWMAN_ALLOW_EXTERNAL_TARGET',
  process.env.NEWMAN_ALLOW_EXTERNAL_TARGET,
  false
);
if (!ownsLocalApi && !externalTargetAuthorized) {
  throw new Error(
    'External Newman targets require explicit authorization: set NEWMAN_ALLOW_EXTERNAL_TARGET=true together with NEWMAN_BASE_URL'
  );
}

const runId = correlationToken('TEST_RUN_ID', process.env.TEST_RUN_ID, `newman-${Date.now()}`);
const enabledRunIds = environment.values.filter(
  (entry) => entry.key === 'run_id' && entry.enabled !== false
);
if (enabledRunIds.length > 1) {
  throw new Error('Postman environment must not define duplicate enabled run_id values');
}
if (enabledRunIds.length === 1) enabledRunIds[0].value = runId;
else environment.values.push({ key: 'run_id', value: runId, enabled: true });

const postSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const timeoutRequest = positiveInteger(
  'REQUEST_TIMEOUT_MS',
  process.env.REQUEST_TIMEOUT_MS,
  10_000
);
const executionLedger = new ExecutionLedger();

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function compactCounter(value = {}) {
  return {
    total: nonNegativeInteger(value.total),
    pending: nonNegativeInteger(value.pending),
    failed: nonNegativeInteger(value.failed),
  };
}

function compactStats(stats = {}) {
  return {
    iterations: compactCounter(stats.iterations),
    items: compactCounter(stats.items),
    requests: compactCounter(stats.requests),
    tests: compactCounter(stats.tests),
    assertions: compactCounter(stats.assertions),
  };
}

function safeIso(value) {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function compactTimings(timings = {}) {
  const startedAt = safeIso(timings.started);
  const completedAt = safeIso(timings.completed);
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  const completedMs = completedAt ? Date.parse(completedAt) : NaN;
  return {
    startedAt,
    completedAt,
    durationMs:
      Number.isFinite(startedMs) && Number.isFinite(completedMs) && completedMs >= startedMs
        ? completedMs - startedMs
        : null,
    responseAverageMs: nonNegativeNumber(timings.responseAverage),
    responseMinMs: nonNegativeNumber(timings.responseMin),
    responseMaxMs: nonNegativeNumber(timings.responseMax),
    responseSdMs: nonNegativeNumber(timings.responseSd),
  };
}

function executeCollection() {
  return new Promise((resolve, reject) => {
    const run = newman.run(
      {
        collection: collectionPath,
        environment,
        globals: {
          values: [{ key: 'post_schema', value: JSON.stringify(postSchema), enabled: true }],
        },
        iterationData,
        folder: folder || undefined,
        timeoutRequest,
        // Raw Newman JSON can serialize substantially more runtime context than
        // the operational evidence contract requires. Retain focused JUnit plus
        // the allowlisted sanitized run manifest instead.
        reporters: ['cli', 'junit'],
        reporter: {
          junit: { export: path.join(reportsDir, 'newman-junit.xml') },
        },
      },
      (error, summary) => {
        if (error) reject(error);
        else resolve(summary);
      }
    );

    run.on('request', (error, args) => executionLedger.record(args, error));
  });
}

function writeManifest(summary) {
  const failures = Array.isArray(summary.run.failures) ? summary.run.failures : [];
  const manifest = {
    schemaVersion: 1,
    runId,
    inputs: {
      collection: path.relative(root, collectionPath),
      environment: path.relative(root, environmentPath),
      iterationData: iterationData ? path.relative(root, iterationData) : null,
      folder: folder ? redactText(folder) : null,
      baseUrl: baseUrlEntry.value,
      targetClass: ownsLocalApi ? 'local-fixture' : 'explicit-external',
      externalTargetAuthorized: ownsLocalApi ? false : externalTargetAuthorized,
      timeoutRequestMs: timeoutRequest,
    },
    stats: compactStats(summary.run.stats),
    timings: compactTimings(summary.run.timings),
    executions: executionLedger.snapshot(),
    failures: failures.map(compactFailure),
  };

  const output = path.join(reportsDir, 'run-manifest.json');
  const temporary = `${output}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, output);
  return failures.length;
}

async function main() {
  let localApi;

  try {
    if (ownsLocalApi) {
      localApi = await startLocalApi();
      console.log(`Newman runner owns deterministic local API at ${DEFAULT_LOCAL_API_URL}`);
    }

    const summary = await executeCollection();
    if (writeManifest(summary) > 0) process.exitCode = 1;
  } catch (error) {
    console.error(redactText(error?.message || error));
    process.exitCode = 1;
  } finally {
    try {
      await stopLocalApi(localApi);
    } catch (error) {
      console.error(redactText(error?.message || error));
      process.exitCode = 1;
    }
  }
}

main();
