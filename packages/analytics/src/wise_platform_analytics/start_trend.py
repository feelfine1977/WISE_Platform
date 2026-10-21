"""Distinct first raw-record starts on a checked, frozen complete-case parent."""
from __future__ import annotations

from bisect import bisect_right
from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta
import re

from .mapping import ImportRefusal
from .selection import SelectionError, case_ids as checked_case_ids
from .time_formats import iso_local, iso_utc, validate_time_policy

START_TREND_POLICY = "incident.start_trend.first_raw_declared_order_half_open.v1"
ANCHOR_POLICY = "first_raw_record_in_declared_order_of_sequence_evaluable_case"
_LOCAL = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?")
_UTC = re.compile(_LOCAL.pattern + "Z")


def _timestamp(value: object, kind: str) -> datetime | None:
    if not isinstance(value, str) or (_UTC if kind == "utc_instant" else _LOCAL).fullmatch(value) is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def validate_start_trend_definition(definition: object) -> ImportRefusal | None:
    if not isinstance(definition, Mapping) or set(definition) != {"policy_id", "binning"}:
        return ImportRefusal("invalid_parameter", "The trend definition must contain only its policy and binning.", "definition")
    if definition["policy_id"] != START_TREND_POLICY:
        return ImportRefusal("unsupported_policy", "Use the supplied first raw-record incident-start policy.", "definition.policy_id")
    binning = definition["binning"]
    if not isinstance(binning, Mapping):
        return ImportRefusal("invalid_parameter", "Choose parent-observed bins or exact timestamp edges.", "definition.binning")
    if binning.get("kind") == "parent_observed_range":
        if set(binning) != {"kind", "max_bin_count"} or type(binning["max_bin_count"]) is not int or not 1 <= binning["max_bin_count"] <= 64:
            return ImportRefusal("invalid_parameter", "Parent-observed bin count must be an integer from one to 64.", "definition.binning.max_bin_count")
        return None
    if binning.get("kind") != "explicit_edges" or set(binning) != {"kind", "timestamp_kind", "edges"}:
        return ImportRefusal("invalid_parameter", "Choose a closed supported binning definition.", "definition.binning")
    kind = binning["timestamp_kind"]
    if not isinstance(kind, str) or kind not in {"utc_instant", "wall_clock"}:
        return ImportRefusal("invalid_parameter", "Timestamp edges use the declared UTC or recorded-wall clock.", "definition.binning.timestamp_kind")
    edges = binning["edges"]
    if not isinstance(edges, list) or not 2 <= len(edges) <= 65:
        return ImportRefusal("invalid_parameter", "Supply two to 65 exact timestamp edges.", "definition.binning.edges")
    moments = [_timestamp(value, kind) for value in edges]
    if any(value is None for value in moments):
        return ImportRefusal("invalid_parameter", "Every edge must be a valid canonical timestamp in its declared clock.", "definition.binning.edges")
    if any(left >= right for left, right in zip(moments, moments[1:])):
        return ImportRefusal("invalid_parameter", "Timestamp edges must increase strictly without repeated bounds.", "definition.binning.edges")
    return None


def _support(prepared, members: Iterable[str]) -> dict:
    ids = sorted(members)
    return {"case_ids": ids, "case_count": len(ids), "record_count": sum(len(prepared.histories[case]) for case in ids)}


def _pair(prepared, members: Iterable[str], kept: set[str]) -> dict:
    ids = tuple(members)
    return {"parent_support": _support(prepared, ids), "kept_support": _support(prepared, (case for case in ids if case in kept))}


def _observed_range(records, kind: str) -> tuple[dict | None, tuple[datetime, datetime] | None]:
    moments = []
    for record in records:
        if record.time_value is not None and record.timestamp_status == "usable":
            if record.timestamp_kind != kind or (record.time_value.tzinfo is None) != (kind == "wall_clock"):
                raise SelectionError("inconsistent_time_kind", "Usable source observations disagree with the preparation clock.")
            moments.append(record.time_value)
    if not moments:
        return None, None
    first, last = min(moments), max(moments)
    render = iso_utc if kind == "utc_instant" else iso_local
    return {"earliest_recorded_timestamp": render(first), "latest_recorded_timestamp": render(last)}, (first, last)


def start_trend(prepared, selected_ids: Iterable[str], parent_ids: Iterable[str], definition: Mapping[str, object]) -> dict | ImportRefusal:
    """Supply exact start membership without clipping records or creating a population.

    Every supported start is records[0] in the immutable declared raw order.
    Unknown chronology never falls through to a usable timestamp or mapped label.
    """
    problem = validate_start_trend_definition(definition)
    if problem is not None:
        return problem
    try:
        parent = checked_case_ids(prepared, parent_ids)
        kept_ids = checked_case_ids(prepared, selected_ids)
        kept = set(kept_ids)
        if not kept <= set(parent):
            return ImportRefusal("identity_mismatch", "Selected cases are outside their frozen parent.", "identity.population_id")
        clock = validate_time_policy(prepared.policies["time"])
        if isinstance(clock, ImportRefusal):
            return clock
        source_range, _ = _observed_range(prepared.records, clock.kind)
        parent_range, parent_bounds = _observed_range((record for case in parent for record in prepared.histories[case]), clock.kind)
        binning = definition["binning"]
        if binning["kind"] == "explicit_edges":
            if binning["timestamp_kind"] != clock.kind:
                return ImportRefusal("inconsistent_time_kind", "Timestamp edges must use the preparation clock.", "definition.binning.timestamp_kind")
            edges = list(binning["edges"])
            generation = {"kind": "explicit_edges", "max_bin_count": None, "upper_extension_microseconds": 0, "status": "available"}
        else:
            generation = {"kind": "parent_observed_range", "max_bin_count": binning["max_bin_count"], "upper_extension_microseconds": 0,
                "status": "empty_parent" if not parent else "no_usable_parent_timestamps"}
            edges = []
            if parent_bounds is not None:
                first, last = parent_bounds
                try:
                    end = last + timedelta(microseconds=1)
                except OverflowError:
                    return ImportRefusal("invalid_parameter", "The latest parent observation cannot be extended by one supported microsecond; supply explicit bounds.", "definition.binning")
                elapsed = end - first
                span_microseconds = (elapsed.days * 86400 + elapsed.seconds) * 1_000_000 + elapsed.microseconds
                count = min(binning["max_bin_count"], span_microseconds)
                render = iso_utc if clock.kind == "utc_instant" else iso_local
                edges = [render(first + timedelta(microseconds=span_microseconds * index // count)) for index in range(count + 1)]
                generation.update(upper_extension_microseconds=1, status="available")
        moments = [_timestamp(edge, clock.kind) for edge in edges]
        bins_ids = [[] for _ in edges[:-1]]
        available, unknown, before, after = [], [], [], []
        order_unknown, first_missing = [], []
        for case in parent:
            records = prepared.histories[case]
            if not records:
                raise SelectionError("inconsistent_sequence", "An identified case must retain its raw history.")
            if not prepared.sequence_evaluable(case):
                unknown.append(case)
                order_unknown.append(case)
                # With unknown order, only universal timestamp absence proves the
                # first raw time missing without choosing presentation ordering.
                if all(record.time_value is None or record.timestamp_status != "usable" for record in records):
                    first_missing.append(case)
                continue
            start = records[0]
            if start.time_value is None or start.timestamp_status != "usable":
                unknown.append(case)
                first_missing.append(case)
                continue
            available.append(case)
            index = bisect_right(moments, start.time_value) - 1
            if index < 0:
                before.append(case)
            elif index >= len(bins_ids):
                after.append(case)
            else:
                bins_ids[index].append(case)
        cutoff_key = "snapshot_cutoff_local" if clock.kind == "wall_clock" else "snapshot_cutoff_utc"
        return {"grain": "distinct_incident_starts", "anchor_policy": ANCHOR_POLICY,
            "clock": {"timestamp_kind": clock.kind, "snapshot_cutoff": prepared.policies["time"]["parameters"][cutoff_key]},
            "source_time_range": source_range, "parent_time_range": parent_range,
            "bin_generation": generation,
            "edges": edges, "parent_support": _support(prepared, parent), "kept_support": _support(prepared, kept_ids),
            "bins": [{"start_inclusive": edges[index], "end_exclusive": edges[index + 1], **_pair(prepared, ids, kept)} for index, ids in enumerate(bins_ids)],
            "available": _pair(prepared, available, kept),
            "unevaluable": {**_pair(prepared, unknown, kept), "reason_supports": {
                "order_unknown": _pair(prepared, order_unknown, kept), "first_raw_timestamp_missing": _pair(prepared, first_missing, kept)},
                "reason_supports_are_nonadditive": True},
            "before_range": _pair(prepared, before, kept), "after_range": _pair(prepared, after, kept)}
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), "identity.population_id")


def validate_start_trend_answer(answer: Mapping[str, object]) -> None:
    """Enforce producer clock, bin and complete-support conservation invariants.

    Shape/types belong to the generated contract. This checks the relationships
    the schema cannot express, without repairing or coercing the supplied answer.
    """
    definition = answer["definition"]
    problem = validate_start_trend_definition(definition)
    if problem is not None:
        raise ValueError("The start-trend definition is invalid at " + (problem.field or "definition"))
    kind = answer["clock"]["timestamp_kind"]
    if _timestamp(answer["clock"]["snapshot_cutoff"], kind) is None:
        raise ValueError("The trend cutoff does not have a valid declared clock timestamp.")
    edges = answer["edges"]
    moments = [_timestamp(edge, kind) for edge in edges]
    if any(moment is None for moment in moments) or any(left >= right for left, right in zip(moments, moments[1:])):
        raise ValueError("The trend edges must increase in the declared clock.")
    if len(edges) == 1 or len(answer["bins"]) != max(0, len(edges) - 1):
        raise ValueError("The trend bins must exactly span their declared edges.")
    for index, item in enumerate(answer["bins"]):
        if item["start_inclusive"] != edges[index] or item["end_exclusive"] != edges[index + 1]:
            raise ValueError("A trend bin does not have the supplied half-open bounds.")
    ranges = {}
    for field in ("source_time_range", "parent_time_range"):
        value = answer[field]
        if value is None:
            ranges[field] = None
            continue
        first, last = (_timestamp(value[name], kind) for name in ("earliest_recorded_timestamp", "latest_recorded_timestamp"))
        if first is None or last is None or first > last:
            raise ValueError("The trend raw-observation range has invalid clock/calendar bounds.")
        if last > _timestamp(answer["clock"]["snapshot_cutoff"], kind):
            raise ValueError("The trend observes a raw timestamp beyond its snapshot cutoff.")
        ranges[field] = first, last
    source, parent_range = ranges["source_time_range"], ranges["parent_time_range"]
    if parent_range is not None and (source is None or not source[0] <= parent_range[0] <= parent_range[1] <= source[1]):
        raise ValueError("The frozen parent raw range is outside its source snapshot range.")

    def support(value):
        ids = value["case_ids"]
        if ids != sorted(set(ids)) or len(ids) != value["case_count"] or value["record_count"] < len(ids) or (not ids and value["record_count"] != 0):
            raise ValueError("The trend support must supply exact unique sorted IDs, case count and complete-record support.")
        return set(ids)

    parent = support(answer["parent_support"])
    kept = support(answer["kept_support"])
    if not kept <= parent or answer["kept_support"]["record_count"] > answer["parent_support"]["record_count"]:
        raise ValueError("The kept trend support is outside the frozen parent.")
    if kept == parent and answer["kept_support"]["record_count"] != answer["parent_support"]["record_count"]:
        raise ValueError("Equal parent and kept identities must have equal complete-record support.")

    def pair(value):
        parent_ids, kept_ids = support(value["parent_support"]), support(value["kept_support"])
        if not parent_ids <= parent or kept_ids != parent_ids & kept:
            raise ValueError("A trend support does not retain its exact parent/kept membership.")
        parent_records, kept_records = value["parent_support"]["record_count"], value["kept_support"]["record_count"]
        if parent_records - kept_records < len(parent_ids - kept_ids) or (parent_ids == kept_ids and parent_records != kept_records):
            raise ValueError("A trend support does not conserve parent/kept complete records.")

    pairs = [answer[name] for name in ("available", "unevaluable", "before_range", "after_range")] + list(answer["bins"])
    reasons = list(answer["unevaluable"]["reason_supports"].values())
    for value in pairs + reasons:
        pair(value)

    def partition(total, pieces):
        for role in ("parent_support", "kept_support"):
            supports = [piece[role] for piece in pieces]
            ids = [case for value in supports for case in value["case_ids"]]
            if len(ids) != len(set(ids)) or set(ids) != set(total[role]["case_ids"]) or sum(value["record_count"] for value in supports) != total[role]["record_count"]:
                raise ValueError("The trend partitions do not conserve exact cases and complete records.")

    partition(answer, [answer["available"], answer["unevaluable"]])
    partition(answer["available"], [answer["before_range"], *answer["bins"], answer["after_range"]])
    for role in ("parent_support", "kept_support"):
        unknown = set(answer["unevaluable"][role]["case_ids"])
        reason_ids = set().union(*(set(value[role]["case_ids"]) for value in reasons))
        if reason_ids != unknown or any(value[role]["record_count"] > answer["unevaluable"][role]["record_count"] for value in reasons):
            raise ValueError("The nonadditive trend reasons must explain only unevaluable cases.")

    chosen, generation = definition["binning"], answer["bin_generation"]
    if generation["kind"] != chosen["kind"]:
        raise ValueError("The resolved trend bins changed the requested binning definition.")
    if chosen["kind"] == "explicit_edges":
        if chosen["timestamp_kind"] != kind or edges != chosen["edges"] or generation != {
            "kind": "explicit_edges", "max_bin_count": None, "upper_extension_microseconds": 0, "status": "available"}:
            raise ValueError("Explicit trend edges must remain the exact requested clock bounds.")
    else:
        status = "available" if parent_range is not None else "empty_parent" if not parent else "no_usable_parent_timestamps"
        if generation != {"kind": "parent_observed_range", "max_bin_count": chosen["max_bin_count"],
            "upper_extension_microseconds": 1 if parent_range is not None else 0, "status": status}:
            raise ValueError("Parent-derived bin availability and extension must remain explicit.")
        if parent_range is None:
            if edges or answer["available"]["parent_support"]["case_count"]:
                raise ValueError("An unobserved parent has no generated timestamp edges or available starts.")
        else:
            first, last = parent_range
            if len(answer["bins"]) > chosen["max_bin_count"] or not moments or moments[0] != first or moments[-1] - last != timedelta(microseconds=1):
                raise ValueError("Generated trend edges must cover the exact parent raw range with its one-microsecond extension.")
            if answer["before_range"]["parent_support"]["case_count"] or answer["after_range"]["parent_support"]["case_count"]:
                raise ValueError("Parent-derived bins must retain every available parent start.")
