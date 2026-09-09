# Operations Guide

## Purpose

This guide owns the detailed operating contract for the Postman / Newman API Quality Engineering Framework: runtime inputs, deterministic target lifecycle, collection execution, evidence, compatibility, dependency maintenance, and failure triage.

The main [`README.md`](../README.md) is intentionally a concise repository landing page. Deep component ownership and lifecycle rationale live in [`ARCHITECTURE.md`](ARCHITECTURE.md); test-layer and assertion strategy live in [`TEST_STRATEGY.md`](TEST_STRATEGY.md).

## Local execution

Install the locked npm graph without lifecycle scripts, validate repository/runtime contracts, then execute the default collection against the runner-owned loopback API:

```bash
npm ci --ignore-scripts
npm run validate
npm test
```

Useful focused executions:

```bash
# read-only smoke folder
npm run test:smoke

# data-driven full collection
NEWMAN_ITERATION_DATA=data/posts.json npm test

# explicit deployed API: review the target, then authorize this invocation exactly
NEWMAN_BASE_URL=https://staging.example.test NEWMAN_ALLOW_EXTERNAL_TARGET=true npm test
```

The default run needs no separately started API process.

## Runtime input reference

| Variable | Purpose | Default |
| --- | --- | --- |
| `NEWMAN_COLLECTION` | Collection path inside repository | `collections/posts-api.postman_collection.json` |
| `NEWMAN_ENVIRONMENT` | Environment path | `postman_environment.json` |
| `NEWMAN_ITERATION_DATA` | Optional iteration data | unset |
| `NEWMAN_FOLDER` | Optional exact folder selector | unset |
| `NEWMAN_BASE_URL` | Explicit target override; non-local values require separate authorization | environment `base_url` |
| `NEWMAN_ALLOW_EXTERNAL_TARGET` | Exact opt-in for a reviewed non-local target; only literal `true` authorizes external traffic | unset / `false` |
| `REQUEST_TIMEOUT_MS` | Per-request timeout | `10000` |
| `TEST_RUN_ID` | Run correlation | generated ID |

Collection, environment, schema, and iteration-data overrides must resolve inside the repository root. Target URLs must be absolute HTTP(S) with no credentials, query, or fragment.

## Deterministic target lifecycle

`scripts/local-api.js` implements exactly the protocol surface required by the collection:

- `GET /health`;
- `GET /posts`;
- `GET /posts/:id`;
- `POST /posts`;
- JSON content type;
- request-ID echo;
- deterministic create representation;
- isolated created-state lookup;
- explicit error responses.

When the resolved target equals the committed loopback default, `scripts/run-newman.js` starts the fixture, executes Newman, writes bounded evidence, and closes the fixture in `finally`. Startup, execution, evidence, and cleanup failures remain nonzero.

A non-local `NEWMAN_BASE_URL` is fail-closed. It is rejected before Newman execution unless `NEWMAN_ALLOW_EXTERNAL_TARGET` is the exact literal `true`. Values such as `TRUE`, `1`, `yes`, or whitespace-padded strings do not authorize external traffic.

Authorized non-local runs are classified as `explicit-external`; deterministic default runs remain `local-fixture`. The authorization bit expresses operator intent to cross the local boundary. It does not prove that the deployment is trusted, safe, healthy, or correctly permissioned.

## Collection execution model

Postman assets own request and assertion semantics. The Node runner owns execution governance.

Collection-level scripts own universal cross-request policy such as correlation, common content-type expectations, and response-time budgets. Endpoint scripts own status, schema, identity, write representation, readiness, and state handoff.

The runner deliberately does not duplicate those assertions.

### Preflight and stateful workflow

The full collection contains two explicit sequencing contracts:

1. **Runtime preflight** — `GET /health` proves readiness, protocol semantics, and request-ID echo before behavior-dependent requests.
2. **Create → read** — a write stores the created identifier/title as temporary collection variables; the next request reads that resource, proves identity/shape/value continuity, then removes the temporary variables.

This is explicit workflow state rather than hidden reliance on unrelated test order.

### Variable precedence

| Variable | Scope | Purpose |
| --- | --- | --- |
| `base_url` | environment | Validated service target |
| `post_id` | environment / iteration | Read identifier; iteration wins |
| `user_id` | environment / iteration | Write input; iteration wins |
| `max_response_time_ms` | environment | Shared response-time budget |
| `run_id` | injected environment | Run correlation |
| `request_id` | local | Per-request correlation |
| `generated_title` | local | Unique write value |
| `created_post_id` / `created_post_title` | temporary collection | Explicit create→read handoff |
| `post_schema` | injected global | Version-controlled schema text |

Use the narrowest scope matching the value lifetime. Request-local values should not silently become shared mutable environment state.

## Runtime governance

`npm run validate` proves policy before collection execution. It covers:

- committed JSON integrity;
- secret-like environment guards;
- repository path containment;
- timeout parsing;
- target URL validation;
- fail-closed external authorization/classification;
- run-correlation and focused-folder label validation;
- URL/failure redaction;
- bounded execution-ledger behavior;
- executable local-fixture protocol/lifecycle behavior.

The runtime self-test evaluates external-target authorization without sending external network traffic.

## Evidence and exit integrity

The runner writes:

```text
reports/
├── newman-junit.xml
└── run-manifest.json
```

The manifest is constructed from explicit allowlists rather than serializing broad Newman runtime objects. It records:

- validated run identity;
- repository-relative input provenance;
- bounded/redacted optional folder selection;
- validated base URL and target class;
- `externalTargetAuthorized`;
- timeout policy;
- selected Newman counters and timings;
- bounded sanitized request-ledger entries;
- bounded/redacted failure identity.

`ExecutionLedger` subscribes to Newman request events and retains only structural fields needed for attribution:

- iteration and request position;
- normalized HTTP method;
- URL pathname only;
- integer status code;
- non-negative response time;
- transport error class.

The ledger is bounded and evicts the oldest observation when full. It does not retain request/response bodies, authorization values, cookies, raw query strings, or arbitrary exception objects.

Required CI independently rejects missing/empty JUnit, zero request/assertion work, ledger/stat mismatches, transport errors, invalid target evidence, manifest failures, and contradictory local/external authorization evidence.

Evidence generation never converts validation, authorization, fixture, Newman, assertion, manifest, or cleanup failure into success.

## Confidence boundaries

| Signal | Confidence gained | Deliberate limit |
| --- | --- | --- |
| Postman collection assertions | Native collection request construction, variable behavior, response semantics, schema and stateful workflow are executable | Does not prove runner process control, artifact integrity, or deployed infrastructure |
| Newman runner policy | Input provenance, target authorization, timeouts, correlation, process lifecycle, and reporter/evidence behavior are governed | Runner correctness does not make a poor assertion meaningful |
| Repository-owned HTTP fixture | Required CI proves real HTTP serialization without public DNS, third-party uptime, rate limits, or mutable content | Does not prove deployed TLS, ingress, identity, production data, or external dependencies |
| Data-driven cases | Represented input partitions execute through the same governed request/assertion path | A data file is not exhaustive domain coverage |
| JUnit + sanitized manifest | CI can reconcile process outcome, work performed, target attribution, authorization attribution, and bounded evidence | Reporter output remains secondary to native Newman exit status and semantic validation |
| Explicit deployed target | The same governed runner can exercise an approved environment only after a separate authorization signal | Environment runs mix service, network, identity, and data risks and must be interpreted separately |
| CodeQL / npm Audit / Trivy / Dependency Review | Independent controls inspect source, advisory, repository/configuration/secret, and dependency-diff surfaces | Green scanners are scoped evidence, not proof of vulnerability absence |

## Newman and collection-format compatibility

This repository intentionally remains a **Newman** framework using **Postman Collection v2.1 JSON**.

**Collection v3** is a different **YAML**-based format associated with newer Postman workflows. Newman does not execute Collection v3; **Postman CLI** is the migration path when Collection v3 or newer Postman-native Git behavior is required.

A future migration therefore changes the execution engine and collection format together, then requalifies target authorization, deterministic fixture ownership, variable semantics, schema injection, JUnit/reporting behavior, bounded evidence, and exit integrity before Newman is retired.

Do not convert the asset format independently of the runner.

## Primary and extended CI

Primary and extended collection execution use the same runner-owned deterministic API. The difference is coverage breadth:

- **primary** — standard collection environment;
- **extended** — full data-driven execution using `data/posts.json`.

Required workflows do not authorize external targets.

Security and documentation workflows remain independent failure domains. CodeQL covers source-level analysis; governed npm Audit evaluates advisory exposure; Trivy covers dependency/configuration/secret findings; Dependency Review provides pull-request change-diff evidence when GitHub Dependency graph is available.

## Dependency maintenance

Dependabot maintains **npm** and **GitHub Actions**.

- updates run weekly Monday at 09:00 America/New_York;
- routine minor/patch updates are grouped to reduce review noise;
- major Newman/Node ecosystem upgrades remain standalone;
- GitHub Actions are treated as executable dependencies;
- dependency PRs are evaluated by asset validation, runtime/fixture/ledger self-tests, Newman execution, security, and docs workflows.

Dependabot, lifecycle-script-disabled locked installation, deterministic fixture tests, CodeQL, governed npm Audit, Trivy, and Dependency Review address different supply-chain risks and remain separate controls.

## Failure triage

| Signal | First interpretation |
| --- | --- |
| Asset validation | Export/configuration policy |
| Runtime self-test | Path/URL/timeout/target-authorization/evidence policy |
| Fixture self-test | Local protocol/state fixture defect |
| Ledger self-test | Request-event sanitization/bounding policy |
| Health preflight | Target readiness/correlation contract |
| Local fixture startup | Listener/port lifecycle |
| Newman runtime | Postman runtime/transport |
| Endpoint assertion/schema | API behavior contract |
| Create→read mismatch | Explicit chained-state contract |
| Iteration mismatch | Variable/data precedence |
| External-target authorization | Reviewed target intent / exact opt-in policy |
| External-target-only failure | Deployment/environment integration |
| Security/docs | Independent repository governance |

## Explicit anti-patterns

- required CI against a public API;
- provider-specific names for provider-neutral local contracts;
- converting to a newer collection format while retaining Newman;
- duplicated assertions in Node and Postman;
- repository-path overrides that escape the project root;
- raw runtime evidence retained without a data-minimization reason;
- query strings, auth material, cookies, or arbitrary payloads in the generic request ledger;
- mutable environment state used for request-local values;
- temporary cross-request collection state left behind after its scenario;
- reports that swallow Newman or fixture failures;
- non-local execution without the exact explicit authorization signal;
- external target availability used to define framework health.

## Related documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — runner, fixture, assets, target policy, evidence boundaries, and extension rules.
- [`TEST_STRATEGY.md`](TEST_STRATEGY.md) — request/assertion ownership, data-driven execution, evidence policy, and exit criteria.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — change-quality expectations.

A strong Newman framework makes the failing boundary obvious: asset/format compatibility, variable scope, runtime validation, target authorization, target preflight, local fixture/state, collection assertion, request-evidence lifecycle, or explicit deployed environment.
