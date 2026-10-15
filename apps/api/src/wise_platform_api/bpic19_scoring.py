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
from . import bpic19_associations
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
_MATERIALIZATION_PAGE_SIZE = 100000
_DEFAULT_MAX_CASES = 251734
_DEFAULT_MAX_RETAINED_RECORDS = 1595923
_WORKLOAD_POLICY = "bpic19.native_workload_admission.v1"
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
    # Native verdicts repeat keys and witness IDs heavily. Level 1 preserves
    # identical JSON while keeping full-source snapshot writing linear in bytes.
    compressed = gzip.compress(raw, compresslevel=1, mtime=0)
    digest = _digest(compressed)
    folder = workspace.path / "score-run-artifacts"
    folder.mkdir(exist_ok=True)
    path = folder / (digest + ".json.gz")
    if path.exists():
        if _digest(path.read_bytes()) != digest:
            raise _Refused(Problem("checksum_mismatch", "A stored native snapshot artifact was changed. Nothing was overwritten."))
    else:
        write_atomically(path, compressed)
    return {"kind": kind, "sha256": digest, "byte_count": len(compressed), "json_byte_count": len(raw),
            "format": "json-gzip.v1", "filename": digest + ".json.gz"}


def _artifact_bytes(workspace: Workspace, receipt: dict) -> bytes:
    digest = receipt.get("sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or receipt.get("filename") != digest + ".json.gz":
        raise _Refused(Problem("checksum_mismatch", "The snapshot artifact receipt is not valid."))
    try: raw = (workspace.path / "score-run-artifacts" / (digest + ".json.gz")).read_bytes()
    except OSError:
        raise _Refused(Problem("artifact_unavailable", "A native result artifact is missing or unreadable. Nothing was computed again.")) from None
    if len(raw) != receipt.get("byte_count") or _digest(raw) != digest:
        raise _Refused(Problem("checksum_mismatch", "A native result artifact failed its checksum. Nothing was computed again."))
    return raw


def _load_artifact(workspace: Workspace, receipt: dict):
    try:
        raw = gzip.decompress(_artifact_bytes(workspace, receipt))
        if len(raw) != receipt["json_byte_count"]: raise ValueError("Wrong size")
        return json.loads(raw)
    except (ValueError, OSError, EOFError, KeyError, TypeError):
        raise _Refused(Problem("checksum_mismatch", "A native result artifact is not the recorded JSON snapshot.")) from None


def _bounded_analysis(value, limit=200):
    """Keep large population witnesses in the artifact, with bounded public receipts."""
    if isinstance(value,dict):
        output={}
        for key,item in value.items():
            if key == "reviewed_query":
                output[key] = item
                continue
            if isinstance(item,list) and (key=="case_ids" or key.endswith("_case_ids") or key=="native_item_penalties"):
                output[key]=item[:limit]
                output[key+"_receipt"]={"count":len(item),"sha256":_digest(_canonical(item)),"complete":len(item)<=limit,
                                       "limit":limit,"next_offset":limit if len(item)>limit else None}
            else:output[key]=_bounded_analysis(item,limit)
        return output
    if isinstance(value,list):return [_bounded_analysis(item,limit) for item in value]
    return value


def _complete_report(assessment, case_count: int) -> dict:
    """Materialize every admitted group through Method's bounded report pages.

    The report API's page limit is not a snapshot truncation policy. Each item
    belongs to at most one group, document and representation of each kind, so
    their complete tables are bounded by the admitted item population.
    """
    limit = min(_MATERIALIZATION_PAGE_SIZE, max(1, case_count))
    report = assessment.report(case_limit=1, group_limit=limit)
    totals = [report["group_page"]["total"], report["group_page"]["document_total"]]
    totals.extend(report.get("representation_page", {}).get(key, 0)
                  for key in ("exact_total", "signature_total"))
    total = max(totals)
    if total > case_count:
        raise ValueError("Native group support exceeds the admitted item population.")
    for offset in range(limit, total, limit):
        page = assessment.report(case_limit=1, group_offset=offset, group_limit=limit)
        for field in ("groups", "documents", "layer_drivers"):
            report[field].extend(page[field])
        for kind in report.get("representation_scores", {}):
            report["representation_scores"][kind].extend(page["representation_scores"][kind])
    report["group_page"].update(offset=0, limit=max(1, total))
    if "representation_page" in report:
        report["representation_page"].update(offset=0, limit=max(1, total))
    return report


class Bpic19Scoring:
    """The public scoring boundary, owning no alternate evaluator or mutable run cache."""
    def __init__(self, imports: Imports, *, max_cases: int = _DEFAULT_MAX_CASES,
                 max_retained_records: int = _DEFAULT_MAX_RETAINED_RECORDS) -> None:
        # Server-local admission configuration, not a measured capacity or SLA.
        # Reject invalid deployment configuration rather than silently uncap it.
        for name, value in (("max_cases", max_cases), ("max_retained_records", max_retained_records)):
            if type(value) is not int or not 1 <= value <= 2**53 - 1:
                raise ValueError(f"{name} must be a positive integer no greater than 2**53 - 1.")
        self.imports = imports
        self.max_cases = max_cases
        self.max_retained_records = max_retained_records
        self._lock = RLock()

    def _admit_workload(self, prepared, population, settings: dict) -> dict:
        selected = tuple(population.case_ids)
        fits_parent = settings["profile"] == "historical" or (
            settings["profile"] == "paper" and settings["volume"] == "exposure"
            and settings["exposure_policy"] == "max_absolute_p95")
        members = tuple(sorted(set(selected) | (set(population.parent_ids) if fits_parent else set())))
        record_count = sum(len(prepared.histories[case_id]) for case_id in members)
        if len(members) > self.max_cases or record_count > self.max_retained_records:
            raise _Refused(Problem("unsupported_policy",
                f"Fresh native computation requested {len(members)} complete items and {record_count} retained original records; "
                f"the declared admission limits are {self.max_cases} items and {self.max_retained_records} records "
                f"under {_WORKLOAD_POLICY}. No items or records were dropped and no native result was published.",
                "named_population"))
        return {"policy_id": _WORKLOAD_POLICY, "max_cases": self.max_cases,
                "max_retained_records": self.max_retained_records,
                "admitted_case_count": len(members), "admitted_record_count": record_count,
                "selected_case_count": len(selected),
                "selected_record_count": sum(len(prepared.histories[case_id]) for case_id in selected),
                "includes_calibration_parent": fits_parent,
                "membership_sha256": _digest(_canonical(list(members))),
                "interpretation": "server-local fresh-computation admission policy; not a measured capacity or runtime SLA"}

    def score(self, body: bytes) -> Bpic19ScoringReply:
        return self._answer(body, generated.Bpic19ScoreRequest, self._score)

    def read(self, body: bytes) -> Bpic19ScoringReply:
        return self._answer(body, generated.Bpic19ReadRequest, self._read_run)

    def read_saved_snapshot(self, body: bytes) -> Bpic19ScoringReply:
        """Verify the complete stored result at save/replay, then read its page.

        Ordinary browser reads stay paged. A saved native action, however,
        must not certify a run whose undisplayed snapshot chunks are missing
        or changed. Verification reads recorded bytes without evaluating,
        decoding all chunks or replacing any artifact.
        """
        return self._answer(body, generated.Bpic19ReadRequest, self._read_saved_snapshot)

    def associate(self, body: bytes) -> Bpic19ScoringReply:
        return self._answer(body, generated.Bpic19AssociationRequest, self._associate)

    def review(self, body: bytes) -> Bpic19ScoringReply:
        return self._answer(body, generated.Bpic19ReviewRequest, self._review)

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
            identity = {"format": _SNAPSHOT_VERSION, "definition_version_id": definition_id,
                        "base_identity": given["base_identity"], "population_identity": population.identity,
                        "parent_identity": population.parent_identity,
                        "population_membership_sha256": _digest(_canonical(list(population.case_ids))),
                        "parent_membership_sha256": _digest(_canonical(list(population.parent_ids))),
                        "method_artifact": method.METHOD_ARTIFACT}
            run_id = content_identity("score-run", identity)
            stored = _checked(workspace.run(run_id))
            if stored is None:
                admission = self._admit_workload(prepared, population, settings)
                version = _checked(workspace.store_definition(definition))
                if settings["profile"] == "historical":
                    features = build_historical_features(prepared, population.case_ids, given["roles"], calibration_case_ids=population.parent_ids)
                    for feature in features:
                        records = prepared.histories[feature["case_id"]]
                        timed = [record for record in records if record.time_value is not None]
                        first = min((record.time_value for record in timed), default=None)
                        feature["historical_artifacts"] = {
                            "policy_id": "bpic19.historical_compatibility_artifacts.v1",
                            "start_quarter": f"{first.year}Q{(first.month - 1) // 3 + 1}" if first else None,
                            "start_timestamp": first.isoformat() if first else None,
                            "start_row_ids": [record.row_id for record in timed if record.time_value == first],
                            "unparsed_time_row_ids": [record.row_id for record in records if record.time_value is None],
                            "representations": feature.get("representations", {}),
                            "replication_proxy": {**feature["historical_measures"]["event_replication_ratio"],
                                "row_ids": feature.get("record_row_ids", []),
                                "interpretation": "original events divided by distinct parsed timestamps; not a verified duplicate count"},
                            "timestamp_policy": "historical parsed minimum without a range filter; no deduplication",
                        }
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
                report = _complete_report(assessment, len(features))
                report["case_page"]["cases"] = []
                stored_case_ids = list(assessment.features)
                membership_positions = {cid: position for position, cid in enumerate(stored_case_ids)}
                def positions(mask):
                    return [membership_positions[cid] for cid in assessment.result.violations.index[mask]]
                index = {"format": "bpic19.membership.positions.v1", "case_ids": stored_case_ids, "parent_case_ids": list(population.parent_ids),
                         "contexts": {f["case_id"]: {key: f.get(key) if key != "item_type" else f.get("context", {}).get(key, {}).get("value")
                                      for key in set(settings["group_by"]) | {"document", "flow", "company", "spend_area", "item_type"}} for f in features},
                         "criterion_members": {key: {"evaluated": positions(assessment.result.violations[key].notna()),
                            "positive": positions(assessment.result.violations[key].gt(0)),
                            "unavailable": positions(assessment.result.violations[key].isna())}
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
                                 "workload_admission": admission,
                                 "reference": "arithmetic mean of scored items in the recorded assessment population",
                                 "calibration_population": population.parent_identity}}))
            return self._page(workspace, stored, given)

    def _stored(self, given: dict, *, saved_reference: bool = False) -> tuple[Workspace, dict]:
        workspace = _checked(self.imports.opened_workspace(given["workspace_id"]))
        if saved_reference:
            self._require_reference(workspace, "run", given["run_id"], "run_id")
        run = _checked(workspace.run(given["run_id"]))
        if run is None or run.get("identity", {}).get("format") not in _READ_VERSIONS:
            raise _Refused(Problem("run_unavailable", "This workspace has no BPIC19 native snapshot with that identity.", "run_id"))
        base = run["identity"]["base_identity"]
        if saved_reference:
            self._require_reference(workspace, "definition", run["identity"]["definition_version_id"], "definition_id")
        prepared = _checked(self.imports.prepared(given["workspace_id"], base["preparation_id"]))
        if not isinstance(prepared, tuple) or prepared[0].identity_dict() != base:
            raise _Refused(Problem("identity_mismatch", "The recorded source preparation is no longer reproducible."))
        definition = _checked(workspace.definition(run["identity"]["definition_version_id"]))
        if definition is None or dict(definition) != run["definition_version"]:
            raise _Refused(Problem("definition_unavailable", "The frozen definition is missing or differs from the saved run."))
        return workspace, dict(run)

    @staticmethod
    def _require_reference(workspace, kind, reference_id, field):
        integrity = workspace.reference_integrity(kind, reference_id)
        if integrity.state == "available": return
        if integrity.state == "invalid_reference":
            raise _Refused(Problem("invalid_parameter", "The saved native reference has an unsupported identity.", field))
        code = "checksum_mismatch" if integrity.state == "checksum_invalid" else "artifact_unavailable"
        raise _Refused(Problem(code, f"The saved native {kind} reference {reference_id} is {integrity.state}. Nothing was rebound or computed again.", field))

    def _read_run(self, given: dict) -> dict:
        workspace, run = self._stored(given)
        return self._page(workspace, run, given)

    def _read_saved_snapshot(self, given: dict) -> dict:
        workspace, run = self._stored(given, saved_reference=True)
        for ref in run["snapshot"]["artifacts"]:
            _artifact_bytes(workspace, ref)
        return self._page(workspace, run, given)

    def _variant(self, workspace: Workspace, parent: dict, report: dict, operation: str, recipe: dict) -> dict:
        """Freeze a derived interpretation beside the original native run, reusing native chunks."""
        definition={**parent["definition_version"], "parent_definition_id":parent["identity"]["definition_version_id"],
                    "derived_operation":operation,"derived_recipe":recipe}
        definition.pop("definition_version_id",None)
        definition_id=content_identity("definition-version",definition)
        definition["definition_version_id"]=definition_id
        definition=_checked(workspace.store_definition(definition))
        identity={**parent["identity"],"definition_version_id":definition_id,"parent_native_run_id":parent["identity"]["run_id"]}
        identity.pop("run_id",None)
        run_id=content_identity("score-run",identity)
        existing=_checked(workspace.run(run_id))
        if existing is not None: return dict(existing)
        artifacts=[_store_artifact(workspace,report,"report"),*[ref for ref in parent["snapshot"]["artifacts"] if ref["kind"]!="report"]]
        return dict(_checked(workspace.store_run({**parent,"identity":{"run_id":run_id,**identity},"definition_version":definition,
            "snapshot":{**parent["snapshot"],"artifacts":artifacts,"parent_native_run_id":parent["identity"]["run_id"],
                        "derived_operation":operation,"derived_recipe":recipe}})))

    def _associate(self,given: dict) -> dict:
        with self._lock:
            workspace,parent=self._stored(given)
            refs=parent["snapshot"]["artifacts"]
            index=_load_artifact(workspace,next(ref for ref in refs if ref["kind"]=="membership"))
            query=json.loads(json.dumps(given["query"]))
            for name in ("target","comparator"):
                if query[name]["selector"]["kind"]=="case_ids":
                    query[name]["selector"]["case_ids"]=sorted(query[name]["selector"]["case_ids"])
            order={constraint["id"]:i for i,constraint in enumerate(parent["definition_version"]["norm"]["constraints"])}
            query["criteria"]=sorted(query["criteria"],key=lambda key:order.get(key,len(order)))
            def resolve(selector: dict,target_ids=None):
                kind=selector["kind"]
                if kind=="outside_target":
                    if target_ids is None: raise ValueError("The target cannot be defined as outside itself.")
                    kept=set(target_ids);return [cid for cid in index["case_ids"] if cid not in kept]
                if kind=="all":return list(index["case_ids"])
                if kind=="case_ids":
                    ids=selector["case_ids"]
                    if len(set(ids))!=len(ids) or set(ids)-set(index["case_ids"]):
                        raise ValueError("Association items must belong once to the selected frozen run.")
                    return sorted(ids)
                keys=selector["group_values"]
                excluded = selector.get("exclude_group_values", {})
                admitted = set(next(iter(index["contexts"].values()), {})) & {"document", "flow", "company", "spend_area", "item_type"}
                if (set(keys) | set(excluded)) - admitted:
                    raise ValueError("That context field was not recorded in this frozen run. Evaluate a new identified run with that context receipt.")
                def matches(cid, values):
                    return all(index["contexts"][cid].get(key)==value or
                        (value=="(missing)" and index["contexts"][cid].get(key) is None) for key,value in values.items())
                return [cid for cid in index["case_ids"] if matches(cid, keys) and (not excluded or not matches(cid, excluded))]
            target=resolve(query["target"]["selector"])
            comparator=resolve(query["comparator"]["selector"],target)
            selected=set(target)|set(comparator)
            cases={}
            for ref in refs:
                if ref["kind"]=="cases" and any(cid in selected for cid in index["case_ids"][ref["offset"]:ref["offset"]+ref["count"]]):
                    for case in _load_artifact(workspace,ref)["cases"]:
                        if case["case_id"] in selected:cases[case["case_id"]]=case
            resolved={**query,"target":{"name":query["target"]["name"],"case_ids":target},
                      "comparator":{"name":query["comparator"]["name"],"case_ids":comparator}}
            analysis=bpic19_associations.analyse_associations(cases,parent["definition_version"]["norm"],resolved)
            analysis["reviewed_query"]=query
            analysis["source_native_run_id"]=parent["identity"]["run_id"]
            analysis["source_native_definition_id"]=parent["identity"]["definition_version_id"]
            analysis["source_population_identity"]=parent["identity"]["population_identity"]
            report=_load_artifact(workspace,next(ref for ref in refs if ref["kind"]=="report"))
            report["association_analysis"]=analysis
            recipe={"query":query,"target_membership_sha256":_digest(_canonical(target)),"target_case_count":len(target),
                    "comparator_membership_sha256":_digest(_canonical(comparator)),"comparator_case_count":len(comparator),
                    "association_artifact_sha256":_digest(Path(bpic19_associations.__file__).read_bytes())}
            derived=self._variant(workspace,parent,report,"bpic19_associations",recipe)
            return self._page(workspace,derived,given)

    def _review(self, given: dict) -> dict:
        """Record explicitly supplied interpretations; native numbers remain frozen."""
        with self._lock:
            workspace, parent = self._stored(given)
            review = given["review"]
            criteria = {item["id"] for item in parent["definition_version"]["norm"]["constraints"]}
            controls = [item["criterion_id"] for item in review["mandatory_controls"]]
            if len(set(controls)) != len(controls) or set(controls) - criteria:
                raise ValueError("Mandatory-control flags must reference each admitted criterion at most once.")
            finding_ids = [item["id"] for item in review["findings"]]
            if len(set(finding_ids)) != len(finding_ids):
                raise ValueError("Each recorded finding needs a distinct identity.")
            index = _load_artifact(workspace, next(ref for ref in parent["snapshot"]["artifacts"] if ref["kind"] == "membership"))
            members = set(index["case_ids"])
            prepared = _checked(self.imports.prepared(given["workspace_id"], parent["identity"]["base_identity"]["preparation_id"]))[0]
            references = [item["evidence"] for item in review["mandatory_controls"]]
            references += [item[stage]["evidence"] for item in review["findings"] for stage in ("observation", "proposed_change", "adoption", "tested_outcome")]
            for evidence in references:
                if set(evidence["case_ids"]) - members or set(evidence["criterion_ids"]) - criteria:
                    raise ValueError("Finding evidence must belong to this frozen population and admitted native profile.")
                rows = {record.row_id for cid in evidence["case_ids"] for record in prepared.histories[cid]}
                if set(evidence["row_ids"]) - rows:
                    raise ValueError("Source-row evidence must belong to the explicitly referenced complete items.")
            report = _load_artifact(workspace, next(ref for ref in parent["snapshot"]["artifacts"] if ref["kind"] == "report"))
            report["analysis_review"] = review
            child = self._variant(workspace, parent, report, "bpic19_interpretation_review", {"review": review})
            return self._page(workspace, child, given)

    def _page(self, workspace: Workspace, run: dict, given: dict) -> dict:
        refs = run["snapshot"]["artifacts"]
        report = _load_artifact(workspace, next(r for r in refs if r["kind"] == "report"))
        index = _load_artifact(workspace, next(r for r in refs if r["kind"] == "membership"))
        ids = index["case_ids"]
        # Presentation positions are always in the original frozen run, never
        # relative to a member filter or a reordered native assessment table.
        # They are derived on read and never written into the report artifact.
        positions = {cid: pos for pos, cid in enumerate(ids)}
        exemplar_pages = []
        for entry in report.get("exemplars", []):
            cid = entry.get("case_id") if isinstance(entry, dict) else None
            if not isinstance(cid, str) or not cid:
                continue
            position = positions.get(cid)
            exemplar_pages.append({"case_id": cid, "full_population_case_offset": position,
                                   "unavailable_reason": "not_in_frozen_membership" if position is None else None})
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
            def members(values):
                if index.get("format") == "bpic19.membership.positions.v1":
                    return {index["case_ids"][position] for position in values}
                return set(values)
            selected = members(criterion[state])
            if "right_criterion_id" in filter_:
                right = index["criterion_members"].get(filter_["right_criterion_id"])
                if right is None: raise _Refused(Problem("invalid_parameter", "The second criterion is not in this profile."))
                selected.intersection_update(members(right[state]))
            ids = [cid for cid in ids if cid in selected]
        if "representation_group" in filter_:
            group = filter_["representation_group"]
            key = "exact_score_group" if group["kind"] == "exact" else "signature_score_group"
            if not any(context.get(key) == group["group_id"] for context in index["contexts"].values()):
                raise _Refused(Problem("invalid_parameter", "That representation group is not in this frozen run.", "case_filter.representation_group"))
            ids = [cid for cid in ids if index["contexts"][cid].get(key) == group["group_id"]]
        if "association_set" in filter_:
            analysis=report.get("association_analysis")
            if not analysis:raise _Refused(Problem("invalid_parameter","This frozen run has no reviewed association comparison."))
            selection=filter_["association_set"]
            if selection.get("pair"):
                pair=selection["pair"]
                row=next((row for row in analysis["accepted_pairs"]+analysis["suppressed_pairs"] if
                    row["left"]==pair["left"] and row["right"]==pair["right"]),None)
                if row is None:raise _Refused(Problem("invalid_parameter","That pair is not in this association definition."))
                selected=set(row[pair["set"]+"_case_ids"])
            else:
                population=analysis["populations"][selection["population"]]
                if selection["state"]=="all":selected=set(population["case_ids"])
                else:
                    criterion=population["criteria"].get(selection.get("criterion_id"))
                    if criterion is None:raise _Refused(Problem("invalid_parameter","That criterion is not in this association definition."))
                    selected=set(criterion[selection["state"]+"_case_ids"])
            ids=[cid for cid in ids if cid in selected]
        offset, limit = given["case_offset"], given["case_limit"]
        selected = ids[offset:offset + limit]
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
        if "association_analysis" in report:
            report["association_analysis"]=_bounded_analysis(report["association_analysis"])
        return {"schema_version": 1, "message_type": "bpic19_score_answer",
                **{name: given[name] for name in ("request_id", "query_revision", "workspace_id")},
                "base_identity": run["identity"]["base_identity"], "parent_identity": run["identity"]["parent_identity"],
                "named_population": run["named_population"], "run_id": run["identity"]["run_id"],
                "definition_version_id": run["identity"]["definition_version_id"],
                "definition_id": run["identity"]["definition_version_id"], "definition": run["definition_version"],
                "snapshot": run["snapshot"], "report": report, "native_exemplar_pages": exemplar_pages}

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
    for path, action in (("bpic19-score", service.score), ("bpic19-read", service.read),("bpic19-associate",service.associate),("bpic19-review",service.review)):
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
