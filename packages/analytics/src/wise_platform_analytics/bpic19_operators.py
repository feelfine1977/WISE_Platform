"""Finite declared, source-witnessed operators over complete original PO-item histories.

These are descriptive recipes. Inferred episodes are not native invoice IDs,
and recorded nonmatches are not future obligations or normative judgements.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta
import math
import re

from .mapping import ImportRefusal
from .preparation import PreparedData, PreparedRecord, content_identity
from .selection import SelectionError, case_ids as checked_case_ids
from .time_formats import iso_local, iso_utc

POLICY_ID = "bpic19.declared_operators.v1"
FLOW_LABELS = {
    "3-way match, invoice after GR": "after_gr",
    "3-way match, invoice before GR": "before_gr",
    "2-way match": "two_way",
    "Consignment": "consignment",
}
_EVENT_ID = re.compile(r"[0-9]{1,64}")
_ISO = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})?"
)


def _stamp(value: datetime | None) -> str | None:
    return (
        None
        if value is None
        else iso_local(value) if value.tzinfo is None else iso_utc(value)
    )


def _parse(text: str, kind: str) -> datetime:
    if not isinstance(text, str) or _ISO.fullmatch(text) is None:
        raise ValueError("Horizon boundaries require ISO timestamps with seconds.")
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if (value.tzinfo is None) != (kind == "wall_clock"):
        raise ValueError("Horizon boundaries must use the prepared clock kind.")
    return value


def checked_roles(prepared: PreparedData, roles: Mapping) -> dict:
    if not isinstance(roles, Mapping) or set(roles) != {
        "event_id",
        "item_category",
        "net_worth",
    }:
        raise ValueError(
            "Review event_id, item_category and net_worth original-column roles."
        )
    result = dict(roles)
    for name, column in result.items():
        if column is not None and (
            type(column) is not int or not 0 <= column < len(prepared.columns)
        ):
            raise ValueError(
                f"The {name} role must identify an original column or null."
            )
    return result


def _labels(value: object) -> None:
    if (
        not isinstance(value, list)
        or not 1 <= len(value) <= 8
        or any(not isinstance(v, str) or not v or len(v) > 256 for v in value)
        or len(set(value)) != len(value)
    ):
        raise ValueError(
            "Activity selectors require 1–8 distinct nonempty exact labels."
        )


def checked_recipe(prepared: PreparedData, recipe: Mapping, roles: Mapping) -> dict:
    if not isinstance(recipe, Mapping):
        raise ValueError("Choose a registered operator recipe.")
    r = dict(recipe)
    kind = r.get("kind")
    fields = {
        "ordinal": {"kind", "order", "stages", "receipt", "cancellation", "ties"},
        "fifo": {"kind", "order", "stages", "receipt", "cancellation", "ties"},
        "cancellation": {
            "kind",
            "target_activities",
            "cancellation_activities",
            "reuse",
            "ties",
            "ambiguity",
            "amount_filter",
            "tolerance",
            "max_window_days",
        },
        "rule": {
            "kind",
            "left_activities",
            "right_activities",
            "relation",
            "position",
            "quantifier",
            "reuse",
            "ties",
            "vacuity",
            "flow_scope",
        },
        "waiting": {
            "kind",
            "activation_activities",
            "response_activities",
            "endpoints",
            "completion",
            "horizon_start",
            "horizon_end",
            "horizon_provenance",
            "horizon_policy",
            "calendar",
        },
    }
    if not isinstance(kind, str) or kind not in fields or set(r) != fields[kind]:
        raise ValueError("This recipe has missing or unsupported parameters.")

    def enum(name, choices):
        if not isinstance(r[name], str) or r[name] not in choices:
            raise ValueError(f"Unsupported {name} choice.")

    if kind in {"ordinal", "fifo"}:
        enum(
            "order",
            (
                {"numeric_event_id", "timestamp_source_position"}
                if kind == "ordinal"
                else {
                    "source_position",
                    "timestamp_source_position",
                    "timestamp_numeric_event_id",
                }
            ),
        )
        enum("stages", {"gr_ir_ci", "ir_gr_ci", "ir_ci", "auto_flow"})
        enum("receipt", {"goods", "goods_or_service"})
        enum("cancellation", {"retain", "exclude_item"})
        enum(
            "ties",
            (
                {"source_position", "ambiguous"}
                if kind == "ordinal"
                else {"allow_equal", "strict_time"}
            ),
        )
        if r["order"] == "numeric_event_id" and roles["event_id"] is None:
            raise ValueError(
                "Numeric-eventID ordinals require an explicitly reviewed event_id column."
            )
        if r["order"] == "timestamp_numeric_event_id" and roles["event_id"] is None:
            raise ValueError(
                "Timestamp/numeric-eventID FIFO requires an explicitly reviewed event_id column."
            )
        if r["stages"] == "auto_flow" and roles["item_category"] is None:
            raise ValueError(
                "Automatic flow stages require a reviewed invariant category field."
            )
    elif kind == "cancellation":
        _labels(r["target_activities"])
        _labels(r["cancellation_activities"])
        if set(r["target_activities"]) & set(r["cancellation_activities"]):
            raise ValueError("Receipt and cancellation label sets must be disjoint.")
        enum("reuse", {"allow", "consume"})
        enum("ties", {"strict_before", "allow_equal_source_before"})
        enum("ambiguity", {"refuse", "source_position"})
        enum("amount_filter", {"ignore", "equal", "opposite"})
        for name in ["tolerance", "max_window_days"]:
            if name == "max_window_days" and r[name] is None:
                continue
            if (
                type(r[name]) not in {int, float}
                or not math.isfinite(r[name])
                or r[name] < 0
            ):
                raise ValueError(f"{name} must be a finite nonnegative number.")
        if r["amount_filter"] != "ignore" and roles["net_worth"] is None:
            raise ValueError(
                "Amount-dependent matching requires a reviewed value field."
            )
    elif kind == "rule":
        _labels(r["left_activities"])
        _labels(r["right_activities"])
        enum("relation", {"response", "precedence"})
        enum("position", {"raw_direct", "eventual"})
        enum("quantifier", {"some", "every"})
        enum("reuse", {"allow", "consume"})
        enum("ties", {"allow_equal", "strict"})
        enum("vacuity", {"not_activated", "logical"})
        enum("flow_scope", {"all", *FLOW_LABELS.values()})
        if r["flow_scope"] != "all" and roles["item_category"] is None:
            raise ValueError("A flow-scoped rule requires the reviewed category field.")
    else:
        _labels(r["activation_activities"])
        _labels(r["response_activities"])
        enum("endpoints", {"first_first", "first_last", "first_after"})
        enum("completion", {"completed_only", "right_censored"})
        enum("horizon_policy", {"refuse_outside", "clip"})
        enum("calendar", {"elapsed_segments", "daily_snapshots"})
        kind_clock = prepared.records[0].timestamp_kind
        start, end = _parse(r["horizon_start"], kind_clock), _parse(
            r["horizon_end"], kind_clock
        )
        if end <= start:
            raise ValueError("The horizon end must be after its start.")
        params = prepared.policies.get("time", {}).get("parameters", {})
        cutoff_text = (
            params.get("snapshot_cutoff_local")
            if kind_clock == "wall_clock"
            else params.get("snapshot_cutoff_utc")
        )
        provenance = r["horizon_provenance"]
        if provenance is not None and (
            not isinstance(provenance, str)
            or not provenance.strip()
            or len(provenance) > 1000
        ):
            raise ValueError(
                "Horizon provenance must name the reviewed source authority in 1–1,000 characters or be null."
            )
        if r["completion"] == "right_censored":
            if provenance is None:
                raise ValueError(
                    "Right censoring requires explicit reviewed observation-horizon provenance."
                )
            if cutoff_text is None:
                raise ValueError(
                    "Right censoring requires the preparation's explicitly trusted snapshot cutoff."
                )
            if end > _parse(cutoff_text, kind_clock):
                raise ValueError(
                    "The waiting horizon exceeds the trusted source snapshot cutoff."
                )
        if r["calendar"] == "daily_snapshots" and (end - start).days > 36600:
            raise ValueError(
                "Daily snapshots support a reviewed horizon of at most 100 years."
            )
    return r


def _number(row: PreparedRecord, column: int | None) -> float | None:
    if column is None:
        return None
    try:
        value = float(row.original_cells[column])
        return value if math.isfinite(value) else None
    except (ValueError, OverflowError):
        return None


def _raw(
    value: int | float | None,
    rows: Iterable[str],
    unit: str,
    reason: str | None = None,
    **extra,
) -> dict:
    if isinstance(value, float) and not math.isfinite(value):
        value, reason = None, "nonfinite_derived_value"
    if isinstance(rows, (set, frozenset)):
        rows = sorted(rows)
    return {
        "value": value if reason is None else None,
        "available": reason is None,
        "reason": reason,
        "unit": unit,
        "row_ids": list(dict.fromkeys(rows)),
        **extra,
    }


def _interval(first: PreparedRecord | None, last: PreparedRecord | None) -> dict:
    rows = [row.row_id for row in (first, last) if row is not None]
    reason = (
        "unmatched_endpoint"
        if first is None or last is None
        else (
            "unknown_endpoint_time"
            if first.time_value is None or last.time_value is None
            else None
        )
    )
    days = (
        None if reason else (last.time_value - first.time_value).total_seconds() / 86400
    )
    if days is not None and days < 0:
        reason = "reversed_interval"
    return _raw(days, rows, "days", reason, recorded_difference_days=days)


def _case(prepared: PreparedData, case_id: str) -> dict:
    rows = prepared.histories[case_id]
    return {
        "case_id": case_id,
        "state": "evaluated",
        "reason": None,
        "record_count": len(rows),
        "record_row_ids": [row.row_id for row in rows],
        "observations": [],
        "unmatched_row_ids": [],
        "included_row_ids": [],
        "excluded_row_ids": [],
        "unknown_row_ids": [],
        "totals": {},
        "truth": None,
        "activation_count": 0,
        "known_activation_count": 0,
    }


def _observation(
    definition_id: str,
    case_id: str,
    index: int,
    state: str,
    reason: str | None,
    activation=(),
    response=(),
    candidates=(),
    unknown=(),
    **extra,
) -> dict:
    result = {
        "ordinal": index,
        "state": state,
        "reason": reason,
        "activation_row_ids": list(activation),
        "response_row_ids": list(response),
        "candidate_row_ids": list(candidates),
        "unknown_row_ids": list(unknown),
        "truth": None,
        "intervals": {},
        "start": None,
        "end": None,
        "native_invoice_id": None,
        **extra,
    }
    result["observation_id"] = content_identity(
        "bpic19-observation",
        {"definition_id": definition_id, "case_id": case_id, **result},
    )
    return result


def _category(
    rows: tuple[PreparedRecord, ...], column: int | None
) -> tuple[str | None, str | None]:
    if column is None:
        return None, "category_role_unmapped"
    values = {row.original_cells[column] for row in rows}
    if len(values) != 1:
        return None, "conflicting_case_attribute"
    label = next(iter(values))
    return FLOW_LABELS.get(label), (
        None
        if label in FLOW_LABELS
        else "missing_category" if not label else "unrecognized_category"
    )


def _stages(
    prepared: PreparedData, case_id: str, recipe: Mapping, roles: Mapping
) -> tuple[list[set[str]], str | None]:
    receipts = {"Record Goods Receipt"} | (
        {"Record Service Entry Sheet"}
        if recipe["receipt"] == "goods_or_service"
        else set()
    )
    mode = recipe["stages"]
    if mode == "auto_flow":
        flow, reason = _category(prepared.histories[case_id], roles["item_category"])
        if reason:
            return [], reason
        if flow == "consignment":
            return [], "consignment_outside_invoice_episodes"
        mode = "ir_ci" if flow == "two_way" else "gr_ir_ci"
        if flow == "before_gr":
            relevant = [
                row
                for row in prepared.histories[case_id]
                if row.activity in receipts | {"Record Invoice Receipt"}
            ]
            if recipe["order"] == "numeric_event_id":
                values = [
                    row.original_cells[roles["event_id"]].strip() for row in relevant
                ]
                if any(_EVENT_ID.fullmatch(value) is None for value in values):
                    return [], "invalid_event_id"
                if len({int(value) for value in values}) != len(values):
                    return [], "ambiguous_event_id"
                relevant.sort(
                    key=lambda row: int(row.original_cells[roles["event_id"]].strip())
                )
            elif recipe["order"] == "source_position":
                relevant.sort(key=lambda row: row.source_position)
            elif recipe["order"] == "timestamp_numeric_event_id":
                keys, invalid = _fifo_event_id_keys(
                    prepared.histories[case_id], roles["event_id"]
                )
                if invalid:
                    return [], "invalid_event_id"
                if any(row.time_value is None for row in relevant):
                    return [], "unknown_flow_stage_order"
                relevant.sort(
                    key=lambda row: (
                        row.time_value,
                        keys[row.row_id],
                        row.source_position,
                    )
                )
            elif any(row.time_value is None for row in relevant):
                return [], "unknown_flow_stage_order"
            else:
                relevant.sort(key=lambda row: (row.time_value, row.source_position))
            if relevant and relevant[0].activity == "Record Invoice Receipt":
                mode = "ir_gr_ci"
    stages = (
        [receipts, {"Record Invoice Receipt"}, {"Clear Invoice"}]
        if mode == "gr_ir_ci"
        else (
            [{"Record Invoice Receipt"}, receipts, {"Clear Invoice"}]
            if mode == "ir_gr_ci"
            else [{"Record Invoice Receipt"}, {"Clear Invoice"}]
        )
    )
    return stages, None


def _fifo_event_id_keys(
    records: tuple[PreparedRecord, ...], column: int
) -> tuple[dict[str, int], list[str]]:
    """Panel convention: every raw row needs a numeric ID; duplicate IDs tie by position.

    This is separate from source-compatible numeric ordinals, which reject duplicate
    IDs. Numeric IDs here break equal parsed-time ties and do not prove chronology.
    """
    keys, invalid = {}, []
    for row in records:
        raw = row.original_cells[column] if column < len(row.original_cells) else None
        text = raw.strip() if isinstance(raw, str) else ""
        if _EVENT_ID.fullmatch(text) is None:
            invalid.append(row.row_id)
        else:
            keys[row.row_id] = int(text)
    return keys, invalid


def episode_case(
    prepared: PreparedData,
    case_id: str,
    recipe: Mapping,
    roles: Mapping,
    definition_id: str,
) -> dict:
    result = _case(prepared, case_id)
    records = prepared.histories[case_id]
    numeric_fifo = recipe["order"] == "timestamp_numeric_event_id"
    event_id_keys, invalid_event_ids = (
        _fifo_event_id_keys(records, roles["event_id"]) if numeric_fifo else ({}, [])
    )
    stages, problem = _stages(prepared, case_id, recipe, roles)
    cancellations = [
        row
        for row in records
        if row.activity in {"Cancel Invoice Receipt", "Cancel Goods Receipt"}
    ]
    missing_labels = [row.row_id for row in records if row.activity is None]
    relevant = [
        row for row in records if any(row.activity in stage for stage in stages)
    ]
    if stages:
        result["known_activation_count"] = sum(
            row.activity in stages[0] for row in records
        )
        result["activation_count"] = (
            None if missing_labels else result["known_activation_count"]
        )
    elif problem and not problem.startswith("consignment_"):
        result["activation_count"] = None
    if problem:
        if numeric_fifo:
            result["unknown_row_ids"] = (
                invalid_event_ids
                if problem == "invalid_event_id"
                else [
                    row.row_id
                    for row in records
                    if problem == "unknown_flow_stage_order"
                    and row.activity
                    in {"Record Goods Receipt", "Record Invoice Receipt"}
                    | (
                        {"Record Service Entry Sheet"}
                        if recipe["receipt"] == "goods_or_service"
                        else set()
                    )
                    and row.time_value is None
                ]
            )
        result.update(
            state="outside_scope" if problem.startswith("consignment_") else "unknown",
            reason=problem,
        )
        return result
    if missing_labels:
        problem = "missing_activity_label"
    if cancellations and recipe["cancellation"] == "exclude_item":
        result.update(
            state="excluded",
            reason="cancellation_case",
            excluded_row_ids=[row.row_id for row in cancellations],
            unmatched_row_ids=[row.row_id for row in relevant],
        )
        return result
    order = recipe["order"]
    if order == "numeric_event_id":
        keys = []
        for row in records:
            text = row.original_cells[roles["event_id"]].strip()
            if _EVENT_ID.fullmatch(text) is None:
                problem = "invalid_event_id"
                result["unknown_row_ids"].append(row.row_id)
            else:
                keys.append((int(text), row))
        ids = [key for key, _ in keys]
        if len(ids) != len(set(ids)):
            problem = "ambiguous_event_id"
            result["unknown_row_ids"] += [
                row.row_id for key, row in keys if ids.count(key) > 1
            ]
        rows = [row for _, row in sorted(keys, key=lambda pair: pair[0])]
    elif order == "source_position":
        rows = sorted(records, key=lambda row: row.source_position)
    else:
        if numeric_fifo and invalid_event_ids:
            problem = "invalid_event_id"
            result["unknown_row_ids"] += invalid_event_ids
        unknown_times = [row.row_id for row in relevant if row.time_value is None]
        if unknown_times:
            problem = "unknown_chronology"
            result["unknown_row_ids"] += unknown_times
        rows = sorted(
            (
                row
                for row in records
                if row.time_value is not None
                and (not numeric_fifo or row.row_id in event_id_keys)
            ),
            key=(
                lambda row: (
                    (
                        row.time_value,
                        event_id_keys[row.row_id],
                        row.source_position,
                    )
                    if numeric_fifo
                    else (row.time_value, row.source_position)
                )
            ),
        )
        if recipe["kind"] == "ordinal" and recipe["ties"] == "ambiguous":
            for stage in stages:
                instants = Counter(
                    row.time_value
                    for row in relevant
                    if row.activity in stage and row.time_value is not None
                )
                tied = [
                    row.row_id
                    for row in relevant
                    if row.activity in stage and instants[row.time_value] > 1
                ]
                if tied:
                    problem = "ambiguous_ordinal_tie"
                    result["unknown_row_ids"] += tied
    if problem:
        result.update(
            state="unknown",
            reason=problem,
            unmatched_row_ids=[row.row_id for row in relevant],
        )
        result["unknown_row_ids"] = list(
            dict.fromkeys(result["unknown_row_ids"] + missing_labels)
        )
        return result
    groups = [[row for row in rows if row.activity in stage] for stage in stages]
    tuples = []
    if recipe["kind"] == "ordinal":
        tuples = [
            [group[n] if n < len(group) else None for group in groups]
            for n in range(max(map(len, groups), default=0))
        ]
    else:
        positions = {row.row_id: n for n, row in enumerate(rows)}
        used = set()
        for anchor in groups[0]:
            chosen = [anchor]
            for group in groups[1:]:
                prior = chosen[-1]
                partner = next(
                    (
                        row
                        for row in group
                        if row.row_id not in used
                        and prior is not None
                        and positions[row.row_id] > positions[prior.row_id]
                        and (
                            recipe["ties"] == "allow_equal"
                            or prior.time_value is not None
                            and row.time_value is not None
                            and row.time_value > prior.time_value
                        )
                    ),
                    None,
                )
                chosen.append(partner)
            tuples.append(chosen)
            if all(row is not None for row in chosen):
                used.update(row.row_id for row in chosen)
    paired = set()
    for n, selected in enumerate(tuples, 1):
        complete = all(row is not None for row in selected)
        intervals = {
            f"stage_{i+1}_to_{i+2}": _interval(selected[i], selected[i + 1])
            for i in range(len(selected) - 1)
        }
        state = (
            "unmatched"
            if not complete
            else (
                "reversed"
                if any(v["reason"] == "reversed_interval" for v in intervals.values())
                else (
                    "unknown"
                    if any(not v["available"] for v in intervals.values())
                    else (
                        "zero"
                        if all(v["value"] == 0 for v in intervals.values())
                        else "matched"
                    )
                )
            )
        )
        if complete:
            paired.update(row.row_id for row in selected)
        result["observations"].append(
            _observation(
                definition_id,
                case_id,
                n,
                state,
                (
                    None
                    if state in {"matched", "zero"}
                    else (
                        "unmatched_endpoint"
                        if state == "unmatched"
                        else (
                            "reversed_interval"
                            if state == "reversed"
                            else "unknown_endpoint_time"
                        )
                    )
                ),
                activation=[selected[0].row_id] if selected[0] else [],
                response=[selected[-1].row_id] if selected[-1] else [],
                intervals=intervals,
                stage_row_ids=[
                    row.row_id if row is not None else None for row in selected
                ],
                selected_row_ids=[row.row_id for row in selected if row is not None],
            )
        )
    result["unmatched_row_ids"] = [
        row.row_id for row in relevant if row.row_id not in paired
    ]
    result["included_row_ids"] = [row.row_id for row in records if row.row_id in paired]
    result["totals"] = {
        "paired_episode_count": _raw(
            sum(
                all(v is not None for v in observation["stage_row_ids"])
                for observation in result["observations"]
            ),
            result["included_row_ids"],
            "inferred_episodes",
        ),
        "unmatched_event_count": _raw(
            len(result["unmatched_row_ids"]),
            result["unmatched_row_ids"],
            "original_events",
        ),
        "paired_endpoint_event_count": _raw(
            len(paired), result["included_row_ids"], "original_events"
        ),
        "cancellation_count": _raw(
            len(cancellations), (row.row_id for row in cancellations), "original_events"
        ),
    }
    for n, group in enumerate(groups, 1):
        leftover = [row.row_id for row in group if row.row_id not in paired]
        result["totals"][f"stage_{n}_event_count"] = _raw(
            len(group), (row.row_id for row in group), "original_events"
        )
        result["totals"][f"stage_{n}_unmatched_event_count"] = _raw(
            len(leftover), leftover, "original_events"
        )
    return result


def _amounts(rows: Iterable[PreparedRecord], column: int | None, prefix: str) -> dict:
    records = list(rows)
    valid = [(row, _number(row, column)) for row in records]
    invalid = [row.row_id for row, value in valid if value is None]
    reason = (
        "value_role_unmapped"
        if column is None
        else "invalid_or_missing_value" if invalid else None
    )
    values = [v for _, v in valid if v is not None]
    ids = [row.row_id for row in records]
    try:
        total = math.fsum(values)
    except OverflowError:
        total = math.inf
    average = math.fsum(v / len(values) for v in values) if values else None
    return {
        prefix + "sum": _raw(total, ids, "EUR", reason),
        prefix
        + "mean": _raw(
            average,
            ids,
            "EUR",
            reason or ("no_selected_values" if not values else None),
        ),
        prefix
        + "maximum_absolute": _raw(
            max((abs(v) for v in values), default=None),
            ids,
            "EUR",
            reason or ("no_selected_values" if not values else None),
        ),
        prefix
        + "zero_count": _raw(
            sum(v == 0 for v in values), ids, "original_events", reason
        ),
        prefix
        + "negative_count": _raw(
            sum(v < 0 for v in values), ids, "original_events", reason
        ),
    }


def cancellation_case(
    prepared: PreparedData,
    case_id: str,
    recipe: Mapping,
    roles: Mapping,
    definition_id: str,
) -> dict:
    result = _case(prepared, case_id)
    records = prepared.histories[case_id]
    targets = [row for row in records if row.activity in recipe["target_activities"]]
    cancellations = sorted(
        (row for row in records if row.activity in recipe["cancellation_activities"]),
        key=lambda row: (
            row.time_value is None,
            row.time_value or datetime.min,
            row.source_position,
        ),
    )
    unknown_labels = [row.row_id for row in records if row.activity is None]
    unknown_times = [
        row.row_id for row in targets + cancellations if row.time_value is None
    ]
    used = set()
    result["activation_count"] = None if unknown_labels else len(cancellations)
    result["known_activation_count"] = len(cancellations)
    for n, cancellation in enumerate(cancellations, 1):
        value = _number(cancellation, roles["net_worth"])
        issue = (
            "unknown_chronology"
            if unknown_times
            else (
                "missing_activity_label"
                if unknown_labels
                else (
                    "unknown_cancellation_value"
                    if recipe["amount_filter"] != "ignore" and value is None
                    else None
                )
            )
        )
        candidates = []
        unknown_values = []
        if issue is None:
            for target in targets:
                if recipe["reuse"] == "consume" and target.row_id in used:
                    continue
                days = (
                    cancellation.time_value - target.time_value
                ).total_seconds() / 86400
                if (
                    days < 0
                    or days == 0
                    and (
                        recipe["ties"] == "strict_before"
                        or target.source_position >= cancellation.source_position
                    )
                ):
                    continue
                if (
                    recipe["max_window_days"] is not None
                    and days > recipe["max_window_days"]
                ):
                    continue
                amount = _number(target, roles["net_worth"])
                if recipe["amount_filter"] != "ignore":
                    if amount is None:
                        unknown_values.append(target)
                        continue
                    difference = (
                        amount - value
                        if recipe["amount_filter"] == "equal"
                        else amount + value
                    )
                    if abs(difference) > recipe["tolerance"]:
                        continue
                candidates.append(target)
        latest = max((row.time_value for row in candidates), default=None)
        nearest = sorted(
            (row for row in candidates if row.time_value == latest),
            key=lambda row: row.source_position,
        )
        if unknown_values and (
            latest is None or max(row.time_value for row in unknown_values) >= latest
        ):
            issue = "unknown_target_value"
        state = (
            "unknown"
            if issue
            else (
                "unmatched"
                if not nearest
                else (
                    "ambiguous"
                    if len(nearest) > 1 and recipe["ambiguity"] == "refuse"
                    else "matched"
                )
            )
        )
        partner = nearest[0] if state == "matched" else None
        if partner:
            used.add(partner.row_id)
        result["observations"].append(
            _observation(
                definition_id,
                case_id,
                n,
                state,
                issue
                or (
                    "tied_latest_candidates"
                    if state == "ambiguous"
                    else "no_eligible_target" if state == "unmatched" else None
                ),
                activation=[cancellation.row_id],
                response=[partner.row_id] if partner else [],
                candidates=[row.row_id for row in nearest],
                unknown=unknown_times
                + unknown_labels
                + [row.row_id for row in unknown_values],
                intervals={"receipt_to_cancellation": _interval(partner, cancellation)},
                selected_row_ids=(
                    [partner.row_id, cancellation.row_id]
                    if partner
                    else [cancellation.row_id]
                ),
                cancellation_value=value,
                target_value=_number(partner, roles["net_worth"]) if partner else None,
            )
        )
    result["excluded_row_ids"] = [row.row_id for row in targets if row.row_id in used]
    retained = [row for row in targets if row.row_id not in used]
    result["included_row_ids"] = [row.row_id for row in retained]
    result["unmatched_row_ids"] = [
        obs["activation_row_ids"][0]
        for obs in result["observations"]
        if obs["state"] == "unmatched"
    ]
    result["unknown_row_ids"] = list(dict.fromkeys(unknown_times + unknown_labels))
    result["totals"] = _amounts(targets, roles["net_worth"], "raw_receipt_") | _amounts(
        retained, roles["net_worth"], "retained_receipt_"
    )
    result["totals"].update(
        {
            "consumed_target_count": _raw(
                len(used), result["excluded_row_ids"], "original_events"
            ),
            "retained_target_count": _raw(
                len(retained), result["included_row_ids"], "original_events"
            ),
        }
    )
    for state in ["matched", "unmatched", "ambiguous", "unknown"]:
        witnesses = [
            obs["activation_row_ids"][0]
            for obs in result["observations"]
            if obs["state"] == state
        ]
        result["totals"][state + "_cancellation_count"] = _raw(
            len(witnesses), witnesses, "original_events"
        )
    creations = [row for row in records if row.activity == "Create Purchase Order Item"]
    value = _number(creations[0], roles["net_worth"]) if len(creations) == 1 else None
    result["totals"]["unique_creation_value"] = _raw(
        value,
        (row.row_id for row in creations),
        "EUR",
        (
            "creation_event_not_unique"
            if len(creations) != 1
            else "invalid_creation_value" if value is None else None
        ),
    )
    if unknown_times or unknown_labels:
        result.update(
            state="unknown",
            reason="unknown_chronology" if unknown_times else "missing_activity_label",
        )
    return result


def rule_case(
    prepared: PreparedData,
    case_id: str,
    recipe: Mapping,
    roles: Mapping,
    definition_id: str,
) -> dict:
    """Three-valued finite recorded-event relations; unknown support is never a false match."""
    result = _case(prepared, case_id)
    records = prepared.histories[case_id]
    response = recipe["relation"] == "response"
    activation_labels = (
        recipe["left_activities"] if response else recipe["right_activities"]
    )
    result["known_activation_count"] = sum(
        row.activity in activation_labels for row in records
    )
    result["activation_count"] = (
        None
        if any(row.activity is None for row in records)
        else result["known_activation_count"]
    )
    if recipe["flow_scope"] != "all":
        flow, problem = _category(records, roles["item_category"])
        if problem or flow != recipe["flow_scope"]:
            result.update(
                state="unknown" if problem else "outside_scope",
                reason=problem or "different_flow_scope",
                truth="unknown" if problem else None,
            )
            return result
    activation_labels = (
        recipe["left_activities"] if response else recipe["right_activities"]
    )
    partner_labels = (
        recipe["right_activities"] if response else recipe["left_activities"]
    )
    unknown_labels = [row for row in records if row.activity is None]
    activations = sorted(
        (row for row in records if row.activity in activation_labels),
        key=lambda row: (
            row.time_value is None,
            row.time_value or datetime.min,
            row.source_position,
        ),
    )
    partners = [row for row in records if row.activity in partner_labels]
    known_order = sorted(
        (row for row in records if row.time_value is not None),
        key=lambda row: (row.time_value, row.source_position),
    )
    positions = {row.row_id: n for n, row in enumerate(known_order)}
    unknown_activation_time = any(row.time_value is None for row in activations)
    result["known_activation_count"] = len(activations)
    result["activation_count"] = None if unknown_labels else len(activations)
    used = set()

    def eligible(anchor, row):
        if row.row_id == anchor.row_id:
            return False
        if anchor.time_value is None or row.time_value is None:
            return True
        difference = (
            (row.time_value - anchor.time_value).total_seconds()
            if response
            else (anchor.time_value - row.time_value).total_seconds()
        )
        return difference >= 0 if recipe["ties"] == "allow_equal" else difference > 0

    for n, anchor in enumerate(activations, 1):
        candidates = []
        unknown = []
        reason = None
        if anchor.time_value is None:
            unknown = [anchor]
            reason = "unknown_activation_time"
        elif recipe["position"] == "raw_direct":
            index = positions[anchor.row_id] + (1 if response else -1)
            neighbor = known_order[index] if 0 <= index < len(known_order) else None
            unknown = [
                row
                for row in records
                if row.time_value is None and row.row_id != anchor.row_id
            ]
            if unknown:
                reason = "unknown_raw_adjacency"
            elif neighbor is not None and neighbor.activity is None:
                unknown = [neighbor]
                reason = "unknown_neighbor_activity"
            elif (
                neighbor is not None
                and neighbor.activity in partner_labels
                and eligible(anchor, neighbor)
                and (recipe["reuse"] == "allow" or neighbor.row_id not in used)
            ):
                candidates = [neighbor]
        else:
            known = [
                row
                for row in partners
                if row.time_value is not None
                and eligible(anchor, row)
                and (recipe["reuse"] == "allow" or row.row_id not in used)
            ]
            nearest = (min if response else max)(
                (row.time_value for row in known), default=None
            )
            candidates = sorted(
                (row for row in known if row.time_value == nearest),
                key=lambda row: row.source_position,
            )
            unknown = [
                row
                for row in partners + unknown_labels
                if (row.time_value is None or row.activity is None)
                and row.row_id != anchor.row_id
                and (recipe["reuse"] == "allow" or row.row_id not in used)
                and eligible(anchor, row)
                and (
                    row.time_value is None
                    or nearest is None
                    or (
                        row.time_value <= nearest
                        if response
                        else row.time_value >= nearest
                    )
                )
            ]
            if not candidates and unknown:
                reason = "potential_unknown_partner"
            if recipe["reuse"] == "consume" and (
                unknown or unknown_activation_time or unknown_labels
            ):
                reason = "unknown_consuming_assignment"
        truth = "unknown" if reason else "true" if candidates else "false"
        # A confirmed reusable existential witness remains true despite unrelated unknown rows.
        if (
            recipe["position"] == "eventual"
            and recipe["reuse"] == "allow"
            and candidates
        ):
            truth, reason = "true", None
        partner = candidates[0] if truth == "true" else None
        if partner is not None:
            used.add(partner.row_id)
        interval = (
            _interval(anchor, partner) if response else _interval(partner, anchor)
        )
        result["observations"].append(
            _observation(
                definition_id,
                case_id,
                n,
                (
                    "matched"
                    if truth == "true"
                    else "unmatched" if truth == "false" else "unknown"
                ),
                reason or ("no_recorded_partner" if truth == "false" else None),
                activation=[anchor.row_id],
                response=[partner.row_id] if partner else [],
                candidates=[row.row_id for row in candidates],
                unknown=[row.row_id for row in unknown],
                truth=truth,
                intervals={"relation_lag": interval},
                selected_row_ids=(
                    [anchor.row_id, partner.row_id] if partner else [anchor.row_id]
                ),
            )
        )
    truths = [obs["truth"] for obs in result["observations"]]
    if recipe["quantifier"] == "some":
        truth = (
            "true"
            if "true" in truths
            else (
                "unknown"
                if "unknown" in truths or unknown_labels
                else (
                    "false"
                    if truths
                    else "false" if recipe["vacuity"] == "logical" else "not_activated"
                )
            )
        )
    else:
        truth = (
            "false"
            if "false" in truths
            else (
                "unknown"
                if "unknown" in truths or unknown_labels
                else (
                    "true"
                    if truths
                    else "true" if recipe["vacuity"] == "logical" else "not_activated"
                )
            )
        )
    result["truth"] = None if truth == "not_activated" else truth
    result["state"] = (
        "unknown"
        if truth == "unknown"
        else "not_activated" if truth == "not_activated" else "evaluated"
    )
    result["reason"] = (
        "unknown_rule_support"
        if truth == "unknown"
        else (
            "no_known_activation"
            if truth == "not_activated"
            else "logical_empty_quantification" if not truths else None
        )
    )
    result["unmatched_row_ids"] = [
        obs["activation_row_ids"][0]
        for obs in result["observations"]
        if obs["truth"] == "false"
    ]
    result["included_row_ids"] = list(
        dict.fromkeys(
            row_id
            for obs in result["observations"]
            if obs["truth"] == "true"
            for row_id in obs["selected_row_ids"]
        )
    )
    result["unknown_row_ids"] = list(
        dict.fromkeys(
            [row.row_id for row in unknown_labels]
            + [
                row_id
                for obs in result["observations"]
                for row_id in obs["unknown_row_ids"]
            ]
        )
    )
    result["totals"] = {
        "activation_count": _raw(
            result["activation_count"],
            (row.row_id for row in activations),
            "original_events",
            "unknown_activation_support" if unknown_labels else None,
        ),
        "matched_activation_count": _raw(
            truths.count("true"), result["included_row_ids"], "original_events"
        ),
        "nonmatching_activation_count": _raw(
            truths.count("false"), result["unmatched_row_ids"], "original_events"
        ),
    }
    result["totals"]["partner_use_count"] = _raw(
        truths.count("true"),
        (row.row_id for row in records if row.row_id in used),
        "partner_uses",
    )
    return result


def waiting_case(
    prepared: PreparedData,
    case_id: str,
    recipe: Mapping,
    roles: Mapping,
    definition_id: str,
) -> dict:
    result = _case(prepared, case_id)
    records = prepared.histories[case_id]
    clock = prepared.records[0].timestamp_kind
    horizon_start, horizon_end = _parse(recipe["horizon_start"], clock), _parse(
        recipe["horizon_end"], clock
    )
    activations = [
        row for row in records if row.activity in recipe["activation_activities"]
    ]
    responses = [
        row for row in records if row.activity in recipe["response_activities"]
    ]
    unknown = [
        row
        for row in records
        if row.activity is None
        or (
            row.activity
            in recipe["activation_activities"] + recipe["response_activities"]
            and row.time_value is None
        )
    ]
    known_a = sorted(
        (row for row in activations if row.time_value is not None),
        key=lambda row: (row.time_value, row.source_position),
    )
    known_b = sorted(
        (row for row in responses if row.time_value is not None),
        key=lambda row: (row.time_value, row.source_position),
    )
    anchor = known_a[0] if known_a else None
    if recipe["endpoints"] == "first_after" and anchor is not None:
        known_b = [
            row
            for row in known_b
            if row.time_value >= anchor.time_value and row.row_id != anchor.row_id
        ]
    partner = (
        (known_b[-1] if recipe["endpoints"] == "first_last" else known_b[0])
        if known_b
        else None
    )
    state = (
        "unknown"
        if unknown
        else (
            "not_activated"
            if anchor is None
            else "unmatched" if partner is None else "matched"
        )
    )
    reason = (
        "missing_activity_label"
        if any(row.activity is None for row in unknown)
        else (
            "unknown_activation_time"
            if any(row.activity in recipe["activation_activities"] for row in unknown)
            else (
                "unknown_response_time"
                if unknown
                else (
                    "no_recorded_activation"
                    if anchor is None
                    else (
                        "no_recorded_response"
                        if not responses
                        else (
                            "no_eligible_recorded_response" if partner is None else None
                        )
                    )
                )
            )
        )
    )
    start, end = (anchor.time_value if anchor else None), (
        partner.time_value if partner else None
    )
    if state == "unmatched" and recipe["completion"] == "right_censored":
        state, reason, end = "censored", "trusted_horizon_right_censor", horizon_end
    elif state == "unmatched":
        state = "excluded"
    interval = _interval(anchor, partner)
    signed = (
        None if start is None or end is None else (end - start).total_seconds() / 86400
    )
    if state in {"matched", "censored"}:
        if end < start:
            state, reason = "reversed", "reversed_interval"
        elif (
            start < horizon_start
            or end > horizon_end
            or start > horizon_end
            or end < horizon_start
        ):
            if recipe["horizon_policy"] == "refuse_outside":
                state, reason = "excluded", "interval_outside_horizon"
            else:
                start, end = max(start, horizon_start), min(end, horizon_end)
                if end < start:
                    state, reason = "excluded", "no_horizon_overlap"
        if state in {"matched", "censored"} and end == start and state != "censored":
            state = "zero"
    if state not in {"matched", "zero", "censored"}:
        start, end = None, None
    witnesses_a = [
        row.row_id
        for row in known_a
        if anchor is not None and row.time_value == anchor.time_value
    ]
    witnesses_b = [
        row.row_id
        for row in known_b
        if partner is not None and row.time_value == partner.time_value
    ]
    obs = _observation(
        definition_id,
        case_id,
        1,
        state,
        reason,
        activation=witnesses_a,
        response=witnesses_b,
        candidates=[row.row_id for row in responses],
        unknown=[row.row_id for row in unknown],
        intervals={
            "waiting_duration": _raw(
                (end - start).total_seconds() / 86400 if start is not None else None,
                witnesses_a + witnesses_b,
                "days",
                None if start is not None else reason or "unavailable_interval",
                recorded_difference_days=signed,
            )
        },
        start=_stamp(start),
        end=_stamp(end),
        selected_row_ids=list(dict.fromkeys(witnesses_a + witnesses_b)),
    )
    result["observations"] = [obs]
    result["state"] = "evaluated" if start is not None else state
    result["reason"] = reason
    result["activation_count"] = (
        None if any(row.activity is None for row in records) else len(activations)
    )
    result["known_activation_count"] = len(activations)
    result["included_row_ids"] = (
        list(dict.fromkeys(witnesses_a + witnesses_b)) if start is not None else []
    )
    result["unknown_row_ids"] = [row.row_id for row in unknown]
    result["unmatched_row_ids"] = (
        witnesses_a
        if reason in {"no_recorded_response", "no_eligible_recorded_response"}
        else []
    )
    return result


def occupancy(
    intervals: list[tuple[str, datetime, datetime]], recipe: Mapping, clock: str
) -> dict:
    """Half-open sweep over the whole explicit horizon, retaining zero durations separately."""
    start, end = _parse(recipe["horizon_start"], clock), _parse(
        recipe["horizon_end"], clock
    )
    changes = Counter({start: 0, end: 0})
    for _, left, right in intervals:
        if right > left:
            changes[left] += 1
            changes[right] -= 1
    times = sorted(changes)
    current = 0
    peak = 0
    peak_start = peak_end = None
    by_count = defaultdict(float)
    segments = []
    for n, left in enumerate(times[:-1]):
        current += changes[left]
        right = times[n + 1]
        seconds = (right - left).total_seconds()
        by_count[current] += seconds
        if len(segments) < 200:
            segments.append(
                {"start": _stamp(left), "end": _stamp(right), "occupancy": current}
            )
        if current > peak:
            peak, peak_start, peak_end = current, left, right
    seconds = (end - start).total_seconds()
    area = math.fsum(count * duration for count, duration in by_count.items())
    running = 0.0
    middle = 0
    for count, duration in sorted(by_count.items()):
        running += duration
        if running >= seconds / 2:
            middle = count
            break
    peak_ids = sorted(
        case
        for case, left, right in intervals
        if peak_start is not None and left <= peak_start < right
    )
    snapshots = []
    if recipe["calendar"] == "daily_snapshots":
        index = 0
        current = 0
        snapshot = start
        while snapshot < end:
            while index < len(times) and times[index] <= snapshot:
                current += changes[times[index]]
                index += 1
            snapshots.append({"timestamp": _stamp(snapshot), "occupancy": current})
            snapshot += timedelta(days=1)
    return {
        "unit": "PO_items",
        "horizon_start": _stamp(start),
        "horizon_end": _stamp(end),
        "horizon_days": seconds / 86400,
        "available_interval_count": len(intervals),
        "positive_duration_count": sum(right > left for _, left, right in intervals),
        "zero_duration_count": sum(right == left for _, left, right in intervals),
        "peak": peak,
        "peak_start": _stamp(peak_start),
        "peak_end": _stamp(peak_end),
        "peak_case_ids": peak_ids,
        "item_days": area / 86400,
        "duration_weighted_mean": area / seconds,
        "duration_weighted_lower_median": middle,
        "segments": segments,
        "segment_count": len(times) - 1,
        "omitted_segment_count": max(0, len(times) - 1 - len(segments)),
        "duration_by_occupancy": [
            {"occupancy": count, "days": duration / 86400}
            for count, duration in sorted(by_count.items())
        ],
        "daily_snapshots": snapshots,
    }


SOURCES = {
    "ordinal": [
        "merged_reports.pdf R04 pp91–93: kth exact-activity occurrence ordered by original numeric eventID; item mean intervals",
        "merged_reports.pdf R15 pp344,346–347: timestamp kth occurrences and simultaneous events; reuse/shared creation rules require separate admission",
        "Panel-declared numeric-eventID and timestamp recipes; inferred ordinal episodes, not native invoice identifiers",
    ],
    "fifo": [
        "merged_reports.pdf R08 pp172–176: ordered receipt, invoice and clearing vectors; Table5 consuming FIFO triples (1,3,5),(2,4,15),(7,11,20)",
        "Panel-declared source-position and timestamp alternatives; strict-later positions may have equal parsed timestamps",
    ],
    "cancellation": [
        "merged_reports.pdf R09 pp198–200: most-recent preceding receipt hypothesis; self-join/window sorting; full matching tie/reuse policy not specified",
        "Panel-declared latest-preceding receipt candidates, strict predecessor, consuming and amount-independent default; no clearing deletion or invoice balance claim",
    ],
    "rule": [
        "merged_reports.pdf R10 pp223–225: every-requesting-activity precedence/response; response omitted from published compliance due open cases",
        "merged_reports.pdf R08 pp181–182 and R15 pp346–347: direct/eventual and per-clearing chronology alternatives",
        "Panel-declared finite three-valued direct/eventual response/precedence relations; no automatic normative obligations",
    ],
    "waiting": [
        "merged_reports.pdf R15 pp353–354: first-cycle completed-case backlog; precise boundaries and time weighting unspecified",
        "Panel-declared half-open intervals, explicit trusted horizon, endpoint alternatives, elapsed-time or daily snapshot calendars",
    ],
}


def _distribution(values: list[float], total: int) -> dict:
    count = len(values)
    try:
        known_sum = math.fsum(values) if values else None
    except OverflowError:
        known_sum = None
    ordered = sorted(values)
    middle = (
        None
        if not count
        else (
            ordered[count // 2]
            if count % 2
            else ordered[count // 2 - 1] / 2 + ordered[count // 2] / 2
        )
    )
    return {
        "available_count": count,
        "unavailable_count": total - count,
        "zero_count": values.count(0),
        "minimum": min(values) if values else None,
        "maximum": max(values) if values else None,
        "mean": math.fsum(value / count for value in values) if values else None,
        "median": middle,
        "known_sum": known_sum,
        "known_sum_reason": (
            "no_available_values"
            if not values
            else "nonfinite_aggregate" if known_sum is None else None
        ),
    }


def evaluate_operator_case(
    prepared: PreparedData,
    case_id: str,
    recipe: Mapping,
    roles: Mapping,
    definition_id: str,
) -> dict:
    kind = recipe["kind"]
    return (
        episode_case(prepared, case_id, recipe, roles, definition_id)
        if kind in {"ordinal", "fifo"}
        else (
            cancellation_case(prepared, case_id, recipe, roles, definition_id)
            if kind == "cancellation"
            else (
                rule_case(prepared, case_id, recipe, roles, definition_id)
                if kind == "rule"
                else waiting_case(prepared, case_id, recipe, roles, definition_id)
            )
        )
    )


def operator_population(
    prepared: PreparedData,
    case_ids: Iterable[str],
    roles: Mapping,
    recipe: Mapping | None,
    offset: int = 0,
    limit: int = 20,
) -> dict | ImportRefusal:
    try:
        ids = checked_case_ids(prepared, case_ids)
        chosen = checked_roles(prepared, roles)
        if (
            type(offset) is not int
            or offset < 0
            or type(limit) is not int
            or not 1 <= limit <= 100
        ):
            raise ValueError(
                "Review a nonnegative page offset and a limit from 1 to 100."
            )
        r = None if recipe is None else checked_recipe(prepared, recipe, chosen)
    except (ValueError, SelectionError, TypeError, IndexError) as exc:
        return ImportRefusal("invalid_parameter", str(exc), "query")
    definition = {
        "policy_id": POLICY_ID,
        "roles": chosen,
        "recipe": r,
        "source_evidence": SOURCES[r["kind"]] if r else [],
        "original_history_policy": "immutable_complete_item_histories",
        "inferred_invoice_id_policy": "none",
        "representative_policy": "source_position_first_with_all_tied_candidates",
    }
    if r and r["kind"] == "fifo" and r["order"] == "timestamp_numeric_event_id":
        definition["representative_policy"] = (
            "parsed_time_then_numeric_event_id_then_original_source_position"
        )
        definition["source_evidence"] = [
            *definition["source_evidence"],
            "Panel-declared modern FIFO order: parsed time primary; trimmed ASCII 1–64 digit original eventID secondary; original source position resolves equal numeric IDs. Every original item row must have a valid numeric ID; otherwise the item is unknown with raw witnesses. Relevant missing timestamps are unknown. IDs do not prove chronology. This is separate from R08 source-position reproduction and duplicate-refusing numeric ordinals.",
        ]
    definition_id = content_identity("bpic19-operator-definition", definition)
    definition["definition_id"] = definition_id
    result_id = content_identity(
        "bpic19-operator-result",
        {
            "identity": prepared.identity_dict(),
            "case_ids": ids,
            "definition_id": definition_id,
        },
    )
    operation = "bpic19_" + r["kind"] if r else "bpic19_catalogue"
    catalogue = {
        "columns": [
            {"index": index, "name": name}
            for index, name in enumerate(prepared.columns)
        ],
        "activities": sorted(
            {
                row.activity
                for case in ids
                for row in prepared.histories[case]
                if row.activity is not None
            }
        ),
        "clock_kind": (
            prepared.records[0].timestamp_kind if prepared.records else "wall_clock"
        ),
        "trusted_cutoff": None,
    }
    params = prepared.policies.get("time", {}).get("parameters", {})
    catalogue["trusted_cutoff"] = (
        params.get("snapshot_cutoff_local")
        if catalogue["clock_kind"] == "wall_clock"
        else params.get("snapshot_cutoff_utc")
    )
    cases = []
    state_counts = Counter()
    observation_counts = Counter()
    truth_counts = Counter()
    groups = defaultdict(list)
    intervals = []
    values = defaultdict(list)
    item_values = defaultdict(list)
    total_measure_values = defaultdict(list)
    metric_totals = Counter()
    activation_count = 0
    known_activation_count = 0
    total_records = 0
    if r is not None:
        for index, case_id in enumerate(ids):
            feature = evaluate_operator_case(
                prepared, case_id, r, chosen, definition_id
            )
            total_records += feature["record_count"]
            state_counts[feature["state"]] += 1
            groups[feature["state"]].append(case_id)
            if feature["truth"] is not None:
                truth_counts[feature["truth"]] += 1
                groups["truth_" + feature["truth"]].append(case_id)
            known_activation_count += feature["known_activation_count"]
            activation_count = (
                None
                if activation_count is None or feature["activation_count"] is None
                else activation_count + feature["activation_count"]
            )
            states = set()
            local_values = defaultdict(list)
            for obs in feature["observations"]:
                observation_counts[obs["state"]] += 1
                states.add(obs["state"])
                for name, measure in obs["intervals"].items():
                    metric_totals[name] += 1
                    if measure["available"]:
                        values[name].append(measure["value"])
                        local_values[name].append(measure["value"])
                if r["kind"] == "waiting" and obs["start"] is not None:
                    intervals.append(
                        (
                            case_id,
                            _parse(obs["start"], catalogue["clock_kind"]),
                            _parse(obs["end"], catalogue["clock_kind"]),
                        )
                    )
            for state in states:
                groups["observation_" + state].append(case_id)
            for name, numbers in local_values.items():
                item_values[name].append(
                    math.fsum(value / len(numbers) for value in numbers)
                )
            for name, measure in feature["totals"].items():
                total_measure_values[
                    name
                ]  # Keep fully unavailable measures visible in the summary.
                if measure["available"]:
                    total_measure_values[name].append(measure["value"])
            if offset <= index < offset + limit:
                cases.append(feature)
    else:
        total_records = sum(len(prepared.histories[case]) for case in ids)
    interval_names = set(metric_totals)
    summary = {
        "case_state_counts": dict(state_counts),
        "observation_state_counts": dict(observation_counts),
        "truth_case_counts": dict(truth_counts),
        "activation_count": activation_count,
        "known_activation_count": known_activation_count,
        "observation_count": sum(observation_counts.values()),
        "interval_distributions": {
            name: {
                "per_episode": _distribution(values[name], metric_totals[name]),
                "per_item_mean": _distribution(item_values[name], len(ids)),
            }
            for name in sorted(interval_names)
        },
        "total_distributions": {
            name: _distribution(numbers, len(ids))
            for name, numbers in sorted(total_measure_values.items())
        },
        "occupancy": (
            occupancy(intervals, r, catalogue["clock_kind"])
            if r and r["kind"] == "waiting"
            else None
        ),
    }
    selection_groups = [
        {
            "key": key,
            "label": key.replace("_", " "),
            "case_ids": members,
            "case_count": len(members),
            "record_count": sum(len(prepared.histories[case]) for case in members),
        }
        for key, members in sorted(groups.items())
    ]
    if summary["occupancy"] is not None:
        members = summary["occupancy"]["peak_case_ids"]
        selection_groups.append(
            {
                "key": "peak",
                "label": "earliest peak occupancy",
                "case_ids": members,
                "case_count": len(members),
                "record_count": sum(len(prepared.histories[case]) for case in members),
            }
        )
    return {
        "operation": operation,
        "definition_id": definition_id,
        "result_id": result_id,
        "definition": definition,
        "catalogue": catalogue,
        "population_case_count": len(ids),
        "population_record_count": total_records,
        "summary": summary,
        "selection_groups": selection_groups,
        "cases": cases,
        "offset": offset,
        "limit": limit,
        "next_offset": (
            offset + limit if r is not None and offset + limit < len(ids) else None
        ),
    }
