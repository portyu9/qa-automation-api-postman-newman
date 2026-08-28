'use strict';

const fs = require('node:fs');
const path = require('node:path');
const newman = require('newman');

const root = path.resolve(__dirname, '..');
const collectionPath = path.resolve(root, process.env.NEWMAN_COLLECTION || 'collections/jsonplaceholder.postman_collection.json');
const environmentPath = path.resolve(root, process.env.NEWMAN_ENVIRONMENT || 'postman_environment.json');
const schemaPath = path.resolve(root, 'schemas/post-schema.json');
const reportsDir = path.resolve(root, 'reports');
const iterationData = process.env.NEWMAN_ITERATION_DATA
  ? path.resolve(root, process.env.NEWMAN_ITERATION_DATA)
  : undefined;

fs.mkdirSync(reportsDir, { recursive: true });
const environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8'));
const runId = process.env.TEST_RUN_ID || `newman-${Date.now()}`;
const runIdEntry = environment.values.find((entry) => entry.key === 'run_id');
if (runIdEntry) runIdEntry.value = runId;
else environment.values.push({ key: 'run_id', value: runId, enabled: true });

const postSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const timeoutRequest = Number(process.env.REQUEST_TIMEOUT_MS || 10_000);
if (!Number.isInteger(timeoutRequest) || timeoutRequest <= 0) {
  throw new Error('REQUEST_TIMEOUT_MS must be a positive integer');
}

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
    reporters: ['cli', 'junit', 'json'],
    reporter: {
      junit: { export: path.join(reportsDir, 'newman-junit.xml') },
      json: { export: path.join(reportsDir, 'newman.json') },
    },
  },
  (error, summary) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
      return;
    }

    const failures = summary.run.failures || [];
    const stats = summary.run.stats;
    fs.writeFileSync(
      path.join(reportsDir, 'summary.json'),
      JSON.stringify({ runId, failures: failures.length, stats }, null, 2)
    );

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  }
);
