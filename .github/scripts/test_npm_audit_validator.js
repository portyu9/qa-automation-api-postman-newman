'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateAuditPolicy } = require('./validate_npm_audit');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-audit-policy-'));
  fs.mkdirSync(path.join(root, 'collections'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/postman-collection/lib/superstring'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(root, 'collections/test.json'), '{"name":"safe"}\n');
  fs.writeFileSync(path.join(root, 'postman_environment.json'), '{"values":[]}\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ devDependencies: { newman: '6.2.2' } }, null, 2)
  );
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify(
      {
        packages: {
          'node_modules/newman': { version: '6.2.2' },
          'node_modules/postman-collection': { version: '4.4.0' },
          'node_modules/@faker-js/faker': { version: '5.5.3' },
        },
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(root, 'node_modules/postman-collection/lib/superstring/dynamic-variables.js'),
    "var faker = require('@faker-js/faker/locale/en');\nconst city = faker.address.city;\n"
  );

  const config = {
    schemaVersion: 1,
    exceptions: [
      {
        id: 'GHSA-qxc2-j82w-r537',
        package: '@faker-js/faker',
        severity: 'high',
        expiresOn: '2026-10-02',
        exactVersions: {
          newman: '6.2.2',
          'postman-collection': '4.4.0',
          '@faker-js/faker': '5.5.3',
        },
        directDependency: { name: 'newman', version: '6.2.2' },
        installedSource: {
          path: 'node_modules/postman-collection/lib/superstring/dynamic-variables.js',
          requiredMarkers: ["require('@faker-js/faker/locale/en')", 'faker.address.city'],
          forbiddenPatterns: ['helpers.fake'],
        },
        forbiddenAssetPatterns: ['{{$random', 'helpers.fake'],
      },
    ],
  };

  const rootAdvice = {
    source: 1158500,
    name: '@faker-js/faker',
    dependency: '@faker-js/faker',
    title: 'Faker RCE',
    url: 'https://github.com/advisories/GHSA-qxc2-j82w-r537',
    severity: 'high',
    range: '<=10.4.0',
  };
  const audit = {
    auditReportVersion: 2,
    vulnerabilities: {
      '@faker-js/faker': {
        name: '@faker-js/faker',
        severity: 'high',
        via: [rootAdvice],
      },
      'postman-collection': {
        name: 'postman-collection',
        severity: 'high',
        via: [
          '@faker-js/faker',
          {
            name: 'uuid',
            severity: 'moderate',
            url: 'https://github.com/advisories/GHSA-moderate',
          },
        ],
      },
      'postman-runtime': {
        name: 'postman-runtime',
        severity: 'high',
        via: ['postman-collection'],
      },
      newman: {
        name: 'newman',
        severity: 'high',
        via: ['postman-runtime'],
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 1,
        high: 4,
        critical: 0,
        total: 5,
      },
      dependencies: {
        prod: 0,
        dev: 20,
        optional: 0,
        peer: 0,
        peerOptional: 0,
        total: 20,
      },
    },
  };
  return { root, config, audit };
}

function expectFailure(fn, pattern) {
  assert.throws(fn, pattern);
}

{
  const { root, config, audit } = fixture();
  const result = validateAuditPolicy({
    audit,
    config,
    root,
    now: new Date('2026-09-02T12:00:00Z'),
    auditStatus: 1,
  });
  assert.equal(result.waivedRootAdvisories, 1);
  assert.deepEqual(result.waivedAffectedNodes, [
    '@faker-js/faker',
    'newman',
    'postman-collection',
    'postman-runtime',
  ]);
}

{
  const { root, config, audit } = fixture();
  audit.vulnerabilities.evil = {
    name: 'evil',
    severity: 'high',
    via: [
      {
        name: 'evil',
        severity: 'high',
        url: 'https://github.com/advisories/GHSA-evil-0000',
      },
    ],
  };
  expectFailure(
    () =>
      validateAuditPolicy({
        audit,
        config,
        root,
        now: new Date('2026-09-02T12:00:00Z'),
        auditStatus: 1,
      }),
    /unwaived HIGH\/CRITICAL/
  );
}

{
  const { root, config, audit } = fixture();
  expectFailure(
    () =>
      validateAuditPolicy({
        audit,
        config,
        root,
        now: new Date('2026-10-03T00:00:00Z'),
        auditStatus: 1,
      }),
    /expired/
  );
}

{
  const { root, config, audit } = fixture();
  config.exceptions[0].exactVersions['postman-collection'] = '4.4.1';
  expectFailure(
    () =>
      validateAuditPolicy({
        audit,
        config,
        root,
        now: new Date('2026-09-02T12:00:00Z'),
        auditStatus: 1,
      }),
    /expected postman-collection@4\.4\.1/
  );
}

{
  const { root, config, audit } = fixture();
  fs.writeFileSync(path.join(root, 'collections/test.json'), '{"value":"{{$randomCity}}"}\n');
  expectFailure(
    () =>
      validateAuditPolicy({
        audit,
        config,
        root,
        now: new Date('2026-09-02T12:00:00Z'),
        auditStatus: 1,
      }),
    /forbidden execution-surface pattern/
  );
}

{
  const { root, config, audit } = fixture();
  fs.appendFileSync(
    path.join(root, 'node_modules/postman-collection/lib/superstring/dynamic-variables.js'),
    '\nfaker.helpers.fake("{{system.filePath}}")\n'
  );
  expectFailure(
    () =>
      validateAuditPolicy({
        audit,
        config,
        root,
        now: new Date('2026-09-02T12:00:00Z'),
        auditStatus: 1,
      }),
    /forbidden upstream source pattern/
  );
}

{
  const { root, config, audit } = fixture();
  expectFailure(
    () =>
      validateAuditPolicy({
        audit,
        config,
        root,
        now: new Date('2026-09-02T12:00:00Z'),
        auditStatus: 2,
      }),
    /operationally/
  );
}

console.log('npm audit exception validator self-test: ok');
