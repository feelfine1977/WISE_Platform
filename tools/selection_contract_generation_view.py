"""Keep nonempty selection arrays without generating 32 condition tuple variants."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import sys


def generation_view(source: dict) -> dict:
    """Relax only the TS representation of the bounded condition array.

    Authoritative JSON and Pydantic contracts still enforce the 32-condition
    limit. Keeping minItems preserves nonempty tuples for this predicate and
    all existing selectors; ignoring every array bound would weaken those.
    """
    view = deepcopy(source)
    conditions = view["$defs"]["RecordAttributesAll"]["properties"]["conditions"]
    if conditions.get("minItems") != 1 or conditions.get("maxItems") != 32:
        raise ValueError("The supported same-record condition bounds changed.")
    del conditions["maxItems"]
    return view


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"selection", "comparison", "saving"}:
        raise SystemExit("Choose selection, comparison or saving.")
    source_path = Path(__file__).resolve().parents[1] / f"contracts/{sys.argv[1]}.schema.json"
    print(json.dumps(generation_view(json.loads(source_path.read_text(encoding="utf-8")))))
