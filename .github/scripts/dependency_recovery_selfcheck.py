#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from dependency_governance import load_config  # noqa: E402
from dependency_recovery import (  # noqa: E402
    classify_leaf_job_failure,
    classify_run_failure,
    extract_step_log_window,
    matching_non_transient_signatures,
    matching_transient_signatures,
    recovery_scope_assessment,
    run_dependency_recovery,
    validate_recovery_config,
)

ROOT = SCRIPT_DIR.parents[1]
GOVERNANCE = load_config()
RECOVERY = json.loads((ROOT / ".github" / "dependency-recovery.json").read_text(encoding="utf-8"))
SUCCESS_START = "2026-09-15T12:00:00Z"
SUCCESS_END = "2026-09-15T12:00:02Z"
FAILURE_START = "2026-09-15T12:00:03Z"
FAILURE_END = "2026-09-15T12:00:05Z"


def log_line(timestamp: str, message: str) -> str:
    return f"{timestamp} {message}"


def logs(before: str = "", failed: str = "", after: str = "") -> str:
    return "\n".join(
        (
            log_line("2026-09-15T12:00:01.0000000Z", before),
            log_line("2026-09-15T12:00:04.0000000Z", failed),
            log_line("2026-09-15T12:00:06.0000000Z", after),
        )
    )


def job(
    *,
    job_id: int = 10,
    name: str = "newman · Node 24 current LTS",
    step: str = "Pin and verify npm toolchain",
    conclusion: str | None = "failure",
    started_at: str | None = FAILURE_START,
    completed_at: str | None = FAILURE_END,
) -> dict[str, Any]:
    return {
        "id": job_id,
        "name": name,
        "conclusion": conclusion,
        "steps": [
            {
                "name": "Set up job",
                "conclusion": "success",
                "started_at": SUCCESS_START,
                "completed_at": SUCCESS_END,
            },
            {
                "name": step,
                "conclusion": conclusion,
                "started_at": started_at,
                "completed_at": completed_at,
            },
        ],
    }


def gate(name: str = "ci-gate", conclusion: str = "failure") -> dict[str, Any]:
    return {
        "id": 99,
        "name": name,
        "conclusion": conclusion,
        "steps": [
            {
                "name": "Evaluate required runtime matrix",
                "conclusion": conclusion,
                "started_at": FAILURE_START,
                "completed_at": FAILURE_END,
            }
        ],
    }


def canonical_fixture() -> dict[str, Any]:
    base_sha = "a" * 40
    head_sha = "b" * 40
    full_name = "portyu9/fixture"
    pull = {
        "number": 41,
        "state": "open",
        "user": {"login": GOVERNANCE["botLogin"], "id": GOVERNANCE["botUserId"]},
        "base": {"ref": GOVERNANCE["baseBranch"], "repo": {"full_name": full_name}},
        "head": {
            "ref": "dependabot/npm_and_yarn/routine-dependencies",
            "repo": {"full_name": full_name},
            "sha": head_sha,
        },
        "draft": False,
        "labels": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "commits": 1,
        "changed_files": 2,
    }
    commit = {
        "sha": head_sha,
        "author": {"login": GOVERNANCE["botLogin"], "id": GOVERNANCE["botUserId"]},
        "committer": {"login": GOVERNANCE["trustedCommitterLogin"]},
        "commit": {
            "author": {"name": GOVERNANCE["botLogin"], "email": GOVERNANCE["botAuthorEmail"]},
            "committer": {
                "name": GOVERNANCE["gitCommitterName"],
                "email": GOVERNANCE["gitCommitterEmail"],
            },
            "verification": {"verified": True, "reason": "valid", "signature": "fixture-signature"},
            "message": (
                "deps(deps): bump newman\n\n"
                "updated-dependencies:\n"
                "- dependency-name: newman\n"
                "  dependency-version: 6.2.3\n"
                "  dependency-type: direct:development\n"
                "  update-type: version-update:semver-patch\n"
                "...\n\n"
                f"{GOVERNANCE['signedOffBy']}"
            ),
        },
        "parents": [{"sha": base_sha}],
    }
    return {"base_sha": base_sha, "head_sha": head_sha, "pull": pull, "commit": commit}


def workflow_run(fixture: dict[str, Any], requirement: dict[str, str] | None = None) -> dict[str, Any]:
    requirement = requirement or GOVERNANCE["requiredWorkflows"][0]
    return {
        "id": 501,
        "name": requirement["workflow"],
        "path": f".github/workflows/{requirement['file']}",
        "event": "pull_request",
        "head_sha": fixture["head_sha"],
        "head_branch": fixture["pull"]["head"]["ref"],
        "pull_requests": [{"number": fixture["pull"]["number"]}],
        "status": "completed",
        "conclusion": "failure",
        "run_attempt": 1,
        "updated_at": "2026-09-15T12:00:10Z",
    }


class FakeApi:
    def __init__(
        self,
        fixture: dict[str, Any],
        *,
        files: list[dict[str, Any]] | None = None,
        run: dict[str, Any] | None = None,
        jobs: list[dict[str, Any]] | None = None,
        base_sha: str | None = None,
    ) -> None:
        self.owner = "portyu9"
        self.repo = "fixture"
        self.fixture = fixture
        self.files = files or [{"filename": "package.json"}, {"filename": "package-lock.json"}]
        self.run = run
        self.jobs = jobs or []
        self.base_sha = base_sha or fixture["base_sha"]
        self.reruns: list[int] = []

    def get(self, path: str) -> Any:
        if path == f"/pulls/{self.fixture['pull']['number']}":
            return self.fixture["pull"]
        if path.startswith("/git/ref/heads/"):
            return {"object": {"sha": self.base_sha}}
        raise AssertionError(f"unexpected GET {path}")

    def paginate(self, path: str, selector: str | None = None) -> list[Any]:
        if path.startswith(f"/pulls/{self.fixture['pull']['number']}/files"):
            return self.files
        if path.startswith(f"/pulls/{self.fixture['pull']['number']}/commits"):
            return [self.fixture["commit"]]
        if path.startswith("/actions/runs?"):
            return [self.run] if self.run else []
        if self.run and path.startswith(f"/actions/runs/{self.run['id']}/jobs"):
            return self.jobs
        if path.startswith("/pulls?state=open"):
            return [self.fixture["pull"]]
        raise AssertionError(f"unexpected paginate {path} selector={selector}")

    def post(self, path: str, payload: dict[str, Any]) -> None:
        match = re.fullmatch(r"/actions/runs/(\d+)/rerun-failed-jobs", path)
        if not match:
            raise AssertionError(f"unexpected POST {path}")
        self.reruns.append(int(match.group(1)))


class RecoverySelfCheck(unittest.TestCase):
    def test_recovery_config_is_bounded_and_infrastructure_only(self) -> None:
        self.assertEqual(validate_recovery_config(RECOVERY), [])
        self.assertEqual(RECOVERY["maxRunAttempts"], 2)
        for forbidden in (
            "Validate assets, runtime, fixture, and evidence policy",
            "Execute collection against runner-owned local API",
            "Validate governed semantic Newman evidence",
            "Execute full data-driven collection against runner-owned local API",
            "Validate governed data-driven Newman evidence",
            "Audit HIGH and CRITICAL npm advisories with governed exceptions",
            "Scan npm dev dependencies, configuration, and repository secrets",
            "Review dependency changes",
            "Analyze",
            "Evaluate required runtime matrix",
            "Evaluate data-driven contract",
            "Evaluate security jobs",
        ):
            self.assertNotIn(forbidden, RECOVERY["transientSteps"], forbidden)
        self.assertTrue(validate_recovery_config({**RECOVERY, "maxRunAttempts": 4}))
        invalid = {**RECOVERY, "transientSteps": [*RECOVERY["transientSteps"], "Execute collection against runner-owned local API"]}
        self.assertTrue(validate_recovery_config(invalid))

    def test_signature_model_stays_narrow(self) -> None:
        self.assertEqual(matching_transient_signatures("npm error code EAI_AGAIN"), ["dns-eai-again"])
        self.assertEqual(matching_transient_signatures("request failed with status code 503"), ["http-5xx"])
        self.assertEqual(matching_transient_signatures("Service Unavailable"), [])
        self.assertEqual(matching_transient_signatures("502 assertions passed"), [])
        self.assertEqual(matching_non_transient_signatures("npm error code ERESOLVE"), ["npm-resolution"])
        self.assertEqual(matching_non_transient_signatures("HTTP 403"), ["http-client-or-policy"])
        self.assertEqual(matching_non_transient_signatures("npm error code ENOSPC"), ["disk-space"])

    def test_only_failed_step_timestamp_window_can_authorize_recovery(self) -> None:
        candidate = job()
        window = extract_step_log_window(
            logs("npm error code EAI_AGAIN", "npm error code ERESOLVE", "503 Service Unavailable"),
            candidate["steps"][1],
        )
        self.assertIsNotNone(window)
        assert window is not None
        self.assertIn("ERESOLVE", window)
        self.assertNotIn("EAI_AGAIN", window)
        self.assertNotIn("Service Unavailable", window)
        result = classify_leaf_job_failure(
            candidate,
            logs("npm error code EAI_AGAIN", "npm error code ERESOLVE"),
            RECOVERY,
        )
        self.assertFalse(result["transient"])
        self.assertIn("deterministic or policy-blocking", result["reason"])

    def test_allowlisted_package_setup_with_network_evidence_is_retryable(self) -> None:
        result = classify_leaf_job_failure(job(), logs(failed="npm error code ECONNRESET"), RECOVERY)
        self.assertTrue(result["transient"], result["reason"])
        self.assertEqual(result["signatures"], ["connection-reset"])

    def test_deterministic_blocker_wins_in_same_failed_step(self) -> None:
        result = classify_leaf_job_failure(
            job(), logs(failed="EAI_AGAIN followed by npm error code ERESOLVE"), RECOVERY
        )
        self.assertFalse(result["transient"])
        self.assertEqual(result["blockers"], ["npm-resolution"])

    def test_missing_or_invalid_timestamps_fail_closed(self) -> None:
        candidates = (
            job(started_at=None),
            job(completed_at=None),
            job(started_at="not-a-date"),
            job(started_at=FAILURE_END, completed_at=FAILURE_START),
        )
        for candidate in candidates:
            result = classify_leaf_job_failure(candidate, logs(failed="EAI_AGAIN"), RECOVERY)
            self.assertFalse(result["transient"])
            self.assertIn("timestamp-bounded log window", result["reason"])

    def test_newman_evidence_and_security_semantics_are_never_transient(self) -> None:
        for step in (
            "Validate assets, runtime, fixture, and evidence policy",
            "Execute collection against runner-owned local API",
            "Validate governed semantic Newman evidence",
            "Execute full data-driven collection against runner-owned local API",
            "Validate governed data-driven Newman evidence",
            "Test governed npm advisory policy",
            "Audit HIGH and CRITICAL npm advisories with governed exceptions",
            "Scan npm dev dependencies, configuration, and repository secrets",
            "Require attributed repository security evidence",
            "Analyze",
        ):
            result = classify_leaf_job_failure(
                job(step=step), logs(failed="ETIMEDOUT EAI_AGAIN HTTP 503"), RECOVERY
            )
            self.assertFalse(result["transient"], step)

    def test_workflow_rerun_requires_failed_gate_and_unambiguous_siblings(self) -> None:
        run = {"status": "completed", "conclusion": "failure", "run_attempt": 1}
        transient = job()
        positive = classify_run_failure(
            run, [transient, gate()], {10: logs(failed="EAI_AGAIN")}, "ci-gate", RECOVERY
        )
        self.assertTrue(positive["rerunnable"], positive["reason"])
        for conclusion in ("cancelled", "timed_out", "neutral", "action_required", "stale", None):
            sibling = {"id": 20, "name": "sibling", "conclusion": conclusion, "steps": []}
            blocked = classify_run_failure(
                run,
                [transient, sibling, gate()],
                {10: logs(failed="EAI_AGAIN")},
                "ci-gate",
                RECOVERY,
            )
            self.assertFalse(blocked["rerunnable"], str(conclusion))
            self.assertIn("ambiguous terminal state", blocked["reason"])
        missing_gate = classify_run_failure(
            run, [transient], {10: logs(failed="EAI_AGAIN")}, "ci-gate", RECOVERY
        )
        self.assertFalse(missing_gate["rerunnable"])
        self.assertIn("stable aggregate gate", missing_gate["reason"])

    def test_recovery_is_capped_after_one_rerun(self) -> None:
        result = classify_run_failure(
            {"status": "completed", "conclusion": "failure", "run_attempt": 2},
            [job(), gate()],
            {10: logs(failed="EAI_AGAIN")},
            "ci-gate",
            RECOVERY,
        )
        self.assertFalse(result["rerunnable"])
        self.assertIn("recovery cap", result["reason"])

    def test_scope_can_recover_manual_npm_without_changing_merge_policy(self) -> None:
        base = {
            "pull": {"changed_files": 2},
            "files": [{"filename": "package.json"}, {"filename": "package-lock.json"}],
            "provenance": {"eligible": True, "reasons": []},
            "metadata": {
                "eligible": True,
                "reasons": [],
                "metadata": [{"name": "newman", "version": "6.2.3", "updateType": "version-update:semver-patch"}],
            },
        }
        result = recovery_scope_assessment(governance_config=GOVERNANCE, **base)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["ecosystem"], "npm")
        self.assertEqual(result["mergePolicy"], "manual")
        self.assertEqual(GOVERNANCE["ecosystems"]["npm"]["mode"], "manual")

        protected = recovery_scope_assessment(
            pull={"changed_files": 1},
            files=[{"filename": ".github/workflows/dependency-governance.yml"}],
            provenance={"eligible": True, "reasons": []},
            metadata={"eligible": True, "reasons": [], "metadata": []},
            governance_config=GOVERNANCE,
        )
        self.assertFalse(protected["eligible"])

    def test_injected_client_requests_one_canonical_transient_rerun(self) -> None:
        fixture = canonical_fixture()
        requirement = GOVERNANCE["requiredWorkflows"][0]
        run = workflow_run(fixture, requirement)
        api = FakeApi(fixture, run=run, jobs=[job(), gate(requirement["gate"])])
        result = run_dependency_recovery(
            api,
            "workflow_run",
            {"workflow_run": {"pull_requests": [{"number": 41}], "head_branch": fixture["pull"]["head"]["ref"]}},
            GOVERNANCE,
            RECOVERY,
            True,
            lambda _api, _job_id: logs(failed="npm error code EAI_AGAIN"),
        )
        self.assertEqual(api.reruns, [run["id"]])
        assert isinstance(result, dict)
        self.assertEqual(result["actions"][0]["state"], "rerun-requested")
        self.assertEqual(result["scope"]["mergePolicy"], "manual")

    def test_stale_head_waits_for_native_dependabot_auto_rebase(self) -> None:
        fixture = canonical_fixture()
        requirement = GOVERNANCE["requiredWorkflows"][0]
        run = workflow_run(fixture, requirement)
        api = FakeApi(
            fixture,
            run=run,
            jobs=[job(), gate(requirement["gate"])],
            base_sha="c" * 40,
        )
        result = run_dependency_recovery(
            api,
            "workflow_run",
            {"workflow_run": {"pull_requests": [{"number": 41}]}},
            GOVERNANCE,
            RECOVERY,
            True,
            lambda _api, _job_id: logs(failed="EAI_AGAIN"),
        )
        self.assertEqual(api.reruns, [])
        assert isinstance(result, dict)
        self.assertIn("auto-rebase", result["reason"])

    def test_dry_run_reports_safe_action_without_mutating_actions(self) -> None:
        fixture = canonical_fixture()
        requirement = GOVERNANCE["requiredWorkflows"][0]
        run = workflow_run(fixture, requirement)
        api = FakeApi(fixture, run=run, jobs=[job(), gate(requirement["gate"])])
        result = run_dependency_recovery(
            api,
            "workflow_run",
            {"workflow_run": {"pull_requests": [{"number": 41}]}},
            GOVERNANCE,
            RECOVERY,
            False,
            lambda _api, _job_id: logs(failed="EAI_AGAIN"),
        )
        self.assertEqual(api.reruns, [])
        assert isinstance(result, dict)
        self.assertEqual(result["actions"][0]["state"], "dry-run")

    def test_native_rebase_and_recovery_wiring_are_self_tested_control_plane(self) -> None:
        dependabot = (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
        ecosystems = re.findall(r"^\s*-\s+package-ecosystem:", dependabot, flags=re.M)
        rebases = re.findall(r"^\s*rebase-strategy:\s*auto\s*$", dependabot, flags=re.M)
        self.assertGreater(len(ecosystems), 0)
        self.assertEqual(len(rebases), len(ecosystems))

        workflow = (ROOT / ".github" / "workflows" / "dependency-governance.yml").read_text(encoding="utf-8")
        for path in (
            ".github/dependabot.yml",
            ".github/dependency-recovery.json",
            ".github/scripts/dependency_recovery.py",
            ".github/scripts/dependency_recovery_selfcheck.py",
        ):
            self.assertIn(path, workflow, path)
            self.assertIn(path, GOVERNANCE["manualReviewPaths"], path)
        self.assertIn("dependency_recovery.py", workflow)
        self.assertIn("ALLOW_RERUN", workflow)

    def test_recovery_controller_has_no_merge_or_branch_mutation_transport(self) -> None:
        source = (SCRIPT_DIR / "dependency_recovery.py").read_text(encoding="utf-8")
        self.assertNotIn("/merges", source)
        self.assertNotIn("api.patch(", source)
        self.assertNotIn("api.put(", source)
        self.assertNotIn("update-branch", source)
        self.assertEqual(GOVERNANCE["ecosystems"]["npm"]["mode"], "manual")


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RecoverySelfCheck)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
