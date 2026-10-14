"""Finite interval distributions on two declared whole-item sides of one parent."""
from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from statistics import median
import math

from .bpic19_measures import PAPER_TIME_POLICY, checked_measure_definition, derive_interval_evidence
from .mapping import ImportRefusal, plain_json
from .preparation import PreparedData, content_identity
from .selection import SelectionError, case_ids

POLICY_ID = "bpic19.interval_distribution_comparison.v1"
MEMBERSHIP_POLICY = "bpic19.explicit_complete_case_ids.v1"


def _side(prepared, parent_set, given, name):
    if not isinstance(given, Mapping) or set(given) != {"label", "recipe"} or not isinstance(given["label"], str) or not given["label"].strip():
        return ImportRefusal("invalid_parameter", "Each side needs an explicit name and a complete-case membership recipe.", "query." + name)
    recipe = given["recipe"]
    if not isinstance(recipe, Mapping) or set(recipe) != {"kind", "case_ids"} or recipe["kind"] != "complete_case_ids" or not isinstance(recipe["case_ids"], (list, tuple)):
        return ImportRefusal("invalid_parameter", "Choose the finite complete-case-ID recipe.", "query." + name + ".recipe")
    try:
        ids = case_ids(prepared, recipe["case_ids"])
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), "query." + name + ".recipe.case_ids")
    if any(cid not in parent_set for cid in ids):
        return ImportRefusal("invalid_parent", "Every side member must belong to this exact frozen parent.", "query." + name + ".recipe.case_ids")
    return {"label": given["label"], "recipe": {"kind": "complete_case_ids", "case_ids": list(ids)}}


def _distribution(values):
    if not values:
        return {"available_case_count": 0, "zero_case_count": 0, "minimum": None, "maximum": None,
                "mean": None, "median": None, "reason": "empty_eligible_support"}
    return {"available_case_count": len(values), "zero_case_count": values.count(0), "minimum": min(values),
            "maximum": max(values), "mean": math.fsum(value / len(values) for value in values),
            "median": median(values), "reason": None}


def compare_intervals(prepared: PreparedData, query: Mapping, population_case_ids=None):
    """No Norm, complements, event trimming, or implicit actor/value prerequisites."""
    if query.get("policy_id") != POLICY_ID or query.get("interval_policy") != "independent_minimum":
        return ImportRefusal("unsupported_policy", "Choose the admitted independent-minimum interval comparison.", "query.interval_policy")
    try:
        parent = case_ids(prepared, population_case_ids)
        recipe = checked_measure_definition({"interval_source": query.get("interval_source"), "interval_target": query.get("interval_target")})
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), error.field)
    except (TypeError, ValueError) as error:
        return ImportRefusal("invalid_parameter", str(error), "query")
    parent_set = set(parent)
    target = _side(prepared, parent_set, query.get("target"), "target")
    reference = _side(prepared, parent_set, query.get("reference"), "reference")
    if isinstance(target, ImportRefusal): return target
    if isinstance(reference, ImportRefusal): return reference
    page = query.get("page", {})
    if page.get("role") not in {"target", "reference"} or type(page.get("offset")) is not int or page["offset"] < 0 or type(page.get("limit")) is not int or not 1 <= page["limit"] <= 100:
        return ImportRefusal("invalid_parameter", "Choose a target/reference evidence page with a nonnegative offset and limit 1–100.", "query.page")
    sides = {"target": target, "reference": reference}
    target_set, reference_set = (set(side["recipe"]["case_ids"]) for side in (target, reference))
    union = sorted(target_set | reference_set)
    overlap = sorted(target_set & reference_set)
    summaries = {}
    for role, side in sides.items():
        ids = side["recipe"]["case_ids"]
        summaries[role] = {"label": side["label"], "case_ids": ids, "case_count": len(ids),
            "record_count": sum(len(prepared.histories[cid]) for cid in ids),
            "available_case_ids": [], "zero_case_ids": [], "unavailable_case_ids": [], "unavailable_reasons": {},
            "_values": [], "_reasons": Counter()}
    for cid in union:
        interval = derive_interval_evidence(prepared, cid, recipe["interval_source"], recipe["interval_target"])["interval"]
        for role, members in (("target", target_set), ("reference", reference_set)):
            if cid not in members: continue
            support = summaries[role]
            if interval["available"]:
                support["available_case_ids"].append(cid)
                support["_values"].append(interval["value"])
                if interval["value"] == 0: support["zero_case_ids"].append(cid)
            else:
                support["unavailable_case_ids"].append(cid)
                support["_reasons"][interval["reason"]] += 1
    for support in summaries.values():
        support["summary"] = {**_distribution(support.pop("_values")), "unavailable_case_count": len(support["unavailable_case_ids"])}
        support["unavailable_reasons"] = dict(sorted(support.pop("_reasons").items()))
    definition = {"policy_id": POLICY_ID, "time_policy_id": PAPER_TIME_POLICY, "membership_policy_id": MEMBERSHIP_POLICY,
        "interval_policy": "independent_minimum", "interval_source": recipe["interval_source"], "interval_target": recipe["interval_target"],
        "target": target, "reference": reference, "parent_case_ids": list(parent),
        "activity_column": prepared.mapping.get("activity_column"),
        "clock_kind": next((row.timestamp_kind for row in prepared.records), "unavailable"),
        "clock_policy_id": prepared.policies.get("time", {}).get("id", "prepared_clock"),
        "endpoint_admissibility": "select_parsed_minimum_then_2017_inclusive_2020_exclusive",
        "direction_policy": "nonnegative_recorded_difference", "elapsed_unit": "days",
        "source_representation": "complete_original_item_histories"}
    did = content_identity("bpic19-interval-comparison", {"preparation_id": prepared.preparation_id, "definition": definition})
    members = sides[page["role"]]["recipe"]["case_ids"]
    items = [derive_interval_evidence(prepared, cid, recipe["interval_source"], recipe["interval_target"])
             for cid in members[page["offset"]:page["offset"] + page["limit"]]]
    return {"definition_id": did, "definition": definition,
        "parent": {"case_ids": list(parent), "case_count": len(parent), "record_count": sum(len(prepared.histories[cid]) for cid in parent)},
        "target": summaries["target"], "reference": summaries["reference"],
        "union_case_ids": union, "overlap_case_ids": overlap,
        "outside_case_ids": [cid for cid in parent if cid not in target_set and cid not in reference_set],
        "page": {**plain_json(page), "total": len(members), "items": items,
            "next_offset": page["offset"] + page["limit"] if page["offset"] + page["limit"] < len(members) else None},
        "limitations": ["Descriptive elapsed days do not establish active work, contractual lateness or a causal cohort effect.",
            "Missing, reversed and out-of-range intervals are unavailable; they never become zero-day observations.",
            "The two explicitly named sides can overlap. The reference is not an implicit target complement.",
            "Independent minima preserve every co-minimum and later or unparseable candidate in complete original histories."]}
