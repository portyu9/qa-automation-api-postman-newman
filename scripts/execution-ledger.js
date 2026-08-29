'use strict';

class ExecutionLedger {
  constructor({ maxEntries = 5000 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError('maxEntries must be a positive integer');
    }
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  record(args, error) {
    if (this.entries.length >= this.maxEntries) return;

    const rawUrl = args?.request?.url?.toString?.() || '';
    let path = '<invalid-url>';
    try {
      path = new URL(rawUrl).pathname || '/';
    } catch (_) {
      // Retain a fixed sentinel rather than serializing an unsafe raw URL.
    }

    const responseTime = Number(args?.response?.responseTime);
    const statusCode = Number(args?.response?.code);
    this.entries.push({
      iteration: Number.isInteger(args?.cursor?.iteration) ? args.cursor.iteration : null,
      position: Number.isInteger(args?.cursor?.position) ? args.cursor.position : null,
      method: String(args?.request?.method || 'UNKNOWN').toUpperCase(),
      path,
      statusCode: Number.isInteger(statusCode) ? statusCode : null,
      responseTimeMs: Number.isFinite(responseTime) && responseTime >= 0 ? responseTime : null,
      transportError: error ? String(error.name || 'request_error') : null,
    });
  }

  snapshot() {
    return this.entries.map((entry) => ({ ...entry }));
  }
}

module.exports = { ExecutionLedger };
