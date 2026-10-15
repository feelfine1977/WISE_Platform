"""Public declared prepared arithmetic, independently identified from raw scoring.

Only Method evaluates the fixed historical29 norm. Review freezes declarations;
read, export and investigation reopen verify stored bytes and never score again.
Native transport activities/times are private plumbing, never original records.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import html
import io
import json
import math
import logging
import zipfile

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from wise_platform_analytics.preparation import content_identity

from . import bpic19_method, method
from .bpic19_prepared_input import (
    CATALOGUE_SHA256, PROFILE_ID, PreparedInput, binding_catalogue,
    build_prepared_input, _unique_object,
)
from .bpic19_scoring import _Refused, _canonical, _checked, _load_artifact, _store_artifact
from .boundary import echo_of, read_object
from .generated import bpic19_prepared_runs as generated
from .imports import Imports
from .strict_reading import alternatives_of, read_strictly
from .workspace import Problem, Workspace, is_workspace_id

_VIEWS = ("Finance", "Logistics", "Compliance", "Automation")
_MAX_BODY = 32 * 1024 * 1024
_MAX_ITEMS = 1000
_KIND = "bpic19.declared-prepared-native.v1"
_REVIEW_KIND = "bpic19.declared-prepared-review.v1"
_ALTERNATIVES = alternatives_of(generated)
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PreparedReply:
    status: int
    body: dict | bytes
    media_type: str = "application/json"
    filename: str | None = None


def _digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _fail(code: str, message: str, field: str | None = None):
    raise _Refused(Problem(code, message, field))


def _envelope(given: dict, kind: str) -> dict:
    return {"schema_version": 1, "message_type": "bpic19_prepared_" + kind,
            "request_id": given["request_id"], "query_revision": given["query_revision"],
            "workspace_id": given["workspace_id"]}


def _refused(given: dict, problem: Problem) -> PreparedReply:
    if problem.code=="definition_unavailable": problem=Problem("input_unavailable",problem.message,problem.field)
    body = {"schema_version": 1, "message_type": "bpic19_prepared_refusal", **echo_of(given),
            "workspace_id": given.get("workspace_id") if is_workspace_id(given.get("workspace_id")) else None,
            "code": problem.code, "message": problem.message, "field": problem.field,
            "retryable": problem.code in {"workspace_unavailable", "publication_failed", "computation_failed"}}
    generated.Bpic19PreparedRefusal.model_validate(body)
    status = 400 if problem.code in {"invalid_request", "unsupported_schema", "unsupported_policy", "input_limit_exceeded"} else 404 if problem.code in {"workspace_unavailable", "input_unavailable", "run_unavailable"} else 403 if problem.code == "workspace_not_writable" else 500 if problem.code == "computation_failed" else 409
    return PreparedReply(status, body)


def _parse(body: bytes, model) -> dict:
    if len(body) > _MAX_BODY:
        _fail("input_limit_exceeded", "Prepared requests are limited to 32 MiB.")
    given = read_object(body)
    if isinstance(given, str): _fail("invalid_request", given)
    # Reject ambiguous duplicate keys in addition to the shared Unicode/number checks.
    try: json.loads(body, object_pairs_hook=_unique_object)
    except (ValueError, RecursionError): _fail("invalid_request", "Duplicate or invalid JSON fields are not admitted.")
    if type(given.get("schema_version")) is int and given["schema_version"] != 1:
        _fail("unsupported_schema", "Only prepared arithmetic schema version 1 is supported.", "schema_version")
    if "presentation_order" in given and given["presentation_order"] is None:
        _fail("invalid_request", "Omit an absent display order; explicit null cannot select a default.", "presentation_order")
    parsed = read_strictly(given, model, _ALTERNATIVES)
    if isinstance(parsed, list): _fail("invalid_request", parsed[0].reason, parsed[0].field)
    return given


def _public_input(artifact: PreparedInput) -> None:
    rows = artifact.to_dict()["rows"]
    if len(rows) > _MAX_ITEMS: _fail("input_limit_exceeded", "A prepared input admits at most 1000 assessment items.", "rows")
    for index, row in enumerate(rows):
        for key, cell in row["measurements"].items():
            if cell["provenance"]["original_row_refs"]:
                _fail("unsupported_policy", "This declared-input mode does not verify raw witnesses. Use declared assessment references; unverified original-row declarations cannot be admitted as public evidence.", f"rows.{index}.measurements.{key}.provenance.original_row_refs")


def _review_id(input_id: str) -> str:
    return content_identity("definition-version", {"kind": _REVIEW_KIND, "input_id": input_id})


def _immutable_record(workspace: Workspace, kind: str, reference_id: str) -> dict | None:
    """Reuse workspace integrity states without changing legacy refusal vocabulary."""
    _checked(workspace.check())
    integrity=workspace.reference_integrity(kind, reference_id)
    if integrity.state=="unavailable": return None
    if integrity.state!="available" or not isinstance(integrity.record,dict):
        _fail("checksum_mismatch", "A retained prepared reference failed its immutable-record checksum. Nothing was repaired or scored again.", "input_id" if kind=="definition" else "run_id")
    return dict(integrity.record)


def _input(workspace: Workspace, input_id: str) -> PreparedInput:
    record = _immutable_record(workspace,"definition",_review_id(input_id))
    if record is None: _fail("input_unavailable", "This workspace has no reviewed prepared input with that identity.", "input_id")
    if record.get("kind") != _REVIEW_KIND or record.get("input_id") != input_id:
        _fail("identity_mismatch", "The reviewed input record names another basis.", "input_id")
    payload = _load_artifact(workspace, record["artifact"])
    try: artifact = PreparedInput(payload)
    except (ValueError, TypeError, KeyError): _fail("checksum_mismatch", "The reviewed declaration no longer matches its immutable input identity.", "input_id")
    if artifact.content_id != input_id: _fail("identity_mismatch", "The stored input is a different declaration.", "input_id")
    _public_input(artifact)
    return artifact


def _basis(artifact: PreparedInput) -> dict:
    return {"kind": "declared_prepared_attributes", "input_id": artifact.content_id,
            "assessment_item_ids": [row["assessment_item_id"] for row in artifact.to_dict()["rows"]]}


def _number(value):
    if value is None: return None
    number = float(value)
    return number if math.isfinite(number) else None


def _definition(norm_document: dict, norm, view: str) -> dict:
    bindings = {b.attribute: b for b in binding_catalogue()}
    parts = {"profile_id": PROFILE_ID, "catalogue_sha256": CATALOGUE_SHA256,
             "mode": "layer_balanced", "view": view, "norm_fingerprint": norm.fingerprint(),
             "method_artifact": dict(method.METHOD_ARTIFACT),
             "criteria": [{"criterion_id": c["id"], "label": c["description"], "layer": c["layer"], "unit": bindings[c["id"]].unit,
                           "threshold": c["params"]["threshold"], "width": c["params"]["width"],
                           "direction": c["params"]["direction"], "within_layer_weight": c["weight"],
                           "applicable_flows": c["applicability"]["flow"]} for c in norm_document["constraints"]],
             "layer_weights": [{"layer": layer, "value": weight} for layer, weight in next(v for v in norm_document["views"] if v["name"] == view)["layer_weights"].items()]}
    return {"definition_id": content_identity("bpic19-prepared-definition", parts), **parts}


def _native(artifact: PreparedInput, view: str) -> dict:
    problem = method.method_problem()
    if problem is not None: _fail("native_unavailable", problem.message)
    norm_document, omissions, _ = bpic19_method._historical_binding()
    if omissions: _fail("unsupported_policy", "The complete historical29 prepared binding is unavailable.")
    wise, pandas = method._wise(), method._pandas()
    norm = wise.Norm.from_dict(norm_document); norm.validate()
    definition = _definition(norm_document, norm, view)
    attrs = artifact.method_attributes()
    # Method's EventLog requires a row/activity/time. These private carrier rows
    # are never source events and are never offered to raw-history/Keep actions.
    frame = pandas.DataFrame([{**row, "activity": "declared_prepared_measure_transport", "time": "2000-01-01T00:00:00Z"} for row in attrs])
    log = wise.EventLog(frame, case_col="case_id", activity_col="activity", timestamp_col="time",
                        event_id_col="assessment_row_id", case_attributes=["flow"] + [b.attribute for b in binding_catalogue()], utc=True, dedupe=False)
    result = wise.score(log, norm, mode="layer_balanced", derive=False)
    result.check_decomposition()
    if result.calibrations: raise method.MethodContractError("Declared fixed attributes unexpectedly fitted a calibration.")
    raw_weights = norm.raw_weights(view); weights = result.effective_weights(view); penalties = result.penalties(view)
    cases = []
    for row in artifact.to_dict()["rows"]:
        key = row["assessment_item_id"]; criteria = []
        for criterion, cell in row["measurements"].items():
            criteria.append({"criterion_id": criterion, "unit": cell["unit"], "declared_state": cell["state"],
                "declared_value": cell["value"], "declared_reason": cell["reason"], "provenance": cell["provenance"],
                "native_in_scope": bool(result.in_scope.loc[key, criterion]),
                "native_evaluated": bool(result.applicable.loc[key, criterion]),
                "native_reason": str(result.reasons.loc[key, criterion]),
                "native_deviation": _number(result.violations.loc[key, criterion]),
                "native_raw_weight": float(raw_weights[criterion]),
                "native_effective_weight": float(weights.loc[key, criterion]),
                "native_penalty": float(penalties.loc[key, criterion])})
        in_scope = sum(c["native_in_scope"] for c in criteria); evaluated = sum(c["native_evaluated"] for c in criteria)
        complete = in_scope > 0 and evaluated == in_scope; score = _number(result.scores.loc[key, view])
        cases.append({"assessment_item_id": key, "assessment_row_ref": row["assessment_row_ref"], "flow": row["flow"],
            "score": score, "score_state": "unscored" if score is None else "complete" if complete else "partial_evidence",
            "coverage": 1 if complete else None, "coverage_state": "complete" if complete else "partial_not_qualified",
            "in_scope_count": in_scope, "evaluated_count": evaluated, "criteria": criteria,
            "layer_contributions": [{"layer": str(layer), "value": _number(value)} for layer, value in result.contributions[view].loc[key].items()]})
    return {"kind": _KIND, "basis": _basis(artifact), "definition": definition, "norm_document": norm_document,
            "cases": cases, "limitations": ["Declared measurements are independent of original event histories.",
                "No raw-source algorithm, source fidelity, financial reconciliation or original witness is established.",
                "Incomplete-evidence numeric coverage is not qualified; complete baseline coverage is one.",
                "The packed Method is a component-checked unreleased candidate."]}


def _run_parts(record: dict) -> dict:
    return {key: value for key, value in record.items() if key != "identity"}


def _reference(record: dict) -> dict:
    return {"basis_kind": "declared_prepared_attributes", "input_id": record["input_id"],
            "definition_id": record["definition_id"], "run_id": record["identity"]["run_id"],
            "view": record["view"], "output_sha256": record["output_sha256"]}


def _snapshot(workspace: Workspace, run_id: str) -> tuple[dict, dict, PreparedInput]:
    record = _immutable_record(workspace,"run",run_id)
    if record is None: _fail("run_unavailable", "This workspace has no stored prepared run with that identity.", "run_id")
    if record.get("kind") != _KIND: _fail("identity_mismatch", "This run has another analytical basis; raw runs cannot be used as declared assessments.", "run_id")
    if content_identity("score-run", _run_parts(record)) != run_id or record.get("identity", {}).get("run_id") != run_id:
        _fail("checksum_mismatch", "The prepared run manifest no longer matches its recorded identity.", "run_id")
    artifact = _input(workspace, record["input_id"])
    snapshot = _load_artifact(workspace, record["artifact"])
    if _digest(_canonical(snapshot)) != record["output_sha256"] or snapshot.get("kind") != _KIND or snapshot.get("basis") != _basis(artifact):
        _fail("checksum_mismatch", "The prepared output differs from its recorded basis or checksum.", "run_id")
    definition = snapshot.get("definition", {})
    if definition.get("definition_id") != record["definition_id"] or definition.get("view") != record["view"] or content_identity("bpic19-prepared-definition", {k: v for k, v in definition.items() if k != "definition_id"}) != record["definition_id"]:
        _fail("checksum_mismatch", "The retained native definition is not the run's definition.", "run_id")
    return record, snapshot, artifact


def _retained_prepared_manifest(workspace: Workspace, references: list[dict] | None) -> dict | None:
    """Save/reopen checks separate immutable references; never raw membership or rescore."""
    if references is None: return None
    if not isinstance(references, list) or not 1 <= len(references) <= 4:
        _fail("invalid_request", "Save one to four distinct prepared views.", "bpic19_prepared_assessments")
    views = set(); basis = None
    for reference in references:
        record, snapshot, _ = _snapshot(workspace, reference["run_id"])
        if reference != _reference(record): _fail("identity_mismatch", "The prepared reference names another stored input, definition, view or output.", "bpic19_prepared_assessments")
        if reference["view"] in views: _fail("invalid_request", "A saved prepared view cannot repeat.", "bpic19_prepared_assessments")
        views.add(reference["view"])
        if basis is not None and basis != snapshot["basis"]: _fail("identity_mismatch", "Retain the views of one reviewed prepared input together.", "bpic19_prepared_assessments")
        basis = snapshot["basis"]
    return {"basis_kind": "declared_prepared_attributes", "input_id": basis["input_id"],
            "assessment_item_ids": basis["assessment_item_ids"], "references": references}


def retained_prepared_manifest(workspace: Workspace, references: list[dict] | None) -> dict | Problem | None:
    """Translate stored-reference refusal into the existing saving vocabulary."""
    try: return _retained_prepared_manifest(workspace, references)
    except _Refused as refused:
        problem=refused.problem
        code="artifact_unavailable" if problem.code in {"input_unavailable","run_unavailable"} else problem.code
        return Problem(code, problem.message, "bpic19_prepared_assessments")


def _page(given: dict, kind: str, record: dict, snapshot: dict, offset: int, limit: int) -> PreparedReply:
    total = len(snapshot["cases"]); end = min(offset + limit, total)
    body = {**_envelope(given, kind), "reference": _reference(record), "basis": snapshot["basis"],
            "definition": snapshot["definition"], "cases": snapshot["cases"][offset:end],
            "offset": offset, "total": total, "complete": end >= total, "next_offset": end if end < total else None}
    (generated.Bpic19PreparedRunAnswer if kind == "run_answer" else generated.Bpic19PreparedReadAnswer).model_validate(body)
    return PreparedReply(200, body)


class Bpic19PreparedRuns:
    def __init__(self, imports: Imports): self._imports = imports

    def request(self, operation: str, body: bytes) -> PreparedReply:
        given = read_object(body); echo = given if isinstance(given, dict) else {}
        models = {"review": generated.Bpic19PreparedReviewRequest, "run": generated.Bpic19PreparedRunRequest,
                  "read": generated.Bpic19PreparedReadRequest, "export": generated.Bpic19PreparedExportRequest}
        try:
            given = _parse(body, models[operation]); workspace = _checked(self._imports.opened_workspace(given["workspace_id"]))
            if operation == "review":
                artifact = build_prepared_input(given["rows"], presentation_order=given.get("presentation_order")); _public_input(artifact)
                review_id=_review_id(artifact.content_id)
                if _immutable_record(workspace,"definition",review_id) is None:
                    record = {"kind": _REVIEW_KIND, "definition_version_id": review_id,
                              "input_id": artifact.content_id, "artifact": _store_artifact(workspace, artifact.to_dict(), "bpic19-prepared-input.v1")}
                    _checked(workspace.store_definition(record))
                artifact = _input(workspace, artifact.content_id)
                labels={c["id"]:c["description"] for c in bpic19_method.historical_catalogue()["source"]["constraints"]}
                answer = {**_envelope(given, "review_answer"), "input": artifact.to_dict(), "basis": _basis(artifact),
                          "bindings": [{"criterion_id": b.attribute, "label": labels[b.attribute], "unit": b.unit, "applicable_flows": list(b.applicable_flows), "source_operator": b.source_operator} for b in binding_catalogue()]}
                generated.Bpic19PreparedReviewAnswer.model_validate(answer); return PreparedReply(200, answer)
            if operation == "run":
                artifact = _input(workspace, given["input_id"]); snapshot = _native(artifact, given["view"])
                record = {"kind": _KIND, "input_id": artifact.content_id, "definition_id": snapshot["definition"]["definition_id"],
                          "view": given["view"], "output_sha256": _digest(_canonical(snapshot)),
                          "artifact": _store_artifact(workspace, snapshot, _KIND)}
                run_id = content_identity("score-run", record); record["identity"] = {"run_id": run_id}
                _immutable_record(workspace,"run",run_id)
                _checked(workspace.store_run(record)); record, snapshot, _ = _snapshot(workspace, run_id)
                return _page(given, "run_answer", record, snapshot, 0, 100)
            record, snapshot, artifact = _snapshot(workspace, given["run_id"])
            if operation == "read": return _page(given, "read_answer", record, snapshot, given["offset"], given["limit"])
            return _export(given, record, snapshot, artifact)
        except _Refused as refused: return _refused(echo, refused.problem)
        except (ValueError, TypeError, KeyError) as error: return _refused(echo, Problem("invalid_request", str(error)))
        except OSError: return _refused(echo, Problem("publication_failed", "The prepared artifact cannot be read or kept. No saved investigation revision was changed."))
        except Exception:
            logger.exception("The declared prepared operation failed unexpectedly")
            return _refused(echo, Problem("computation_failed", "The prepared operation failed; no substitute score was produced."))


def _export(given: dict, record: dict, snapshot: dict, artifact: PreparedInput) -> PreparedReply:
    bundle = {"format": "bpic19.declared-prepared-export.v1", "reference": _reference(record),
              "input": artifact.to_dict(), "output": snapshot}
    prefix = "prepared-" + record["view"].lower()
    if given["format"] == "json": return PreparedReply(200, _canonical(bundle), "application/json", prefix + ".json")
    if given["format"] == "markdown":
        lines = ["# Declared prepared assessment", "", "Basis: declared measurements; no original-history equivalence or verified raw witnesses.",
                 "", "Input: " + record["input_id"], "Run: " + record["identity"]["run_id"], "View: " + record["view"], "", "| Assessment item | Flow | Native score | State | Coverage |", "| --- | --- | --- | --- | --- |"]
        escape = lambda value: html.escape(str(value)).replace("|", "\\|").replace("\n", " ").replace("\r", " ")
        for case in snapshot["cases"]: lines.append("| " + " | ".join(escape(case[k]) for k in ["assessment_item_id", "flow", "score", "score_state", "coverage"]) + " |")
        lines += ["", "The JSON declaration and native ZIP retain all29 cells, units, declared provenance, applicability, reasons, deviations, weights and contributions.", "", "```json", json.dumps(bundle, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False), "```", ""]
        return PreparedReply(200, "\n".join(lines).encode(), "text/markdown", prefix + ".md")
    files = {"input.json": _canonical(artifact.to_dict()), "definition.json": _canonical(snapshot["definition"]),
             "native-norm.json": _canonical(snapshot["norm_document"]), "cases.json": _canonical(snapshot["cases"]),
             "limitations.json": _canonical(snapshot["limitations"])}
    manifest = {"format": "bpic19.declared-prepared-native-export.v1", "reference": _reference(record),
                "files": [{"filename": name, "sha256": _digest(raw), "byte_count": len(raw)} for name, raw in files.items()]}
    files["manifest.json"] = _canonical(manifest); buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in files.items():
            info=zipfile.ZipInfo(name, date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info, raw)
    return PreparedReply(200, buffer.getvalue(), "application/zip", prefix + ".zip")


def register_bpic19_prepared_routes(application: FastAPI, imports: Imports) -> None:
    service = Bpic19PreparedRuns(imports)
    def endpoint(operation):
        async def handle(request: Request):
            chunks = []; size = 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > _MAX_BODY:
                    reply = _refused({}, Problem("input_limit_exceeded", "Prepared requests are limited to 32 MiB.")); break
                chunks.append(chunk)
            else: reply = await run_in_threadpool(service.request, operation, b"".join(chunks))
            if isinstance(reply.body, dict): return JSONResponse(reply.body, status_code=reply.status)
            headers = {"Content-Disposition": 'attachment; filename="' + reply.filename + '"'} if reply.filename else {}
            return Response(reply.body, status_code=reply.status, media_type=reply.media_type, headers=headers)
        return handle
    for operation in ("review", "run", "read", "export"):
        application.add_api_route("/api/investigations/bpic19-prepared/" + operation, endpoint(operation), methods=["POST"])
