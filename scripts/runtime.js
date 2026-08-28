'use strict';

const path = require('node:path');

function positiveInteger(name, raw, fallback) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function projectFile(root, value, name) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, value);
  const relative = path.relative(resolvedRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${name} must resolve inside the repository root`);
  }
  return resolved;
}

function compactFailure(failure) {
  return {
    parent: failure.parent?.name || null,
    source: failure.source?.name || null,
    error: failure.error?.name || 'Error',
    message: String(failure.error?.message || failure.error || 'unknown failure').slice(0, 2_000),
    at: failure.at || null,
  };
}

module.exports = { compactFailure, positiveInteger, projectFile };
