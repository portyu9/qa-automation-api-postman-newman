'use strict';

const path = require('node:path');

const MAX_FAILURE_MESSAGE = 2_000;
const MAX_LABEL = 500;
const SAFE_CORRELATION_TOKEN = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const URI_PATTERN = /\b(?:https?|wss?|data|file|javascript|blob|about|filesystem|chrome-extension|moz-extension|devtools|view-source):\S+/gi;
const AUTH_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT = /\b(access[_-]?token|token|password|passwd|secret|api[_-]?key|authorization)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi;

function positiveInteger(name, raw, fallback) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function explicitBoolean(name, raw, fallback = false) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be the exact literal true or false`);
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
  const raw = String(value ?? '').trim();
  if (!raw || CONTROL_CHARACTER.test(raw)) {
    throw new Error(`${name} must be a non-empty URL without control characters`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${name} must use http or https with a hostname`);
  }
  if (parsed.port === '0') {
    throw new Error(`${name} port must be between 1 and 65535`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain URL credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain a query string or fragment`);
  }

  const canonical = parsed.toString();
  return canonical.endsWith('/') ? canonical.slice(0, -1) : canonical;
}

function sanitizeUrl(value) {
  const raw = String(value ?? '');
  if (raw.toLowerCase() === 'about:blank') return 'about:blank';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return /^(?:https?|wss?):/i.test(raw) ? '<invalid-url>' : raw;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `${parsed.protocol}<redacted>`;
  }
  const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.origin}${pathname}`;
}

function redactText(value) {
  return String(value ?? '')
    .replace(URI_PATTERN, (url) => sanitizeUrl(url))
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
  explicitBoolean,
  optionalLabel,
  positiveInteger,
  projectFile,
  redactText,
  sanitizeUrl,
};
