"""Generic case-list and fixed-parent distribution projections of complete histories."""
from __future__ import annotations

from bisect import bisect_right
from collections.abc import Iterable, Mapping
import math

from .case_time import CaseTimeError, SUMMARY_POLICY, case_time_summary
from .mapping import ImportRefusal
from .selection import SelectionError, case_ids as checked_case_ids
from .time_formats import iso_local, iso_utc

DISTRIBUTION_POLICY = "incident.case_distribution.explicit_hours_half_open.v1"
DEFAULT_EDGES_HOURS = (0, 1, 24, 168, 720, 2160)
MAX_SAFE_INTEGER = 9007199254740991
_SORT_FIELDS = {"case_id", "record_count", "first_recorded_time", "observed_span_hours", "maximum_adjacent_raw_gap_hours"}
_MEASURES = {"observed_span_hours", "maximum_adjacent_raw_gap_hours"}


def _finite_number(value: object) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def validate_case_list_query(query: object) -> ImportRefusal | None:
    if not isinstance(query, Mapping) or set(query) not in (
        {"search_text", "sort", "offset", "limit"}, {"search_text", "sort", "offset", "limit", "distribution"}
    ):
        return ImportRefusal("invalid_parameter", "The list query must contain its closed search, sort and page fields.", "query")
    if query["search_text"] is not None and not isinstance(query["search_text"], str):
        return ImportRefusal("invalid_parameter", "The search is literal incident-ID text or null.", "query.search_text")
    sort = query["sort"]
    if not isinstance(sort, Mapping) or set(sort) != {"field", "direction"}:
        return ImportRefusal("invalid_parameter", "The sort must name only a field and a direction.", "query.sort")
    if not isinstance(sort["field"], str) or sort["field"] not in _SORT_FIELDS:
        return ImportRefusal("invalid_parameter", "The list cannot sort by this field.", "query.sort.field")
    if not isinstance(sort["direction"], str) or sort["direction"] not in {"ascending", "descending"}:
        return ImportRefusal("invalid_parameter", "The sort direction is ascending or descending.", "query.sort.direction")
    if type(query["offset"]) is not int or not 0 <= query["offset"] <= MAX_SAFE_INTEGER:
        return ImportRefusal("invalid_parameter", "The page offset is a nonnegative supported safe integer.", "query.offset")
    if type(query["limit"]) is not int or not 1 <= query["limit"] <= 200:
        return ImportRefusal("invalid_parameter", "The page size is an integer from one to 200.", "query.limit")
    if "distribution" in query:
        distribution = query["distribution"]
        if not isinstance(distribution, Mapping) or set(distribution) != {"measure", "edges_hours"}:
            return ImportRefusal("invalid_parameter", "The distribution must name only its measure and explicit hour edges.", "query.distribution")
        if not isinstance(distribution["measure"], str) or distribution["measure"] not in _MEASURES:
            return ImportRefusal("invalid_parameter", "The distribution measure is recorded span or maximum adjacent raw gap.", "query.distribution.measure")
        edges = distribution["edges_hours"]
        if not isinstance(edges, list) or not 1 <= len(edges) <= 32:
            return ImportRefusal("invalid_parameter", "The distribution needs one to 32 explicit hour edges.", "query.distribution.edges_hours")
        if any(not _finite_number(edge) or edge < 0 for edge in edges):
            return ImportRefusal("invalid_parameter", "Every edge must be a finite nonnegative number of hours.", "query.distribution.edges_hours")
        if edges[0] != 0 or any(left >= right for left, right in zip(edges, edges[1:])):
            return ImportRefusal("invalid_parameter", "Hour edges must start at zero and increase strictly.", "query.distribution.edges_hours")
    return None


def _row(prepared, case_id: str, summary: dict) -> dict:
    records = prepared.histories[case_id]
    omitted = sum(record.activity is None for record in records)
    gap_context = None
    witness = summary["maximum_gap_witness"]
    if witness is not None:
        by_id = {record.row_id: record for record in records}
        def context(row_id):
            return [{"column_index": item.column_index, "value": item.value} for item in by_id[row_id].context]
        gap_context = {"from_context": context(witness["from_row_id"]), "to_context": context(witness["to_row_id"])}
    return {"case_id": case_id, "record_count": len(records), "mapped_record_count": len(records) - omitted,
            "omitted_activity_record_count": omitted, "sequence_evaluable": prepared.sequence_evaluable(case_id),
            "time_summary": summary, "maximum_gap_context": gap_context}


def _distribution_support(summaries: Mapping[str, dict], members: tuple[str, ...], measure: str, edges: list) -> tuple[list[int], dict]:
    counts = [0] * len(edges)
    unavailable = {suffix: 0 for suffix in ("case_count", "order_unknown_case_count", "fewer_than_two_records_case_count")}
    for case_id in members:
        summary = summaries[case_id]
        value = summary[measure]
        if value is None:
            reason = summary["observed_span_unavailable_reason" if measure == "observed_span_hours" else "maximum_adjacent_raw_gap_unavailable_reason"]
            unavailable["case_count"] += 1
            unavailable[reason + "_case_count"] += 1
        else:
            counts[bisect_right(edges, value) - 1] += 1
    return counts, unavailable


def case_distribution_baseline(summaries: Mapping[str, dict], parent: tuple[str, ...], chosen: Mapping[str, object], kind: str) -> dict:
    """Reduce the whole parent once for reuse with independently kept groups."""
    measure, edges = chosen["measure"], list(chosen["edges_hours"])
    counts, unavailable = _distribution_support(summaries, parent, measure, edges)
    return {"policy_id": DISTRIBUTION_POLICY, "measure": measure, "timestamp_kind": kind, "edges_hours": edges,
            "parent_case_count": len(parent), "parent_available_case_count": len(parent) - unavailable["case_count"],
            "bins": [{"start_inclusive_hours": edge, "end_exclusive_hours": edges[index + 1] if index + 1 < len(edges) else None,
                      "parent_case_count": counts[index]} for index, edge in enumerate(edges)],
            "unavailable": {"parent_" + name: count for name, count in unavailable.items()}}


def case_distribution_for_kept(summaries: Mapping[str, dict], kept: tuple[str, ...], baseline: Mapping[str, object]) -> dict:
    """Add kept support without rescanning or modifying the parent baseline."""
    edges = list(baseline["edges_hours"])
    counts, unavailable = _distribution_support(summaries, kept, baseline["measure"], edges)
    return {**baseline, "edges_hours": edges, "kept_case_count": len(kept),
            "kept_available_case_count": len(kept) - unavailable["case_count"],
            "bins": [{**item, "kept_case_count": counts[index]} for index, item in enumerate(baseline["bins"])],
            "unavailable": {**baseline["unavailable"], **{"kept_" + name: count for name, count in unavailable.items()}}}


def _distribution(summaries: Mapping[str, dict], parent: tuple[str, ...], kept: tuple[str, ...], chosen: Mapping[str, object], kind: str) -> dict:
    return case_distribution_for_kept(summaries, kept, case_distribution_baseline(summaries, parent, chosen, kind))


def _parent_time_range(prepared, parent: tuple[str, ...], kind: str) -> dict | None:
    moments = []
    for case_id in parent:
        for record in prepared.histories[case_id]:
            if record.timestamp_status == "usable" and record.time_value is not None:
                if record.timestamp_kind != kind:
                    raise CaseTimeError("inconsistent_time_kind", "A usable parent timestamp disagrees with the prepared clock.")
                if (record.time_value.tzinfo is None) != (kind == "wall_clock"):
                    raise CaseTimeError("inconsistent_time_kind", "A usable parent timestamp does not have its declared clock kind.")
                moments.append(record.time_value)
    if not moments:
        return None
    format_time = iso_local if kind == "wall_clock" else iso_utc
    return {"timestamp_kind": kind, "earliest_recorded_timestamp": format_time(min(moments)),
            "latest_recorded_timestamp": format_time(max(moments))}


def case_list_projection(prepared, selected_ids: Iterable[str], parent_ids: Iterable[str], query: Mapping[str, object]) -> dict | ImportRefusal:
    """List the selected cases; bins remain fixed over the actual whole parent.

    Search, sorting and paging are views. They never remove cases from either
    distribution denominator or register a new analytical population.
    """
    problem = validate_case_list_query(query)
    if problem is not None:
        return problem
    try:
        parent = checked_case_ids(prepared, parent_ids)
        kept = checked_case_ids(prepared, selected_ids)
        if not set(kept) <= set(parent):
            return ImportRefusal("identity_mismatch", "The selected incidents are outside their frozen parent.", "identity.population_id")
        summaries = {case_id: case_time_summary(prepared, case_id) for case_id in parent}
        policy_id = prepared.policies["time"]["id"]
        if policy_id not in {"incident.time.wall_clock_as_recorded.v1", "incident.time.explicit_format_timezone_utc.v1"}:
            return ImportRefusal("unsupported_policy", "The prepared clock policy is not supported by this projection.", "identity.preparation_id")
        kind = "wall_clock" if policy_id == "incident.time.wall_clock_as_recorded.v1" else "utc_instant"
        parent_range = _parent_time_range(prepared, parent, kind)
        distribution = _distribution(summaries, parent, kept, query.get("distribution", {
            "measure": "observed_span_hours", "edges_hours": DEFAULT_EDGES_HOURS}), kind)
        rows = [_row(prepared, case_id, summaries[case_id]) for case_id in kept]
        search = query["search_text"]
        if search:
            rows = [row for row in rows if search in row["case_id"]]
        field = query["sort"]["field"]
        def value(row):
            if field in {"case_id", "record_count"}:
                return row[field]
            if field == "first_recorded_time":
                return prepared.histories[row["case_id"]][0].time_value if row["time_summary"]["status"] == "available" else None
            return row["time_summary"][field]
        known = [row for row in rows if value(row) is not None]
        unknown = [row for row in rows if value(row) is None]
        # kept IDs started sorted. Stable reverse sort retains ascending ID ties.
        known.sort(key=value, reverse=query["sort"]["direction"] == "descending")
        ordered = known + unknown
        offset, limit = query["offset"], query["limit"]
        page = ordered[offset:offset + limit]
        return {"summary_policy": SUMMARY_POLICY,
                "context_columns": [{"column_index": index, "name": prepared.columns[index]} for index in prepared.mapping["context_columns"]],
                "parent_time_range": parent_range, "distribution": distribution,
                "population_case_count": len(kept), "population_record_count": sum(len(prepared.histories[c]) for c in kept),
                "total_matching_case_count": len(ordered), "next_offset": offset + limit if offset + limit < len(ordered) else None,
                "rows": page}
    except (SelectionError, CaseTimeError) as error:
        return ImportRefusal(error.code, str(error), "identity.population_id")
