# Test strategy

## Purpose

The suite uses the Newman-supported Postman Collection format executed by Newman to verify API behavior while keeping execution governance and the default target independently testable in Node. Required collection execution is repository-controlled; deployed environments remain explicit integration targets that require a separate authorization signal.

## Gate layers

| Layer | Runner | Target | Primary concern |
| --- | --- | --- | --- |
| Asset validation | Node | None | JSON/export integrity and committed-value guardrails |
| Runtime contract | Node | None | File provenance, target authorization/classification, correlation/selector policy, timeout parsing, evidence redaction |
| Fixture contract | Node + native fetch | Ephemeral loopback | Local API lifecycle/protocol/state behavior |
| Primary collection | Newman | Runner-owned `127.0.0.1:4010` | Preflight, status/protocol/semantic/schema/write-read behavior |
| Execution evidence | Newman request events + Node ledger | Same run | Bounded structural per-request attribution + target/authorization reconciliation |
| Data-driven collection | Newman | Same local fixture | Iteration cases and variable precedence |
| Environment integration | Newman | Reviewed `NEWMAN_BASE_URL` + exact authorization | Deployed-system behavior |

## Zero-public-network validation

`npm run validate` is required before Newman execution. It fails for malformed committed assets, suspicious secret-like environment values, repository path escape, invalid/non-positive request timeout, invalid target URLs/hostnames/ports, URL credentials/query/fragment, missing or malformed external authorization, unsafe run correlation, unsafe focused folder labels, diagnostic redaction regressions, and local fixture protocol/lifecycle defects.

The runtime self-test evaluates external target policy without sending requests. It proves that unset/empty/`false` authorization rejects a non-local target, only exact `true` authorizes it, lookalikes such as `TRUE`, `1`, `yes`, or whitespace-padded values fail, and a local target remains local even when the opt-in is present.

A launcher or fixture-policy defect should not require a remote API to reproduce.

## Deterministic target policy

The committed Postman environment sets `base_url` to `http://127.0.0.1:4010`. Exactly one enabled `base_url` is required; missing or duplicate enabled entries fail before execution because target ownership/precedence would be ambiguous.

`run-newman.js` resolves the proposed target through `targetPolicy()`, which validates the URL and decides target authorization/classification before any Newman request. Explicit target port `0` is invalid.

The environment may contain at most one enabled `run_id`; the runner updates it or creates one when absent. This prevents duplicate enabled correlation identity from making request/evidence behavior order-dependent.

The runner closes its fixture in `finally`, so successful reporting does not excuse lifecycle failure. Required CI therefore excludes public DNS/TLS, vendor availability, public rate limits, and third-party data drift.

A non-local `NEWMAN_BASE_URL` alone is insufficient. External execution requires the second exact signal `NEWMAN_ALLOW_EXTERNAL_TARGET=true`. Authorized runs are marked `explicit-external` with `externalTargetAuthorized=true` in the manifest. The local fixture is always marked `local-fixture` with `externalTargetAuthorized=false`.

## Focused folder policy

`NEWMAN_FOLDER` is an operator convenience for focused troubleshooting, not the definition of required coverage. When supplied, it is normalized through a bounded label policy and rejected for control characters or excessive length before Newman execution.

The manifest stores a bounded/redacted form of the selected folder. The full required CI path runs the complete intended collection workflow unless a workflow explicitly owns a focused scope.

## Fixture contract

`scripts/local-api.selftest.js` binds an ephemeral port and independently verifies:

- health readiness;
- list response;
- arbitrary item lookup;
- request-ID echo;
- POST status and deterministic representation;
- created-resource persistence sufficient for a later read contract.

The fixture self-test executes before Newman. A fixture failure should be fixed at the protocol/lifecycle layer rather than hidden by weakening collection assertions.

## Collection workflow and assertion depth

The full required collection begins with a health preflight. Stateful write coverage then creates a synthetic post, captures the generated identifier/title in temporary collection variables, and rereads that same resource before temporary state is cleaned.

Every endpoint case should combine the relevant dimensions:

1. HTTP status;
2. protocol/content type;
3. schema/shape;
4. critical semantic values;
5. state continuity where a prior request intentionally created the resource;
6. bounded response-time policy where useful.

Schema validation alone is insufficient. A structurally valid response can still contain the wrong record or write result.

## Collection-scope policy

Collection-level scripts remain small and universal: correlation and common protocol budgets are appropriate. Endpoint-specific assertions stay with the endpoint.

Generated per-request values use request/local scope unless a later request intentionally consumes them. Intentional cross-request variables are temporary collection state rather than permanent environment configuration.

The Node runner must not become a second assertion engine. Its responsibility is safe execution policy, target authorization, and lifecycle, not duplicating `pm.*` behavior.

## Data-driven execution

Iteration data is reviewed repository content selected explicitly by path. Each row must be independently valid and should not require mutable state from a previous iteration.

The collection explicitly consults `pm.iterationData` before environment fallback for `post_id` and `user_id`, ensuring assertions evaluate the same values that drove each iteration.

State created inside one iteration must stay within that iteration's workflow.

## Primary versus extended coverage

Primary CI and extended CI use the same deterministic target model. Extended adds `data/posts.json`; it does not introduce determinism that the primary gate lacks.

Required workflows do not authorize external targets. Their expected evidence class is `local-fixture`, so a workflow or runner change that silently points required CI at a deployment fails target-evidence validation.

This means a primary failure is attributable to runner/fixture/Postman/API-contract behavior rather than a public dependency.

## External environment policy

A deployed run requires both a reviewed non-local `NEWMAN_BASE_URL` and exact `NEWMAN_ALLOW_EXTERNAL_TARGET=true` in the same invocation. Keep environment promotion in configuration rather than branching collection behavior by environment unless the API contract itself differs.

The authorization variable is a deliberate intent boundary, not a credential or trust decision. It does not prove the endpoint is safe, correctly permissioned, healthy, or appropriate for write tests. Deployment ownership, credentials, data safety, and target review remain separate operational responsibilities.

Classify external-only failures first as environment/integration issues: deployment state, connectivity, TLS, data, or downstream dependencies can differ from the local framework contract.

## Evidence policy

Default retained machine evidence is:

- JUnit for CI test integration;
- `run-manifest.json` for bounded operational context.

Required CI independently validates that both outputs are present and non-empty, that the manifest represents non-zero request/assertion work, that its execution ledger matches request statistics, and that it contains no transport or manifest failures.

The manifest is an **explicit allowlisted projection**, not a serialized copy of `summary.run`. It records input provenance, validated resolved target, target class, `externalTargetAuthorized`, timeout, a bounded/redacted folder selector, selected stats/timings, compact failures, and a bounded execution ledger.

Target evidence is itself governed: `local-fixture` must use `http://127.0.0.1:4010` and authorization `false`; `explicit-external` must use a non-local URL and authorization `true`; unknown or contradictory combinations fail evidence validation. The required `posts-full` profile separately requires `local-fixture`.

Selected Newman stats retain only `total`, `pending`, and `failed` for iterations, items, requests, tests, and assertions. Selected timings retain normalized start/completion timestamps, derived duration, and finite non-negative response average/min/max/standard-deviation values. Invalid/negative/non-finite values normalize to `null`, and unknown fields in future Newman result objects are discarded unless deliberately added to the contract.

The ledger records only iteration/position, method, sanitized path, response status/time, and transport error class. It is capped at 5,000 entries and drops oldest observations when full. Bodies, auth values, cookies, query strings, and arbitrary exception objects are excluded.

Raw Newman JSON is intentionally excluded because it can serialize broader runtime context than the allowlisted evidence contract requires.

Failure text is bounded and common credential/token forms are redacted. Malformed HTTP(S) diagnostic URLs fail closed rather than being retained raw. Do not assume request/response bodies are safe merely because the manifest is safe.

## Collection format and execution engine

Newman is the selected execution engine, so committed collections remain Postman Collection **the Newman-supported format**.

A requirement for Postman a newer collection format or newer Postman-native Git/CLI behavior is a migration decision: adopt Postman CLI, update collection format and CI commands, then revalidate lifecycle, evidence, exit semantics, and privacy. Do not change only the JSON schema version while claiming unchanged Newman compatibility.

## Exit integrity

A failure in any of these stages must remain nonzero:

- asset/runtime/fixture validation;
- target authorization/classification;
- local fixture startup;
- Newman runtime;
- collection assertion;
- manifest generation/evidence reconciliation;
- local fixture cleanup.

Reports are evidence, not a mechanism for converting failure to success.

## Failure triage

| Failure class | First evidence/action |
| --- | --- |
| Asset parse/secret guard | `npm run validate` output |
| Duplicate/missing enabled environment identity | runner input validation |
| Path/target/correlation/timeout policy | runtime self-test/validation error |
| External target authorization | target-policy self-test / exact opt-in input |
| Folder selector policy | bounded-label validation error |
| Fixture self-test | local protocol/lifecycle implementation |
| Fixture startup | listener/port ownership |
| Preflight | target readiness/protocol baseline |
| Stateful create→read mismatch | collection-variable/API state contract |
| Newman transport/runtime | Newman CLI + JUnit |
| Assertion/schema | JUnit + manifest failure identity |
| Iteration mismatch | manifest provenance + collection variable assertion |
| Evidence schema anomaly | runtime/manifest allowlist contract |
| Target evidence contradiction | manifest target class/base URL/authorization reconciliation |
| Ledger anomaly | sanitized execution observations |
| External-only | deployed environment/integration first |
| Unexpected zero requests/tests | selected stats + folder/data inputs |

Do not suppress Newman exit status or replace deterministic failures with retries.

## Secret handling

Committed environments contain only non-secret fixture/default values. Runtime credentials for explicit deployments should come from controlled injection and must not be embedded in `base_url` or the external authorization variable.

Avoid collection-level logging of full headers, bodies, cookies, or environment objects. The runner's redaction policy cannot reliably sanitize arbitrary logs emitted by collection scripts.

Repository security remains an independent failure domain: CodeQL performs source analysis, Trivy checks dependency/misconfiguration/committed-secret findings, and pull-request Dependency Review runs when GitHub Dependency graph is available.

## Parallelism and isolation

One runner process owns the default local listener for its run. GitHub Actions jobs execute on isolated runners. If developers intentionally run multiple Newman processes on the same host, each must use an isolated port/target rather than racing for the committed default port.

Data-driven iterations must be independent. Intentional create→read state is bounded to the current workflow/iteration rather than shared globally.

## Exit criteria

A collection/framework change is ready when:

- asset, runtime, and fixture self-tests pass;
- the selected input provenance is valid/reviewable;
- exactly one enabled target identity is present and duplicate run identity is rejected;
- target, run-correlation, folder, and port inputs fail closed before Newman requests;
- non-local targets fail closed unless exact external authorization is present;
- local/external target class and authorization evidence reconcile independently after execution;
- primary Newman execution passes against the local fixture;
- preflight and create→read state contracts pass;
- data-driven execution passes when affected;
- schema and semantic assertions cover critical responses;
- the execution ledger remains bounded and payload-safe;
- retained stats/timings come from explicit numeric/date allowlists rather than broad Newman objects;
- lifecycle, authorization, and Newman failures preserve nonzero status;
- retained evidence remains bounded/privacy-aware and passes the independent meaningful-evidence gate;
- the Newman/Collection-the Newman-supported format compatibility boundary remains explicit;
- external target behavior remains explicitly authorized and classified;
- changed runner/fixture/reporting policy is reflected in documentation and CI.
