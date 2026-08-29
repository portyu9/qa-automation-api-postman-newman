# Postman / Newman API Quality Engineering Framework

[![CI](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/ci.yml/badge.svg)](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/ci.yml)
[![Extended](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/extended.yml/badge.svg)](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/extended.yml)
[![Security](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/security.yml/badge.svg)](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/security.yml)
[![Docs](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/docs.yml/badge.svg)](https://github.com/portyu9/qa-automation-api-postman-newman/actions/workflows/docs.yml)

[![Node.js](https://img.shields.io/badge/Node.js-runtime-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-language-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Postman](https://img.shields.io/badge/Postman-collections-FF6C37?logo=postman&logoColor=white)](https://www.postman.com/)
[![Newman](https://img.shields.io/badge/Newman-CLI-C84A22?logo=postman&logoColor=white)](https://github.com/postmanlabs/newman)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![Trivy](https://img.shields.io/badge/Trivy-security-1904DA?logo=trivy&logoColor=white)](https://trivy.dev/)
[![License](https://img.shields.io/badge/License-MIT-2EA44F?logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Security Policy](https://img.shields.io/badge/Security-Policy-24292F?logo=github&logoColor=white)](.github/SECURITY.md)

A version-controlled API quality-engineering framework built around **Postman Collection v2.1** and the **Newman** execution engine. Postman assets own request/assertion semantics; the Node runner owns input provenance, deterministic target lifecycle, schema injection, timeout policy, correlation, evidence construction, and process-exit integrity.

> [!IMPORTANT]
> Required execution is repository-owned. The committed environment points to `http://127.0.0.1:4010`, and the runner starts/stops that protocol fixture itself. A deployed API is an explicit `NEWMAN_BASE_URL` integration choice—not a dependency of the framework's health.

**Read by intent:** [capabilities](#capability-map) · [architecture](#architecture) · [quick start](#quick-start) · [collection design](#collection-architecture) · [variable precedence](#variable-scope-and-precedence) · [evidence](#run-manifest-and-exit-integrity) · [dependencies](#dependency-maintenance) · [triage](#failure-triage)

## Capability map

| Plane | What it proves | Target model | Evidence |
| --- | --- | --- | --- |
| Runtime validation | Export integrity, path containment, target/timeouts, fixture/report policy | No external dependency | Node assertions + exit status |
| Primary collection | Request/assertion/schema/write semantics | Runner-owned loopback API | JUnit + sanitized manifest |
| Data-driven contract | Iteration precedence across read/write cases | Same local API | JUnit + manifest |
| Explicit integration | Same collection against a reviewed deployment | Explicit HTTP(S) override | External target classification |
| Security | Dependency/configuration exposure | Trivy filesystem scan | JSON + Markdown findings |
| Documentation | README/workflow/governance consistency | Repository-local validator | Actions status |

## Architecture

```mermaid
flowchart LR
    CLI[npm / CI] --> VALIDATE[Asset + runtime + fixture self-tests]
    CLI --> RUN[run-newman.js]
    RUN --> POLICY[runtime.js]
    RUN --> ENV[Postman environment]
    RUN --> COL[Posts API collection]
    RUN --> SCHEMA[Versioned JSON Schema]
    RUN --> DATA[Optional iteration data]
    ENV --> TARGET{Resolved base_url}
    TARGET -->|default| LOCAL[Runner-owned loopback API]
    TARGET -->|override| EXT[Reviewed deployed API]
    RUN --> JUNIT[JUnit]
    RUN --> MAN[Allowlisted manifest]

    classDef entry fill:#ddf4ff,stroke:#0969da,color:#24292f,stroke-width:1.5px;
    classDef core fill:#f6f8fa,stroke:#57606a,color:#24292f,stroke-width:1.5px;
    classDef gate fill:#fbefff,stroke:#8250df,color:#24292f,stroke-width:1.5px;
    classDef evidence fill:#dafbe1,stroke:#1a7f37,color:#24292f,stroke-width:1.5px;
    class CLI entry;
    class POLICY,ENV,COL,SCHEMA,DATA,TARGET,LOCAL,EXT core;
    class VALIDATE,RUN gate;
    class JUNIT,MAN evidence;
    linkStyle default stroke:#57606a,stroke-width:1.4px;
```

## Engineering invariants

| Concern | Framework contract |
| --- | --- |
| Collection ownership | Request definitions/assertions stay in Postman assets, not duplicated in Node. |
| Collection identity | `collections/posts-api.postman_collection.json` is provider-neutral and describes the behavior under test. |
| Default target | Committed `base_url` is `http://127.0.0.1:4010`. |
| Target lifecycle | Runner starts/stops the local API only for the deterministic default. |
| External integration | Non-default `NEWMAN_BASE_URL` is explicit and classified separately. |
| Runtime files | Collection/environment/data overrides must resolve inside repository root. |
| Target policy | Absolute HTTP(S); no URL credentials, query, or fragment. |
| Schemas | Reusable JSON Schemas are version-controlled and injected once. |
| Variable precedence | Iteration data deliberately overrides environment values where supplied. |
| Correlation | Run/request IDs identify execution without becoming payload/credential carriers. |
| Exit integrity | Validation, Newman, assertion, fixture, manifest, and cleanup failures remain nonzero. |
| Evidence | Retain focused JUnit + allowlisted manifest, not raw runtime state by default. |

## Boundary decision guide

| Requirement | Owner |
| --- | --- |
| Request and endpoint assertion semantics | Postman collection |
| Reusable structural schema | `schemas/` |
| Environment/iteration data | Postman/Newman variable scopes |
| File path/URL/timeout policy | Node runner/runtime |
| Deterministic HTTP protocol behavior | Local Node fixture |
| CI-compatible test evidence | Newman JUnit reporter |
| Bounded execution metadata | Run manifest |

> [!TIP]
> Keep policy in the narrowest place that owns it. If an assertion is meaningful inside Postman, duplicating it in the Node launcher creates two sources of truth rather than more confidence.

## Repository map

```text
.
├── collections/posts-api.postman_collection.json
├── schemas/post-schema.json
├── data/posts.json
├── scripts/
│   ├── run-newman.js
│   ├── runtime.js
│   ├── runtime.selftest.js
│   ├── validate-assets.js
│   ├── local-api.js
│   └── local-api.selftest.js
├── docs/{ARCHITECTURE.md,TEST_STRATEGY.md}
├── .github/workflows/{ci,docs,extended,security}.yml
├── CONTRIBUTING.md
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

No API process needs to be started manually for the default configuration.

```bash
# read-only smoke folder
npm run test:smoke

# data-driven full collection
NEWMAN_ITERATION_DATA=data/posts.json npm test

# explicit deployed API
NEWMAN_BASE_URL=https://staging.example.test npm test
```

<details>
<summary><strong>Runtime input reference</strong></summary>

| Variable | Purpose | Default |
| --- | --- | --- |
| `NEWMAN_COLLECTION` | Collection path inside repository | `collections/posts-api.postman_collection.json` |
| `NEWMAN_ENVIRONMENT` | Environment path | `postman_environment.json` |
| `NEWMAN_ITERATION_DATA` | Optional iteration data | unset |
| `NEWMAN_FOLDER` | Optional folder selector | unset |
| `NEWMAN_BASE_URL` | Explicit target override | environment `base_url` |
| `REQUEST_TIMEOUT_MS` | Per-request timeout | `10000` |
| `TEST_RUN_ID` | Run correlation | generated ID |

</details>

## Deterministic target lifecycle

`scripts/local-api.js` implements exactly the protocol surface the collection requires: `GET /health`, `GET /posts`, `GET /posts/:id`, `POST /posts`, JSON content type, request-ID echo, deterministic create representation, and explicit error responses.

When the resolved target equals the local default, `scripts/run-newman.js` starts the fixture, executes Newman, writes the sanitized manifest, and closes the fixture in `finally`. Startup/cleanup failures remain nonzero.

A non-default safe HTTP(S) target disables the local fixture and becomes an explicit integration run.

## Collection architecture

Collection-level scripts own cross-request policy: run/request correlation, response-time budget, and JSON content-type expectation. Endpoint scripts own endpoint semantics: status, schema, identifier equality, and write representation.

The runner does **not** reimplement those assertions. That keeps the collection portable across Postman/Newman while CI/runtime policy remains explicit in code.

## Variable scope and precedence

| Variable | Scope | Purpose |
| --- | --- | --- |
| `base_url` | environment | Validated service target |
| `post_id` | environment / iteration | Read identifier; iteration wins |
| `user_id` | environment / iteration | Write input; iteration wins |
| `max_response_time_ms` | environment | Shared response-time budget |
| `run_id` | injected environment | Run correlation |
| `request_id` | local | Per-request correlation |
| `generated_title` | local | Unique write value |
| `post_schema` | injected global | Version-controlled schema text |

Use the narrowest variable scope that matches lifetime. Request-local generated values should not silently become mutable shared environment state.

## Execution governance

`npm run validate` proves policy before collection execution: committed JSON integrity, secret-like environment guards, path containment, timeout parsing, target validation, URL sanitization, bounded failure compaction, and executable local-fixture behavior.

A launcher or fixture defect should therefore be reproducible without a public service.

## Run manifest and exit integrity

The runner writes `reports/newman-junit.xml` and `reports/run-manifest.json`. The manifest contains allowlisted inputs, target class, timeout, stats/timings, and bounded/redacted failures. It is written atomically.

Raw Newman JSON is intentionally not retained by default because broad runtime serialization can expose substantially more context than CI needs.

Evidence generation never converts a failing execution to success. Validation, fixture startup, Newman runtime, assertions, manifest creation, and cleanup preserve nonzero status.

## CI and security

Primary CI runs the default collection against the runner-owned fixture. Extended CI adds iteration-data breadth against the **same** deterministic fixture. The difference is coverage breadth, not target reliability.

Security and docs workflows remain independent failure domains. Trivy findings are not collection flakiness.

## Dependency maintenance

Dependabot maintains **npm** and **GitHub Actions**.

- weekly Monday 09:00 America/New_York;
- grouped minor/patch updates reduce routine PR noise;
- major Newman/Node ecosystem upgrades remain standalone;
- GitHub Actions are treated as executable dependencies;
- dependency PRs must clear asset validation, runtime/fixture self-tests, Newman execution, security, and docs gates.

Dependabot, the committed lockfile, deterministic fixture tests, and Trivy address different supply-chain risks and should remain separate controls.

## Failure triage

| Signal | First interpretation |
| --- | --- |
| Asset validation | Export/configuration policy |
| Runtime self-test | Path/URL/timeout/evidence policy |
| Fixture self-test | Local protocol fixture defect |
| Local fixture startup | Listener/port lifecycle |
| Newman runtime | Postman runtime/transport |
| Endpoint assertion/schema | API behavior contract |
| Iteration mismatch | Variable/data precedence |
| External-target-only failure | Deployment/environment integration |
| Security/docs | Independent repository governance |

## Explicit anti-patterns

- required CI against a public API;
- provider-specific names for provider-neutral local contracts;
- duplicated assertions in Node and Postman;
- repository path overrides that escape the project root;
- raw runtime evidence retained without a data-minimization reason;
- mutable environment state used for request-local values;
- reports that swallow Newman/fixture failures;
- external target availability used to define framework health.

## Design references

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — runner, fixture, assets, target policy, and evidence boundaries.
- [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) — request/assertion ownership, data-driven execution, and exit criteria.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — change-quality expectations.

A strong Newman framework makes the failing boundary obvious: **asset policy, variable scope, runtime validation, local protocol fixture, collection assertion, evidence lifecycle, or explicit deployed environment**.
