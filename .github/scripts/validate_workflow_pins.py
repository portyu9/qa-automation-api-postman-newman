"""Fail when GitHub Actions workflows use mutable external action references."""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
USES_RE = re.compile(r"^\s*-?\s*uses:\s*([^\s#]+)", re.MULTILINE)
SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-fA-F]{64}$")


def main() -> int:
    errors: list[str] = []
    files = sorted([*WORKFLOWS.rglob("*.yml"), *WORKFLOWS.rglob("*.yaml")])
    if not files:
        print("workflow pin contract failed: no workflow files found")
        return 1
    for workflow in files:
        text = workflow.read_text(encoding="utf-8")
        for reference in USES_RE.findall(text):
            if reference.startswith("./"):
                continue
            if reference.startswith("docker://"):
                image = reference.removeprefix("docker://")
                if "@" not in image or not DIGEST_RE.fullmatch(image.rsplit("@", 1)[1]):
                    errors.append(f"{workflow.relative_to(ROOT)} uses unpinned Docker action {reference!r}")
                continue
            if "@" not in reference:
                errors.append(f"{workflow.relative_to(ROOT)} action is missing a ref: {reference!r}")
                continue
            _, ref = reference.rsplit("@", 1)
            if not SHA_RE.fullmatch(ref):
                errors.append(
                    f"{workflow.relative_to(ROOT)} uses mutable action ref {reference!r}; require a full 40-character commit SHA"
                )
    if errors:
        print("workflow pin contract failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"workflow pin contract: {len(files)} workflow files use immutable external references")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
