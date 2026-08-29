'use strict';

const path = require('node:path');

const MAX_FAILURE_MESSAGE = 2_000;
const MAX_LABEL = 500;
const SAFE_CORRELATION_TOKEN = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
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

function correlationToken(name, raw, fallback) {
  const value = String(raw ?? '').trim() || fallback;
  if (!SAFE_CORRELATION_TOKEN.test(value)) {
    throw new Error(
      `${name} must be 1-128 ASCII letters, digits, dots, underscores, colons, or hyphens`
    );
  }
  return value;
}

function optionalLabel(name, raw, maxLength = 200) {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new TypeError('maxLength must be a positive integer');
  }
  if (raw === undefined || raw === null) return null;

  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > maxLength || CONTROL_CHARACTER.test(value)) {
    throw new Error(`${name} must be at most ${maxLength} characters and contain no control characters`);
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

function absoluteHttpBaseUrl(name, value) {
  const raw = String(value ?? '').trim().replace(/\/$/, '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${name} must use http or https with a hostname`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain URL credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain a query string or fragment`);
  }
  return raw;
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
  absoluteHttpBaseUrl,
  compactFailure,
  correlationToken,
  optionalLabel,
  positiveInteger,
  projectFile,
  redactText,
  sanitizeUrl,
};
