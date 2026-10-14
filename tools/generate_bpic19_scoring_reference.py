"""Generate the browser's review-only definition catalogue from the actual binding.

Run with PYTHONPATH=apps/api/src:packages/analytics/src. This imports no source
notebook helpers and performs no measurement or scoring.
"""

import json
from pathlib import Path
from wise_platform_api.bpic19_method import CRITERIA_FAMILIES, _historical_binding, paper_norm_document

root = Path(__file__).resolve().parents[1]
reference = {
    "paper": {family: paper_norm_document(criteria_family=family) for family in CRITERIA_FAMILIES},
    "historical": _historical_binding()[0],
}
(root / "apps/web/src/bpic19/scoring-reference.json").write_text(
    json.dumps(reference, indent=2) + "\n", encoding="utf-8"
)
