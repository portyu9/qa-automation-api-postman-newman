# Postman / Newman API Automation Framework

A version-controlled Postman/Newman framework for API behavior, JSON Schema validation, data-driven execution, environment promotion, request correlation, and machine-readable CI evidence. The Postman collection owns request/assertion semantics; the Node runner owns validated input provenance, target policy, reporting, and process exit behavior.

## Engineering contract

| Concern | Framework policy |
| --- | --- |
| Collection design | Shared protocol policies live at collection scope; endpoint-specific assertions stay with the endpoint. |
| Schemas | JSON Schemas are normal version-controlled files and are injected into Newman at runtime. |
| Environments | Committed environments contain non-secret defaults only; credentials are injected externally. |
| Runtime files | Collection, environment, and iteration-data overrides must resolve inside the repository root. |
| Target URL | The resolved `base_url` must be absolute HTTP(S) and cannot contain URL credentials, a query string, or a fragment. |
| Timeouts | Request timeout is validated as a positive integer before Newman starts. |
| Correlation | One run ID and one request ID make failures traceable without embedding credentials. |
| Failure behavior | Newman assertion failures preserve a nonzero process exit code. |
| Evidence | JUnit plus a bounded, redacted, atomic run manifest are written under `reports/`. |
| Reproducibility | Node 22+, pinned Newman 6.2.2, committed lockfile, and `npm ci` define the execution graph. |

## Architecture

```mermaid
flowchart LR
    CLI[npm scripts / CI] --> RUN[run-newman.js]
    RUN --> GUARD[runtime.js validation]
    RUN --> COL[Postman collection]
    RUN --> ENV[Selected environment]
    RUN --> DATA[Optional iteration data]
    RUN --> SCHEMA[Versioned JSON Schema]
    GUARD --> TARGET[Validated base URL]
    COL --> TARGET
    RUN --> JUNIT[JUnit XML]
    RUN --> MAN[Sanitized run manifest]
```

The runner is intentionally thin around Newman. It adds execution governance without reimplementing Postman's request/assertion engine. Raw Newman JSON is deliberately not a default CI artifact because it can serialize substantially more execution context than the bounded operational manifest.

## Repository layout

```text
.
├── collections/
│   └── jsonplaceholder.postman_collection.json
├── schemas/
│   └── post-schema.json
├── data/
│   └── posts.json
├── scripts/
│   ├── run-newman.js
│   ├── runtime.js
│   ├── runtime.selftest.js
│   └── validate-assets.js
├── docs/
│   ├── ARCHITECTURE.md
│   └── TEST_STRATEGY.md
├── postman_environment.json
├── package.json
└── package-lock.json
```

## Quick start

Node.js 22+ is required.

```bash
npm ci
npm run validate
npm test
```

Run only the read-oriented folder:

```bash
npm run test:smoke
```

Run with iteration data:

```bash
NEWMAN_ITERATION_DATA=data/posts.json npm test
```

Select another reviewed environment:

```bash
NEWMAN_ENVIRONMENT=environments/staging.postman_environment.json npm test
```

Override only the resolved target without rewriting the selected environment file:

```bash
NEWMAN_BASE_URL=https://staging.example.test npm test
```

`npm ci` is the normal install path. Use `npm install` only for deliberate dependency changes and review the lockfile diff before committing it.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run validate` | Parse committed assets, check environment guardrails, and run deterministic runtime self-tests. |
| `npm test` | Execute the selected collection with CLI and JUnit reporters plus the sanitized run manifest. |
| `npm run test:smoke` | Execute the `Read` folder only. |

## Runtime inputs

| Variable | Purpose | Default |
| --- | --- | --- |
| `NEWMAN_COLLECTION` | Collection path relative to repository root | `collections/jsonplaceholder.postman_collection.json` |
| `NEWMAN_ENVIRONMENT` | Environment path relative to repository root | `postman_environment.json` |
| `NEWMAN_ITERATION_DATA` | Optional iteration-data path | unset |
| `NEWMAN_FOLDER` | Optional Postman folder selection | unset |
| `NEWMAN_BASE_URL` | Optional validated override for environment `base_url` | environment value |
| `REQUEST_TIMEOUT_MS` | Per-request Newman timeout | `10000` |
| `TEST_RUN_ID` | Run correlation identifier | generated timestamp-based ID |

File variables are not arbitrary filesystem escape hatches. `scripts/runtime.js` resolves them against the repository root and rejects paths that traverse outside it. The resolved target is independently validated before Newman starts. URL user-info belongs in neither configuration nor evidence; authentication belongs in headers/cookies injected through controlled runtime mechanisms.

## Collection variable model

| Variable | Scope | Purpose |
| --- | --- | --- |
| `base_url` | environment | Validated target service endpoint |
| `post_id` | environment / iteration | Read-case identifier |
| `user_id` | environment / iteration | Write-case input |
| `max_response_time_ms` | environment | Collection response-time budget |
| `run_id` | injected environment | Test-run correlation |
| `request_id` | local | Individual request correlation |
| `generated_title` | local | Unique write-case data |
| `post_schema` | injected global | Version-controlled schema text |

Prefer the narrowest variable scope. Request-local generated values should not become mutable environment state unless later requests intentionally consume them.

## Collection design

Collection-level scripts own only policies that genuinely apply to every request, such as:

- run/request correlation setup;
- maximum response-time policy;
- JSON content-type expectations where applicable.

Endpoint-level scripts own endpoint semantics:

- expected status;
- JSON shape/schema;
- requested identifier equality;
- generated payload echo/creation behavior;
- endpoint-specific negative conditions.

This prevents both duplicated boilerplate across every request and oversized global scripts that make endpoint failures opaque.

## Schema strategy

`schemas/post-schema.json` is stored once in source control. The Node runner loads it and injects it as a Postman global for assertions.

Benefits:

- schema changes receive normal code review;
- collection JSON does not contain a second embedded copy;
- schema changes have an isolated diff;
- the artifact remains reusable by additional tooling.

Schema validation is additive. A response can match a schema and still be semantically wrong, so tests also assert critical identifiers/values and protocol behavior.

## Runtime guardrails

`scripts/runtime.selftest.js` executes without network access and verifies:

- default and explicit timeout parsing;
- rejection of zero/invalid timeout budgets;
- correct resolution of repository-contained files;
- rejection of `../` path escape;
- HTTP(S) base-URL validation;
- rejection of URL credentials/query/fragment;
- removal of user-info/query data from diagnostic URLs;
- redaction and bounding of failure messages.

This is part of `npm run validate`, so Node-side execution policy is checked before the collection is sent to a remote API.

## Run manifest

After Newman completes, `scripts/run-newman.js` writes:

```text
reports/run-manifest.json
```

The manifest contains:

- schema version and run ID;
- exact collection/environment/iteration-data paths relative to the repository;
- selected folder;
- validated resolved base URL;
- request timeout;
- Newman execution statistics and timings;
- compact failure identities including parent, source, error type, bounded/redacted message, and location metadata.

The file is written to a temporary path first and atomically renamed. This prevents an interrupted process from leaving a partially written JSON artifact that appears valid by filename alone.

Generated machine-readable evidence is intentionally small:

```text
reports/
├── newman-junit.xml
└── run-manifest.json
```

JUnit integrates with CI test UIs. The run manifest provides a stable operational summary without making the raw Newman summary—which may include broader runtime context—a default retained artifact.

## Secret and diagnostic policy

Do not commit or deliberately emit:

- bearer/API tokens;
- passwords;
- session cookies;
- private keys;
- authorization header values;
- production credentials in exported Postman environments.

`validate-assets.js` checks committed environment content for obvious secret-like values, but that is a guardrail rather than a complete secret scanner. `runtime.js` additionally redacts common credential assignments, bearer/basic values, and URL query/user-info from compact failure diagnostics. Neither mechanism replaces disciplined test-data design or CI secret handling.

Raw Newman JSON is not retained by default because sanitizing an arbitrarily deep third-party execution object safely is materially harder than constructing a narrow allowlisted manifest. If a team later elects to retain deeper raw output, that should be a deliberate policy change with explicit secret review and restricted artifact access.

## CI topology

```mermaid
flowchart TD
    PR[Push / pull request] --> INSTALL[npm ci]
    INSTALL --> VALIDATE[Asset + runtime validation]
    VALIDATE --> NEWMAN[Newman execution]
    NEWMAN --> EXIT[Preserve failure exit code]
    NEWMAN --> REPORTS[JUnit + sanitized run manifest]
```

CI uses the committed lockfile, lockfile-backed npm caching, read-only repository permissions, a bounded job timeout, and unconditional report upload when files exist.

## Failure triage

Use the narrowest evidence that can explain the failure:

| Failure class | First evidence |
| --- | --- |
| Invalid JSON/export | `npm run validate` parser output |
| Suspicious committed environment value | asset-validation output |
| Runtime path escape | `runtime.js` validation error |
| Invalid target URL | base-URL validation error |
| Invalid timeout | runtime validation error |
| Request/connectivity failure | Newman CLI output + JUnit |
| Assertion/schema failure | JUnit + compact run-manifest failure identity |
| Data iteration mismatch | run-manifest input provenance + collection assertion output |
| Unexpected zero tests | Newman stats + selected folder/path inputs |

Do not suppress Newman failures with shell constructs such as `|| true`. A report artifact is useful only if the job outcome still represents the test result.

## Extension rules

When adding requests or environments:

- keep shared collection scripts small and policy-focused;
- keep endpoint assertions close to the request;
- store reusable schemas in `schemas/` rather than embedding duplicates;
- add iteration files under a reviewed repository directory;
- add runtime validation for every new Node-side input;
- preserve relative input provenance and validated target identity in the run manifest;
- inject secrets at execution time through controlled channels rather than URL user-info;
- keep Newman as the source of request/assertion semantics rather than reproducing collection logic in Node.

## Anti-patterns

The framework intentionally avoids:

- collection/environment paths outside the repository;
- credentials, query secrets, or fragments embedded in the base URL;
- secrets committed in Postman exports;
- raw execution summaries retained by default without a redaction contract;
- duplicated schema text inside collection scripts;
- assertion failures converted to zero exit status;
- one giant collection-level script containing endpoint-specific business rules;
- status-code-only tests with no semantic assertions;
- machine-readable reports without input provenance;
- `npm install` in CI with a mutable dependency graph.

## Further design documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — collection, runner, schema, environment, target-validation, and reporting boundaries.
- [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) — API assertion depth, data-driven execution, environment promotion, evidence policy, and gate behavior.

The framework should keep Postman assets **portable**, execution inputs **reviewable**, diagnostic output **bounded and privacy-aware**, and a failed Newman run **attributable** without turning the Node runner into a second API test framework.
