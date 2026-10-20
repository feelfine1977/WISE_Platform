"""Stated-rule catalogues over a checked frozen parent of complete incidents."""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Iterable, Mapping
import math
from types import MappingProxyType

from .case_profiles import case_distribution_baseline, case_distribution_for_kept
from .case_time import CaseTimeError, case_time_summary
from .mapping import ImportRefusal
from .preparation import PreparedData, content_identity
from .selection import SelectionError, case_ids
from .variants import ACTIVITY_PROJECTION_POLICY, variant_id

RULE_POLICY = "incident.rule_groups.stated_rules.v1"
MAX_SAFE_INTEGER = 9007199254740991
_ORDERED_RULES = {"first_raw_activity", "last_raw_activity", "exact_mapped_sequence"}
# Which values of an incident a shared reference reads: every record's (an incident can be in several groups), the first
# record's in the declared order, or the latest record's that has a value; the last two need the order to be known.
REFERENCE_POLICIES = ("any_record", "first_record", "latest_record")


def _ordered(rule: Mapping[str, object]) -> bool:
    return rule["kind"] in _ORDERED_RULES or (rule["kind"] == "shared_reference" and rule.get("policy", "any_record") != "any_record")
_RULE_FIELDS = {
    "first_raw_activity": {"kind"},
    "last_raw_activity": {"kind"},
    "exact_mapped_sequence": {"kind"},
    "raw_record_count_bands": {"kind", "edges"},
    "activity_presence": {"kind", "activity"},
    "shared_reference": {"kind", "column_index", "minimum_parent_case_count"},
}


def _safe_integer(
    value: object, minimum: int = 0, maximum: int = MAX_SAFE_INTEGER
) -> bool:
    return type(value) is int and minimum <= value <= maximum


def _edges_valid(edges: object, integers: bool = False) -> bool:
    if not isinstance(edges, list) or not 1 <= len(edges) <= 32:
        return False
    for edge in edges:
        if integers:
            if not _safe_integer(edge):
                return False
        else:
            if type(edge) not in (int, float) or edge < 0:
                return False
            try:
                if not math.isfinite(edge):
                    return False
            except OverflowError:
                return False
    return edges[0] == 0 and all(left < right for left, right in zip(edges, edges[1:]))


def validate_rule_groups_query(query: object) -> ImportRefusal | None:
    """Require one closed rule, explicit increasing bins, and a bounded page."""

    def invalid(message, field):
        return ImportRefusal("invalid_parameter", message, field)

    if not isinstance(query, Mapping) or set(query) != {
        "rule",
        "distribution_edges_hours",
        "offset",
        "limit",
    }:
        return invalid(
            "The query must contain only its rule, hour edges and page fields.", "query"
        )
    rule = query["rule"]
    if (
        not isinstance(rule, Mapping)
        or not isinstance(rule.get("kind"), str)
        or rule["kind"] not in _RULE_FIELDS
    ):
        return invalid("The rule kind is not supported.", "query.rule.kind")
    kind = rule["kind"]
    # A shared reference names, optionally, which values of an incident it reads (#51); without it, every record's.
    optional = {"policy"} if kind == "shared_reference" else set()
    if not _RULE_FIELDS[kind] <= set(rule) <= _RULE_FIELDS[kind] | optional:
        return invalid(
            "The rule must contain exactly its stated parameters.", "query.rule"
        )
    if kind == "raw_record_count_bands" and not _edges_valid(
        rule["edges"], integers=True
    ):
        return invalid(
            "Record-count edges must be increasing safe integers starting at zero, with one to 32 edges.",
            "query.rule.edges",
        )
    if kind == "activity_presence":
        activity = rule["activity"]
        if (
            not isinstance(activity, str)
            or not activity
            or any(0xD800 <= ord(c) <= 0xDFFF for c in activity)
        ):
            return invalid(
                "Presence requires a nonempty exact activity label.",
                "query.rule.activity",
            )
    if kind == "shared_reference":
        if not _safe_integer(rule["column_index"]):
            return invalid(
                "The context column must be a nonnegative safe integer ordinal.",
                "query.rule.column_index",
            )
        if not _safe_integer(rule["minimum_parent_case_count"], 2):
            return invalid(
                "A shared reference needs at least two parent incidents.",
                "query.rule.minimum_parent_case_count",
            )
        if rule.get("policy", "any_record") not in REFERENCE_POLICIES:
            return invalid(
                "The values read are those of the first record, the latest record with a value, or any record.",
                "query.rule.policy",
            )
    if not _edges_valid(query["distribution_edges_hours"]):
        return invalid(
            "Hour edges must be finite, increase strictly from zero, and contain one to 32 edges.",
            "query.distribution_edges_hours",
        )
    if not _safe_integer(query["offset"]):
        return invalid("The offset must be a nonnegative safe integer.", "query.offset")
    if not _safe_integer(query["limit"], 1, 50):
        return invalid(
            "The page size must be an integer from one to 50.", "query.limit"
        )
    return None


def _support(
    members: Iterable[str], counts: Mapping[str, tuple[int, int]], fixed: bool = False
) -> dict:
    ids = tuple(members)
    result = {
        "case_count": len(ids),
        "record_count": sum(counts[c][0] for c in ids),
        "omitted_activity_record_count": sum(counts[c][1] for c in ids),
    }
    return {"case_ids": list(ids), **result} if fixed else result


def _coverage(
    members: tuple[str, ...],
    eligible: set[str],
    incidence: Mapping[str, int],
    counts: Mapping[str, tuple[int, int]],
) -> dict:
    return {
        "total": _support(members, counts),
        "eligible": _support((c for c in members if c in eligible), counts),
        "unevaluable": _support(
            (c for c in members if c not in eligible), counts, True
        ),
        "assigned": _support((c for c in members if incidence[c]), counts),
        "unassigned": _support(
            (c for c in members if c in eligible and not incidence[c]), counts, True
        ),
        "membership_incidence": {
            "case_count": sum(incidence[c] for c in members),
            "record_count": sum(incidence[c] * counts[c][0] for c in members),
            "omitted_activity_record_count": sum(
                incidence[c] * counts[c][1] for c in members
            ),
        },
    }


def _catalogue(
    prepared: PreparedData,
    parent: tuple[str, ...],
    eligible: set[str],
    rule: Mapping[str, object],
    counts: Mapping[str, tuple[int, int]],
    current: set[str],
) -> tuple[list[tuple[dict, tuple[str, ...]]], dict | None]:
    kind = rule["kind"]
    grouped: dict[object, list[str]] = {}
    reference_coverage = None
    if kind == "raw_record_count_bands":
        edges = rule["edges"]
        grouped = {index: [] for index in range(len(edges))}
        for c in parent:
            grouped[bisect_right(edges, counts[c][0]) - 1].append(c)
        return [
            (
                {
                    "kind": "raw_record_count_band",
                    "start_inclusive": edge,
                    "end_exclusive": edges[i + 1] if i + 1 < len(edges) else None,
                },
                tuple(grouped[i]),
            )
            for i, edge in enumerate(edges)
        ], None
    if kind == "activity_presence":
        grouped = {False: [], True: []}
    missing_records: dict[str, int] = {}
    for c in parent:
        if kind == "shared_reference":
            # Records without a value are counted for every incident of the parent, also one a reading cannot evaluate.
            missing_records[c] = sum(record.context_value(rule["column_index"]) is None for record in prepared.histories[c])
        if c not in eligible:
            continue
        records = prepared.histories[c]
        if kind in {"first_raw_activity", "last_raw_activity"}:
            value = records[0 if kind == "first_raw_activity" else -1].activity
            grouped.setdefault(value, []).append(c)
        elif kind == "activity_presence":
            present = any(record.activity == rule["activity"] for record in records)
            grouped[present].append(c)
        elif kind == "exact_mapped_sequence":
            sequence = tuple(
                record.activity for record in records if record.activity is not None
            )
            grouped.setdefault(sequence, []).append(c)
        else:
            column = rule["column_index"]
            cells = [record.context_value(column) for record in records]
            policy = rule.get("policy", "any_record")
            if policy == "any_record":
                values = set(cells)
            elif policy == "first_record":
                values = {cells[0] if cells else None}
            else:
                values = {next((value for value in reversed(cells) if value is not None), None)}
            for value in values:
                grouped.setdefault(value, []).append(c)
    if kind == "shared_reference":
        distinct = sum(value is not None for value in grouped)
        suppressed = [
            value
            for value in grouped
            if value is not None
            and len(grouped[value]) < rule["minimum_parent_case_count"]
        ]
        reference_coverage = {
            "column_index": rule["column_index"],
            "parent_distinct_nonmissing_value_count": distinct,
            "parent_suppressed_nonmissing_value_count": len(suppressed),
            "parent_missing_reference_record_count": sum(missing_records.values()),
            "population_missing_reference_record_count": sum(
                missing_records[c] for c in current
            ),
        }
        for value in suppressed:
            del grouped[value]
    if kind == "exact_mapped_sequence":
        ranked = sorted(grouped, key=lambda v: (-len(grouped[v]), v))
    else:
        ranked = sorted(
            grouped,
            key=lambda v: (-len(grouped[v]), v is None, v if v is not None else ""),
        )
    catalogue = []
    for value in ranked:
        if kind in {"first_raw_activity", "last_raw_activity"}:
            key = {
                "kind": "activity" if value is not None else "missing_activity",
                "activity": value,
            }
        elif kind == "activity_presence":
            key = {
                "kind": "activity_presence",
                "activity": rule["activity"],
                "present": value,
            }
        elif kind == "shared_reference":
            key = {
                "kind": "reference_value" if value is not None else "missing_reference",
                "column_index": rule["column_index"],
                "value": value,
            }
        else:
            key = {
                "kind": "exact_sequence",
                "activities": list(value),
                "variant_id": variant_id(value),
            }
        catalogue.append((key, tuple(grouped[value])))
    return catalogue, reference_coverage


def _exemplars(
    prepared: PreparedData,
    members: tuple[str, ...],
    summaries: Mapping[str, dict],
    counts: Mapping[str, tuple[int, int]],
) -> dict:
    known = [c for c in members if summaries[c]["observed_span_hours"] is not None]
    if not known:
        return {
            "status": "unavailable",
            "reason": "no_evaluable_case" if members else "empty_current_group",
            "shortest": None,
            "longest": None,
        }

    def exemplar(c):
        return {
            "case_id": c,
            "record_count": counts[c][0],
            "observed_span_hours": summaries[c]["observed_span_hours"],
        }

    # Rank exact endpoint durations before rounding them to descriptive hours.
    spans = {
        c: prepared.histories[c][-1].time_value - prepared.histories[c][0].time_value
        for c in known
    }
    shortest = min(known, key=lambda c: (spans[c], c))
    longest = min(known, key=lambda c: (-spans[c], c))
    return {
        "status": "available",
        "shortest": exemplar(shortest),
        "longest": exemplar(longest),
    }


def rule_groups(
    prepared: PreparedData,
    population_ids: Iterable[str],
    parent_ids: Iterable[str],
    checked_parent_identity: Mapping[str, str],
    query: Mapping[str, object],
) -> dict | ImportRefusal:
    """Project a frozen catalogue and current fixed IDs without publishing a population.

    The caller resolves the exact parent identity. Display bins, pagination and
    the current selection do not participate in the meaning of a group.
    Raw support and time summaries are cached once for the entire parent; only
    the requested page receives per-group measurements and exemplars.
    """
    problem = validate_rule_groups_query(query)
    if problem is not None:
        return problem
    try:
        parent = case_ids(prepared, parent_ids)
        population = case_ids(prepared, population_ids)
        current = set(population)
        if not current <= set(parent):
            return ImportRefusal(
                "identity_mismatch",
                "The current incidents are outside their frozen parent.",
                "identity.population_id",
            )
        base = prepared.identity_dict()
        if (
            not isinstance(checked_parent_identity, Mapping)
            or set(checked_parent_identity) != set(base)
            or any(
                checked_parent_identity[name] != base[name]
                for name in base
                if name != "population_id"
            )
        ):
            return ImportRefusal(
                "identity_mismatch",
                "The parent identity does not belong to this preparation.",
                "parent_identity",
            )
        policy = prepared.policies["time"]["id"]
        if policy not in {
            "incident.time.wall_clock_as_recorded.v1",
            "incident.time.explicit_format_timezone_utc.v1",
        }:
            return ImportRefusal(
                "unsupported_policy",
                "The prepared clock is not supported.",
                "identity.preparation_id",
            )
        if (
            prepared.policies["activity_projection"]["id"] != ACTIVITY_PROJECTION_POLICY
            or prepared.policies["order"]["id"]
            != "incident.order.declared_time_optional_sequence_source_position.v1"
        ):
            return ImportRefusal(
                "unsupported_policy",
                "The prepared activity projection or order is not supported.",
                "identity.preparation_id",
            )
        kind = (
            "wall_clock"
            if policy == "incident.time.wall_clock_as_recorded.v1"
            else "utc_instant"
        )
        rule = query["rule"]
        if (
            rule["kind"] == "shared_reference"
            and rule["column_index"] not in prepared.mapping["context_columns"]
        ):
            return ImportRefusal(
                "unmapped_context_column",
                "The requested column is not mapped as context.",
                "query.rule.column_index",
            )
        summaries = MappingProxyType(
            {c: case_time_summary(prepared, c) for c in parent}
        )
        counts = {
            c: (
                len(prepared.histories[c]),
                sum(r.activity is None for r in prepared.histories[c]),
            )
            for c in parent
        }
        eligible = {
            c
            for c in parent
            if not _ordered(rule)
            or summaries[c]["status"] == "available"
        }
        catalogue, reference_coverage = _catalogue(
            prepared, parent, eligible, rule, counts, current
        )
        incidence = dict.fromkeys(parent, 0)
        for _, members in catalogue:
            for c in members:
                incidence[c] += 1
        parent_coverage = _coverage(parent, eligible, incidence, counts)
        population_coverage = _coverage(population, eligible, incidence, counts)
        measures = ("observed_span_hours", "maximum_adjacent_raw_gap_hours")
        baselines = [
            case_distribution_baseline(
                summaries,
                parent,
                {"measure": measure, "edges_hours": query["distribution_edges_hours"]},
                kind,
            )
            for measure in measures
        ]
        offset, limit = query["offset"], query["limit"]
        groups = []
        for key, members in catalogue[offset : offset + limit]:
            kept = tuple(c for c in members if c in current)
            parent_denominator = parent_coverage["eligible"]["case_count"]
            denominator = population_coverage["eligible"]["case_count"]
            groups.append(
                {
                    "id": content_identity(
                        "rule-group",
                        {
                            "rule_policy_id": RULE_POLICY,
                            "activity_projection_policy": ACTIVITY_PROJECTION_POLICY,
                            "parent_identity": dict(checked_parent_identity),
                            "rule": dict(rule),
                            "key": key,
                        },
                    ),
                    "key": key,
                    "parent": {
                        "cases": _support(members, counts),
                        "denominator": parent_denominator,
                        "share": (
                            len(members) / parent_denominator
                            if parent_denominator
                            else None
                        ),
                    },
                    "population": {
                        "cases": _support(kept, counts, True),
                        "denominator": denominator,
                        "share": len(kept) / denominator if denominator else None,
                    },
                    "span_distribution": case_distribution_for_kept(
                        summaries, kept, baselines[0]
                    ),
                    "gap_distribution": case_distribution_for_kept(
                        summaries, kept, baselines[1]
                    ),
                    "exemplars": _exemplars(prepared, kept, summaries, counts),
                }
            )
        return {
            "rule_policy_id": RULE_POLICY,
            "activity_projection_policy": ACTIVITY_PROJECTION_POLICY,
            "catalogue_scope": "frozen_parent",
            "timestamp_kind": kind,
            "group_membership_overlaps": rule["kind"] == "shared_reference" and rule.get("policy", "any_record") == "any_record",
            "population_coverage": population_coverage,
            "parent_coverage": parent_coverage,
            "shared_reference_coverage": reference_coverage,
            "group_count": len(catalogue),
            "next_offset": offset + limit if offset + limit < len(catalogue) else None,
            "groups": groups,
        }
    except (SelectionError, CaseTimeError) as error:
        return ImportRefusal(error.code, str(error), "identity.population_id")
