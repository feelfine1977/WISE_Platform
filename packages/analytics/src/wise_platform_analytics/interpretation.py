"""Exact interpretation support, raw witnesses and declared time-domain coverage."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping
from itertools import groupby
from typing import TYPE_CHECKING

from .time_formats import TimeInterpretation, iso_local, iso_utc

if TYPE_CHECKING:
    from .preparation import PreparedRecord, SourceReading


def interpretation_report(reading: SourceReading, records: tuple[PreparedRecord, ...], histories: Mapping[str, tuple[PreparedRecord, ...]],
                          mapping: Mapping[str, object], clock: TimeInterpretation) -> dict[str, object]:
    issues = list(reading.issues)
    duplicates = 0
    # Equal cells mean an equal case identifier, so a repeat can only be found within one case or among the
    # unassigned rows. Checking each group in source order finds every repeat without one table over all records.
    for group in (*histories.values(), [row for row in records if row.case_id is None]):
        seen = set()
        for row in sorted(group, key=lambda row: row.source_position):
            if row.original_cells in seen:
                duplicates += 1
                issues.append({"source_position": row.source_position, "column_index": None, "case_id": row.case_id,
                               "code": "duplicate_candidate", "severity": "warning", "message": "These original cells repeat an earlier row; both observations are retained."})
            seen.add(row.original_cells)
    tied_groups = tied_rows = 0
    for case, rows in histories.items():
        times = Counter(row.time_value for row in rows if row.time_value is not None)
        counts = [count for count in times.values() if count > 1]
        tied_groups += len(counts)
        tied_rows += sum(counts)
        if mapping["sequence_column"] is not None:
            prior_max = None
            timed = [row for row in rows if row.time_value is not None and row.source_sequence is not None]
            for _, group in groupby(timed, key=lambda row: row.time_value):
                group_rows = list(group)
                for row in group_rows:
                    if prior_max is not None and row.source_sequence < prior_max:
                        issues.append({"source_position": row.source_position, "column_index": mapping["sequence_column"], "case_id": case,
                                       "code": "timestamp_sequence_disagreement", "severity": "warning",
                                       "message": "Timestamp and sequence disagree; the declared time-first authority is retained."})
                group_max = max(row.source_sequence for row in group_rows)
                prior_max = group_max if prior_max is None else max(prior_max, group_max)
    identified = [row for row in records if row.case_id is not None]
    usable = [row.time_value for row in records if row.time_value is not None]
    ordered_cases = sum(all(row.timestamp_status == "usable" and (mapping["sequence_column"] is None or row.source_sequence is not None) for row in rows) for rows in histories.values())
    activity_rows = Counter(row.activity for row in identified if row.activity is not None)
    activity_cases = defaultdict(set)
    for row in identified:
        if row.activity is not None:
            activity_cases[row.activity].add(row.case_id)
    columns = sorted({mapping["case_column"], mapping["activity_column"], mapping["timestamp_column"], *mapping["context_columns"]}
                     | ({mapping["sequence_column"]} if mapping["sequence_column"] is not None else set()))
    missing_cells = []
    for index in columns:
        count = sum((cells[index].strip() == "" if index == mapping["case_column"] else cells[index] == "")
                    for row in records if index < len(cells := row.original_cells))
        missing_cells.append({"column_index": index, "record_count": count})
    excluded = [reading.excluded[row.source_position].excluded_dict("ragged_record" if len(row.original_cells) != len(reading.columns) else "missing_case_id")
                for row in records if row.case_id is None]
    first, last = (min(usable), max(usable)) if usable else (None, None)
    wall = clock.kind == "wall_clock"
    assumptions = ["All identified incidents retain every original record; unassigned rows remain in the preserved source.",
                   "Activity omission changes the mapped sequence only; duplicate candidates are retained.",
                   "Unavailable times are placed last for evidence presentation only; their case sequence is unevaluable."]
    if wall:
        assumptions.append("Wall clock as recorded has no UTC instant or machine timezone. Wall-clock differences across daylight-saving or offset changes can differ from physical elapsed time, often by one hour.")
    elif clock.mode == "fixed_offset":
        assumptions.append(f"Every unzoned timestamp uses the explicitly chosen fixed UTC offset of {clock.offset_minutes} minutes; no daylight-saving adjustment is inferred.")
    else:
        assumptions.append("UTC instants use each source value's explicit recorded offset.")
    return {"raw_record_count": len(records), "identified_record_count": len(identified), "unassigned_record_count": len(records) - len(identified),
            "usable_timestamp_record_count": len(usable), "unavailable_timestamp_record_count": len(records) - len(usable),
            "case_count": len(histories), "sequence_evaluable_case_count": ordered_cases, "sequence_unevaluable_case_count": len(histories) - ordered_cases,
            "mapped_activity_record_count": sum(row.activity is not None for row in identified), "omitted_activity_record_count": sum(row.activity is None for row in identified),
            "timestamp_kind": clock.kind,
            "first_usable_utc_instant": iso_utc(first) if first is not None and not wall else None,
            "last_usable_utc_instant": iso_utc(last) if last is not None and not wall else None,
            "first_usable_local_timestamp": iso_local(first) if first is not None and wall else None,
            "last_usable_local_timestamp": iso_local(last) if last is not None and wall else None,
            "snapshot_cutoff_utc": None if wall else iso_utc(clock.cutoff), "snapshot_cutoff_local": iso_local(clock.cutoff) if wall else None,
            "missing_cells": missing_cells, "tied_timestamp_groups": tied_groups, "tied_timestamp_record_count": tied_rows,
            "duplicate_candidate_record_count": duplicates,
            "activities": [{"activity": activity, "record_count": activity_rows[activity], "case_count": len(activity_cases[activity])} for activity in sorted(activity_rows)],
            "issues": sorted(issues, key=lambda issue: (issue["source_position"], issue["code"])), "assumptions": assumptions,
            "blank_record_count": reading.blank_record_count, "ragged_record_count": reading.ragged_record_count,
            "excluded_source_records": excluded}
