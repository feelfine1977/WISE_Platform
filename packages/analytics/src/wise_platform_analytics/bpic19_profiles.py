"""Reviewed BPIC19 case attributes and purchasing families over complete raw histories.

No ordering, timestamps, scoring or activity inference is needed for these attributes.
The declared category assigns a family; its flags are a separate cross-check. All
counts and memberships come from this package, never from a browser reducer.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone

from .mapping import plain_json

from .mapping import ImportRefusal
from .preparation import PreparedData, content_identity
from .selection import SelectionError, case_ids

POLICY_ID = "bpic19.all_raw_case_attributes.v1"
ROLE_NAMES = ("item_category", "item_type", "goods_receipt", "gr_based_iv", "purchasing_document", "item", "source_case")
ROLE_HEADERS = {
    "item_category": "case Item Category", "item_type": "case Item Type",
    "goods_receipt": "case Goods Receipt", "gr_based_iv": "case GR-Based Inv. Verif.",
    "purchasing_document": "case Purchasing Document", "item": "case Item", "source_case": "case concept:name",
}
CATEGORY_LABELS = {
    "after_gr": "3-way match, invoice after GR",
    "before_gr": "3-way match, invoice before GR",
    "two_way": "2-way match",
    "consignment": "Consignment",
}
FLOW_IDS = tuple(CATEGORY_LABELS)
KNOWN_ITEM_TYPES = ("Standard", "Service", "Subcontracting", "Third-party", "Limit", "Consignment")
FLOW_LABELS = {
    "after_gr": "Three-way: invoice after goods receipt",
    "before_gr": "Three-way: invoice may precede goods receipt",
    "two_way": "Two-way: no goods receipt required",
    "consignment": "Consignment",
}
_CATEGORY_FLOW = {value: key for key, value in CATEGORY_LABELS.items()}
_EXPECTED_FLAGS = {"after_gr": ("true", "true"), "before_gr": ("true", "false"),
                   "two_way": ("false", "false"), "consignment": ("true", "false")}


def _value(record, index: int) -> str | None:
    value = record.original_cells[index]
    return None if value == "" else value


def invariant_value(records, index: int) -> tuple[str, str | None]:
    """Exact all-record reducer. Blanks mixed with a value are conflicting, not filled forward."""
    values = {_value(record, index) for record in records}
    if not values or values == {None}:
        return "missing", None
    if len(values) != 1:
        return "conflicting", None
    return "invariant", next(iter(values))


def suggested_roles(columns: Iterable[str]) -> dict[str, int | None]:
    """Propose exact aliases only when no normalized competing header exists."""
    columns = tuple(columns)
    normalized = tuple(" ".join(name.casefold().split()).removeprefix("source__") for name in columns)
    proposals = {}
    for role, header in ROLE_HEADERS.items():
        matches = [i for i, name in enumerate(columns) if name in {header, "source__" + header}]
        unambiguous = normalized.count(header.casefold()) == 1
        proposals[role] = matches[0] if len(matches) == 1 and unambiguous else None
    return proposals


def validate_roles(prepared: PreparedData, roles: object) -> dict[str, int | None] | ImportRefusal:
    if not isinstance(roles, Mapping) or set(roles) != set(ROLE_NAMES):
        return ImportRefusal("invalid_parameter", "Review the seven supported source field roles.", "query.roles")
    for role in ROLE_NAMES:
        index = roles[role]
        if role == "source_case" and index is None:
            continue
        if type(index) is not int or not 0 <= index < len(prepared.columns):
            return ImportRefusal("invalid_parameter", "Choose a source column for this field role.", "query.roles." + role)
    required = [roles[role] for role in ROLE_NAMES if role != "source_case"]
    if len(set(required)) != len(required):
        return ImportRefusal("invalid_parameter", "Category, item type, flags, document and item need distinct source columns.", "query.roles")
    return dict(roles)


def _support(prepared, ids, documents, denominator):
    ids = sorted(ids)
    return {"case_ids": ids, "case_count": len(ids), "record_count": sum(len(prepared.histories[c]) for c in ids),
            "document_count": len({documents[c] for c in ids if documents[c] is not None}),
            "share": len(ids) / denominator if denominator else None, "example_case_ids": ids[:3]}


def profile_bpic19(prepared: PreparedData, roles: Mapping[str, int | None],
                   population_case_ids: Iterable[str] | None = None,
                   profile_columns: Iterable[int] | None = None,
                   source_interpretation: Mapping | None = None,
                   attribute_view: Mapping | None = None,
                   include_zero_cells: bool = False,
                   include_document_siblings: bool = False) -> dict | ImportRefusal:
    checked = validate_roles(prepared, roles)
    if isinstance(checked, ImportRefusal):
        return checked
    try:
        parent = case_ids(prepared, population_case_ids)
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), error.field)
    if profile_columns is None:
        # All source case attributes; event fields can be deliberately selected too.
        indices = tuple(i for i, name in enumerate(prepared.columns)
                        if name.startswith("case ") or name.startswith("source__case "))
    else:
        indices = tuple(profile_columns)
    if len(set(indices)) != len(indices) or any(type(i) is not int or not 0 <= i < len(prepared.columns) for i in indices):
        return ImportRefusal("invalid_parameter", "Profile columns must be unique source column indices.", "query.profile_columns")
    indices = tuple(sorted(set(indices) | {i for i in checked.values() if i is not None}))
    documents = {}
    groups = {flow: [] for flow in FLOW_IDS}
    unresolved = {state: [] for state in ("missing", "conflicting", "unrecognized")}
    checks = {state: [] for state in ("valid", "unavailable", "flag_disagreement")}
    doc_flows = defaultdict(set); doc_members = defaultdict(list); compound = defaultdict(list)
    identity_issues = {state: [] for state in ("missing_document_or_item", "conflicting_document_or_item",
                                               "source_case_mismatch", "duplicate_document_item")}
    cells = defaultdict(list)
    for cid in parent:
        records = prepared.histories[cid]
        reduced = {role: invariant_value(records, index) for role, index in checked.items() if index is not None}
        doc_state, doc = reduced["purchasing_document"]; item_state, item = reduced["item"]
        documents[cid] = doc if doc_state == "invariant" else None
        if doc_state == "missing" or item_state == "missing":
            identity_issues["missing_document_or_item"].append(cid)
        elif doc_state != "invariant" or item_state != "invariant":
            identity_issues["conflicting_document_or_item"].append(cid)
        else:
            compound[(doc, item)].append(cid)
            if "source_case" in reduced:
                state, supplied = reduced["source_case"]
                if state != "invariant" or supplied != doc + "_" + item:
                    identity_issues["source_case_mismatch"].append(cid)
        state, category = reduced["item_category"]
        flow = _CATEGORY_FLOW.get(category) if state == "invariant" else None
        category_state = "classified" if flow else (state if state != "invariant" else "unrecognized")
        if flow:
            groups[flow].append(cid)
        else:
            unresolved[category_state].append(cid)
        if documents[cid] is not None:
            doc_members[documents[cid]].append(cid)
            if flow: doc_flows[documents[cid]].add(flow)
        it_state, it_value = reduced["item_type"]
        if flow:
            cells[(flow, it_state, it_value)].append(cid)
        gr_state, gr = reduced["goods_receipt"]; iv_state, iv = reduced["gr_based_iv"]
        if not flow or any(s != "invariant" for s in (gr_state, iv_state, it_state)) or gr not in {"true", "false"} or iv not in {"true", "false"}:
            checks["unavailable"].append(cid)
        elif (gr, iv) != _EXPECTED_FLAGS[flow] or (flow == "consignment") != (it_value == "Consignment"):
            checks["flag_disagreement"].append(cid)
        else:
            checks["valid"].append(cid)
    for memberships in compound.values():
        if len(memberships) > 1: identity_issues["duplicate_document_item"].extend(memberships)
    attributes = []
    for index in indices:
        events = Counter(); supports = Counter()
        states = Counter(); state_examples = defaultdict(list)
        document_first = {}; document_first_case = {}; document_difference_case = {}; changing_documents = set()
        for cid in parent:
            records = prepared.histories[cid]
            values = Counter(_value(r, index) for r in records)
            events.update(values)
            for value in values:
                supports[value] += 1
                doc = documents[cid]
                if doc is not None:
                    if doc not in document_first:
                        document_first[doc] = value; document_first_case[doc] = cid
                    elif document_first[doc] != value:
                        changing_documents.add(doc); document_difference_case.setdefault(doc, cid)
            state = "missing" if set(values) == {None} else "invariant" if len(values) == 1 else "conflicting"
            states[state] += 1
            if len(state_examples[state]) < 3: state_examples[state].append(cid)
        ranked = sorted(events, key=lambda value: (-supports[value], value is not None, value or ""))
        shown = ranked[:12]
        # Keep exact document/witness support only for the bounded visible values.
        # A source-case or numeric field can have hundreds of thousands of values;
        # retaining a document set and examples for each unseen value is needless.
        visible = set(shown); value_docs = defaultdict(set); examples = defaultdict(list)
        for cid in parent:
            values = {_value(r, index) for r in prepared.histories[cid]} & visible
            for value in values:
                if documents[cid] is not None: value_docs[value].add(documents[cid])
                if len(examples[value]) < 3: examples[value].append(cid)
        attributes.append({"column_index": index, "column_name": prepared.columns[index],
            "distinct_nonmissing_value_count": sum(v is not None for v in events), "missing_record_count": events[None],
            "invariant_case_count": states["invariant"], "missing_case_count": states["missing"],
            "conflicting_case_count": states["conflicting"],
            "invariant_document_count": sum(doc not in changing_documents and value is not None for doc,value in document_first.items()),
            "missing_document_count": sum(doc not in changing_documents and value is None for doc,value in document_first.items()),
            "conflicting_document_count": len(changing_documents),
            "document_conflict_examples": [{"document": doc, "case_ids": sorted({document_first_case[doc], document_difference_case[doc]})} for doc in sorted(changing_documents)[:3]],
            "missing_example_case_ids": state_examples["missing"], "conflicting_example_case_ids": state_examples["conflicting"],
            "conflicting_witnesses": [{"case_id": cid, "rows": [{"row_id": r.row_id, "source_position": r.source_position, "value": _value(r, index)} for r in sorted(prepared.histories[cid], key=lambda r: r.source_position)]} for cid in state_examples["conflicting"]],
            "values": [{"value": v, "case_count": supports[v], "record_count": events[v],
                        "document_count": len(value_docs[v]), "example_case_ids": examples[v]} for v in shown],
            "omitted_distinct_value_count": len(ranked) - len(shown), "value_membership_overlaps": states["conflicting"] > 0})
    source_review = review_source(prepared, checked, parent, source_interpretation)
    if isinstance(source_review, ImportRefusal):
        return source_review
    definition = {"policy_id": POLICY_ID, "roles": checked, "profile_columns": list(indices),
                  "category_labels": CATEGORY_LABELS, "category_assignment": "supplied_exact_invariant_category",
                  "flag_policy": "bpic19.category_flags_and_consignment_type.v1", "grain_policy": "bpic19.document_item_underscore.v1",
                  "source_interpretation": source_review["interpretation"]}
    viewed = None
    if attribute_view is not None:
        viewed = attribute_values(prepared, parent, documents, attribute_view)
        if isinstance(viewed, ImportRefusal): return viewed
        if attribute_view["select_value"]:
            definition["attribute_selection"] = {"column_index": attribute_view["column_index"],
                "value": attribute_view["value"], "policy_id": "bpic19.any_original_record_exact_value.v1"}
    identity = content_identity("bpic19-profile", {"preparation_id": prepared.preparation_id,
                                "parent_case_ids": list(parent), "definition": definition})
    mixed = sorted(doc for doc, flows in doc_flows.items() if len(flows) > 1)
    assigned_count = sum(len(ids) for ids in groups.values())
    if include_zero_cells:
        for flow in FLOW_IDS:
            for value in KNOWN_ITEM_TYPES:
                cells.setdefault((flow, "invariant", value), [])
    result = {"definition_id": identity, "definition": definition,
        "population": {"case_count": len(parent), "record_count": sum(len(prepared.histories[c]) for c in parent),
                       "document_count": len(doc_members), "document_unknown_case_count": sum(v is None for v in documents.values())},
        "flows": [{"flow_id": flow, "label": FLOW_LABELS[flow], "category_value": CATEGORY_LABELS[flow],
                   **_support(prepared, groups[flow], documents, len(parent))} for flow in FLOW_IDS],
        "unresolved": [{"state": state, **_support(prepared, ids, documents, len(parent))} for state, ids in unresolved.items()],
        "cross_checks": [{"state": state, **_support(prepared, ids, documents, len(parent))} for state, ids in checks.items()],
        "partition": {"classified_case_count": assigned_count, "unresolved_case_count": len(parent)-assigned_count,
                      "is_disjoint": True, "covers_parent": assigned_count + sum(len(ids) for ids in unresolved.values()) == len(parent)},
        "grain": {"mixed_flow_document_count": len(mixed), "mixed_flow_document_examples":
                    [{"document": doc, "flow_ids": sorted(doc_flows[doc]), "case_ids": sorted(doc_members[doc])} for doc in mixed[:5]],
                  "identity_issues": [{"state": state, **_support(prepared, ids, documents, len(parent))} for state, ids in identity_issues.items()]},
        "source_review": source_review,
        "attributes": attributes,
        "flow_item_types": [{"flow_id": flow, "item_type_state": state, "item_type_value": value,
                             **_support(prepared, ids, documents, len(parent))}
                            for (flow,state,value),ids in sorted(cells.items(), key=lambda pair: (FLOW_IDS.index(pair[0][0]), pair[0][1], pair[0][2] or ""))]}
    if include_zero_cells:
        result["item_type_totals"] = [{"item_type_value": value,
            **_support(prepared, [cid for (flow,state,v),ids in cells.items() if state == "invariant" and v == value for cid in ids], documents, len(parent))}
            for value in sorted({value for flow,state,value in cells if state == "invariant"})]
    if viewed is not None: result["attribute_view"] = viewed
    if include_document_siblings:
        known_docs = {doc for doc in documents.values() if doc is not None}
        inside = set(parent); outside, outside_docs, possible = [], {}, []
        for cid, records in prepared.histories.items():
            if cid in inside: continue
            state, doc = invariant_value(records,checked["purchasing_document"])
            if state == "invariant" and doc in known_docs:
                outside.append(cid); outside_docs[cid] = doc
            elif state != "invariant" and any(_value(row,checked["purchasing_document"]) in known_docs for row in records):
                possible.append(cid)
        result["grain"]["outside_parent_siblings"] = _support(prepared,outside,outside_docs,len(prepared.histories))
        result["grain"]["possible_sibling_conflict_case_ids"] = sorted(possible)
    return result


def attribute_values(prepared: PreparedData, parent: Iterable[str], documents: Mapping, query: Mapping) -> dict | ImportRefusal:
    """Bounded value pages and one explicitly requested complete-item membership.

    This is any-original-record support, not an invariant static-field admission.
    Pagination changes neither global counts nor membership/definition meaning.
    """
    parent = tuple(parent)
    required = {"column_index", "offset", "limit", "select_value", "value"}
    if not isinstance(query, Mapping) or set(query) != required:
        return ImportRefusal("invalid_parameter", "Declare a source column and bounded value page.", "query.attribute_view")
    index = query["column_index"]
    if type(index) is not int or not 0 <= index < len(prepared.columns):
        return ImportRefusal("invalid_parameter", "Choose an existing source column.", "query.attribute_view.column_index")
    if type(query["offset"]) is not int or query["offset"] < 0 or type(query["limit"]) is not int or not 1 <= query["limit"] <= 100:
        return ImportRefusal("invalid_parameter", "Use a nonnegative value offset and limit 1–100.", "query.attribute_view")
    if type(query["select_value"]) is not bool or (query["value"] is not None and not isinstance(query["value"], str)):
        return ImportRefusal("invalid_parameter", "Select one exact raw value or explicit missing.", "query.attribute_view.value")
    events, cases, docs, examples = Counter(), Counter(), defaultdict(set), defaultdict(list)
    selected, witnesses = [], []
    for cid in parent:
        records = prepared.histories[cid]
        values = Counter(_value(row, index) for row in records)
        events.update(values)
        for value in values:
            cases[value] += 1
        if query["select_value"] and query["value"] in values:
            selected.append(cid)
            if len(witnesses) < 20:
                witnesses.append({"case_id": cid, "row_ids": [row.row_id for row in records if _value(row,index) == query["value"]]})
    ranked = sorted(events, key=lambda value: (-cases[value], value is not None, value or ""))
    page_values = ranked[query["offset"]:query["offset"] + query["limit"]]
    visible = set(page_values)
    for cid in parent:
        for value in {_value(row,index) for row in prepared.histories[cid]} & visible:
            if documents[cid] is not None: docs[value].add(documents[cid])
            if len(examples[value]) < 3: examples[value].append(cid)
    return {"column_index": index, "column_name": prepared.columns[index],
        "policy_id": "bpic19.any_original_record_exact_value.v1", "offset": query["offset"], "limit": query["limit"],
        "total_value_count": len(ranked), "distinct_nonmissing_value_count": sum(value is not None for value in ranked),
        "next_offset": query["offset"] + query["limit"] if query["offset"] + query["limit"] < len(ranked) else None,
        "values": [{"value": value, "case_count": cases[value], "record_count": events[value],
            "document_count": len(docs[value]), "example_case_ids": examples[value]} for value in page_values],
        "selection": None if not query["select_value"] else {"value": query["value"],
            **_support(prepared, selected, documents, len(parent)), "witnesses": witnesses,
            "omitted_witness_case_count": max(0,len(selected) - len(witnesses))}}


SOURCE_POLICY_ID = "bpic19.raw_source_interpretation.v1"


def default_source_interpretation(prepared: PreparedData) -> dict:
    kind = prepared.records[0].timestamp_kind if prepared.records else "utc_instant"
    return {"profile_name": "All original records", "policy_id": SOURCE_POLICY_ID,
            "inclusion": {"kind": "all_source", "timestamp_kind": kind,
                          "start_inclusive": None, "end_exclusive": None},
            "horizon": {"timestamp_kind": kind, "value": None, "provenance": None},
            "discrepancies": []}


def _declared_time(value, kind: str, field: str):
    if not isinstance(value, str) or not value or "T" not in value:
        return ImportRefusal("invalid_parameter", "Declare a complete ISO timestamp in the reviewed clock.", field)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return ImportRefusal("invalid_parameter", "Declare a valid ISO timestamp in the reviewed clock.", field)
    if kind == "utc_instant":
        if parsed.tzinfo is None:
            return ImportRefusal("invalid_parameter", "UTC-instant boundaries require an explicit offset; no workstation timezone is inferred.", field)
        return parsed.astimezone(timezone.utc)
    if parsed.tzinfo is not None:
        return ImportRefusal("invalid_parameter", "Recorded wall-clock boundaries cannot carry an undeclared offset.", field)
    return parsed


def _time_text(moment: datetime | None) -> str | None:
    return None if moment is None else moment.isoformat().replace("+00:00", "Z")


def review_source(prepared: PreparedData, roles: Mapping[str, int | None], parent: Iterable[str],
                  interpretation: Mapping | None = None) -> dict | ImportRefusal:
    """Preview a named source policy without changing any prepared record or population.

    Parser admission cutoff and trusted observation horizon are separate declarations.
    Selection uses complete raw item histories; a record projection is explicitly derived.
    Unknown or changing document links never acquire a guessed document identifier.
    """
    parent = tuple(parent)
    definition = default_source_interpretation(prepared) if interpretation is None else plain_json(interpretation)
    base = "query.source_interpretation"
    required = {"profile_name", "policy_id", "inclusion", "horizon", "discrepancies"}
    if not isinstance(definition, dict) or not required <= set(definition) or set(definition) - required - {"reported_populations"}:
        return ImportRefusal("invalid_parameter", "Review a named source interpretation, horizon and discrepancy list.", base)
    if definition["policy_id"] != SOURCE_POLICY_ID:
        return ImportRefusal("unsupported_policy", "This source interpretation policy is not supported.", base + ".policy_id")
    if not isinstance(definition["profile_name"], str) or not definition["profile_name"].strip():
        return ImportRefusal("invalid_parameter", "Name this source interpretation.", base + ".profile_name")
    inclusion, horizon = definition["inclusion"], definition["horizon"]
    if not isinstance(inclusion, dict) or set(inclusion) != {"kind", "timestamp_kind", "start_inclusive", "end_exclusive"}:
        return ImportRefusal("invalid_parameter", "Declare source inclusion grain and boundaries.", base + ".inclusion")
    if not isinstance(horizon, dict) or set(horizon) != {"timestamp_kind", "value", "provenance"}:
        return ImportRefusal("invalid_parameter", "Declare the trusted horizon or leave it unknown.", base + ".horizon")
    source_clock = prepared.records[0].timestamp_kind if prepared.records else "utc_instant"
    for name, part in (("inclusion", inclusion), ("horizon", horizon)):
        if part["timestamp_kind"] not in {"utc_instant", "wall_clock"} or part["timestamp_kind"] != source_clock:
            return ImportRefusal("invalid_parameter", "The declared clock must match the reviewed preparation; create a new preparation to change it.", base + "." + name + ".timestamp_kind")
    kind = inclusion["kind"]
    if kind not in {"all_source", "item_start", "document_start", "record_projection"}:
        return ImportRefusal("unsupported_policy", "Choose all-source, complete-item, complete-document or a named record projection.", base + ".inclusion.kind")
    start = end = observed_until = None
    if kind == "all_source":
        if inclusion["start_inclusive"] is not None or inclusion["end_exclusive"] is not None:
            return ImportRefusal("invalid_parameter", "All-source inclusion has no trimming boundaries.", base + ".inclusion")
    else:
        start = _declared_time(inclusion["start_inclusive"], source_clock, base + ".inclusion.start_inclusive")
        if isinstance(start, ImportRefusal): return start
        if kind == "record_projection":
            end = _declared_time(inclusion["end_exclusive"], source_clock, base + ".inclusion.end_exclusive")
            if isinstance(end, ImportRefusal): return end
            if end <= start:
                return ImportRefusal("invalid_parameter", "Projection end must follow its inclusive start.", base + ".inclusion.end_exclusive")
        elif inclusion["end_exclusive"] is not None:
            return ImportRefusal("invalid_parameter", "Complete-item/document start policies have no event-trimming end boundary.", base + ".inclusion.end_exclusive")
    if horizon["value"] is None:
        if horizon["provenance"] is not None:
            return ImportRefusal("invalid_parameter", "An unknown horizon has no asserted provenance.", base + ".horizon.provenance")
    else:
        observed_until = _declared_time(horizon["value"], source_clock, base + ".horizon.value")
        if isinstance(observed_until, ImportRefusal): return observed_until
        if not isinstance(horizon["provenance"], str) or not horizon["provenance"].strip():
            return ImportRefusal("invalid_parameter", "A trusted observation horizon requires reviewed evidence or provenance.", base + ".horizon.provenance")
    discrepancies = definition["discrepancies"]
    if not isinstance(discrepancies, list) or any(not isinstance(d, dict) or set(d) != {"reference", "reported_total", "reported_subtotal"}
        or not isinstance(d["reference"], str) or not d["reference"].strip()
        or any(type(d[k]) is not int or not 0 <= d[k] <= 9_007_199_254_740_991 for k in ("reported_total", "reported_subtotal")) for d in discrepancies):
        return ImportRefusal("invalid_parameter", "Source discrepancies require a reference and two exact nonnegative reported counts.", base + ".discrepancies")
    reported = definition.get("reported_populations", [])
    if not isinstance(reported, list) or len(reported) > 20 or any(
        not isinstance(figure, dict) or set(figure) != {"label", "count", "grain", "reference", "denominator", "parent_label"}
        or any(not isinstance(figure[key], str) or not figure[key].strip() for key in ("label", "reference", "denominator"))
        or figure["grain"] not in {"po_item", "purchasing_document", "original_record"}
        or type(figure["count"]) is not int or not 0 <= figure["count"] <= 9_007_199_254_740_991
        or (figure["parent_label"] is not None and not isinstance(figure["parent_label"], str)) for figure in reported):
        return ImportRefusal("invalid_parameter", "Reported populations need a label, exact count, grain, source reference and denominator.", base + ".reported_populations")
    if len({figure["label"] for figure in reported}) != len(reported):
        return ImportRefusal("invalid_parameter", "Use distinct labels for reported populations.", base + ".reported_populations")
    labels = {figure["label"] for figure in reported}
    if any(figure["parent_label"] is not None and (figure["parent_label"] not in labels or figure["parent_label"] == figure["label"]) for figure in reported):
        return ImportRefusal("invalid_parameter", "A reported subset must name a separately declared reported parent.", base + ".reported_populations")
    documents = {}
    for cid in parent:
        state, value = invariant_value(prepared.histories[cid], roles["purchasing_document"])
        documents[cid] = value if state == "invariant" else None
    retained, excluded, unavailable = [], [], []
    reasons, witnesses = {}, {}
    projected_rows, projected_cases = [], set()
    groups = defaultdict(list)
    if kind == "document_start":
        for cid in parent:
            if documents[cid] is not None:
                groups[documents[cid]].append(cid)
            else:
                unavailable.append(cid)
                reasons[cid] = "document_relation_missing_or_conflicting"
                witnesses[cid] = list(prepared.histories[cid])
    elif kind == "item_start":
        groups = {cid: [cid] for cid in parent}
    if kind in {"item_start", "document_start"}:
        for members in groups.values():
            rows = [r for cid in members for r in prepared.histories[cid]]
            parsed = [r for r in rows if r.time_value is not None]
            # A known earlier witness excludes even if another timestamp is unknown.
            early = [r for r in parsed if r.time_value < start]
            if early:
                target, reason, evidence = excluded, "earliest_raw_event_before_start", early
            elif len(parsed) != len(rows):
                target, reason, evidence = unavailable, "raw_timestamp_missing_or_invalid", [r for r in rows if r.time_value is None]
            else:
                target, reason, evidence = retained, "all_raw_events_at_or_after_start", rows
            for cid in members:
                target.append(cid); reasons[cid] = reason; witnesses[cid] = evidence
    elif kind == "all_source":
        retained = list(parent)
    else:
        # A derived representation has its own exact row IDs, never shortened raw histories.
        for cid in parent:
            rows = prepared.histories[cid]
            selected = [r for r in rows if r.time_value is not None and start <= r.time_value < end]
            projected_rows.extend(r.row_id for r in selected)
            if selected: projected_cases.add(cid)
            if any(r.time_value is None for r in rows): unavailable.append(cid)
    for key in ("start_inclusive", "end_exclusive"):
        inclusion[key] = _time_text(start if key == "start_inclusive" else end)
    horizon["value"] = _time_text(observed_until)
    rows = [r for cid in parent for r in prepared.histories[cid]]
    parsed = [r.time_value for r in rows if r.time_value is not None]
    anomaly_rows = defaultdict(list)
    for row in rows:
        if row.time_value is None:
            anomaly_rows["timestamp_" + row.timestamp_status].append(row)
        else:
            if row.time_value.year < 2017: anomaly_rows["before_reference_2017"].append(row)
            if row.time_value.year >= 2020: anomaly_rows["at_or_after_reference_2020"].append(row)
            if observed_until is not None and row.time_value > observed_until: anomaly_rows["after_trusted_horizon"].append(row)
    def row_witness(row):
        return {"case_id": row.case_id, "row_id": row.row_id, "source_position": row.source_position,
                "raw_timestamp": row.original_cells[prepared.mapping["timestamp_column"]],
                "interpreted_timestamp": row.utc_instant or row.local_timestamp}
    evidence = [{"case_id": cid, "reason": reasons[cid], "row_ids": sorted(r.row_id for r in witnesses[cid]),
                 "witness_case_ids": sorted({r.case_id for r in witnesses[cid]})}
                for cid in sorted(reasons)[:50]]
    time_policy = plain_json(prepared.policies["time"])
    parameters = time_policy["parameters"]
    result = {"interpretation": definition,
            "source_id": prepared.source_id, "preparation_id": prepared.preparation_id,
            "parser_time_policy": time_policy["id"], "parser_cutoff": parameters.get("snapshot_cutoff_utc", parameters.get("snapshot_cutoff_local")),
            "clock_kind": source_clock, "observed_raw_minimum": _time_text(min(parsed)) if parsed else None,
            "observed_raw_maximum": _time_text(max(parsed)) if parsed else None,
            "horizon_state": "unknown" if observed_until is None else "reviewed",
            "due_assessment": "unavailable", "due_assessment_reason": "observation_horizon_unknown" if observed_until is None else "payment_terms_and_due_obligation_not_defined",
            "raw_support": _support(prepared, parent, documents, len(parent)),
            "retained": _support(prepared, retained, documents, len(parent)),
            "excluded": _support(prepared, excluded, documents, len(parent)),
            "unavailable": _support(prepared, unavailable, documents, len(parent)),
            "projection": None if kind != "record_projection" else {"row_ids": sorted(projected_rows), "record_count": len(projected_rows),
                "case_ids": sorted(projected_cases), "case_count": len(projected_cases),
                "document_count": len({documents[c] for c in projected_cases if documents[c] is not None}), "raw_histories_preserved": True},
            "inclusion_evidence": evidence, "omitted_inclusion_evidence_count": max(0, len(reasons) - len(evidence)),
            "anomalies": [{"state": state, "record_count": len(anomalies), "case_count": len({r.case_id for r in anomalies}),
                "witnesses": [row_witness(r) for r in sorted(anomalies, key=lambda r: r.source_position)[:20]],
                "omitted_witness_count": max(0, len(anomalies) - 20)} for state, anomalies in sorted(anomaly_rows.items())],
            "discrepancies": [{**d, "difference": d["reported_total"] - d["reported_subtotal"],
                "measured_parent_case_count": len(parent)} for d in discrepancies]}
    if "reported_populations" in definition:
        result["reported_populations"] = [{**figure, "claim_status": "reported_source_claim"} for figure in reported]
    return result
