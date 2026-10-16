"""Finite descriptive flow/subtype comparison on one reviewed complete-item parent."""
from __future__ import annotations

from collections.abc import Mapping

from .bpic19_profiles import CATEGORY_LABELS, FLOW_IDS, _support, invariant_value, profile_bpic19
from .mapping import ImportRefusal, plain_json
from .preparation import PreparedData, content_identity
from .selection import SelectionError, case_ids

POLICY_ID = "bpic19.flow_item_type_comparison.v1"


def compare_flow_subtypes(prepared: PreparedData, query: Mapping, population_case_ids=None,
                          lineage_origin: PreparedData | None = None):
    """Re-evaluate both declared rules, never interpret the reference as a complement."""
    if query.get("policy_id") != POLICY_ID:
        return ImportRefusal("unsupported_policy", "Choose the finite flow/subtype comparison policy.", "query.policy_id")
    try:
        parent = case_ids(prepared, population_case_ids)
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), error.field)
    profile_query = query["profile_query"]
    if profile_query["roles"] is None:
        return ImportRefusal("invalid_parameter", "Review the source field roles before comparing subtypes.", "query.profile_query.roles")
    profile = profile_bpic19(prepared, profile_query["roles"], parent, profile_query["profile_columns"],
        profile_query.get("source_interpretation"), profile_query.get("attribute_view"), profile_query.get("include_zero_cells", False),
        profile_query.get("include_document_siblings", False), profile_query.get("category_lineage"), lineage_origin)
    if isinstance(profile, ImportRefusal): return profile
    if profile["definition_id"] != query["profile_definition_id"]:
        return ImportRefusal("identity_mismatch", "The reviewed source profile does not belong to this exact parent and definition.", "query.profile_definition_id")
    target_rule, reference_rule = query["target"], query["reference"]
    for name, rule in (("target", target_rule), ("reference", reference_rule)):
        if rule["flow_id"] not in FLOW_IDS or rule["item_type_state"] not in {"invariant", "missing", "conflicting"}:
            return ImportRefusal("invalid_parameter", "Choose one supplied flow and a reviewed subtype state.", "query." + name)
        if (rule["item_type_state"] == "invariant" and (not isinstance(rule["item_type_value"], str) or not rule["item_type_value"])) or (rule["item_type_state"] != "invariant" and rule["item_type_value"] is not None):
            return ImportRefusal("invalid_parameter", "An invariant subtype names its exact value; missing/conflicting states have no value.", "query." + name + ".item_type_value")
    if target_rule["flow_id"] != reference_rule["flow_id"]:
        return ImportRefusal("unsupported_policy", "This bounded comparison compares subtypes within one purchasing flow.", "query.reference.flow_id")
    if target_rule == reference_rule:
        return ImportRefusal("invalid_parameter", "Choose two distinct subtype rules.", "query.reference")
    page = query["page"]
    if type(page["offset"]) is not int or page["offset"] < 0 or type(page["limit"]) is not int or not 1 <= page["limit"] <= 100 or page["role"] not in {"target", "reference", "outside", "unavailable"}:
        return ImportRefusal("invalid_parameter", "Choose a bounded side evidence page.", "query.page")
    roles = profile_query["roles"]
    documents, states = {}, {}
    flow_parent, scope_unavailable = [], []
    for cid in parent:
        records = prepared.histories[cid]
        doc_state, doc = invariant_value(records, roles["purchasing_document"])
        documents[cid] = doc if doc_state == "invariant" else None
        cat_state, category = invariant_value(records, roles["item_category"])
        if cat_state != "invariant" or category not in CATEGORY_LABELS.values(): scope_unavailable.append(cid)
        if cat_state == "invariant" and category == CATEGORY_LABELS[target_rule["flow_id"]]:
            flow_parent.append(cid)
            states[cid] = invariant_value(records, roles["item_type"])
    def matches(rule):
        return [cid for cid in flow_parent if states[cid] == (rule["item_type_state"], rule["item_type_value"])]
    target, reference = matches(target_rule), matches(reference_rule)
    union = sorted(set(target) | set(reference))
    union_set = set(union)
    outside = [cid for cid in flow_parent if cid not in union_set]
    unavailable = [cid for cid in flow_parent if states[cid][0] != "invariant"]
    flow_set = set(flow_parent)
    supports = {"parent": _support(prepared,parent,documents,len(parent)),
        "flow_parent": _support(prepared,flow_parent,documents,len(parent)),
        "comparison_parent": _support(prepared,union,documents,len(flow_parent)),
        "target": _support(prepared,target,documents,len(union)),
        "reference": _support(prepared,reference,documents,len(union)),
        "outside": _support(prepared,outside,documents,len(flow_parent)),
        "outside_flow": _support(prepared,[cid for cid in parent if cid not in flow_set],documents,len(parent)),
        "unavailable": _support(prepared,unavailable,documents,len(flow_parent)),
        "scope_unavailable": _support(prepared,scope_unavailable,documents,len(parent))}
    target_docs = {documents[cid] for cid in target if documents[cid] is not None}
    reference_docs = {documents[cid] for cid in reference if documents[cid] is not None}
    record_denominator = supports["comparison_parent"]["record_count"]
    source_meaning = {"policy_id": profile["definition"]["policy_id"],
        "roles": plain_json(profile["definition"]["roles"]),
        "profile_columns": plain_json(profile["definition"]["profile_columns"]),
        "source_interpretation": plain_json(profile["definition"]["source_interpretation"])}
    if profile_query.get("category_lineage") is not None:
        source_meaning["category_lineage"] = plain_json(profile_query["category_lineage"])
    if (profile_query.get("attribute_view") or {}).get("select_value"):
        source_meaning["attribute_view"] = {**plain_json(profile_query["attribute_view"]), "offset": 0, "limit": 1}
    definition = {"policy_id": POLICY_ID, "profile_definition_id": query["profile_definition_id"],
        "profile_query": source_meaning, "target": plain_json(target_rule), "reference": plain_json(reference_rule),
        "membership_policy": "exact_invariant_category_and_reviewed_item_type_state",
        "document_policy": "all_record_invariant_document_overlap_preserved"}
    did = content_identity("bpic19-flow-comparison", {"preparation_id": prepared.preparation_id,
        "parent_case_ids": list(parent), "definition": definition})
    members = {"target": target,"reference": reference,"outside": outside,"unavailable": unavailable}[page["role"]]
    examples = []
    for cid in members[page["offset"]:page["offset"] + page["limit"]]:
        state, value = states[cid]
        examples.append({"case_id": cid, "role": page["role"], "document": documents[cid],
            "item_type_state": state, "item_type_value": value, "record_count": len(prepared.histories[cid]),
            "witness_row_ids": [row.row_id for row in prepared.histories[cid]],
            "reason": "exact_invariant_flow_and_subtype" if page["role"] in {"target","reference"} else "subtype_missing_or_conflicting" if state != "invariant" else "outside_both_reviewed_subtype_rules"})
    return {"definition_id": did, "definition": definition, **supports,
        "shares": {"item_denominator": len(union), "record_denominator": record_denominator,
            "target_item_share": len(target)/len(union) if union else None,
            "reference_item_share": len(reference)/len(union) if union else None,
            "target_record_share": supports["target"]["record_count"]/record_denominator if record_denominator else None,
            "reference_record_share": supports["reference"]["record_count"]/record_denominator if record_denominator else None,
            "reason": None if union else "empty_comparison_parent"},
        "documents": {"union_document_ids": sorted(target_docs|reference_docs), "overlap_document_ids": sorted(target_docs&reference_docs),
            "union_document_count": len(target_docs|reference_docs), "overlap_document_count": len(target_docs&reference_docs),
            "target_document_count": len(target_docs), "reference_document_count": len(reference_docs),
            "unknown_document_case_ids": [cid for cid in union if documents[cid] is None], "supports_overlap": bool(target_docs&reference_docs)},
        "page": {**plain_json(page), "total": len(members), "items": examples,
            "next_offset": page["offset"] + page["limit"] if page["offset"] + page["limit"] < len(members) else None},
        "limitations": ["This is a descriptive count comparison; it does not estimate a causal subtype effect.",
            "Item and record shares use the named union comparison parent, not the entire source or target complement.",
            "Document memberships can overlap; their summed supports are not a count of distinct documents.",
            "Amount and interval comparisons require their separately admitted measure definitions."]}
