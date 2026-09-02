"""Validate repository README and workflow contracts without third-party dependencies."""
from __future__ import annotations
import json
import re
from html import unescape
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
README = ROOT / "README.md"
LOCAL_LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
WORKFLOW_BADGE_RE = re.compile(r"https://github\.com/[^/]+/[^/]+/actions/workflows/([^/]+)/badge\.svg")
STATIC_BADGE_RE = re.compile(r"https://img\.shields\.io/badge/[^\s)?]+-([0-9A-Fa-f]{6})(?:\?[^\s)]*)?")
SECURITY_BADGE_RE = re.compile(r"https://img\.shields\.io/badge/Security-Policy-([0-9A-Fa-f]{6})")
MERMAID_RE = re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL)
REPOSITORY_MAP_RE = re.compile(r"## Repository map\s*\n\s*```text\s*\n(.*?)```", re.DOTALL)
MERMAID_ROOTS = ("flowchart", "graph", "sequenceDiagram", "classDiagram", "stateDiagram", "erDiagram", "journey", "gantt", "pie", "mindmap", "timeline", "quadrantChart", "xychart")


def fail(message: str, errors: list[str]) -> None: errors.append(message)

def validate_local_links(text: str, errors: list[str]) -> None:
    for raw in LOCAL_LINK_RE.findall(text):
        destination = unescape(raw.strip())
        if destination.startswith("<") and destination.endswith(">"): destination = destination[1:-1]
        if not destination or destination.startswith("#"): continue
        if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", destination) or destination.startswith("//"): continue
        destination = destination.split("#", 1)[0].split("?", 1)[0]
        if not destination: continue
        candidate = (ROOT / unquote(destination)).resolve()
        if not candidate.is_relative_to(ROOT): fail(f"README local link escapes repository root: {raw}", errors)
        elif not candidate.exists(): fail(f"README local link target does not exist: {raw}", errors)

def validate_workflow_badges(text: str, errors: list[str]) -> None:
    for name in WORKFLOW_BADGE_RE.findall(text):
        if not (ROOT / ".github" / "workflows" / name).is_file(): fail(f"workflow badge target does not exist: {name}", errors)

def validate_badge_palette(text: str, errors: list[str]) -> None:
    colors = [c.upper() for c in STATIC_BADGE_RE.findall(text)]
    duplicates = sorted({c for c in colors if colors.count(c) > 1})
    if duplicates: fail("static Shields badge colors must be unique within README; duplicates: " + ", ".join(duplicates), errors)
    match = SECURITY_BADGE_RE.search(text)
    if match and match.group(1).upper() != "24292F": fail("Security Policy badge must use GitHub-dark color 24292F", errors)

def validate_mermaid(text: str, errors: list[str]) -> None:
    for index, block in enumerate(MERMAID_RE.findall(text), 1):
        lines = [line.strip() for line in block.splitlines() if line.strip() and not line.lstrip().startswith("%%")]
        if not lines: fail(f"Mermaid block {index} is empty", errors)
        elif not lines[0].startswith(MERMAID_ROOTS): fail(f"Mermaid block {index} does not start with a recognized diagram declaration: {lines[0]!r}", errors)

def validate_repository_map(text: str, errors: list[str]) -> None:
    match = REPOSITORY_MAP_RE.search(text)
    if not match:
        fail("README must contain a fenced `## Repository map` directory tree", errors)
        return
    entries = 0
    for raw_line in match.group(1).splitlines():
        if not raw_line.strip() or raw_line.strip() == ".": continue
        entry = re.sub(r"^[\s│├└─]+", "", raw_line).strip()
        if not entry: continue
        entries += 1
        if not entry.endswith("/"):
            fail(f"README repository map must contain directories only; found non-directory entry: {entry}", errors)
    if entries == 0: fail("README repository map is empty", errors)

def validate_unfiltered_pull_request(workflow_name: str, errors: list[str]) -> None:
    workflow = ROOT / ".github" / "workflows" / workflow_name
    lines = workflow.read_text(encoding="utf-8").splitlines()
    try:
        index = lines.index("  pull_request:")
    except ValueError:
        fail(f"{workflow_name} must emit its aggregate gate on every pull request", errors)
        return
    for line in lines[index + 1:]:
        if line and not line.startswith(" "):
            break
        if re.match(r"^  [A-Za-z0-9_-]+:\s*$", line):
            break
        if re.match(r"^\s{4}(?:paths|paths-ignore):", line):
            fail(f"{workflow_name} pull_request trigger must not be path-filtered", errors)
            break

def validate_security_configuration(errors: list[str]) -> None:
    config = ROOT / "trivy.yaml"
    if not config.is_file():
        fail("trivy.yaml is required to make npm dev-dependency coverage explicit", errors)
        return
    config_text = config.read_text(encoding="utf-8")
    if not re.search(r"(?m)^pkg:\s*$", config_text) or not re.search(r"(?m)^\s{2}include-dev-deps:\s*true\s*$", config_text):
        fail("trivy.yaml must enable pkg.include-dev-deps", errors)
    security = (ROOT / ".github" / "workflows" / "security.yml").read_text(encoding="utf-8")
    for required in ("trivy-config: trivy.yaml", "list-all-pkgs: true", "npm audit --audit-level=high --json"):
        if required not in security: fail(f"security workflow is missing required dependency evidence contract: {required}", errors)

def validate_external_target_docs(text: str, errors: list[str]) -> None:
    authorized_command = "NEWMAN_BASE_URL=https://staging.example.test NEWMAN_ALLOW_EXTERNAL_TARGET=true npm test"
    if authorized_command not in text:
        fail("README must show the explicit deployed-target command with NEWMAN_ALLOW_EXTERNAL_TARGET=true", errors)
    if "`NEWMAN_ALLOW_EXTERNAL_TARGET`" not in text:
        fail("README runtime input reference must document NEWMAN_ALLOW_EXTERNAL_TARGET", errors)
    if not re.search(r"(?i)external[^\n]{0,180}(?:explicit|exact)[^\n]{0,120}(?:authorization|opt-in|true)", text):
        fail("README must explain that non-local execution requires explicit external-target authorization", errors)
    for line in text.splitlines():
        if "NEWMAN_BASE_URL=" in line and "npm test" in line and "NEWMAN_ALLOW_EXTERNAL_TARGET=true" not in line:
            fail("README must not show an external Newman command without the explicit authorization variable", errors)

    runtime = (ROOT / "scripts" / "runtime.js").read_text(encoding="utf-8")
    selftest = (ROOT / "scripts" / "runtime.selftest.js").read_text(encoding="utf-8")
    runner = (ROOT / "scripts" / "run-newman.js").read_text(encoding="utf-8")
    evidence = (ROOT / "scripts" / "validate-evidence.js").read_text(encoding="utf-8")
    for surface, source, required in (
        ("runtime policy", runtime, "function targetPolicy("),
        ("runtime policy", runtime, "NEWMAN_ALLOW_EXTERNAL_TARGET"),
        ("runtime self-test", selftest, "targetPolicy('https://staging.example.test'"),
        ("runner", runner, "targetPolicy("),
        ("evidence validator", evidence, "externalTargetAuthorized"),
    ):
        if required not in source:
            fail(f"{surface} is missing external-target authorization contract: {required}", errors)

def validate_toolchain_and_gates(text: str, errors: list[str]) -> None:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if not str(package.get("packageManager", "")).startswith("npm@"):
        fail("package.json must declare the repository-owned npm package manager", errors)
    if "npm" not in text:
        fail("README must document npm without duplicating its numeric version", errors)
    workflow_text = "\n".join(
        p.read_text(encoding="utf-8") for p in (ROOT / ".github" / "workflows").glob("*.yml")
    )
    for gate in ("ci-gate", "extended-gate", "security-gate"):
        if f"name: {gate}" not in workflow_text:
            fail(f"stable aggregate status is missing from workflows: {gate}", errors)
    for workflow_name in ("ci.yml", "extended.yml", "security.yml"):
        validate_unfiltered_pull_request(workflow_name, errors)
    validate_security_configuration(errors)

def main() -> int:
    errors: list[str] = []
    if not README.is_file(): print("README contract failed: README.md is missing"); return 1
    for required in (ROOT / "LICENSE", ROOT / ".github" / "SECURITY.md"):
        if not required.is_file(): fail(f"required repository surface is missing: {required.relative_to(ROOT)}", errors)
    text = README.read_text(encoding="utf-8")
    validate_local_links(text, errors); validate_workflow_badges(text, errors); validate_badge_palette(text, errors); validate_mermaid(text, errors); validate_repository_map(text, errors); validate_external_target_docs(text, errors); validate_toolchain_and_gates(text, errors)
    if errors:
        print("README contract failed:")
        for error in errors: print(f"- {error}")
        return 1
    print("README contract: links, badges, diagrams, directory-only map, external-target authorization, dependency security, and stable gates are consistent"); return 0


if __name__ == "__main__": raise SystemExit(main())
