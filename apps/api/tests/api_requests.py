"""Requests and checks shared by the API tests."""

import json
from copy import deepcopy
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "tests" / "fixtures" / "incidents"
SCHEMA = json.loads((ROOT / "contracts" / "investigation.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
# The contract's own input fixture: one supported policy per role, with its parameters.
POLICIES = json.loads((FIXTURES / "policies.v1.json").read_text(encoding="utf-8"))

OPEN_ROUTE = "/api/investigations/open-example"
EVIDENCE_ROUTE = "/api/investigations/case-evidence"

HEADER = "incident_id,source_event_id,source_sequence,activity,timestamp_utc,service,assignment_group"


def open_request(example: str = "S0", request_id: str = "open-1", revision: int = 1) -> dict:
    return {
        "schema_version": 1,
        "message_type": "open_example_request",
        "request_id": request_id,
        "query_revision": revision,
        "example_id": example,
        "policies": deepcopy(POLICIES),
    }


def evidence_request(population: dict, case_id: str, request_id: str = "case-1") -> dict:
    return {
        "schema_version": 1,
        "message_type": "case_evidence_request",
        "request_id": request_id,
        "query_revision": population["query_revision"],
        "identity": deepcopy(population["identity"]),
        "case_id": case_id,
    }


def body(message: object) -> bytes:
    return json.dumps(message).encode("utf-8")


def write_example(directory: Path, example: str, *rows: str, header: str = HEADER) -> bytes:
    """Write an example source of literal rows and return its bytes."""
    directory.mkdir(parents=True, exist_ok=True)
    source = "".join(line + "\r\n" for line in (header, *rows)).encode("utf-8")
    (directory / f"{example}.csv").write_bytes(source)
    return source
