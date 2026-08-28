# Test strategy

## Purpose

The suite uses Postman/Newman to verify API behavior while keeping execution governance independently testable in Node. The strategy separates **asset/runtime validity** from **remote API assertions** so a broken launcher, unsafe input, or path escape fails before network traffic begins.

## Gate layers

| Layer | Runner | Network? | Primary concern |
| --- | --- | ---: | --- |
| Asset validation | Node | No | JSON parsing and committed environment guardrails |
| Runtime contract | Node | No | File provenance, target URL policy, timeout parsing, diagnostic redaction |
| Collection execution | Newman | Yes | Status/protocol/semantic/schema behavior |
| Data-driven execution | Newman | Yes | Iteration-specific cases and variable scoping |

## Zero-network validation

`npm run validate` is required before Newman execution. It should fail for:

- malformed committed JSON;
- suspicious secret-like committed environment values;
- collection/environment/iteration paths escaping the repository;
- invalid/non-positive request timeout;
- relative/non-HTTP target URLs;
- URL credentials;
- query/fragment-bearing base URLs;
- diagnostic redaction regressions.

A launcher-policy defect should not require a remote service to reproduce.

## Target selection

The selected environment provides `base_url`; `NEWMAN_BASE_URL` may override only that resolved target. The resulting URL is validated before Newman begins.

Environment promotion should change target/environment data, not collection behavior. Avoid conditionals in collection scripts that implement a different assertion contract per environment unless the API itself truly differs.

## Assertion depth

Every endpoint test should combine the relevant dimensions:

1. HTTP status;
2. protocol/content-type expectations;
3. schema/shape;
4. semantic values critical to the request;
5. bounded response-time policy where useful.

Schema validation alone is insufficient. A structurally valid response can still contain the wrong ID or meaning.

## Collection-scope policy

Collection-level scripts should remain small and universal: correlation setup and common protocol budgets are appropriate. Endpoint-specific business assertions stay with the endpoint.

This keeps a failure's ownership obvious and prevents shared scripts from becoming a hidden test framework inside the collection.

## Data-driven execution

Iteration data belongs in reviewed repository files and is explicitly selected by path. Each row should be independently valid and should not depend on state written by a prior iteration.

Generated write-case values should use local scope unless later requests deliberately consume them.

## Evidence policy

Default retained machine-readable evidence is:

- JUnit for CI test UIs;
- `run-manifest.json` for bounded operational context.

The manifest records input provenance, the validated resolved target, timeout, stats/timings, and compact redacted failures. Raw Newman JSON is not a default artifact because it can contain broader nested execution state than the allowlisted manifest.

Failure messages are bounded and common credential/token forms are redacted. Do not assume request/response bodies are safe simply because the manifest is safe.

## Failure triage

| Failure class | First evidence/action |
| --- | --- |
| Asset parse/secret guard | `npm run validate` output |
| Path escape | runtime validation error |
| Invalid target | base-URL validation error |
| Invalid timeout | runtime validation error |
| Connectivity/transport | Newman CLI + JUnit |
| Assertion/schema | JUnit + run-manifest failure identity |
| Iteration mismatch | manifest input provenance + collection assertion |
| Unexpected zero requests/tests | Newman stats + folder/path selection |

Do not suppress Newman exit status. A failing assertion with a generated report is still a failing gate.

## Secret handling

Committed environments contain non-secret defaults only. Runtime credentials should come from controlled CI/environment injection and should not be encoded into `base_url`.

Avoid collection-level `console.log` of headers, request bodies, or complete environment objects. The Node runner's redaction policy cannot sanitize arbitrary logging emitted by collection scripts.

## Exit criteria

A collection/framework change is ready when:

- asset and runtime validation pass;
- the selected target/input provenance is valid and reviewable;
- collection assertions pass;
- schema and semantic assertions both cover critical responses;
- Newman failures preserve a nonzero job result;
- retained evidence remains bounded/privacy-aware;
- any changed runner input/reporting policy is reflected in docs and self-tests.
