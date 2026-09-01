from pathlib import Path
import re

path = Path('README.md')
text = path.read_text(encoding='utf-8')
marker = '## Dependency maintenance\n'
section = '''## Confidence boundaries

The repository separates **collection behavior**, **runner policy**, **target ownership**, and **retained evidence** so a successful Newman process is not overstated as universal API correctness.

| Signal | Confidence gained | Deliberate limit |
| --- | --- | --- |
| Postman collection assertions | Request construction, variable resolution at the collection layer, response semantics, and stateful create/read behavior are executable through the native collection model | Collection assertions do not prove runner preflight, process control, artifact integrity, or deployed infrastructure |
| Newman runner policy | Environment precedence, bounded execution, timeout/process handling, correlation, and reporter/evidence behavior are governed outside the collection | Runner correctness does not make an incorrect collection assertion meaningful |
| Repository-owned HTTP fixture | Required CI exercises real local HTTP serialization without public DNS, third-party uptime, rate limits, or mutable content | It does not prove deployed TLS, ingress, identity, production data, or external-service dependencies |
| Data-driven cases | The represented input partitions remain executable through one governed request/assertion path | A data file is not proof of exhaustive domain coverage; partitions still require risk-based design |
| Preflight validation | Missing/unsafe inputs, malformed assets, and invalid target policy fail before network execution | Preflight proves configuration admissibility, not target availability or business correctness |
| JUnit + sanitized execution manifest | CI can reconcile process outcome, executed items, target attribution, and bounded evidence without relying on file presence alone | Reporter output is secondary evidence; native Newman exit status and semantic validation remain authoritative |
| Explicit deployed target | The same governed runner can exercise an approved environment without redefining deterministic repository health | An environment run mixes service, network, identity, and data risks and must be interpreted separately |
| CodeQL / npm Audit / Trivy / dependency review | Independent controls inspect source, advisory, repository, configuration/secret, and change-diff surfaces | Green scanners are scoped evidence rather than proof of vulnerability absence |

Keep assertions where their semantics naturally belong: collection-level protocol/business checks stay visible in Postman, while orchestration, target authorization, process lifecycle, and evidence integrity stay in the runner. Avoid duplicating the same policy in both places.

'''
if '## Confidence boundaries\n' not in text:
    if marker not in text:
        raise SystemExit('Dependency maintenance marker missing')
    text = text.replace(marker, section + marker)
path.write_text(text, encoding='utf-8')

patterns = [
    re.compile(r'\bNode(?:\.js)?\s+\d', re.I),
    re.compile(r'\bPostman\s+v?\d', re.I),
    re.compile(r'\bNewman\s+v?\d', re.I),
    re.compile(r'\bCollection\s+v?\d+(?:\.\d+)?', re.I),
    re.compile(r'\bnpm\s+v?\d', re.I),
]
candidates = []
for md in [Path('README.md'), *Path('docs').rglob('*.md')]:
    for number, line in enumerate(md.read_text(encoding='utf-8').splitlines(), 1):
        if any(pattern.search(line) for pattern in patterns):
            candidates.append(f'{md}:{number}: {line}')
if candidates:
    raise SystemExit('Residual Postman/Newman version candidates:\n' + '\n'.join(candidates))
