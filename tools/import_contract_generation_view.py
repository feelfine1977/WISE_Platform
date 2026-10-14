"""Translate extensible prefix arrays for TypeScript generation only."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path


def generation_view(source: dict) -> dict:
    """Copy the authority and express its four prefix arrays as Draft-07 tuples.

    Singleton tuples close after the first record. Multirow tuples require a
    first and following record, then keep the same following-record tail.
    All other source constraints stay in the view.
    """
    view = deepcopy(source)
    view["$schema"] = "http://json-schema.org/draft-07/schema#"
    for kind in ("Utc", "Wall"):
        for size in ("Singleton", "Multirow"):
            records = view["$defs"][f"Known{kind}{size}IncidentTime"]["properties"]["records"]
            positions = records.pop("prefixItems")
            following = records["items"]
            if len(positions) != 1 or records["minItems"] != (1 if size == "Singleton" else 2):
                raise ValueError("The diagnostic array no longer has the supported tuple shape.")
            if size == "Singleton":
                if following is not False or records.get("maxItems") != 1:
                    raise ValueError("A singleton diagnostic tuple must close after its first row.")
            else:
                if not isinstance(following, dict) or "maxItems" in records:
                    raise ValueError("A multirow diagnostic tuple must retain its following-row tail.")
                positions.append(deepcopy(following))
            records["items"] = positions
            records["additionalItems"] = following
    return view


if __name__ == "__main__":
    source_path = Path(__file__).resolve().parents[1] / "contracts/import.schema.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    print(json.dumps(generation_view(source), ensure_ascii=True))
