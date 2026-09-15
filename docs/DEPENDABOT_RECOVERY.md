# Dependabot recovery

Dependency recovery is a bounded qualification aid, not a second merge authority. `dependency-governance` remains the only autonomous merge path, and npm updates remain explicitly human-reviewed under the repository's existing governance policy.

A current canonical Dependabot PR may receive one failed-job rerun only when its signed single-commit provenance is intact, its head is based directly on current `main`, its changed files belong to a governed dependency ecosystem, the failed required workflow has exactly one failed aggregate gate, every failed leaf job has exactly one failed step, and every such step is explicitly allowlisted infrastructure with a timestamp-bounded transient network/service signature. Deterministic package-resolution, permission, disk, client/policy HTTP, or ambiguous job evidence blocks recovery even when a transient signature is also present.

The retry allowlist is intentionally narrow: npm toolchain/bootstrap installation and evidence artifact upload. Newman collection execution, fixture/runtime validation, semantic evidence validation, npm advisory policy, CodeQL, Trivy, Dependency Review, and aggregate gates are never made green by recovery. A rerun must pass those controls normally.

`maxRunAttempts: 2` permits at most one automatic failed-job rerun. A stale PR waits for Dependabot's native `rebase-strategy: auto`; the controller never updates a Dependabot branch. Recovery has no merge or Git-ref mutation transport. The Dependabot configuration, recovery configuration, recovery implementation/tests, governance implementation/tests, security workflow, and privileged governance workflow are manual-review control plane.

For npm PRs, a successful recovery can restore qualification evidence but does **not** change `ecosystems.npm.mode: manual`. For eligible GitHub Actions PRs, the existing dependency-governance semantic and exact-head gates still decide whether autonomous merge is allowed.
