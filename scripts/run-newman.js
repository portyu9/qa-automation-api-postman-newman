'use strict';

const fs = require('node:fs');
const path = require('node:path');
const newman = require('newman');
const {
  DEFAULT_LOCAL_API_URL,
  startLocalApi,
  stopLocalApi,
} = require('./local-api');
const {
  absoluteHttpBaseUrl,
  compactFailure,
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

fs.mkdirSync(reportsDir, { recursive: true });
const environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8'));
if (!Array.isArray(environment.values)) {
  throw new Error('Postman environment must contain a values array');
}

const baseUrlEntry = environment.values.find(
  (entry) => entry.key === 'base_url' && entry.enabled !== false
);
if (!baseUrlEntry) {
  throw new Error('Postman environment must define an enabled base_url value');
}
baseUrlEntry.value = absoluteHttpBaseUrl(
  'base_url',
  process.env.NEWMAN_BASE_URL || baseUrlEntry.value
);

const runId = process.env.TEST_RUN_ID || `newman-${Date.now()}`;
const runIdEntry = environment.values.find((entry) => entry.key === 'run_id');
if (runIdEntry) runIdEntry.value = runId;
else environment.values.push({ key: 'run_id', value: runId, enabled: true });

const postSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const timeoutRequest = positiveInteger(
  'REQUEST_TIMEOUT_MS',
  process.env.REQUEST_TIMEOUT_MS,
  10_000
);

function executeCollection() {
  return new Promise((resolve, reject) => {
    newman.run(
      {
        collection: collectionPath,
        environment,
        globals: {
          values: [{ key: 'post_schema', value: JSON.stringify(postSchema), enabled: true }],
        },
        iterationData,
        folder: process.env.NEWMAN_FOLDER || undefined,
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
  });
}

function writeManifest(summary) {
  const failures = summary.run.failures || [];
  const manifest = {
    schemaVersion: 1,
    runId,
    inputs: {
      collection: path.relative(root, collectionPath),
      environment: path.relative(root, environmentPath),
      iterationData: iterationData ? path.relative(root, iterationData) : null,
      folder: process.env.NEWMAN_FOLDER || null,
      baseUrl: baseUrlEntry.value,
      targetClass: baseUrlEntry.value === DEFAULT_LOCAL_API_URL ? 'local-fixture' : 'explicit-external',
      timeoutRequestMs: timeoutRequest,
    },
    stats: summary.run.stats,
    timings: summary.run.timings,
    failures: failures.map(compactFailure),
  };

  const output = path.join(reportsDir, 'run-manifest.json');
  const temporary = `${output}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, output);
  return failures.length;
}

async function main() {
  const ownsLocalApi = baseUrlEntry.value === DEFAULT_LOCAL_API_URL;
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
