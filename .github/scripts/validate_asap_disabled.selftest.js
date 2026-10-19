'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateManifestAndLock, verifyInstalled } = require('./validate_asap_disabled');

const root = path.resolve(__dirname, '../..');
const load = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const manifest = load('package.json');
const lock = load('package-lock.json');
const vendor = load('vendor/node-forge-disabled/package.json');
const clone = value => structuredClone(value);
function rejects(mutator, message) {
  const p = clone(manifest), l = clone(lock), v = clone(vendor);
  mutator(p, l, v);
  assert.throws(() => validateManifestAndLock(p, l, v), message);
}
assert.doesNotThrow(() => validateManifestAndLock(manifest, lock, vendor));
rejects((p) => { p.overrides['node-forge'] = '1.4.0'; }, /transitive node-forge/);
rejects((p) => { p.devDependencies['node-forge'] = '1.4.0'; }, /local inert/);
rejects((_p, l) => { l.packages['node_modules/node-forge'] = { version: '1.4.0', resolved: 'https://registry.npmjs.org/node-forge/-/node-forge-1.4.0.tgz' }; }, /registry node-forge/);
rejects((_p, l) => { l.packages['node_modules/postman-runtime/node_modules/node-forge'] = { version: '1.4.0' }; }, /nested upstream/);
rejects((_p, l) => { l.packages['vendor/node-forge-disabled'].version = '1.4.0'; }, /inert reviewed/);
rejects((_p, _l, v) => { v.name = 'node-forge'; }, /@portyu9\\/asap-disabled/);
rejects((_p, _l, v) => { v.scripts = { postinstall: 'node download.js' }; }, /lifecycle scripts/);
rejects((_p, _l, v) => { v.dependencies = { 'node-forge': '1.4.0' }; }, /transitive packages/);
if (fs.existsSync(path.join(root, 'node_modules/node-forge'))) verifyInstalled(root);
console.log('ASAP-disabled dependency isolation negative/positive tests: ok');
