"""#29: the first supported capacity tier of the incident journey.

The measurement itself is tools/qualify_incident_capacity.py, recorded in docs/capacity.md. Here: the service says the
memory it may use, which the Data area shows beside the measured tier; the byte budget, not a count of entries, bounds the
work admitted; and the measured tier the browser states is the one the documentation records.
"""

from pathlib import Path
import re

from fastapi.testclient import TestClient

from wise_platform_api.app import create_app

ROOT = Path(__file__).resolve().parents[1]


def test_the_service_says_the_memory_it_may_use(tmp_path, monkeypatch):
    monkeypatch.setenv("WISE_MEMORY_BUDGET_BYTES", str(3 * 1024 ** 3))
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        assert client.get("/api/health").json() == {"status": "ok", "stage": "foundation", "version": client.get("/api/health").json()["version"], "memory_budget_bytes": 3 * 1024 ** 3}


def test_the_tier_the_browser_states_is_the_one_documented():
    note = (ROOT / "apps/web/src/data/CapacityNote.tsx").read_text(encoding="utf-8")
    capacity = (ROOT / "docs/capacity.md").read_text(encoding="utf-8")
    incidents, records = re.search(r"incidents: ([\d_]+),\s+records: ([\d_]+),", note).groups()
    assert f"{int(incidents.replace('_', '')):,}" in capacity and f"{int(records.replace('_', '')):,}" in capacity
    assert "python tools/qualify_incident_capacity.py" in capacity
