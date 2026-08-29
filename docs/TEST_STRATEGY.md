# Test strategy

## Purpose

The suite uses Postman/Newman to verify API behavior while keeping execution governance and the default target independently testable in Node. Required collection execution is repository-controlled; deployed environments remain explicit integration targets.

## Gate layers

| Layer | Runner | Target | Primary concern |
| --- | --- | --- | --- |
| Asset validation | Node | None | JSON/export integrity and committed-value guardrails |
| Runtime contract | Node | None | File provenance, target URL policy, timeout parsing, evidence redaction |
| Fixture contract | Node + native fetch | Ephemeral loopback | Local API lifecycle/protocol behavior |
| Primary collection | Newman | Runner-owned `127.0.0.1:4010` | Status/protocol/semantic/schema/write behavior |
| Data-driven collection | Newman | Same local fixture | Iteration cases and variable precedence |
| Environment integration | Newman | Explicit `NEWMAN_BASE_URL` | Deployed-system behavior |

## Zero-public-network validation

`npm run validate` is required before Newman execution. It fails for malformed committed assets, suspicious secret-like environment values, repository path escape, invalid/non-positive request timeout, invalid target URLs, URL credentials/query/fragment, diagnostic redaction regressions, and local fixture protocol/lifecycle defects.

A launcher or fixture-policy defect should not require a remote API to reproduce.

## Deterministic target policy

The committed Postman environment sets `base_url` to `http://127.0.0.1:4010`. `run-newman.js` resolves and validates the target, then starts the repository fixture when that default is selected.

The runner closes its fixture in `finally`, so successful reporting does not excuse lifecycle failure. Required CI therefore excludes public DNS/TLS, vendor availability, public rate limits, and third-party data drift.

`NEWMAN_BASE_URL` may select a validated non-default deployment. Such runs are integration signals and are marked `explicit-external` in the manifest.

## Fixture contract

`scripts/local-api.selftest.js` binds an ephemeral port and independently verifies:

- health readiness;
- list response;
- arbitrary item lookup;
- request-ID echo;
- POST status and deterministic representation.

The fixture self-test executes before Newman. A fixture failure should be fixed at the protocol/lifecycle layer rather than hidden by weakening collection assertions.

## Assertion depth

Every endpoint case should combine the relevant dimensions:

1. HTTP status;
2. protocol/content type;
3. schema/shape;
4. critical semantic values;
5. bounded response-time policy where useful.

Schema validation alone is insufficient. A structurally valid response can still contain the wrong record or write result.

## Collection-scope policy

Collection-level scripts remain small and universal: correlation and common protocol budgets are appropriate. Endpoint-specific assertions stay with the endpoint.

The Node runner must not become a second assertion engine. Its responsibility is safe execution policy and lifecycle, not duplicating `pm.*` behavior.

## Data-driven execution

Iteration data is reviewed repository content selected explicitly by path. Each row must be independently valid and must not depend on mutable state produced by a previous iteration.

The collection explicitly consults `pm.iterationData` before environment fallback for `post_id` and `user_id`, ensuring assertions evaluate the same values that drove each iteration.

Generated write-case values remain request/local scope unless later requests deliberately consume them.

## Primary versus extended coverage

Primary CI and extended CI use the same deterministic target model. Extended adds `data/posts.json`; it does not introduce determinism that the primary gate lacks.

This means a primary failure is attributable to runner/fixture/Postman/API-contract behavior rather than a public dependency.

## External environment policy

A non-default `NEWMAN_BASE_URL` intentionally selects a deployed API. Keep environment promotion in configuration rather than branching collection behavior by environment unless the API contract itself differs.

Classify external-only failures first as environment/integration issues: deployment state, connectivity, TLS, data, or downstream dependencies can differ from the local framework contract.

## Evidence policy

Default retained machine evidence is:

- JUnit for CI test integration;
- `run-manifest.json` for bounded operational context.

The manifest records input provenance, validated resolved target, target class, timeout, Newman stats/timings, and compact redacted failures. Raw Newman JSON is intentionally excluded because it can serialize broader runtime context than the allowlisted evidence contract requires.

Failure text is bounded and common credential/token forms are redacted. Do not assume request/response bodies are safe merely because the manifest is safe.

## Exit integrity

A failure in any of these stages must remain nonzero:

- asset/runtime/fixture validation;
- local fixture startup;
- Newman runtime;
- collection assertion;
- manifest generation;
- local fixture cleanup.

Reports are evidence, not a mechanism for converting failure to success.

## Failure triage

| Failure class | First evidence/action |
| --- | --- |
| Asset parse/secret guard | `npm run validate` output |
| Path/target/timeout policy | runtime self-test/validation error |
| Fixture self-test | local protocol/lifecycle implementation |
| Fixture startup | listener/port ownership |
| Newman transport/runtime | Newman CLI + JUnit |
| Assertion/schema | JUnit + manifest failure identity |
| Iteration mismatch | manifest provenance + collection variable assertion |
| External-only | deployed environment/integration first |
| Unexpected zero requests/tests | Newman stats + selected folder/data inputs |

Do not suppress Newman exit status or replace deterministic failures with retries.

## Secret handling

Committed environments contain only non-secret fixture/default values. Runtime credentials for explicit deployments should come from controlled injection and must not be embedded in `base_url`.

Avoid collection-level logging of full headers, bodies, cookies, or environment objects. The runner's redaction policy cannot reliably sanitize arbitrary logs emitted by collection scripts.

## Parallelism and isolation

One runner process owns the default local listener for its run. GitHub Actions jobs execute on isolated runners. If developers intentionally run multiple Newman processes on the same host, each must use an isolated port/target rather than racing for the committed default port.

Data-driven iterations must be independent; the local fixture intentionally returns deterministic representations rather than accumulating mutable cross-iteration state.

## Exit criteria

A collection/framework change is ready when:

- asset, runtime, and fixture self-tests pass;
- the selected input provenance is valid/reviewable;
- primary Newman execution passes against the local fixture;
- data-driven execution passes when affected;
- schema and semantic assertions cover critical responses;
- lifecycle and Newman failures preserve nonzero status;
- retained evidence remains bounded/privacy-aware;
- external target behavior remains explicitly classified;
- changed runner/fixture/reporting policy is reflected in documentation and CI.
