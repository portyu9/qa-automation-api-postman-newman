'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_PATH = 'vendor/node-forge-disabled';
const LOCAL_SPEC = 'file:' + LOCAL_PATH;
const INERT_VERSION = '0.0.0-asap-disabled';
const UNSUPPORTED = 'ERR_ASAP_AUTH_DISABLED';

function validateManifestAndLock(manifest, lock, vendorManifest) {
  assert.equal(manifest.devDependencies?.['node-forge'], LOCAL_SPEC, 'the unsupported package must be explicitly replaced with a local inert module');
  assert.equal(manifest.overrides?.['node-forge'], '$node-forge', 'all transitive node-forge uses must resolve to the audited local module');
  assert.equal(lock.lockfileVersion, 3, 'immutable npm v3 lockfile required');
  assert.equal(lock.packages?.['']?.devDependencies?.['node-forge'], LOCAL_SPEC, 'lock root must bind the local replacement');
  assert.deepEqual(lock.packages?.['node_modules/node-forge'], { resolved: LOCAL_PATH, link: true }, 'registry node-forge must never be installed');
  assert.deepEqual(lock.packages?.[LOCAL_PATH], { name: '@portyu9/asap-disabled', version: INERT_VERSION, dev: true }, 'the only allowed replacement is the inert reviewed package');
  assert.equal(vendorManifest.name, '@portyu9/asap-disabled');
  assert.equal(vendorManifest.version, INERT_VERSION);
  assert.equal(vendorManifest.private, true);
  assert.equal(vendorManifest.main, 'index.js');
  assert.equal(vendorManifest.dependencies, undefined, 'no transitive packages allowed');
  assert.equal(vendorManifest.optionalDependencies, undefined, 'no optional packages allowed');
  assert.equal(vendorManifest.peerDependencies, undefined, 'no peer packages allowed');
  assert.equal(vendorManifest.scripts, undefined, 'no lifecycle scripts allowed');
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name.endsWith('/node_modules/node-forge') && name !== 'node_modules/node-forge') {
      throw new Error('nested upstream node-forge install forbidden: ' + name);
    }
    if (name !== 'node_modules/node-forge' && entry?.name === 'node-forge' && name !== LOCAL_PATH) {
      throw new Error('unexpected node-forge registry/package entry: ' + name);
    }
  }
  const postman = lock.packages['node_modules/postman-runtime'];
  assert.ok(postman?.dependencies?.['node-forge'], 'upstream postman-runtime dependency must remain explicitly modeled');
}

function verifyInstalled(root) {
  const expected = path.join(root, LOCAL_PATH);
  const installed = path.join(root, 'node_modules/node-forge');
  assert.ok(fs.existsSync(installed), 'npm ci must install the local inert module');
  assert.equal(fs.realpathSync(installed), fs.realpathSync(expected), 'npm ci resolved a registry node-forge instead of the reviewed local module');
  const replacement = require(installed);
  for (const [section, names] of Object.entries({
    util: ['decode64'],
    asn1: ['fromDer'],
    pki: ['privateKeyFromAsn1', 'privateKeyToPem', 'privateKeyFromPem', 'privateKeyToAsn1', 'wrapRsaPrivateKey', 'privateKeyInfoToPem'],
  })) {
    for (const name of names) {
      assert.throws(() => replacement[section][name]('untrusted'), error => error?.code === UNSUPPORTED, 'ASAP crypto must fail closed: ' + section + '.' + name);
    }
  }
  assert.equal(replacement.pki.publicKeyFromPem, undefined, 'signature verifier must not exist');
}

function validate(root, { installed = true } = {}) {
  const load = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  validateManifestAndLock(load('package.json'), load('package-lock.json'), load(LOCAL_PATH + '/package.json'));
  if (installed) verifyInstalled(root);
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '../..');
    validate(root, { installed: !process.argv.includes('--lock-only') });
    console.log('ASAP-disabled dependency isolation: validated');
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}
module.exports = { validate, validateManifestAndLock, verifyInstalled };
