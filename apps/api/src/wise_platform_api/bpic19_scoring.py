"""Native BPIC19 assessments and immutable, checksummed workspace snapshots.

The measured input is derived from the frozen population. Only the installed
Method grades and ranks it. Reading a run, browsing its members and exporting it
read recorded artifacts; none of those operations scores or fits a calibration.
"""
from __future__ import annotations

from dataclasses import dataclass
import gzip
import hashlib
import io
import json
import logging
from pathlib import Path
import re
from threading import RLock
import zipfile

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from wise_platform_analytics.bpic19_measures import (
    build_historical_features, build_paper_features, derive_case_measures,
)
from wise_platform_analytics import bpic19_measures as measures_module
from wise_platform_analytics.preparation import content_identity

from . import method, bpic19_method
from .boundary import read_object
from .bpic19_method import evaluate_features, paper_norm_document, representation_key, _historical_binding
from .generated import bpic19_scoring as generated
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem, Workspace, is_workspace_id, write_atomically

logger = logging.getLogger(__name__)
_ALTERNATIVES = alternatives_of(generated)
_SNAPSHOT_VERSION = "bpic19.native-snapshot.v3"
_READ_VERSIONS = {_SNAPSHOT_VERSION,"bpic19.native-snapshot.v2"}
_CHUNK_SIZE = 500
_REQUEST_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")


@dataclass(frozen=True)
class Bpic19ScoringReply:
    status: int
    body: dict


class _Refused(Exception):
    def __init__(self, problem: Problem):
        self.problem = problem


def _canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _checked(value):
    if isinstance(value, Problem):
        raise _Refused(value)
    return value


def _refusal(given: dict, problem: Problem) -> Bpic19ScoringReply:
    request_id, revision = given.get("request_id"), given.get("query_revision")
    body = {"schema_version": 1, "message_type": "bpic19_refusal",
            "request_id": request_id if isinstance(request_id, str) and _REQUEST_ID.fullmatch(request_id) else None,
            "query_revision": revision if type(revision) is int and 1 <= revision <= 2**53 - 1 else None,
            "workspace_id": given.get("workspace_id") if is_workspace_id(given.get("workspace_id")) else None,
            "code": problem.code, "message": problem.message, "field": problem.field,
            "retryable": problem.code in {"workspace_unavailable", "source_unavailable", "computation_failed"}}
    status = 400 if problem.code in {"invalid_request", "unsupported_schema", "unsupported_policy", "invalid_parameter",
                                      "invalid_count", "context_conflict"} else 404 if problem.code in {
        "workspace_unavailable", "source_unavailable", "preparation_unavailable", "run_unavailable"} else 409
    if problem.code == "computation_failed": status = 500
    return Bpic19ScoringReply(status, body)


def _read(body: bytes, model) -> dict:
    given = read_object(body)
    if isinstance(given, str): raise _Refused(Problem("invalid_request", given))
    if type(given.get("schema_version")) is int and given["schema_version"] != 1:
        raise _Refused(Problem("unsupported_schema", "Only BPIC19 scoring schema version 1 is supported.", "schema_version"))
    result = read_strictly(given, model, _ALTERNATIVES)
    if isinstance(result, list):
        raise _Refused(Problem("invalid_request", result[0].reason, result[0].field))
    for name in ("base_identity",):
        failures = version_failures(given, ((name, "implementation_version"), ("named_population", "identity", "implementation_version")))
        if failures: raise _Refused(Problem("invalid_request", failures[0].reason, failures[0].field))
    if len(set(given.get("settings", {}).get("group_by", []))) != len(given.get("settings", {}).get("group_by", [])):
        raise _Refused(Problem("invalid_parameter", "Grouping keys must be distinct.", "settings.group_by"))
    return given


def _store_artifact(workspace: Workspace, payload: object, kind: str) -> dict:
    raw = _canonical(payload)
    compressed = gzip.compress(raw, mtime=0)
    digest = _digest(compressed)
    folder = workspace.path / "score-run-artifacts"
    folder.mkdir(exist_ok=True)
    path = folder / (digest + ".json.gz")
    if path.exists():
        if _digest(path.read_bytes()) != digest:
            raise _Refused(Problem("artifact_unavailable", "A stored native snapshot artifact was changed. Nothing was overwritten."))
    else:
        write_atomically(path, compressed)
    return {"kind": kind, "sha256": digest, "byte_count": len(compressed), "json_byte_count": len(raw),
            "format": "json-gzip.v1", "filename": digest + ".json.gz"}


def _artifact_bytes(workspace: Workspace, receipt: dict) -> bytes:
    digest = receipt.get("sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or receipt.get("filename") != digest + ".json.gz":
        raise _Refused(Problem("artifact_unavailable", "The snapshot artifact receipt is not valid."))
    try: raw = (workspace.path / "score-run-artifacts" / (digest + ".json.gz")).read_bytes()
    except OSError:
        raise _Refused(Problem("artifact_unavailable", "A native result artifact is missing or unreadable. Nothing was computed again.")) from None
    if len(raw) != receipt.get("byte_count") or _digest(raw) != digest:
        raise _Refused(Problem("artifact_unavailable", "A native result artifact failed its checksum. Nothing was computed again."))
    return raw


def _load_artifact(workspace: Workspace, receipt: dict):
    try:
        raw = gzip.decompress(_artifact_bytes(workspace, receipt))
        if len(raw) != receipt["json_byte_count"]: raise ValueError("Wrong size")
        return json.loads(raw)
    except (ValueError, OSError, EOFError):
        raise _Refused(Problem("artifact_unavailable", "A native result artifact is not the recorded JSON snapshot.")) from None


class Bpic19Scoring:
    """The public scoring boundary, owning no alternate evaluator or mutable run cache."""
    def __init__(self, imports: Imports) -> None:
        self.imports = imports
        self._lock = RLock()

    def score(self, body: bytes) -> Bpic19ScoringReply:
        return self._answer(body, generated.Bpic19ScoreRequest, self._score)

    def read(self, body: bytes) -> Bpic19ScoringReply:
        return self._answer(body, generated.Bpic19ReadRequest, self._read_run)

    def _answer(self, body: bytes, model, action) -> Bpic19ScoringReply:
        echo = read_object(body)
        given = echo if isinstance(echo, dict) else {}
        try:
            given = _read(body, model)
            result = action(given)
            checked = read_strictly(result, generated.Bpic19ScoreAnswer, _ALTERNATIVES)
            if isinstance(checked, list): raise ValueError("Native answer violates the boundary: " + str(checked[0]))
            return Bpic19ScoringReply(200, result)
        except _Refused as error:
            return _refusal(given, error.problem)
        except ValueError as error:
            text = str(error)
            code = "invalid_count" if text.startswith("invalid_count:") else "context_conflict" if text.startswith("context_conflict:") else "invalid_parameter"
            return _refusal(given, Problem(code, text))
        except Exception:
            logger.exception("BPIC19 native assessment failed")
            return _refusal(given, Problem("computation_failed", "The native assessment could not be completed. The previous stored run remains unchanged."))

    def _score(self, given: dict) -> dict:
        with self._lock:
            workspace = _checked(self.imports.opened_workspace(given["workspace_id"]))
            resolved = _checked(resolve_population(self.imports, {"workspace_id": given["workspace_id"], "identity": given["named_population"]["identity"]}))
            prepared, population = resolved
            if prepared.identity_dict() != given["base_identity"]:
                raise _Refused(Problem("identity_mismatch", "The source basis does not match this preparation.", "base_identity"))
            settings = given["settings"]
            problem = method.method_problem()
            if problem is not None: raise _Refused(problem)
            if settings["profile"] == "historical" and (settings["mode"] != "layer_balanced" or settings["criteria_family"] != "full"):
                raise _Refused(Problem("unsupported_policy", "The historical profile requires its complete 29-criterion layer-balanced definition.", "settings"))
            norm = paper_norm_document(settings["mode"], settings["criteria_family"]) if settings["profile"] == "paper" else _historical_binding()[0]
            if settings["view"] not in {view["name"] for view in norm["views"]}:
                raise _Refused(Problem("unsupported_policy", "That stakeholder view belongs to another source profile.", "settings.view"))
            definition = {"schema_version": 1, "kind": _SNAPSHOT_VERSION, "roles": given["roles"],
                          "settings": settings, "norm": norm, "base_identity": given["base_identity"],
                          "method_artifact": method.METHOD_ARTIFACT, "review_state": "reviewed_by_explicit_run_action",
                          "binding_artifacts": {"native_binding_sha256": _digest(Path(bpic19_method.__file__).read_bytes()),
                                                "raw_measurement_sha256": _digest(Path(measures_module.__file__).read_bytes()),
                                                "snapshot_service_sha256": _digest(Path(__file__).read_bytes())}}
            definition_id = content_identity("definition-version", definition)
            definition["definition_version_id"] = definition_id
            version = _checked(workspace.store_definition(definition))
            identity = {"format": _SNAPSHOT_VERSION, "definition_version_id": definition_id,
                        "base_identity": given["base_identity"], "population_identity": population.identity,
                        "parent_identity": population.parent_identity,
                        "population_membership_sha256": _digest(_canonical(list(population.case_ids))),
                        "parent_membership_sha256": _digest(_canonical(list(population.parent_ids))),
                        "method_artifact": method.METHOD_ARTIFACT}
            run_id = content_identity("score-run", identity)
            stored = _checked(workspace.run(run_id))
            if stored is None:
                if settings["profile"] == "historical":
                    features = build_historical_features(prepared, population.case_ids, given["roles"], calibration_case_ids=population.parent_ids)
                else:
                    features = build_paper_features(prepared, population.case_ids, given["roles"])
                if settings["exposure_policy"] == "creation_unique_event":
                    for feature in features:
                        measure = derive_case_measures(prepared, feature["case_id"], given["roles"], {"value_reducer": "unique_creation_event"})
                        feature["measures"]["creation_unique_event"] = measure["measures"]["selected_value"]
                calibration = None
                if settings["volume"] == "exposure" and settings["exposure_policy"] == "max_absolute_p95" and settings["profile"] == "paper":
                    parent = features if population.case_ids == population.parent_ids else build_paper_features(prepared, population.parent_ids, given["roles"])
                    measures = [f["measures"]["exposure"] for f in parent]
                    if any(not m.get("available") or m.get("value") is None for m in measures):
                        raise _Refused(Problem("exposure_unavailable", "The parent calibration has an unavailable maximum-absolute value. It cannot become zero."))
                    cutoff = float(method._pandas().Series([m["value"] for m in measures]).quantile(.95, interpolation="linear"))
                    calibration = {"policy": "max_absolute_p95", "population_case_ids": list(population.parent_ids),
                                   "population_identity": population.parent_identity, "quantile": .95,
                                   "quantile_method": "linear", "cutoff": cutoff, "source_field": given["roles"].get("net_worth", given["roles"].get("value")),
                                   "raw_measure": "maximum_absolute_event_value", "missing_policy": "refuse",
                                   "value_row_ids": [row for m in measures for row in m.get("row_ids", [])]}
                assessment = evaluate_features(features, **settings, exposure_calibration=calibration)
                report = assessment.report(case_limit=1, group_limit=100000)
                report["case_page"]["cases"] = []
                index = {"case_ids": list(population.case_ids), "parent_case_ids": list(population.parent_ids),
                         "contexts": {f["case_id"]: {key: f.get(key) if key != "item_type" else f.get("context", {}).get(key, {}).get("value")
                                      for key in set(settings["group_by"]) | {"document"}} for f in features},
                         "criterion_members": {key: {"evaluated": assessment.result.violations.index[assessment.result.violations[key].notna()].tolist(),
                            "positive": assessment.result.violations.index[assessment.result.violations[key].gt(0)].tolist(),
                            "unavailable": assessment.result.violations.index[assessment.result.violations[key].isna()].tolist()}
                            for key in assessment.result.violations}}
                for feature in features:
                    index["contexts"][feature["case_id"]].update(
                        exact_score_group=representation_key(feature,"exact"),signature_score_group=representation_key(feature,"signature"))
                artifacts = [_store_artifact(workspace, report, "report"), _store_artifact(workspace, index, "membership")]
                for chunk in assessment.case_chunks(_CHUNK_SIZE):
                    artifacts.append({**_store_artifact(workspace, chunk, "cases"), "offset": chunk["offset"], "count": len(chunk["cases"])})
                stored = _checked(workspace.store_run({"identity": {"run_id": run_id, **identity},
                    "definition_version": version, "named_population": given["named_population"],
                    "snapshot": {"format": _SNAPSHOT_VERSION, "artifacts": artifacts,
                                 "case_count": len(features), "chunk_size": _CHUNK_SIZE,
                                 "reference": "arithmetic mean of scored items in the recorded assessment population",
                                 "calibration_population": population.parent_identity}}))
            return self._page(workspace, stored, given)

    def _stored(self, given: dict) -> tuple[Workspace, dict]:
        workspace = _checked(self.imports.opened_workspace(given["workspace_id"]))
        run = _checked(workspace.run(given["run_id"]))
        if run is None or run.get("identity", {}).get("format") not in _READ_VERSIONS:
            raise _Refused(Problem("run_unavailable", "This workspace has no BPIC19 native snapshot with that identity.", "run_id"))
        base = run["identity"]["base_identity"]
        prepared = _checked(self.imports.prepared(given["workspace_id"], base["preparation_id"]))
        if not isinstance(prepared, tuple) or prepared[0].identity_dict() != base:
            raise _Refused(Problem("identity_mismatch", "The recorded source preparation is no longer reproducible."))
        definition = _checked(workspace.definition(run["identity"]["definition_version_id"]))
        if definition is None or dict(definition) != run["definition_version"]:
            raise _Refused(Problem("definition_unavailable", "The frozen definition is missing or differs from the saved run."))
        return workspace, dict(run)

    def _read_run(self, given: dict) -> dict:
        workspace, run = self._stored(given)
        return self._page(workspace, run, given)

    def _page(self, workspace: Workspace, run: dict, given: dict) -> dict:
        refs = run["snapshot"]["artifacts"]
        report = _load_artifact(workspace, next(r for r in refs if r["kind"] == "report"))
        index = _load_artifact(workspace, next(r for r in refs if r["kind"] == "membership"))
        ids = index["case_ids"]
        filter_ = given.get("case_filter", {})
        if ("right_criterion_id" in filter_ or "criterion_state" in filter_) and "criterion_id" not in filter_:
            raise _Refused(Problem("invalid_parameter", "Criterion inspection needs its left criterion identity.", "case_filter.criterion_id"))
        if "group_values" in filter_:
            keys = filter_["group_values"]
            if not keys or set(keys) - (set(report["settings"]["group_by"]) | {"document"}):
                raise _Refused(Problem("invalid_parameter", "Member inspection only uses this run's grouping keys or document.", "case_filter.group_values"))
            ids = [cid for cid in ids if all(index["contexts"][cid].get(key) == value or
                (value == "(missing)" and index["contexts"][cid].get(key) is None) for key, value in keys.items())]
        if "criterion_id" in filter_:
            state = filter_.get("criterion_state", "positive")
            criterion = index["criterion_members"].get(filter_["criterion_id"])
            if criterion is None: raise _Refused(Problem("invalid_parameter", "That criterion is not in this compiled profile."))
            selected = set(criterion[state])
            if "right_criterion_id" in filter_:
                right = index["criterion_members"].get(filter_["right_criterion_id"])
                if right is None: raise _Refused(Problem("invalid_parameter", "The second criterion is not in this profile."))
                selected.intersection_update(right[state])
            ids = [cid for cid in ids if cid in selected]
        if "representation_group" in filter_:
            group = filter_["representation_group"]
            key = "exact_score_group" if group["kind"] == "exact" else "signature_score_group"
            if not any(context.get(key) == group["group_id"] for context in index["contexts"].values()):
                raise _Refused(Problem("invalid_parameter", "That representation group is not in this frozen run.", "case_filter.representation_group"))
            ids = [cid for cid in ids if index["contexts"][cid].get(key) == group["group_id"]]
        offset, limit = given["case_offset"], given["case_limit"]
        selected = ids[offset:offset + limit]
        positions = {cid: pos for pos, cid in enumerate(index["case_ids"])}
        chunks = {}
        for cid in selected:
            chunk_offset = positions[cid] // _CHUNK_SIZE * _CHUNK_SIZE
            if chunk_offset not in chunks:
                ref = next(r for r in refs if r["kind"] == "cases" and r["offset"] == chunk_offset)
                chunks[chunk_offset] = _load_artifact(workspace, ref)["cases"]
        cases = [chunks[positions[cid] // _CHUNK_SIZE * _CHUNK_SIZE][positions[cid] % _CHUNK_SIZE] for cid in selected]
        report["case_page"] = {"offset": offset, "limit": limit, "total": len(ids), "cases": cases}
        report["evidence_page"] = {"filter": filter_, "reference_run_id": run["identity"]["run_id"],
            "reference_population_identity": run["identity"]["population_identity"],
            "selected_membership_sha256": _digest(_canonical(ids)), "selected_case_count": len(ids),
            "interpretation": "stored item inspection; scores, calibration and arithmetic reference unchanged"}
        group_offset, group_limit = given.get("group_offset", 0), given.get("group_limit", 50)
        for field in ("groups", "documents", "layer_drivers"):
            report[field] = report[field][group_offset:group_offset + group_limit]
        if "representation_scores" in report:
            for kind in ("exact","signature"):
                report["representation_scores"][kind] = report["representation_scores"][kind][group_offset:group_offset+group_limit]
            report["representation_page"].update(offset=group_offset,limit=group_limit)
        report["group_page"].update(offset=group_offset, limit=group_limit)
        return {"schema_version": 1, "message_type": "bpic19_score_answer",
                **{name: given[name] for name in ("request_id", "query_revision", "workspace_id")},
                "base_identity": run["identity"]["base_identity"], "parent_identity": run["identity"]["parent_identity"],
                "named_population": run["named_population"], "run_id": run["identity"]["run_id"],
                "definition_version_id": run["identity"]["definition_version_id"],
                "definition_id": run["identity"]["definition_version_id"], "definition": run["definition_version"],
                "snapshot": run["snapshot"], "report": report}

    def export(self, body: bytes) -> tuple[int, dict | bytes]:
        echo = read_object(body); given = echo if isinstance(echo, dict) else {}
        try:
            given = _read(body, generated.Bpic19ExportRequest)
            workspace, run = self._stored(given)
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as out:
                out.writestr("manifest.json", _canonical(run))
                for ref in run["snapshot"]["artifacts"]:
                    out.writestr("artifacts/" + ref["filename"], _artifact_bytes(workspace, ref))
            return 200, archive.getvalue()
        except _Refused as error:
            reply = _refusal(given, error.problem); return reply.status, reply.body


def register_bpic19_scoring_routes(application: FastAPI, imports: Imports) -> Bpic19Scoring:
    """Root application integration seam; no existing routing module is modified."""
    service = Bpic19Scoring(imports)
    for path, action in (("bpic19-score", service.score), ("bpic19-read", service.read)):
        def endpoint_for(operation):
            async def endpoint(request: Request):
                reply = await run_in_threadpool(operation, await request.body())
                return JSONResponse(reply.body, status_code=reply.status, headers={"Cache-Control": "no-store"})
            return endpoint
        application.add_api_route("/api/investigations/" + path, endpoint_for(action), methods=["POST"])

    @application.post("/api/investigations/bpic19-export")
    async def export(request: Request):
        status, body = await run_in_threadpool(service.export, await request.body())
        if isinstance(body, dict): return JSONResponse(body, status_code=status)
        return Response(body, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="bpic19-native-run.zip"', "Cache-Control": "no-store"})
    return service
