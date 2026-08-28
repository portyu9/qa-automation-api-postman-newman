# Postman / Newman API Quality Engineering Framework

[![CI](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/ci.yml/badge.svg)](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/ci.yml)
[![Extended](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/extended.yml/badge.svg)](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/extended.yml)
[![Security](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/security.yml/badge.svg)](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/security.yml)

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Postman](https://img.shields.io/badge/Postman-collections-FF6C37)](https://www.postman.com/)
[![Newman](https://img.shields.io/badge/Newman-6.2.2-FF6C37)](https://github.com/postmanlabs/newman)
[![JSON Schema](https://img.shields.io/badge/JSON%20Schema-contracts-5A29E4)](https://json-schema.org/)
[![JUnit](https://img.shields.io/badge/JUnit-reporting-25A162)](https://junit.org/)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI-2088FF)](https://github.com/features/actions)
[![Trivy](https://img.shields.io/badge/Trivy-security%20scan-1904DA)](https://trivy.dev/)
[![License](https://img.shields.io/badge/License-MIT-2EA44F)](LICENSE)
[![Security Policy](https://img.shields.io/badge/Security-Policy-6E7781)](.github/SECURITY.md)

A version-controlled API quality-engineering framework built around Postman collections and the Newman execution engine. The collection owns request and assertion semantics; the Node runner owns validated input provenance, target policy, timeout policy, schema injection, correlation, reporting, and process-exit integrity. A deterministic loopback API provides a broader data-driven validation path without making extended CI dependent on a public service.

> [!IMPORTANT]
> Postman assets remain the source of API-test intent. The Node layer governs execution; it does not reimplement collection assertions. That boundary keeps the collection portable while making CI inputs, evidence, and safety policy explicit and reviewable.

## Capability map

| Plane | What it proves | Target model | Evidence |
| --- | --- | --- | --- |
| Primary CI | Collection semantics against configured API | Reviewed HTTP(S) target | JUnit + sanitized run manifest |
| Asset/runtime validation | Export integrity, path containment, URL/timeouts, reporter policy | No request required for self-tests | Node validation output |
| Extended data contract | Full collection + iteration data + request/write semantics | Deterministic `127.0.0.1` API | JUnit, manifest, local API log |
| Security | Dependency/configuration exposure | Repository filesystem | Trivy JSON + Markdown summary |
| Observability | Execution identity and gate state | Structured run envelope | `reports/ci-observability.json`, Actions summary |

```mermaid
flowchart LR
    CLI[npm / CI] --> RUN[run-newman.js]
    RUN --> POLICY[runtime.js]
    RUN --> COL[Collection]
    RUN --> ENV[Environment]
    RUN --> DATA[Iteration data]
    RUN --> SCHEMA[Versioned schema]
    POLICY --> TARGET[Validated base URL]
    COL --> TARGET
    EXT[Extended workflow] --> LOCAL[Loopback protocol-compatible API]
    COL --> LOCAL
    RUN --> JUNIT[JUnit]
    RUN --> MAN[Sanitized manifest]
```

## Engineering invariants

| Concern | Framework contract |
| --- | --- |
| Collection ownership | Shared protocol policy lives at collection scope; endpoint semantics stay with each request. |
| Runtime files | Collection/environment/data overrides must resolve inside the repository root. |
| Target policy | Resolved `base_url` must be absolute HTTP(S), with no URL credentials, query, or fragment. |
| Schemas | Reusable JSON Schemas are normal version-controlled files, injected at runtime. |
| Secrets | Committed environments contain non-secret defaults only; credentials are injected through controlled runtime channels. |
| Correlation | Run and request IDs identify execution without becoming payload/credential carriers. |
| Exit integrity | Newman assertion failures preserve a nonzero process result. |
| Evidence | JUnit plus a narrow allowlisted manifest; raw Newman JSON is not retained by default. |
| Reproducibility | Node 22+, Newman `6.2.2`, committed lockfile, `npm ci`. |

## Repository map

```text
.
├── collections/jsonplaceholder.postman_collection.json
├── schemas/post-schema.json
├── data/posts.json
├── scripts/
│   ├── run-newman.js
│   ├── runtime.js
│   ├── runtime.selftest.js
│   ├── validate-assets.js
│   └── local-api.js
├── docs/
│   ├── ARCHITECTURE.md
│   └── TEST_STRATEGY.md
├── .github/workflows/
│   ├── ci.yml
│   ├── extended.yml
│   └── security.yml
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

Read-only smoke folder:

```bash
npm run test:smoke
```

Data-driven execution:

```bash
NEWMAN_ITERATION_DATA=data/posts.json npm test
```

Reviewed target override:

```bash
NEWMAN_BASE_URL=https://staging.example.test npm test
```

> [!NOTE]
> `npm ci` is the execution path. Dependency changes should be made deliberately with `npm install`, reviewed through the manifest/lockfile diff, and then validated by CI.

<details>
<summary><strong>Runtime input reference</strong></summary>

| Variable | Purpose | Default |
| --- | --- | --- |
| `NEWMAN_COLLECTION` | Collection path inside repository | `collections/jsonplaceholder.postman_collection.json` |
| `NEWMAN_ENVIRONMENT` | Environment path inside repository | `postman_environment.json` |
| `NEWMAN_ITERATION_DATA` | Optional iteration-data path | unset |
| `NEWMAN_FOLDER` | Optional Postman folder selector | unset |
| `NEWMAN_BASE_URL` | Validated target override | environment `base_url` |
| `REQUEST_TIMEOUT_MS` | Per-request timeout | `10000` |
| `TEST_RUN_ID` | Run correlation | generated ID |

Paths are execution inputs, not arbitrary filesystem escape hatches. `runtime.js` resolves them relative to the repository root and rejects traversal outside it.

</details>

## Collection architecture

Collection-level scripts own cross-request policy only:

- run/request correlation;
- response-time budget;
- common JSON content-type expectations.

Endpoint scripts own endpoint semantics:

- status;
- schema;
- requested identifier equality;
- write representation/echo behavior;
- endpoint-specific negative conditions.

This avoids two common extremes: duplicated protocol boilerplate in every request, and a giant global script that hides which endpoint contract actually failed.

## Variable scope model

| Variable | Scope | Purpose |
| --- | --- | --- |
| `base_url` | environment | Validated service target |
| `post_id` | environment / iteration | Read identifier |
| `user_id` | environment / iteration | Write input |
| `max_response_time_ms` | environment | Shared response-time budget |
| `run_id` | injected environment | Run correlation |
| `request_id` | local | Individual request correlation |
| `generated_title` | local | Unique write-case value |
| `post_schema` | injected global | Version-controlled schema text |

Use the narrowest scope that expresses data lifetime. Generated request-local values should not become mutable environment state unless a later request intentionally consumes them.

## Schema strategy

`schemas/post-schema.json` is stored once and injected into Newman at runtime.

Benefits:

- schema changes receive normal code review;
- collection JSON does not carry duplicate schema copies;
- schema diffs stay focused;
- another test/tool can reuse the same artifact.

Schema correctness is necessary but not sufficient. A structurally valid response can still return the wrong record or wrong semantic values, so request tests assert both shape and key semantics.

## Execution governance

`scripts/runtime.selftest.js` validates Node-side policy without contacting a target:

- default/explicit timeout parsing;
- invalid/non-positive timeout rejection;
- repository-contained file resolution;
- path traversal rejection;
- HTTP(S) target validation;
- rejection of URL credentials/query/fragment;
- diagnostic URL sanitization;
- bounded compact failure mapping.

`scripts/validate-assets.js` checks committed collection/environment assets before Newman starts. `scripts/local-api.js` is syntax-checked as part of the same validation command.

## Deterministic extended data contract

`extended.yml` executes the full data-driven collection against `scripts/local-api.js`, a small protocol-compatible loopback service implemented with Node's built-in HTTP module.

The service supports the exact contract exercised by the collection:

- `GET /health` for bounded readiness;
- `GET /posts`;
- `GET /posts/:id`;
- `POST /posts` with deterministic creation representation;
- JSON content type and request-ID echo.

Execution flow:

```text
start local-api.js on 127.0.0.1:4010
        ↓
bounded readiness polling
        ↓
NEWMAN_BASE_URL=http://127.0.0.1:4010
NEWMAN_ITERATION_DATA=data/posts.json
        ↓
full Newman collection
        ↓
JUnit + sanitized manifest + local API log
```

This scenario validates the collection, iteration data, schema injection, Node runner, reporting, read/write semantics, and local HTTP path while eliminating public-service drift from the extended gate.

## Run manifest

After execution, `scripts/run-newman.js` writes:

```text
reports/
├── newman-junit.xml
└── run-manifest.json
```

The manifest records:

- schema version and run ID;
- relative collection/environment/data provenance;
- selected folder;
- sanitized validated base URL;
- request timeout;
- Newman stats/timings;
- compact bounded/redacted failure identity.

It is written to a temporary file and atomically renamed so interruption cannot leave a partial final JSON file.

### Why raw Newman JSON is not a default artifact

Raw third-party execution objects can contain far more runtime context than a stable operational contract requires. Instead of attempting to sanitize an arbitrarily deep object after the fact, the framework constructs a narrow allowlisted manifest. If deeper raw evidence is ever retained, that should be a deliberate policy change with explicit data review.

## Security engineering

`.github/workflows/security.yml` runs the open-source Trivy filesystem scanner. The action is pinned to immutable commit `ed142fd0673e97e23eac54620cfb913e5ce36c25` (`v0.36.0`) and installs Trivy `v0.74.0`.

The gate focuses on configured fixed HIGH/CRITICAL dependency vulnerabilities and HIGH/CRITICAL supported repository/configuration misconfigurations. Evidence is retained as JSON plus a Markdown count summary.

Collection/export validation remains complementary: Trivy does not replace the framework's own target/path/runtime validation.

## Observability model

Primary CI produces:

```text
reports/
├── newman-junit.xml
├── run-manifest.json
├── ci-observability.json
└── ci-summary.md
```

`ci-observability.json` supplies a small stable run-level index: framework, run ID, runtime dimension, final job state, SHA, and ref. The Newman manifest supplies API-execution provenance and statistics. JUnit supplies assertion integration.

```text
GitHub Actions run
└── TEST_RUN_ID
    ├── collection/environment/data provenance
    ├── per-request request_id values
    ├── Newman stats/failures
    └── CI observability envelope
```

No proprietary analytics backend is required; the JSON artifacts can be ingested later by open-source log/telemetry tooling.

## CI topology

```mermaid
flowchart TD
    PR[Push / PR] --> INSTALL[npm ci]
    INSTALL --> VALIDATE[Asset + runtime validation]
    VALIDATE --> NEWMAN[Primary collection]
    NEWMAN --> REPORT[JUnit + manifest + observability]
    PR --> SEC[Trivy security]
    APICHANGE[Collection/schema/runner change] --> EXT[Extended local data contract]
    EXT --> LOCAL[Loopback API]
    LOCAL --> FULL[Full data-driven collection]
    FULL --> REPORT2[Independent evidence]
```

## Failure triage

| Signal | First boundary | First evidence |
| --- | --- | --- |
| Invalid export/JSON | Asset integrity | `npm run validate` |
| Path escape | Runtime governance | `runtime.js` validation |
| Invalid target URL | Target policy | pre-Newman validation error |
| Invalid timeout | Runtime policy | pre-Newman validation error |
| Request/connectivity | HTTP dependency | Newman CLI + JUnit |
| Schema/assertion | API contract | JUnit + compact manifest failure |
| Data iteration mismatch | Input provenance | manifest + dataset + request assertion |
| Local extended failure | Collection/runner/local protocol path | local API log + manifest |
| Unexpected zero tests | Selection/provenance | Newman stats + folder/path inputs |
| Trivy failure | Dependency/configuration risk | `trivy.json` |

> [!WARNING]
> Never use `|| true`, report-generation wrappers, or shell cleanup constructs that convert a failed Newman execution into a successful job. Evidence is meaningful only when process status still represents the test result.

## Extension rules

1. keep shared collection scripts small and policy-focused;
2. keep endpoint semantics adjacent to each request;
3. store reusable schemas under `schemas/`;
4. keep data files reviewed and repository-contained;
5. validate every new Node-side execution input;
6. preserve target and input provenance in evidence;
7. inject credentials through controlled runtime mechanisms rather than URLs;
8. preserve Newman as the request/assertion engine;
9. prefer deterministic local protocol fixtures for broader CI scenarios;
10. keep raw retained evidence intentionally narrow.

## Explicit anti-patterns

- collection/environment/data paths outside the repository;
- URL credentials/query secrets/fragments;
- committed environment credentials;
- raw Newman summaries retained without a data contract;
- duplicated schema blobs inside scripts;
- assertion failures converted to zero exit status;
- endpoint-specific logic hidden in one giant collection hook;
- status-only assertions;
- reports without input provenance;
- `npm install` in CI.

## Design references

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — collection, runner, schema, target, and evidence boundaries.
- [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) — assertion depth, data-driven execution, environment promotion, and gates.

> [!TIP]
> The goal is portable Postman intent with governed Newman execution. The runner should make a collection easier to operate safely and diagnose precisely—not become a second API testing language beside it.