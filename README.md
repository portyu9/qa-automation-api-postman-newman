# API Automation with Postman and Newman

I built this repository to demonstrate how I structure and execute API test suites using **Postman** collections and **Newman**.  Many teams rely on Postman for exploratory API testing but struggle to keep those tests version controlled or to run them consistently in CI/CD pipelines.  By committing my collections, test scripts, environment files and CI configuration to Git, I can treat my API tests like any other code asset with GitHub Actions CI.

## Key Features

- **Real public API** – The collection exercises the [`JSONPlaceholder`](https://jsonplaceholder.typicode.com) service.  I interact with endpoints for posts and validate that the responses are well‑formed.
- **JavaScript test scripts** – Each request includes tests written in Postman’s scripting language.  I check HTTP status codes, response structure and specific field values.
- **Environment configuration** – A `postman_environment.json` defines the `base_url` variable.  This makes it easy to point the suite at different deployments without editing the collection itself.
- **JSON schema definitions** – The `schemas/post-schema.json` file contains a JSON Schema for a single post.  Although not used directly by the collection, I keep my contracts under version control so I can import them into Postman or other validation tools.
- **Newman and HTML reporting** – A simple `package.json` sets up Newman and the HTML reporter.  Running `npm test` executes the collection and writes an HTML report to the `reports/` directory.
- **GitHub Actions integration** – The workflow in `.github/workflows/ci.yml` installs dependencies and runs Newman on each push or pull request.  The resulting report is uploaded as a build artifact for convenient viewing.

## Project Structure

```
qa-automation-api-postman-newman
├── collections/
│   └── jsonplaceholder.postman_collection.json   # Postman collection with requests and tests
├── schemas/
│   └── post-schema.json                        # JSON Schema for a single post response
├── postman_environment.json                    # Environment variables (e.g. base_url)
├── package.json                                # NPM scripts and dependencies
├── README.md                                   # You are here
└── .github/workflows/ci.yml                    # GitHub Actions workflow
```

## Getting Started

1. Install Node.js (version 18 or higher) and npm.
2. Clone this repository and install dependencies:

   ```bash
   npm install
   ```

3. Execute the test suite using Newman:

   ```bash
   npm test
   ```

   The HTML report will be generated in the `reports/` directory.  Open it in a browser to review the results.

## Extending the Suite

To add new endpoints, open the collection file in Postman, record additional requests and assertions, and export the updated JSON.  I recommend storing sample payloads in a `data/` folder and loading them in your tests via pre‑request scripts.  If you introduce new response contracts, add corresponding JSON Schema files under `schemas/` so that consumers of your API know exactly what to expect.
