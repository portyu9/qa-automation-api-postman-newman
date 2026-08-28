# Architecture

## Source-of-truth boundaries

- **Collection** owns request definitions and API behavior assertions.
- **Environment** owns non-secret endpoint/runtime defaults.
- **Schemas** are version-controlled interface contracts.
- **Iteration data** supplies data-driven inputs without editing requests.
- **Newman runner** owns CI execution, injected globals, request timeout, reporters, and exit status.

This separation keeps Postman assets useful interactively while making CI behavior deterministic and reviewable.

## Variables

Use the narrowest appropriate scope. Environment variables hold target-specific values such as `base_url`. Request/generated values use local variables. `run_id` is injected at execution time. Live credentials must not be committed in environment exports.

Variable names are part of the framework contract; avoid creating several aliases for the same endpoint or credential.

## Reusable scripts

Collection-level pre-request logic generates correlation and request identifiers. Collection-level tests enforce response-time and content-type policy. Item scripts assert behavior specific to an endpoint. This avoids copy/paste without hiding endpoint intent.

## Schema injection

Newman reads `schemas/post-schema.json` and injects it as a global value at runtime. The collection can therefore use Postman's JSON Schema assertion API without embedding a second copy of the schema. Schema changes remain ordinary source diffs.

## Reporting

The programmatic runner emits CLI output for humans plus JUnit and JSON for automation. It also writes a compact summary file and exits non-zero when collection failures exist. CI does not use `--suppress-exit-code` because failed assertions must fail the gate.

## Secrets

`validate-assets.js` rejects committed values with common secret-like keys. This is a guardrail, not a secret scanner. Repository and CI secret scanning should remain enabled, and secrets should be injected at runtime.
