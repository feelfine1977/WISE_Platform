"""Descriptive group and case-start comparisons over immutable complete histories."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
import json
import math
import re

from .comparison_profiles import opening_context_profile, population_support
from .mapping import ImportRefusal
from .preparation import PreparedData, content_identity
from .selection import (CaseIdIn, CaseStartInWindow, OpeningAttributeIn, RecordAttributeIn,
                        ObservedSpanAtLeast, MaxRawGapAtLeast, IntervalThreshold, VariantIs, semantic_predicate, OPENING_CONTEXT_POLICY, ContainsActivity, DirectlyFollows, EndsWithActivity,
                        OpeningAttributeEquals, SelectionError, StartsWithActivity, case_ids,
                        predicate_descriptor, select_cases)
from .time_formats import TimeInterpretation, iso_local, iso_utc, parse_format, validate_time_policy

_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z")
_LOCAL = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?")
_WALL_LIMITATION = ("Wall-clock differences across daylight-saving or offset changes can differ from physical "
                    "elapsed time; the declared recorded-wall order uses no machine timezone.")


class _InputError(ValueError):
    def __init__(self, refusal: ImportRefusal):
        self.refusal = refusal
        super().__init__(refusal.message)


def _fail(code: str, message: str, field: str) -> None:
    raise _InputError(ImportRefusal(code, message, field))


def _closed(value: object, keys: set[str], field: str, code: str = "invalid_parameter") -> Mapping:
    if not isinstance(value, Mapping) or set(value) != keys:
        _fail(code, "Expected exactly the fields supported by this comparison definition.", field)
    return value


def _utf8_text(value: str, field: str, code: str = "invalid_parameter") -> None:
    try:
        value.encode("utf-8")
    except UnicodeError:
        _fail(code, "Comparison text must contain valid Unicode scalar values.", field)


def _name(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        _fail("invalid_parameter", "A group or period needs a nonempty name of at most 128 characters.", field)
    _utf8_text(value, field)
    return value


def _ids(value: object, field: str, code: str = "invalid_parameter") -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)) or any(not isinstance(i, str) or not 1 <= len(i) <= 256 for i in value):
        _fail(code, "Case IDs must be an array of supported nonempty identifier strings.", field)
    if len(set(value)) != len(value):
        _fail(code, "Case IDs must not repeat.", field)
    return tuple(value)


def _scope(prepared: PreparedData, identity: Mapping, parent_ids: object, column: int,
           policy: str) -> tuple[str, ...]:
    if not isinstance(prepared, PreparedData):
        _fail("preparation_unavailable", "A confirmed prepared snapshot is required.", "identity.preparation_id")
    if not isinstance(identity, Mapping) or dict(identity) != prepared.identity_dict():
        _fail("identity_mismatch", "The full supplied base identity does not match this prepared snapshot.", "identity")
    if policy != OPENING_CONTEXT_POLICY:
        _fail("unsupported_policy", "This opening-context policy or version is unsupported.", "context_policy")
    if type(column) is not int or column not in prepared.mapping["context_columns"]:
        _fail("unmapped_context_column", "Use an explicitly mapped context column ordinal.", "context_column_index")
    requested = None if parent_ids is None else _ids(parent_ids, "parent_case_ids", "invalid_parent")
    return case_ids(prepared, requested)


def _predicates(value: object, field: str) -> tuple[tuple, list[dict[str, object]]]:
    if not isinstance(value, (list, tuple)):
        _fail("invalid_predicate", "Predicates must be an array of supported descriptive definitions.", field)
    predicates, descriptors = [], []
    for index, raw in enumerate(value):
        at = f"{field}[{index}]"
        if not isinstance(raw, Mapping):
            _fail("invalid_predicate", "Each predicate must be a typed object.", at)
        kind = raw.get("kind")
        if kind == "case_id_in":
            d = _closed(raw, {"kind", "case_ids", "negate"}, at, "invalid_predicate")
            p = CaseIdIn(d["case_ids"], d["negate"])
        elif kind == "case_start_in_window":
            d = _closed(raw, {"kind", "window", "negate"}, at, "invalid_predicate")
            w = _closed(d["window"], {"timestamp_kind", "start_inclusive", "end_exclusive"}, at + ".window", "invalid_predicate")
            p = CaseStartInWindow(w["timestamp_kind"], w["start_inclusive"], w["end_exclusive"], d["negate"])
        elif kind in ("opening_attribute_in", "record_attribute_in"):
            keys = {"kind", "column_index", "values", "negate"}
            if kind == "opening_attribute_in":
                keys.add("anchor_policy")
            d = _closed(raw, keys, at, "invalid_predicate")
            if kind == "opening_attribute_in" and d["anchor_policy"] != OPENING_CONTEXT_POLICY:
                _fail("unsupported_policy", "Use the declared first-record anchor.", at + ".anchor_policy")
            constructor = OpeningAttributeIn if kind == "opening_attribute_in" else RecordAttributeIn
            p = constructor(d["column_index"], d["values"], d["negate"])
        elif kind == "interval_threshold":
            d = _closed(raw, {"kind", "interval", "operator", "hours", "negate"}, at, "invalid_predicate")
            i = _closed(d["interval"], {"policy", "start_activity", "response_activity"}, at + ".interval", "invalid_predicate")
            p = IntervalThreshold(i["start_activity"], i["response_activity"], d["operator"], d["hours"], d["negate"], i["policy"])
        elif kind == "variant_is":
            d = _closed(raw, {"kind", "variant", "negate"}, at, "invalid_predicate")
            v = _closed(d["variant"], {"id", "activities", "projection_policy"}, at + ".variant", "invalid_predicate")
            p = VariantIs(tuple(v["activities"]), d["negate"], v["id"], v["projection_policy"])
        elif kind in ("observed_span_at_least", "max_raw_gap_at_least"):
            d = _closed(raw, {"kind", "hours", "negate"}, at, "invalid_predicate")
            constructor = ObservedSpanAtLeast if kind == "observed_span_at_least" else MaxRawGapAtLeast
            p = constructor(d["hours"], d["negate"])
        elif kind == "contains_activity":
            d = _closed(raw, {"kind", "activity", "negate"}, at, "invalid_predicate")
            p = ContainsActivity(d["activity"], d["negate"])
        elif kind in ("starts_with_activity", "ends_with_activity"):
            d = _closed(raw, {"kind", "activity", "negate"}, at, "invalid_predicate")
            p = (StartsWithActivity if kind == "starts_with_activity" else EndsWithActivity)(d["activity"], d["negate"])
        elif kind == "directly_follows":
            d = _closed(raw, {"kind", "source_activity", "target_activity", "negate"}, at, "invalid_predicate")
            p = DirectlyFollows(d["source_activity"], d["target_activity"], d["negate"])
        elif kind == "opening_attribute_equals":
            d = _closed(raw, {"kind", "column_index", "value", "negate", "anchor_policy"}, at, "invalid_predicate")
            if d["anchor_policy"] != OPENING_CONTEXT_POLICY:
                _fail("unsupported_policy", "The opening predicate must use the declared first-record anchor.", at + ".anchor_policy")
            p = OpeningAttributeEquals(d["column_index"], d["value"], d["negate"])
        else:
            _fail("invalid_predicate", "This descriptive predicate kind is unsupported.", at + ".kind")
        descriptor = predicate_descriptor(p)
        for key, text_value in descriptor.items():
            if isinstance(text_value, str):
                _utf8_text(text_value, at + "." + key, "invalid_predicate")
        descriptors.append(descriptor)
        predicates.append(p)
    return tuple(predicates), descriptors


def _states(selected, parent: tuple[str, ...]) -> dict[str, bool | None]:
    kept, removed = set(selected.kept.case_ids), set(selected.removed.case_ids)
    return {case: True if case in kept else False if case in removed else None for case in parent}


def _named_group(prepared: PreparedData, parent: tuple[str, ...], value: object, role: str
                 ) -> tuple[str, dict[str, bool | None], dict[str, object]]:
    at = "definition." + role
    group = _closed(value, {"name", "definition"}, at)
    name = _name(group["name"], at + ".name")
    raw = group["definition"]
    if not isinstance(raw, Mapping):
        _fail("invalid_parameter", "A named group needs an explicit definition.", at + ".definition")
    if raw.get("kind") == "predicates":
        d = _closed(raw, {"kind", "predicates"}, at + ".definition")
        predicates, descriptors = _predicates(d["predicates"], at + ".definition.predicates")
        selected = select_cases(prepared, predicates, parent)
        states = _states(selected, parent)
        wire = {"kind": "predicates", "predicates": descriptors}
    elif raw.get("kind") == "explicit_case_ids":
        d = _closed(raw, {"kind", "case_ids"}, at + ".definition")
        supplied = _ids(d["case_ids"], at + ".definition.case_ids")
        supplied = case_ids(prepared, supplied)
        if set(supplied) - set(parent):
            _fail("case_outside_parent", "The named group includes a case outside the frozen parent.", at + ".definition.case_ids")
        chosen = set(supplied)
        states = {case: case in chosen for case in parent}
        wire = {"kind": "explicit_case_ids", "case_ids": list(d["case_ids"])}
    else:
        _fail("invalid_parameter", "Choose predicates or explicit case IDs for each named group.", at + ".definition.kind")
    return name, states, {"name": name, "definition": wire}


def _semantic(definition: Mapping, periods: bool) -> dict[str, object]:
    result = json.loads(json.dumps(definition, ensure_ascii=False, allow_nan=False))
    def canonical_predicates(predicates):
        return [json.loads(value) for value in sorted({json.dumps(semantic_predicate(p), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) for p in predicates})]
    if periods:
        minimum = result["minimum_followup_hours"]
        if isinstance(minimum, float) and math.isfinite(minimum) and minimum.is_integer():
            result["minimum_followup_hours"] = int(minimum)
        for role in ("target", "reference"):
            result[role].pop("name")
    elif result["mode"] == "two_named_groups":
        for role in ("target", "reference"):
            result[role].pop("name")
            d = result[role]["definition"]
            if d["kind"] == "predicates":
                d["predicates"] = canonical_predicates(d["predicates"])
            else:
                d["case_ids"] = sorted(d["case_ids"])
    else:
        result.pop("target_name"); result.pop("reference_name")
        result["predicates"] = canonical_predicates(result["predicates"])
    return result


def _cohort(prepared: PreparedData, parent: tuple[str, ...], name: str, states: Mapping[str, bool | None]) -> dict[str, object]:
    included = tuple(case for case in parent if states[case] is True)
    return {"name": name, "identity": select_cases(prepared, (), included).identity_dict(),
            "included": population_support(prepared, included),
            "excluded": population_support(prepared, (case for case in parent if states[case] is False)),
            "unevaluable": population_support(prepared, (case for case in parent if states[case] is None))}


def _answer(prepared: PreparedData, parent: tuple[str, ...], column: int, policy: str,
            definition: dict[str, object], target: dict[str, object], reference: dict[str, object],
            ts: Mapping[str, bool | None], rs: Mapping[str, bool | None], periods: bool
            ) -> dict[str, object] | ImportRefusal:
    profile = opening_context_profile(prepared, parent, tuple(target["included"]["case_ids"]),
                                      tuple(reference["included"]["case_ids"]), column)
    if isinstance(profile, ImportRefusal):
        return profile
    pair = {name: [] for name in ("overlap", "target_only", "reference_only", "neither", "unevaluable")}
    for case in parent:
        a, b = ts[case], rs[case]
        key = ("unevaluable" if a is None or b is None else "overlap" if a and b else
               "target_only" if a else "reference_only" if b else "neither")
        pair[key].append(case)
    base = prepared.identity_dict()
    meaning = {"kind": "descriptive_period_comparison.v1" if periods else "descriptive_group_comparison.v1",
               "identity": base, "parent_case_ids": list(parent), "context_column_index": column,
               "context_policy": policy, "definition": _semantic(definition, periods)}
    return {"identity": base, "parent_identity": select_cases(prepared, (), parent).identity_dict(),
            "parent": population_support(prepared, parent), "comparison_id": content_identity("comparison", meaning),
            "context_column_index": column, "context_policy": policy, "definition": definition,
            "target": target, "reference": reference,
            "pair_support": {name: population_support(prepared, ids) for name, ids in pair.items()}, "context_profile": profile}


def compare_groups(prepared: PreparedData, identity: Mapping, parent_case_ids: object, context_column_index: int,
                   context_policy: str, definition: Mapping) -> dict[str, object] | ImportRefusal:
    try:
        parent = _scope(prepared, identity, parent_case_ids, context_column_index, context_policy)
        if not isinstance(definition, Mapping):
            _fail("invalid_parameter", "A typed group-comparison definition is required.", "definition")
        if definition.get("mode") == "two_named_groups":
            d = _closed(definition, {"mode", "target", "reference"}, "definition")
            tn, ts, tw = _named_group(prepared, parent, d["target"], "target")
            rn, rs, rw = _named_group(prepared, parent, d["reference"], "reference")
            wire = {"mode": "two_named_groups", "target": tw, "reference": rw}
        elif definition.get("mode") == "selection_partition":
            d = _closed(definition, {"mode", "target_name", "reference_name", "predicates", "target_side"}, "definition")
            tn, rn = _name(d["target_name"], "definition.target_name"), _name(d["reference_name"], "definition.reference_name")
            if d["target_side"] not in ("kept", "removed"):
                _fail("invalid_parameter", "The target side must be kept or removed; unknown cases are separate.", "definition.target_side")
            predicates, descriptors = _predicates(d["predicates"], "definition.predicates")
            states = _states(select_cases(prepared, predicates, parent), parent)
            ts = {case: value if d["target_side"] == "kept" or value is None else not value for case, value in states.items()}
            rs = {case: None if value is None else not value for case, value in ts.items()}
            wire = {"mode": "selection_partition", "target_name": tn, "reference_name": rn,
                    "predicates": descriptors, "target_side": d["target_side"]}
        else:
            _fail("invalid_parameter", "Choose two named groups or a kept/removed selection partition.", "definition.mode")
        target, reference = _cohort(prepared, parent, tn, ts), _cohort(prepared, parent, rn, rs)
        return _answer(prepared, parent, context_column_index, context_policy, wire, target, reference, ts, rs, False)
    except _InputError as error:
        return error.refusal
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), "definition")


def _window(value: object, role: str, clock: TimeInterpretation) -> tuple[str, datetime, datetime, dict[str, object]]:
    at = "definition." + role
    period = _closed(value, {"name", "window"}, at)
    name = _name(period["name"], at + ".name")
    window = _closed(period["window"], {"timestamp_kind", "start_inclusive", "end_exclusive"}, at + ".window")
    if window["timestamp_kind"] != clock.kind:
        _fail("clock_mismatch", "Every case-start window must use the preparation's declared clock domain.", at + ".window.timestamp_kind")
    pattern = _UTC if clock.kind == "utc_instant" else _LOCAL
    moments = []
    for bound in ("start_inclusive", "end_exclusive"):
        text = window[bound]
        moment = parse_format(text, "iso8601") if isinstance(text, str) and pattern.fullmatch(text) else None
        if moment is None:
            _fail("invalid_window", "A window bound must be a valid canonical date/time in the declared domain.", at + ".window." + bound)
        moments.append(moment)
    if moments[0] >= moments[1]:
        _fail("invalid_window", "A half-open window needs its start strictly before its end.", at + ".window")
    return name, moments[0], moments[1], {"name": name, "window": dict(window)}


def _point(moment: datetime, clock: TimeInterpretation) -> dict[str, object]:
    wall = clock.kind == "wall_clock"
    return {"timestamp_kind": clock.kind, "utc_instant": None if wall else iso_utc(moment),
            "local_timestamp": iso_local(moment) if wall else None}


def _period_cohort(prepared: PreparedData, parent: tuple[str, ...], name: str, states: Mapping[str, bool | None],
                   clock: TimeInterpretation, minimum: int | float, endpoint: str | None) -> dict[str, object]:
    cohort = _cohort(prepared, parent, name, states)
    included = tuple(cohort["included"]["case_ids"])
    adequate, inadequate, exposures = [], [], []
    for case in included:
        start = prepared.histories[case][0].time_value
        hours = (clock.cutoff - start).total_seconds() / 3600
        status = "adequate" if hours >= minimum else "inadequate"
        (adequate if status == "adequate" else inadequate).append(case)
        exposures.append({"case_id": case, "case_start": _point(start, clock), "followup_hours": hours, "status": status})
    cohort["exposure"] = {"adequate": population_support(prepared, adequate),
                          "inadequate": population_support(prepared, inadequate), "cases": exposures}
    if endpoint is None:
        cohort["endpoint_coverage"] = None
    else:
        recorded = tuple(case for case in included if any(row.activity == endpoint for row in prepared.histories[case]))
        recorded_set = set(recorded)
        cohort["endpoint_coverage"] = {"activity": endpoint, "basis": "recorded_activity_presence_in_complete_history",
                                       "recorded": population_support(prepared, recorded),
                                       "not_recorded": population_support(prepared, (case for case in included if case not in recorded_set))}
    return cohort


def compare_periods(prepared: PreparedData, identity: Mapping, parent_case_ids: object, context_column_index: int,
                    context_policy: str, definition: Mapping) -> dict[str, object] | ImportRefusal:
    try:
        parent = _scope(prepared, identity, parent_case_ids, context_column_index, context_policy)
        d = _closed(definition, {"target", "reference", "minimum_followup_hours", "endpoint_activity"}, "definition")
        minimum = d["minimum_followup_hours"]
        try:
            finite = type(minimum) in (int, float) and math.isfinite(minimum) and minimum >= 0
        except OverflowError:
            finite = False
        if not finite:
            _fail("invalid_parameter", "Minimum follow-up hours must be a finite nonnegative number.", "definition.minimum_followup_hours")
        endpoint = d["endpoint_activity"]
        if endpoint is not None and (not isinstance(endpoint, str) or not endpoint):
            _fail("invalid_parameter", "The recorded endpoint is a nonempty activity label or null.", "definition.endpoint_activity")
        if endpoint is not None:
            _utf8_text(endpoint, "definition.endpoint_activity")
        clock = validate_time_policy(prepared.policies["time"])
        if isinstance(clock, ImportRefusal):
            _fail("clock_mismatch", "The prepared clock interpretation is unavailable.", "identity.preparation_id")
        tn, t0, t1, tw = _window(d["target"], "target", clock)
        rn, r0, r1, rw = _window(d["reference"], "reference", clock)
        ts, rs = {}, {}
        for case in parent:
            rows = prepared.histories[case]
            start = rows[0].time_value if rows and prepared.sequence_evaluable(case) else None
            ts[case] = None if start is None else t0 <= start < t1
            rs[case] = None if start is None else r0 <= start < r1
        wire = {"target": tw, "reference": rw, "minimum_followup_hours": minimum, "endpoint_activity": endpoint}
        target = _period_cohort(prepared, parent, tn, ts, clock, minimum, endpoint)
        reference = _period_cohort(prepared, parent, rn, rs, clock, minimum, endpoint)
        result = _answer(prepared, parent, context_column_index, context_policy, wire, target, reference, ts, rs, True)
        if isinstance(result, ImportRefusal):
            return result
        wall = clock.kind == "wall_clock"
        result["case_start_basis"] = "first_record_in_declared_order_of_sequence_evaluable_case"
        result["followup_clock"] = {"timestamp_kind": clock.kind,
            "duration_clock": "recorded_wall_clock_hours" if wall else "elapsed_utc_hours",
            "clock_limitation": _WALL_LIMITATION if wall else None, "snapshot_cutoff": _point(clock.cutoff, clock)}
        return result
    except _InputError as error:
        return error.refusal
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), "definition")
