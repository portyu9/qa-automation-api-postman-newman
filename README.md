# Postman / Newman API Test Framework

A Postman collection and Newman execution framework for API behavior, JSON Schema validation, data-driven inputs, environment promotion, correlation IDs, and CI reporting.

## Structure

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
│   └── validate-assets.js
├── postman_environment.json
├── docs/
└── .github/workflows/ci.yml
```

## Installation

Node.js 22+ is required.

```bash
npm install
```

## Execution

```bash
npm test              # full collection with CLI/JUnit/JSON reporters
npm run test:smoke    # read-only folder selection
npm run validate      # parse assets and check committed environment values
```

Optional data-driven execution:

```bash
NEWMAN_ITERATION_DATA=data/posts.json npm test
```

Use another environment without changing collection code:

```bash
NEWMAN_ENVIRONMENT=environments/staging.postman_environment.json npm test
```

## Runner contract

`scripts/run-newman.js` is the CI entry point. It:

1. loads the collection and selected environment;
2. injects `TEST_RUN_ID` into the environment;
3. loads the version-controlled post JSON Schema and injects it for Postman assertions;
4. applies an explicit request timeout;
5. optionally selects a folder or iteration-data file;
6. emits CLI, JUnit, JSON, and compact summary reports;
7. exits non-zero when any Newman assertion fails.

The framework deliberately does not suppress Newman exit codes.

## Variable strategy

| Variable | Scope | Purpose |
| --- | --- | --- |
| `base_url` | environment | target endpoint |
| `post_id` | environment/iteration data | request case input |
| `user_id` | environment/iteration data | write-case input |
| `max_response_time_ms` | environment | collection response-time budget |
| `run_id` | injected environment | run correlation |
| `request_id` | local | individual request correlation |
| `generated_title` | local | unique write-case data |

Do not commit credentials, tokens, API keys, or authorization headers in exported environments. Inject them through CI/secret management.

## Collection design

Collection-level scripts own policies common to every request. Endpoint scripts remain explicit about endpoint-specific behavior. This avoids both extremes: duplicated assertion boilerplate and opaque global scripts that make failures hard to locate.

The sample collection validates:

- protocol status;
- JSON content type;
- response-time budget;
- array/object JSON Schema;
- requested identifier semantics;
- POST echo/creation semantics;
- unique run/request correlation metadata.

## Schema management

`schemas/post-schema.json` is a normal version-controlled artifact. The Newman runner injects it at runtime so the collection does not contain a duplicate embedded schema. Schema validation is additive; behavioral assertions remain necessary.

## Reporters

Newman provides built-in `cli`, `junit`, and `json` reporters. CI retains machine-readable JUnit/JSON plus `summary.json`. Generated reports live under `reports/` and are ignored by Git.

## CI

GitHub Actions validates all JSON assets, checks the committed environment for obvious secret-like values, executes Newman, preserves the real failure exit code, and uploads reports even on failure.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md) for variable, schema, data, and release-gate guidance.
