"""Numbers in a context column the analyst declared numeric: how a cell is read, how an incident is projected to its
numbers, and their distribution on bins fixed by the parent.

One reading rule, ``incident.context.number.point_or_comma_decimal.v1``: after the outer whitespace is set aside, a cell
is a number when it is an optional sign, digits and at most one decimal separator, a point or a comma, followed by
digits ("0.8", "0,8", "-12", ",5"). Nothing else is read: no thousands separator, no exponent, no unit, no currency sign.
An empty cell is missing; any other cell is "not a number". The records keep their cells unchanged.

Three projections of an incident, as for other context:

- ``first_record``: the number of the first record in the declared order; the order must be known;
- ``latest_record``: the number of the last record in the declared order whose cell is not empty, the latest value
  recorded in the export taken at the snapshot cutoff; the order must be known;
- ``any_record``: every number any record holds; an incident can count in several bins.

An incident without the projected number is unavailable, with its reason (``order_unknown``, ``missing``,
``not_a_number``), never zero.
"""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Iterable, Mapping
import math
import re

NUMBER_POLICY = "incident.context.number.point_or_comma_decimal.v1"
PROJECTIONS = ("first_record", "latest_record", "any_record")
REASONS = ("order_unknown", "missing", "not_a_number")
BINNING_POLICY = "incident.context.number.equal_width_parent_range.v1"
_NUMBER = re.compile(r"[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)")


def read_number(cell: str | None) -> tuple[str, float | None]:
    """A cell as ("number", value), ("missing", None) or ("not_a_number", None)."""
    if cell is None or cell == "":
        return "missing", None
    text = cell.strip()
    if not _NUMBER.fullmatch(text):
        return "not_a_number", None
    value = float(text.replace(",", "."))
    return ("number", value) if math.isfinite(value) else ("not_a_number", None)


def numeric_columns(prepared) -> dict[int, str | None]:
    """The context columns declared numeric for this preparation, with their units."""
    return {item["column_index"]: item["unit"] for item in prepared.mapping.get("numeric_context_columns", ())}


def project(prepared, case_id: str, column: int, projection: str) -> tuple[str, tuple[float, ...]]:
    """("number", values) or (reason, ()) for one incident under one projection."""
    records = prepared.histories[case_id]
    if projection == "any_record":
        read = [read_number(record.context_value(column)) for record in records]
        values = tuple(sorted({value for state, value in read if state == "number"}))
        if values:
            return "number", values
        return ("not_a_number" if any(state == "not_a_number" for state, _ in read) else "missing"), ()
    if not records or not prepared.sequence_evaluable(case_id):
        return "order_unknown", ()
    if projection == "first_record":
        cell = records[0].context_value(column)
    else:
        cell = next((record.context_value(column) for record in reversed(records) if record.context_value(column) is not None), None)
    state, value = read_number(cell)
    return (state, (value,)) if state == "number" else (state, ())


def in_range(values: Iterable[float], minimum: float | None, maximum: float | None) -> bool:
    """Whether one of the values lies in the half-open range [minimum, maximum); a missing bound does not bound."""
    return any((minimum is None or value >= minimum) and (maximum is None or value < maximum) for value in values)


def edges_of(values: Iterable[float], bin_count: int) -> list[float]:
    """Equal-width lower edges over the parent's range; the last bin has no upper edge, so the maximum is in it."""
    measured = list(values)
    if not measured:
        return []
    low, high = min(measured), max(measured)
    if low == high:
        return [low]
    width = (high - low) / bin_count
    return [low + index * width for index in range(bin_count)]


def _record_counts(prepared, case_ids: Iterable[str], column: int) -> dict[str, int]:
    """How the records' cells of the column read: numbers, missing, and "not a number", which are kept and counted, never zero."""
    counts = {"number": 0, "missing": 0, "not_a_number": 0}
    for case_id in case_ids:
        for record in prepared.histories[case_id]:
            counts[read_number(record.context_value(column))[0]] += 1
    return {f"{state}_record_count": count for state, count in counts.items()}


def _support(projected: Mapping[str, tuple[str, tuple[float, ...]]], members: tuple[str, ...]) -> dict[str, object]:
    unavailable = {reason: 0 for reason in REASONS}
    for case_id in members:
        state = projected[case_id][0]
        if state != "number":
            unavailable[state] += 1
    return {"case_count": len(members), "measured_case_count": len(members) - sum(unavailable.values()),
            "unavailable": [{"reason": reason, "case_count": unavailable[reason]} for reason in REASONS]}


def distribution(prepared, kept_ids: Iterable[str], parent_ids: Iterable[str], column: int, projection: str, bin_count: int) -> dict[str, object]:
    """The column's range in the parent and its distribution on bins fixed by the parent, for the parent and the kept."""
    kept, parent = tuple(kept_ids), tuple(parent_ids)
    projected = {case_id: project(prepared, case_id, column, projection) for case_id in parent}
    parent_values = [value for state, values in projected.values() if state == "number" for value in values]
    edges = edges_of(parent_values, bin_count)
    kept_set = set(kept)
    bins = [{"start_inclusive": edge, "end_exclusive": edges[index + 1] if index + 1 < len(edges) else None, "parent_case_count": 0, "kept_case_count": 0}
            for index, edge in enumerate(edges)]
    for case_id in parent:
        state, values = projected[case_id]
        if state != "number":
            continue
        # An incident counts once in each bin one of its numbers falls into.
        for place in sorted({bisect_right(edges, value) - 1 for value in values}):
            bins[place]["parent_case_count"] += 1
            if case_id in kept_set:
                bins[place]["kept_case_count"] += 1
    return {
        "number_policy": NUMBER_POLICY, "binning_policy": BINNING_POLICY, "projection": projection, "column_index": column,
        "unit": numeric_columns(prepared).get(column),
        "parent_range": {"minimum": min(parent_values), "maximum": max(parent_values)} if parent_values else None,
        "bins": bins, "membership_overlaps": projection == "any_record",
        "parent": {**_support(projected, parent), "records": _record_counts(prepared, parent, column)},
        "kept": {**_support(projected, kept), "records": _record_counts(prepared, kept, column)},
    }
