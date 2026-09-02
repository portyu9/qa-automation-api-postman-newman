'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isGatedSeverity(value) {
  return value === 'high' || value === 'critical';
}

function advisoryId(entry) {
  if (!entry || typeof entry.url !== 'string') return null;
  const match = entry.url.match(/\/advisories\/(GHSA-[A-Za-z0-9-]+)$/);
  return match ? match[1] : null;
}

function collectGatedLeaves(vulnerabilities, name, stack = new Set()) {
  if (stack.has(name)) return [];
  const vuln = vulnerabilities[name];
  if (!vuln || !Array.isArray(vuln.via)) return [];
  const nextStack = new Set(stack);
  nextStack.add(name);
  const leaves = [];
  for (const via of vuln.via) {
    if (typeof via === 'string') {
      leaves.push(...collectGatedLeaves(vulnerabilities, via, nextStack));
    } else if (via && typeof via === 'object' && isGatedSeverity(via.severity)) {
      leaves.push(via);
    }
  }
  return leaves;
}

function walkFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const files = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function executionAssets(root) {
  const targets = [
    path.join(root, 'collections'),
    path.join(root, 'data'),
    path.join(root, 'postman_environment.json'),
  ];
  return targets.flatMap(walkFiles).filter((file) => /\.(json|ya?ml|js)$/i.test(file));
}

function validateExceptionScope(exception, root, now) {
  const today = now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expiresOn || '')) {
    throw new Error(`exception ${exception.id}: expiresOn must be YYYY-MM-DD`);
  }
  if (today > exception.expiresOn) {
    throw new Error(`exception ${exception.id} expired on ${exception.expiresOn}`);
  }

  const lock = readJson(path.join(root, 'package-lock.json'));
  const pkg = readJson(path.join(root, 'package.json'));
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json is missing packages metadata');
  }
  for (const [packageName, expected] of Object.entries(exception.exactVersions || {})) {
    const entry = lock.packages[`node_modules/${packageName}`];
    if (!entry || entry.version !== expected) {
      throw new Error(
        `exception ${exception.id}: expected ${packageName}@${expected}, found ${entry?.version ?? 'missing'}`
      );
    }
  }
  if (exception.directDependency) {
    const actual =
      pkg.devDependencies?.[exception.directDependency.name] ??
      pkg.dependencies?.[exception.directDependency.name];
    if (actual !== exception.directDependency.version) {
      throw new Error(
        `exception ${exception.id}: expected direct ${exception.directDependency.name}@${exception.directDependency.version}, found ${actual ?? 'missing'}`
      );
    }
  }

  const sourcePath = path.join(root, exception.installedSource.path);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`exception ${exception.id}: installed source missing: ${exception.installedSource.path}`);
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const marker of exception.installedSource.requiredMarkers || []) {
    if (!source.includes(marker)) {
      throw new Error(`exception ${exception.id}: upstream source marker changed: ${marker}`);
    }
  }
  for (const forbidden of exception.installedSource.forbiddenPatterns || []) {
    if (source.toLowerCase().includes(forbidden.toLowerCase())) {
      throw new Error(
        `exception ${exception.id}: forbidden upstream source pattern is present: ${forbidden}`
      );
    }
  }

  for (const file of executionAssets(root)) {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const forbidden of exception.forbiddenAssetPatterns || []) {
      if (text.includes(forbidden.toLowerCase())) {
        throw new Error(
          `exception ${exception.id}: forbidden execution-surface pattern ${forbidden} found in ${path.relative(root, file)}`
        );
      }
    }
  }
}

function validateAuditPolicy({ audit, config, root, now = new Date(), auditStatus = 1 }) {
  if (
    !audit ||
    audit.auditReportVersion !== 2 ||
    !audit.metadata?.vulnerabilities ||
    !audit.metadata?.dependencies ||
    !audit.vulnerabilities
  ) {
    throw new Error('npm audit JSON is missing required v2 vulnerability/dependency metadata');
  }
  if (![0, 1].includes(auditStatus)) {
    throw new Error(`npm audit command failed operationally with exit status ${auditStatus}`);
  }
  const dependencies = audit.metadata.dependencies;
  if (!Number.isInteger(dependencies.total) || dependencies.total < 10) {
    throw new Error(`npm audit dependency graph is unexpectedly small: ${dependencies.total}`);
  }
  if (config.schemaVersion !== 1 || !Array.isArray(config.exceptions) || config.exceptions.length === 0) {
    throw new Error('npm audit exception policy must contain schemaVersion=1 and at least one exception');
  }

  const exceptionsByKey = new Map();
  for (const exception of config.exceptions) {
    if (!exception.id || !exception.package || !isGatedSeverity(exception.severity)) {
      throw new Error('each exception requires id, package, and HIGH/CRITICAL severity');
    }
    if (exception.severity === 'critical') {
      throw new Error(`critical advisory exceptions are not permitted: ${exception.id}`);
    }
    const key = `${exception.id}|${exception.package}`;
    if (exceptionsByKey.has(key)) throw new Error(`duplicate npm audit exception: ${key}`);
    exceptionsByKey.set(key, exception);
  }

  const used = new Set();
  const affectedNodes = [];
  const residual = [];
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities)) {
    if (!isGatedSeverity(vulnerability.severity)) continue;
    const leaves = collectGatedLeaves(audit.vulnerabilities, name);
    if (leaves.length === 0) {
      residual.push(`${name}: gated severity cannot be attributed to a root advisory`);
      continue;
    }
    let packageWaived = true;
    for (const leaf of leaves) {
      const id = advisoryId(leaf);
      const key = `${id}|${leaf.name}`;
      const exception = id ? exceptionsByKey.get(key) : null;
      if (!exception || leaf.severity !== exception.severity) {
        packageWaived = false;
        residual.push(
          `${name}: ${leaf.name} ${id ?? leaf.url ?? 'unknown advisory'} (${leaf.severity})`
        );
        continue;
      }
      validateExceptionScope(exception, root, now);
      used.add(key);
    }
    if (packageWaived) affectedNodes.push(name);
  }

  for (const key of exceptionsByKey.keys()) {
    if (!used.has(key)) {
      throw new Error(`configured npm audit exception is stale or no longer observed: ${key}`);
    }
  }
  if (residual.length > 0) {
    throw new Error(
      `unwaived HIGH/CRITICAL npm advisories remain:\n- ${[...new Set(residual)].join('\n- ')}`
    );
  }

  return {
    dependencies: dependencies.total,
    rawHigh: audit.metadata.vulnerabilities.high ?? 0,
    rawCritical: audit.metadata.vulnerabilities.critical ?? 0,
    waivedRootAdvisories: used.size,
    waivedAffectedNodes: [...new Set(affectedNodes)].sort(),
    exceptions: [...used].map((key) => exceptionsByKey.get(key)),
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) {
      throw new Error(`invalid arguments near ${argv[i] ?? '<end>'}`);
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.audit || !args.exceptions) {
    throw new Error(
      'usage: validate_npm_audit.js --audit <json> --exceptions <json> [--audit-status <n>]'
    );
  }
  const root = path.resolve(args.root || '.');
  const result = validateAuditPolicy({
    audit: readJson(path.resolve(args.audit)),
    config: readJson(path.resolve(args.exceptions)),
    root,
    auditStatus: Number(args['audit-status'] ?? 1),
  });
  const lines = [
    '### npm advisory gate',
    '',
    `- Audited dependency graph: \`${result.dependencies}\` packages`,
    `- Raw HIGH package nodes: \`${result.rawHigh}\``,
    `- Raw CRITICAL package nodes: \`${result.rawCritical}\``,
    `- Temporarily excepted root advisories: \`${result.waivedRootAdvisories}\``,
    `- Affected package nodes attributable only to approved exceptions: \`${result.waivedAffectedNodes.length}\``,
    '- Residual unwaived HIGH/CRITICAL advisories: `0`',
  ];
  for (const exception of result.exceptions) {
    lines.push(
      `- Exception: \`${exception.id}\` on \`${exception.package}\`, expires \`${exception.expiresOn}\``
    );
  }
  lines.push(
    '- Exception validity is conditional on exact lock versions, installed upstream source markers, and absence of forbidden Faker execution-surface patterns.'
  );
  const summary = `${lines.join('\n')}\n`;
  const summaryPath = path.join(root, 'reports/security/npm-audit-summary.md');
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, summary, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  }
  process.stdout.write(summary);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exit(1);
  }
}

module.exports = { validateAuditPolicy };
