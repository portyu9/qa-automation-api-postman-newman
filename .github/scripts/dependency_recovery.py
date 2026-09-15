#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from dependency_governance import (
    GitHubApi,
    GovernanceError,
    classify_ecosystem,
    load_config,
    select_qualification_run,
    validate_provenance,
    validate_signed_metadata,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RECOVERY_CONFIG = ROOT / ".github" / "dependency-recovery.json"
LOG_TIMESTAMP = re.compile(
    r"^\ufeff?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s"
)
TERMINAL_NONBLOCKING_CONCLUSIONS = {"success", "skipped"}

TRANSIENT_SIGNATURES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("dns-eai-again", re.compile(r"\bEAI_AGAIN\b", re.I)),
    ("connection-reset", re.compile(r"\bECONNRESET\b", re.I)),
    ("connection-timeout", re.compile(r"\bETIMEDOUT\b", re.I)),
    ("socket-timeout", re.compile(r"\bERR_SOCKET_TIMEOUT\b", re.I)),
    ("network-unreachable", re.compile(r"\bENETUNREACH\b", re.I)),
    ("host-unreachable", re.compile(r"\bEHOSTUNREACH\b", re.I)),
    ("socket-hang-up", re.compile(r"\bsocket hang up\b", re.I)),
    (
        "http-5xx",
        re.compile(
            r"(?:server returned code|status(?: code)?|HTTP(?:/\d(?:\.\d)?)?)"
            r"\s*[:=]?\s*(?:502|503|504)\b",
            re.I,
        ),
    ),
    (
        "gateway-service-outage",
        re.compile(r"\b(?:502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout)\b", re.I),
    ),
    (
        "tls-transient",
        re.compile(
            r"\bTLS\b.*\b(?:handshake|connection)\b.*"
            r"\b(?:timeout|timed out|unexpected EOF)\b",
            re.I,
        ),
    ),
)

NON_TRANSIENT_SIGNATURES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("npm-resolution", re.compile(r"\b(?:ERESOLVE|ELSPROBLEMS|EBADENGINE|EUSAGE)\b", re.I)),
    ("npm-no-matching-version", re.compile(r"\bNo matching version found\b", re.I)),
    (
        "npm-lock-mismatch",
        re.compile(r"(?:package\.json.*package-lock\.json.*not in sync|npm ci.*lock(?:file)?)", re.I | re.S),
    ),
    (
        "http-client-or-policy",
        re.compile(
            r"(?:server returned code|status(?: code)?|HTTP(?:/\d(?:\.\d)?)?)"
            r"\s*[:=]?\s*(?:400|401|403|404|409|422|429)\b",
            re.I,
        ),
    ),
    ("permission-denied", re.compile(r"\b(?:EACCES|EPERM)\b", re.I)),
    ("disk-space", re.compile(r"\bENOSPC\b", re.I)),
)

NEVER_RECOVER_STEPS = {
    "Validate immutable workflow dependencies",
    "Validate assets, runtime, fixture, and evidence policy",
    "Execute collection against runner-owned local API",
    "Validate governed semantic Newman evidence",
    "Execute full data-driven collection against runner-owned local API",
    "Validate governed data-driven Newman evidence",
    "Test governed npm advisory policy",
    "Audit HIGH and CRITICAL npm advisories with governed exceptions",
    "Scan npm dev dependencies, configuration, and repository secrets",
    "Require attributed repository security evidence",
    "Review dependency changes",
    "Initialize CodeQL",
    "Analyze",
    "Evaluate required runtime matrix",
    "Evaluate data-driven contract",
    "Evaluate security jobs",
}


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def load_recovery_config(path: Path | None = None) -> dict[str, Any]:
    config_path = path or Path(os.environ.get("RECOVERY_CONFIG", DEFAULT_RECOVERY_CONFIG))
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GovernanceError(f"unable to read recovery config {config_path}: {exc}") from exc
    errors = validate_recovery_config(config)
    if errors:
        raise GovernanceError("invalid dependency recovery config:\n- " + "\n- ".join(errors))
    return config


def validate_recovery_config(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if config.get("schemaVersion") != 1:
        errors.append("schemaVersion must equal 1")
    if not isinstance(config.get("enabled"), bool):
        errors.append("enabled must be boolean")
    attempts = config.get("maxRunAttempts")
    if not isinstance(attempts, int) or not 1 <= attempts <= 3:
        errors.append("maxRunAttempts must be an integer from 1 to 3")
    steps = config.get("transientSteps")
    if not isinstance(steps, list) or not steps:
        errors.append("transientSteps must be a non-empty array")
    else:
        if any(not isinstance(step, str) or not step.strip() for step in steps):
            errors.append("every transientSteps entry must be a non-empty string")
        if len(set(steps)) != len(steps):
            errors.append("transientSteps must not contain duplicates")
        for forbidden in sorted(NEVER_RECOVER_STEPS):
            if forbidden in steps:
                errors.append(f"{forbidden} must never be eligible for automatic recovery")
    return unique(errors)


def matching_transient_signatures(logs: str) -> list[str]:
    return [name for name, pattern in TRANSIENT_SIGNATURES if pattern.search(str(logs or ""))]


def matching_non_transient_signatures(logs: str) -> list[str]:
    return [name for name, pattern in NON_TRANSIENT_SIGNATURES if pattern.search(str(logs or ""))]


def extract_step_log_window(logs: str, step: dict[str, Any]) -> str | None:
    started = _parse_timestamp(step.get("started_at"))
    completed = _parse_timestamp(step.get("completed_at"))
    if started is None or completed is None or completed < started:
        return None
    selected: list[str] = []
    for line in str(logs or "").splitlines():
        match = LOG_TIMESTAMP.match(line)
        if not match:
            continue
        timestamp = _parse_timestamp(match.group(1))
        if timestamp is not None and started <= timestamp <= completed:
            selected.append(line)
    return "\n".join(selected) if selected else None


def classify_leaf_job_failure(
    job: dict[str, Any], logs: str, recovery_config: dict[str, Any]
) -> dict[str, Any]:
    if job.get("conclusion") != "failure":
        return {"transient": False, "reason": "job conclusion is not failure", "signatures": []}
    failed_steps = [step for step in (job.get("steps") or []) if step.get("conclusion") == "failure"]
    if len(failed_steps) != 1:
        return {
            "transient": False,
            "reason": f"expected exactly one failed step, found {len(failed_steps)}",
            "signatures": [],
        }
    failed_step = failed_steps[0]
    name = str(failed_step.get("name") or "")
    if name not in recovery_config["transientSteps"]:
        return {
            "transient": False,
            "reason": f"failed step is not allowlisted for transient recovery: {name}",
            "signatures": [],
            "failedStep": name,
        }
    step_logs = extract_step_log_window(logs, failed_step)
    if step_logs is None:
        return {
            "transient": False,
            "reason": f"failed step has no attributable timestamp-bounded log window: {name}",
            "signatures": [],
            "failedStep": name,
        }
    blockers = matching_non_transient_signatures(step_logs)
    if blockers:
        return {
            "transient": False,
            "reason": "failed step contains deterministic or policy-blocking evidence: "
            + ", ".join(blockers),
            "signatures": [],
            "blockers": blockers,
            "failedStep": name,
        }
    signatures = matching_transient_signatures(step_logs)
    if not signatures:
        return {
            "transient": False,
            "reason": "allowlisted infrastructure step has no proven transient network/service "
            f"signature in its own log window: {name}",
            "signatures": [],
            "failedStep": name,
        }
    return {
        "transient": True,
        "reason": f"proven transient infrastructure failure in {name}",
        "signatures": signatures,
        "failedStep": name,
    }


def classify_run_failure(
    run: dict[str, Any],
    jobs: list[dict[str, Any]],
    logs_by_job_id: dict[int, str],
    gate_name: str,
    recovery_config: dict[str, Any],
) -> dict[str, Any]:
    if run.get("status") != "completed" or run.get("conclusion") != "failure":
        return {"rerunnable": False, "reason": "workflow run is not a completed failure", "failures": []}
    attempt = int(run.get("run_attempt") or 1)
    if attempt >= recovery_config["maxRunAttempts"]:
        return {
            "rerunnable": False,
            "reason": f"workflow run attempt {attempt} reached recovery cap {recovery_config['maxRunAttempts']}",
            "failures": [],
        }
    gates = [job for job in jobs if job.get("name") == gate_name]
    if len(gates) != 1 or gates[0].get("conclusion") != "failure":
        return {
            "rerunnable": False,
            "reason": "stable aggregate gate is missing, duplicated, or not a completed failure",
            "failures": [],
        }
    leaves = [job for job in jobs if job.get("name") != gate_name]
    ambiguous = [
        job
        for job in leaves
        if job.get("conclusion") != "failure"
        and job.get("conclusion") not in TERMINAL_NONBLOCKING_CONCLUSIONS
    ]
    if ambiguous:
        states = ", ".join(
            f"{job.get('name')}={job.get('conclusion') or 'unknown'}" for job in ambiguous
        )
        return {
            "rerunnable": False,
            "reason": f"leaf job has ambiguous terminal state: {states}",
            "failures": [],
        }
    failed = [job for job in leaves if job.get("conclusion") == "failure"]
    if not failed:
        return {
            "rerunnable": False,
            "reason": "no failed leaf job exists beneath the stable aggregate gate",
            "failures": [],
        }
    failures = []
    for job in failed:
        job_id = int(job["id"])
        classification = classify_leaf_job_failure(job, logs_by_job_id.get(job_id, ""), recovery_config)
        failures.append({"jobId": job_id, "jobName": job.get("name"), **classification})
    if any(item.get("transient") is not True for item in failures):
        return {
            "rerunnable": False,
            "reason": "at least one failed leaf job is deterministic or ambiguous",
            "failures": failures,
        }
    return {
        "rerunnable": True,
        "reason": "every failed leaf job is a proven transient infrastructure failure",
        "failures": failures,
    }


def recovery_scope_assessment(
    pull: dict[str, Any],
    files: list[dict[str, Any]],
    provenance: dict[str, Any],
    metadata: dict[str, Any],
    governance_config: dict[str, Any],
) -> dict[str, Any]:
    reasons: list[str] = []
    if not provenance.get("eligible"):
        reasons.extend(provenance.get("reasons") or [])
    if not metadata.get("eligible"):
        reasons.extend(metadata.get("reasons") or [])
    if pull.get("changed_files") != len(files):
        reasons.append(
            f"GitHub reports {pull.get('changed_files')} changed files but {len(files)} were enumerated"
        )
    if len(files) > governance_config["maxChangedFiles"]:
        reasons.append(
            f"PR changes {len(files)} files, exceeding recovery limit {governance_config['maxChangedFiles']}"
        )
    protected = [
        str(file.get("filename"))
        for file in files
        if file.get("filename") in governance_config["manualReviewPaths"]
    ]
    if protected:
        reasons.append("recovery is disabled for control-plane path(s): " + ", ".join(protected))
    ecosystem = classify_ecosystem(files, governance_config)
    if ecosystem == "unknown":
        reasons.append("changed-file set does not map to one governed dependency ecosystem")
    if ecosystem == "github-actions":
        for item in metadata.get("metadata") or []:
            update_type = item.get("updateType")
            if update_type not in governance_config["allowedActionUpdateTypes"]:
                reasons.append(
                    f"{item.get('name') or 'action'} uses non-routine update type {update_type or 'unknown'}"
                )
    merge_policy = "manual" if ecosystem == "npm" else "governed-autonomous"
    return {
        "eligible": not reasons,
        "reasons": unique(reasons),
        "ecosystem": ecosystem,
        "mergePolicy": merge_policy,
    }


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


def download_job_logs(api: GitHubApi, job_id: int) -> str:
    url = f"{api.root}/actions/jobs/{job_id}/logs"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {api.token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "dependency-recovery",
        },
    )
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=30) as response:
            payload = response.read()
            return payload.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code not in {301, 302, 303, 307, 308}:
            detail = exc.read().decode("utf-8", "replace")[:500]
            raise GovernanceError(f"unable to download logs for job {job_id}: {exc.code} {detail}") from exc
        location = exc.headers.get("Location")
        if not location:
            raise GovernanceError(f"job {job_id} log redirect did not include a location") from exc
    parsed = urllib.parse.urlparse(location)
    if parsed.scheme != "https" or not parsed.netloc:
        raise GovernanceError(f"job {job_id} log redirect is not an absolute HTTPS URL")
    # The redirect URL is a GitHub-issued, short-lived signed URL. Never forward GITHUB_TOKEN to it.
    unsigned_request = urllib.request.Request(location, headers={"User-Agent": "dependency-recovery"})
    try:
        with urllib.request.urlopen(unsigned_request, timeout=30) as response:
            return response.read().decode("utf-8", "replace")
    except OSError as exc:
        raise GovernanceError(f"unable to follow signed log redirect for job {job_id}: {exc}") from exc


def _current_base_sha(api: GitHubApi, branch: str) -> str:
    payload = api.get(f"/git/ref/heads/{urllib.parse.quote(branch, safe='')}")
    sha = ((payload or {}).get("object") or {}).get("sha")
    if not sha:
        raise GovernanceError(f"unable to resolve base branch {branch}")
    return str(sha)


def _pull_files(api: GitHubApi, pull: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    reported = pull.get("changed_files")
    if isinstance(reported, int) and reported > config["maxChangedFiles"]:
        raise GovernanceError(f"PR changes {reported} files; refusing oversized recovery input")
    files = api.paginate(f"/pulls/{pull['number']}/files")
    return files


def _pull_commits(api: GitHubApi, pull: dict[str, Any]) -> list[dict[str, Any]]:
    reported = pull.get("commits")
    if isinstance(reported, int) and reported > 100:
        raise GovernanceError(f"PR contains {reported} commits; refusing oversized recovery history")
    return api.paginate(f"/pulls/{pull['number']}/commits")


def _qualification_runs(
    api: GitHubApi, pull: dict[str, Any], config: dict[str, Any]
) -> list[tuple[dict[str, str], dict[str, Any] | None]]:
    query = urllib.parse.urlencode({"head_sha": (pull.get("head") or {}).get("sha"), "event": "pull_request"})
    runs = api.paginate(f"/actions/runs?{query}", "workflow_runs")
    return [
        (requirement, select_qualification_run(runs, pull, requirement))
        for requirement in config["requiredWorkflows"]
    ]


def _classify_requirement_failure(
    api: GitHubApi,
    requirement: dict[str, str],
    run: dict[str, Any],
    recovery_config: dict[str, Any],
    log_loader: Callable[[GitHubApi, int], str],
) -> dict[str, Any]:
    jobs = api.paginate(f"/actions/runs/{run['id']}/jobs", "jobs")
    failed_leaves = [
        job for job in jobs if job.get("conclusion") == "failure" and job.get("name") != requirement["gate"]
    ]
    logs_by_job_id: dict[int, str] = {}
    for job in failed_leaves:
        job_id = int(job["id"])
        try:
            logs_by_job_id[job_id] = log_loader(api, job_id)
        except Exception:
            # Missing or ambiguous log evidence must fail closed, not convert into a retry.
            logs_by_job_id[job_id] = ""
    return {
        "workflow": requirement["workflow"],
        "runId": run["id"],
        **classify_run_failure(run, jobs, logs_by_job_id, requirement["gate"], recovery_config),
    }


def _rerun_failed_jobs(api: GitHubApi, run_id: int) -> str:
    try:
        api.post(f"/actions/runs/{run_id}/rerun-failed-jobs", {})
        return "rerun-requested"
    except GovernanceError as exc:
        if "(409)" in str(exc):
            return "already-running"
        raise


def recover_pull(
    api: GitHubApi,
    number: int,
    governance_config: dict[str, Any],
    recovery_config: dict[str, Any],
    allow_rerun: bool,
    log_loader: Callable[[GitHubApi, int], str] = download_job_logs,
) -> dict[str, Any]:
    pull = api.get(f"/pulls/{number}")
    user = pull.get("user") or {}
    if user.get("login") != governance_config["botLogin"] or user.get("id") != governance_config["botUserId"]:
        return {"pr": number, "skipped": True, "reason": "not canonical Dependabot"}
    if pull.get("state") != "open":
        return {"pr": number, "skipped": True, "reason": f"pull request state is {pull.get('state')}"}

    base_sha = _current_base_sha(api, governance_config["baseBranch"])
    files = _pull_files(api, pull, governance_config)
    commits = _pull_commits(api, pull)
    provenance = validate_provenance(pull, commits, base_sha, governance_config)
    metadata = validate_signed_metadata(provenance.get("commit")) if provenance.get("commit") else {
        "eligible": False,
        "reasons": ["no single verified Dependabot commit"],
        "metadata": [],
    }
    scope = recovery_scope_assessment(pull, files, provenance, metadata, governance_config)

    if not recovery_config["enabled"]:
        return {"pr": number, "skipped": True, "reason": "recovery kill switch is disabled", "scope": scope}
    if not scope["eligible"]:
        stale_only = provenance.get("reasons") == ["PR is not rebased directly on the current base branch head"]
        return {
            "pr": number,
            "skipped": True,
            "reason": (
                "waiting for Dependabot native auto-rebase; controller never mutates Dependabot branches"
                if stale_only
                else "recovery scope is not eligible"
            ),
            "scope": scope,
        }

    failures: list[dict[str, Any]] = []
    for requirement, run in _qualification_runs(api, pull, governance_config):
        if run and run.get("status") == "completed" and run.get("conclusion") == "failure":
            failures.append(
                _classify_requirement_failure(api, requirement, run, recovery_config, log_loader)
            )

    actions: list[dict[str, Any]] = []
    for failure in failures:
        if not failure.get("rerunnable"):
            continue
        state = "dry-run" if not allow_rerun else _rerun_failed_jobs(api, int(failure["runId"]))
        actions.append(
            {
                "workflow": failure["workflow"],
                "runId": failure["runId"],
                "state": state,
                "reason": failure["reason"],
                "failures": [
                    {
                        "job": item.get("jobName"),
                        "step": item.get("failedStep"),
                        "signatures": item.get("signatures") or [],
                    }
                    for item in failure.get("failures") or []
                ],
            }
        )
    return {
        "pr": number,
        "skipped": False,
        "head": (pull.get("head") or {}).get("sha"),
        "scope": scope,
        "failures": failures,
        "actions": actions,
    }


def _resolve_pull_number(
    api: GitHubApi, event_name: str, payload: dict[str, Any]
) -> int | None:
    if event_name in {"pull_request_target", "pull_request"}:
        number = ((payload.get("pull_request") or {}).get("number"))
        return int(number) if number else None
    if event_name == "workflow_run":
        workflow_run = payload.get("workflow_run") or {}
        associations = workflow_run.get("pull_requests") or []
        if associations and associations[0].get("number"):
            return int(associations[0]["number"])
        branch = workflow_run.get("head_branch")
        if not branch:
            return None
        query = urllib.parse.urlencode({"state": "open", "head": f"{api.owner}:{branch}"})
        pulls = api.paginate(f"/pulls?{query}")
        return int(pulls[0]["number"]) if len(pulls) == 1 else None
    if event_name == "workflow_dispatch":
        value = (payload.get("inputs") or {}).get("pr-number")
        if value is None or str(value).strip() == "":
            return None
        text = str(value).strip()
        if not re.fullmatch(r"[1-9]\d*", text):
            raise GovernanceError("pr-number must be a positive integer")
        return int(text)
    return None


def run_dependency_recovery(
    api: GitHubApi,
    event_name: str,
    payload: dict[str, Any],
    governance_config: dict[str, Any],
    recovery_config: dict[str, Any],
    allow_rerun: bool,
    log_loader: Callable[[GitHubApi, int], str] = download_job_logs,
) -> list[dict[str, Any]] | dict[str, Any] | None:
    if event_name == "schedule":
        pulls = api.paginate("/pulls?state=open")
        results: list[dict[str, Any]] = []
        for pull in pulls:
            user = pull.get("user") or {}
            if user.get("login") != governance_config["botLogin"] or user.get("id") != governance_config["botUserId"]:
                continue
            try:
                results.append(
                    recover_pull(
                        api,
                        int(pull["number"]),
                        governance_config,
                        recovery_config,
                        allow_rerun,
                        log_loader,
                    )
                )
            except Exception as exc:
                results.append({"pr": pull.get("number"), "error": str(exc)})
        if any("error" in item for item in results):
            raise GovernanceError("scheduled dependency recovery encountered one or more controller errors")
        return results

    number = _resolve_pull_number(api, event_name, payload)
    if number is None:
        return None
    return recover_pull(
        api,
        number,
        governance_config,
        recovery_config,
        allow_rerun,
        log_loader,
    )


def main() -> int:
    governance_config = load_config()
    recovery_config = load_recovery_config()
    token = os.environ.get("GITHUB_TOKEN", "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    event_path = os.environ.get("GITHUB_EVENT_PATH", "")
    if not event_name or not event_path:
        raise GovernanceError("GITHUB_EVENT_NAME and GITHUB_EVENT_PATH are required")
    try:
        payload = json.loads(Path(event_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GovernanceError(f"unable to read GitHub event payload: {exc}") from exc
    api = GitHubApi(token, repository, governance_config["maxPaginationPages"])
    allow_rerun = os.environ.get("ALLOW_RERUN", "false").strip().lower() == "true"
    result = run_dependency_recovery(
        api,
        event_name,
        payload,
        governance_config,
        recovery_config,
        allow_rerun,
    )
    print(json.dumps({"recovery": result}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GovernanceError as exc:
        print(f"dependency recovery failed: {exc}", file=os.sys.stderr)
        raise SystemExit(1) from exc
