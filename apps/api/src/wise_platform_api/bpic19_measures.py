"""Read source-witnessed descriptive features on an authorized frozen population.

Norms and grading remain in Method. This service caches bounded summary metadata,
never a replacement event log or a second scoring implementation.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import json
import logging
from threading import RLock

from wise_platform_analytics.bpic19_measures import add_historical_measures, derive_case_measures, measure_population
from wise_platform_analytics.footprint import report_footprint
from wise_platform_analytics.mapping import ImportRefusal

from .boundary import read_object
from .generated import bpic19_measures as generated
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)
_ALTERNATIVES = alternatives_of(generated)
_UNIQUE = {"row_ids", "record_row_ids", "activation_row_ids", "response_row_ids", "invalid_row_ids", "missing_fill_row_ids", "omitted_activity_row_ids", "missing_activity_row_ids", "first_occurrence_signature", "signature_suppressed_row_ids", "signature_retained_row_ids", "candidate_row_ids", "later_row_ids", "unparseable_row_ids", "unknown_activity_row_ids", "unknown_row_ids", "absence_row_ids", "matching_row_ids", "winner_row_ids", "representation_unavailable_case_ids", "population_case_ids"}


@dataclass(frozen=True)
class Bpic19MeasuresReply:
    status: int
    body: dict


def _repeats(value: object, path: tuple = ()) -> tuple | None:
    if isinstance(value, dict):
        for name, item in value.items():
            if (name in _UNIQUE or name == "case_ids" or name.endswith("_case_ids")) and isinstance(item, list) and len(set(item)) != len(item):
                return (*path, name)
            if name == "activity_row_ids" and isinstance(item, dict):
                for activity, ids in item.items():
                    if len(set(ids)) != len(ids): return (*path, name, activity)
            found = _repeats(item, (*path, name))
            if found is not None: return found
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found = _repeats(item, (*path, index))
            if found is not None: return found
    return None


def _refused(given: dict, code: str, message: str, field: str | None = None) -> Bpic19MeasuresReply:
    status = 503 if code == "memory_unavailable" else 400 if code in {"invalid_request", "unsupported_schema", "unsupported_policy", "invalid_parameter", "unsupported_definition", "role_unavailable", "empty_calibration"} else 404 if code in {"workspace_unavailable", "source_unavailable", "preparation_unavailable", "population_unavailable"} else 403 if code == "workspace_not_writable" else 500 if code == "computation_failed" else 409
    body = {"schema_version": 1, "message_type": "bpic19_measures_refusal", **import_echo(given),
            "operation": "bpic19_measures", "code": code, "message": message, "field": field,
            "retryable": code in {"memory_unavailable", "computation_failed", "workspace_unavailable", "source_unavailable", "preparation_unavailable", "population_unavailable"}}
    checked = read_strictly(body, generated.Bpic19MeasuresRefusal, _ALTERNATIVES)
    if isinstance(checked, list): raise ValueError("The BPIC19 measures refusal violates its contract")
    return Bpic19MeasuresReply(status, body)


def _checked_answer(body: dict) -> Bpic19MeasuresReply:
    checked = read_strictly(body, generated.Bpic19MeasuresAnswer, _ALTERNATIVES)
    if isinstance(checked, list) or _repeats(body) is not None:
        raise ValueError("The BPIC19 measures answer violates its contract")
    if version_failures(body, (("identity", "implementation_version"), ("parent_identity", "implementation_version"))):
        raise ValueError("The BPIC19 measures answer has an invalid version")
    if body["definition_id"] != body["definition"]["definition_id"]:
        raise ValueError("The definition identity does not match its receipt")
    total = body["population_case_count"]
    if sum(body["flow_case_counts"].values()) != total:
        raise ValueError("Flow counts do not partition the measured population")
    if any(summary["available_case_count"] + summary["unavailable_case_count"] != total for summary in body["summaries"].values()):
        raise ValueError("Measure availability does not partition the measured population")
    if len({feature["case_id"] for feature in body["cases"]}) != len(body["cases"]):
        raise ValueError("A case repeats in the measured page")
    return Bpic19MeasuresReply(200, body)


class Bpic19Measures:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports
        self._summaries: OrderedDict[str, dict] = OrderedDict()
        self._lock = RLock()

    def _forget(self, key: str) -> None:
        with self._lock:
            self._summaries.pop(key, None)

    def measures(self, body: bytes) -> Bpic19MeasuresReply:
        given = read_object(body)
        if isinstance(given, str): return _refused({}, "invalid_request", given)
        if type(given.get("schema_version")) is int and given["schema_version"] != 1:
            return _refused(given, "unsupported_schema", "Only BPIC19 measures schema version 1 is supported.", "schema_version")
        query = given.get("query")
        if isinstance(query, dict) and isinstance(query.get("policy_id"), str) and query["policy_id"] != "bpic19.source_witnessed_measures.v1":
            return _refused(given, "unsupported_policy", "This measures policy is not admitted.", "query.policy_id")
        if isinstance(query, dict) and isinstance(query.get("measure_profile"), str) and query["measure_profile"] not in {"paper_v1", "historical_v1"}:
            return _refused(given, "unsupported_policy", "This measures profile is not admitted.", "query.measure_profile")
        checked = read_strictly(given, generated.Bpic19MeasuresRequest, _ALTERNATIVES)
        if isinstance(checked, list):
            failure = checked[0]
            return _refused(given, "invalid_request", "The measures request does not match its contract: " + failure.reason, failure.field)
        versions = version_failures(given, (("identity", "implementation_version"),))
        if versions: return _refused(given, "invalid_request", versions[0].reason, versions[0].field)
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem): return _refused(given, resolved.code, resolved.message, resolved.field)
            prepared, population = resolved
            query = given["query"]
            key = json.dumps({"workspace_id": given["workspace_id"], "identity": population.identity,
                "parent_identity": population.parent_identity, "query": {name: value for name, value in query.items() if name not in {"offset", "limit"}}}, sort_keys=True)
            with self._lock:
                cached = self._summaries.get(key)
                if cached is not None: self._summaries.move_to_end(key)
            if cached is None:
                result = measure_population(prepared, population.case_ids, query["roles"], query["offset"], query["limit"],
                    query["measure_profile"], population.case_ids if query.get("calibration_population") == "selected" else population.parent_ids, query)
                if isinstance(result, ImportRefusal): return _refused(given, result.code, result.message, result.field)
                cached = {name: value for name, value in result.items() if name not in {"cases", "offset", "limit", "next_offset"}}
                with self._lock:
                    self._summaries[key] = cached
                    dropped = [self._summaries.popitem(last=False)[0] for _ in range(len(self._summaries) - 2)]
                for old in dropped: self._imports.budget.forget(("measures", old))
                self._imports.budget.hold(("measures", key), report_footprint(cached), lambda key=key: self._forget(key))
            else:
                chosen = cached["definition"]["roles"]
                cases = [derive_case_measures(prepared, case_id, chosen, cached["definition"]) for case_id in population.case_ids[query["offset"]:query["offset"] + query["limit"]]]
                calibration = cached["definition"].get("calibration")
                if calibration is not None:
                    cases = [add_historical_measures(prepared, feature, chosen, calibration) for feature in cases]
                result = {**cached, "cases": cases, "offset": query["offset"], "limit": query["limit"],
                    "next_offset": query["offset"] + query["limit"] if query["offset"] + query["limit"] < len(population.case_ids) else None}
            answer = {"schema_version": 1, "message_type": "bpic19_measures_answer",
                "request_id": given["request_id"], "query_revision": given["query_revision"], "workspace_id": given["workspace_id"],
                "identity": population.identity, "parent_identity": population.parent_identity, "query": query, **result}
            return _checked_answer(answer)
        except Exception:
            logger.exception("The BPIC19 raw measures could not be computed")
            return _refused(given, "computation_failed", "The raw measures could not be computed. Retry; if it fails again, the application needs repair.")
