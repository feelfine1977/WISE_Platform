"""Tuple translation is confined to a copied TypeScript generation view."""

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

from jsonschema import Draft7Validator, FormatChecker

from test_incident_time_contracts import ROOT, read, validator


def view_of(source):
    spec = importlib.util.spec_from_file_location("import_generation", ROOT / "tools/import_contract_generation_view.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.generation_view(source)


def test_only_four_array_representations_change_in_an_independent_copy():
    source = json.loads((ROOT / "contracts/import.schema.json").read_text(encoding="utf-8"))
    before = deepcopy(source)
    view = view_of(source)
    for kind in ("Utc", "Wall"):
        for size in ("Singleton", "Multirow"):
            name = f"Known{kind}{size}IncidentTime"
            original = source["$defs"][name]["properties"]["records"]
            translated = view["$defs"][name]["properties"]["records"]
            positions = [original["prefixItems"][0]]
            if size == "Multirow":
                positions.append(original["items"])
            assert translated == {key: value for key, value in original.items() if key not in ("prefixItems", "items")} | {
                "items": positions, "additionalItems": original["items"]}
            view["$defs"][name]["properties"]["records"] = deepcopy(original)
    assert view == source == before


def test_source_and_tuple_view_agree_on_every_complete_corpus_body():
    source = json.loads((ROOT / "contracts/import.schema.json").read_text(encoding="utf-8"))
    check_source = validator(source)
    check_view = Draft7Validator(view_of(source), format_checker=FormatChecker())
    for case in read("validation-corpus.json"):
        assert check_view.is_valid(case["body"]) is check_source.is_valid(case["body"]), case["name"]


def test_fresh_generated_import_mirrors_match_committed_bytes(tmp_path):
    python_output = tmp_path / "imports.py"
    subprocess.run([sys.executable, "-m", "datamodel_code_generator", "--input", "contracts/import.schema.json",
                    "--input-file-type", "jsonschema", "--output-model-type", "pydantic_v2.BaseModel",
                    "--target-python-version", "3.11", "--enum-field-as-literal", "all", "--disable-timestamp",
                    "--formatters", "black", "isort", "--output", str(python_output)], cwd=ROOT, check=True,
                   capture_output=True, text=True)
    assert python_output.read_bytes() == (ROOT / "apps/api/src/wise_platform_api/generated/imports.py").read_bytes()
    view = subprocess.run([sys.executable, "tools/import_contract_generation_view.py"], cwd=ROOT,
                          check=True, capture_output=True, text=True, encoding="utf-8").stdout
    ts_output = tmp_path / "imports.ts"
    subprocess.run(["node", "node_modules/json-schema-to-typescript/dist/src/cli.js", "--output", str(ts_output)],
                   input=view, cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")
    assert ts_output.read_bytes() == (ROOT / "apps/web/src/generated/imports.ts").read_bytes()
