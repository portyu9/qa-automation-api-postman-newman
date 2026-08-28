'use strict';

const path = require('node:path');

const MAX_FAILURE_MESSAGE = 2_000;
const MAX_LABEL = 500;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const AUTH_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT = /\b(access[_-]?token|token|password|passwd|secret|api[_-]?key|authorization)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi;

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

function sanitizeUrl(value) {
  const raw = String(value ?? '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return raw;
  const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.origin}${pathname}`;
}

function redactText(value) {
  return String(value ?? '')
    .replace(URL_PATTERN, (url) => sanitizeUrl(url))
    .replace(AUTH_PATTERN, '$1 <redacted>')
    .replace(SECRET_ASSIGNMENT, '$1$2<redacted>');
}

function bounded(value, maxLength) {
  const text = redactText(value);
  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}…<truncated>`;
}

function compactFailure(failure) {
  return {
    parent: failure.parent?.name ? bounded(failure.parent.name, MAX_LABEL) : null,
    source: failure.source?.name ? bounded(failure.source.name, MAX_LABEL) : null,
    error: failure.error?.name || 'Error',
    message: bounded(
      failure.error?.message || failure.error || 'unknown failure',
      MAX_FAILURE_MESSAGE
    ),
    at: failure.at ? bounded(failure.at, MAX_LABEL) : null,
  };
}

module.exports = {
  compactFailure,
  positiveInteger,
  projectFile,
  redactText,
  sanitizeUrl,
};
