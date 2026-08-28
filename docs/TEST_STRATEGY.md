# API collection strategy

## Assertion layers

Collection-level assertions enforce invariants shared by every request, such as response-time budget and JSON content type. Request-level assertions cover status, schema, identifiers, and semantic values.

Status-only checks are insufficient. A passing API test should provide confidence in both protocol behavior and domain-relevant response semantics.

## Data-driven execution

Use iteration data for meaningful input partitions, not to create an exhaustive Cartesian product. `data/posts.json` demonstrates externalized inputs. CI can set `NEWMAN_ITERATION_DATA=data/posts.json` when repeated cases are desired.

## Negative cases

Negative tests should verify the API's documented behavior for invalid input, authorization, not-found, conflict/idempotency, and malformed payloads. Do not invent a desired status code for a third-party sample API whose contract behaves differently.

## Contract checks

JSON Schema catches structural drift. It does not verify business semantics, authorization, persistence side effects, or workflow transitions, so retain explicit assertions for those properties.

## Environment promotion

Use separate non-secret environment files for stable target differences or inject values from CI. Do not clone collections per environment. The same collection should execute against compatible targets by changing configuration only.

## CI policy

Newman must retain its real exit status. JUnit is consumed by CI/test-reporting systems; JSON is retained for deeper analysis. Reports are artifacts, not committed generated files.

## Observability

Send a run ID/request ID when the service accepts diagnostic headers. Do not log authorization headers or secret variables. Correlation makes an individual Newman failure traceable in distributed server telemetry.
