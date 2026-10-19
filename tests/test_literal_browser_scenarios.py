"""Every literal browser scenario imports its literal and saves its pipeline over public HTTP.

The built-browser half of tools/qualify_literal_browser.py needs Chrome and runs locally; this keeps each
scenario's HTTP setup working in every test run.
"""

from pathlib import Path
import sys

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "apps/api/tests"), str(ROOT / "packages/analytics/tests")]

import literal_scenarios  # noqa: E402
from wise_platform_api.app import create_app  # noqa: E402


@pytest.mark.parametrize("name", sorted(literal_scenarios.SCENARIOS))
def test_scenario_saves_its_reviewed_pipeline(name, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        scenario = literal_scenarios.SCENARIOS[name](client, workspace)
    assert scenario["texts"] and scenario["name"] == scenario["saved"]["revision"]["content"]["name"]
    operations = [output["operation"] for output in scenario["saved"]["bpic19_outputs"]["outputs"]]
    assert operations[0] == "bpic19_profile" and len(operations) >= 1
