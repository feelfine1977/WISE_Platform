"""Finite recorded-completion cohorts over immutable complete PO-item histories.

Presence, source-compatible last-ending, inclusion and business due judgements
are deliberately distinct. No score, inferred invoice matching or event trimming.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from .bpic19_profiles import CATEGORY_LABELS, invariant_value
from .mapping import ImportRefusal, plain_json
from .preparation import PreparedData, content_identity
from .selection import SelectionError, case_ids

POLICY_ID = "bpic19.flow_completion_cohorts.v1"
FLOW_BY_CATEGORY = {label: flow for flow, label in CATEGORY_LABELS.items()}
STATES = ("observed_closed", "open_recorded", "unknown")
CLEAR = "Clear Invoice"
GR = "Record Goods Receipt"
SES = "Record Service Entry Sheet"
IR = "Record Invoice Receipt"
PO = "Create Purchase Order Item"
VENDOR = "Vendor creates invoice"
DELETE = "Delete Purchase Order Item"


def default_query(roles: dict, timestamp_kind: str = "utc_instant") -> dict:
    return {"policy_id": POLICY_ID, "roles": roles,
            "inclusion": {"kind": "all_items", "timestamp_kind": timestamp_kind,
                          "start_inclusive": None, "end_exclusive": None},
            "completion": {"recipe": "flow_presence", "receipt": "goods_only", "tie_policy": "unknown"},
            "retain": "all_included", "horizon": {"timestamp_kind": timestamp_kind, "value": None, "provenance": None},
            "page": {"offset": 0, "limit": 50}}


def _time(value, kind, field):
    if not isinstance(value, str) or "T" not in value:
        return ImportRefusal("invalid_parameter", "Declare a complete ISO timestamp in the reviewed clock.", field)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return ImportRefusal("invalid_parameter", "The boundary is not a valid ISO timestamp.", field)
    if (dt.tzinfo is not None) != (kind == "utc_instant"):
        return ImportRefusal("invalid_parameter", "Boundary and source clock differ; no timezone is inferred.", field)
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt


def _validate(prepared, query):
    if query.get("policy_id") != POLICY_ID:
        return ImportRefusal("unsupported_policy", "This cohort policy is not registered.", "query.policy_id")
    roles = query["roles"]
    if set(roles) != {"item_category", "purchasing_document"} or any(type(i) is not int or not 0 <= i < len(prepared.columns) for i in roles.values()) or len(set(roles.values())) != 2:
        return ImportRefusal("invalid_parameter", "Review distinct source category and document roles.", "query.roles")
    if query["inclusion"]["kind"] not in {"all_items", "item_start_window", "document_start_window", "item_any_event_window"} or query["completion"]["recipe"] not in {"flow_presence", "kpmg_last_ending", "botti_mandatory_presence"}:
        return ImportRefusal("unsupported_policy", "Only the finite registered inclusion/completion recipes are available; financial balances need a separate admitted operator.", "query")
    if query["completion"]["receipt"] not in {"goods_only", "goods_or_service"} or query["completion"]["tie_policy"] not in {"unknown", "source_position"} or query["retain"] not in {"all_included", *STATES}:
        return ImportRefusal("unsupported_policy", "This receipt, tie or retention policy is not registered.", "query")
    inclusion = query["inclusion"]
    kind = inclusion["timestamp_kind"]
    if kind not in {"utc_instant", "wall_clock"} or query["horizon"]["timestamp_kind"] not in {"utc_instant", "wall_clock"}:
        return ImportRefusal("invalid_parameter", "Review the source clock without inferring a timezone.", "query.inclusion.timestamp_kind")
    bounds = []
    for key in ("start_inclusive", "end_exclusive"):
        value = inclusion[key]
        dt = None if value is None else _time(value, kind, "query.inclusion." + key)
        if isinstance(dt, ImportRefusal): return dt
        bounds.append(dt)
    if inclusion["kind"] == "all_items" and any(v is not None for v in bounds):
        return ImportRefusal("invalid_parameter", "All-items inclusion has no hidden time boundary.", "query.inclusion")
    if inclusion["kind"] != "all_items" and all(v is None for v in bounds):
        return ImportRefusal("invalid_parameter", "A time-window inclusion needs at least one boundary.", "query.inclusion")
    if all(v is not None for v in bounds) and bounds[0] >= bounds[1]:
        return ImportRefusal("invalid_parameter", "The end-exclusive boundary must follow the start.", "query.inclusion")
    horizon = query["horizon"]
    if horizon["value"] is None:
        if horizon["provenance"] is not None:
            return ImportRefusal("invalid_parameter", "An unknown horizon has no invented provenance.", "query.horizon")
    else:
        if not isinstance(horizon["provenance"], str) or not horizon["provenance"].strip():
            return ImportRefusal("invalid_parameter", "A declared horizon needs reviewed source provenance.", "query.horizon.provenance")
        dt = _time(horizon["value"], horizon["timestamp_kind"], "query.horizon.value")
        if isinstance(dt, ImportRefusal): return dt
        if any(r.timestamp_kind != horizon["timestamp_kind"] for r in prepared.records):
            return ImportRefusal("invalid_parameter", "The declared horizon uses another source clock.", "query.horizon.timestamp_kind")
    if query["completion"]["recipe"] != "kpmg_last_ending" and query["completion"]["tie_policy"] != "unknown":
        return ImportRefusal("invalid_parameter", "Source-position tie ordering applies only to the last-ending recipe.", "query.completion.tie_policy")
    return bounds


def _presence(rows, alternatives):
    witnesses = [r.row_id for r in rows if r.activity in alternatives]
    return (True if witnesses else None if any(r.activity is None for r in rows) else False), witnesses


def _completion(rows, flow, category_state, definition):
    if flow is None:
        return "unknown", ["category_" + category_state], [], []
    receipt = [GR, SES] if definition["receipt"] == "goods_or_service" else [GR]
    recipe = definition["recipe"]
    if recipe == "kpmg_last_ending":
        if any(r.timestamp_status != "usable" for r in rows):
            return "unknown", ["ending_order_unavailable"], [r.row_id for r in rows if r.timestamp_status != "usable"], [[CLEAR, DELETE]]
        last = max(r.time_value for r in rows)
        tied = [r for r in rows if r.time_value == last]
        if len(tied) > 1 and definition["tie_policy"] == "unknown":
            return "unknown", ["equal_time_ending_unordered"], [r.row_id for r in tied], [[CLEAR, DELETE]]
        chosen = max(tied, key=lambda r: r.source_position)
        if chosen.activity is None:
            return "unknown", ["ending_activity_missing"], [chosen.row_id], [[CLEAR, DELETE]]
        return ("observed_closed" if chosen.activity in {CLEAR, DELETE} else "open_recorded"), ["last_recorded_activity"], [chosen.row_id], [[CLEAR, DELETE]]
    required = [receipt] if flow == "consignment" else [[CLEAR]]
    if recipe == "botti_mandatory_presence":
        required = [[PO], receipt] if flow == "consignment" else [[PO], [VENDOR], [IR], [CLEAR]]
        if flow in {"after_gr", "before_gr"}: required.insert(1, receipt)
    measures = [_presence(rows, labels) for labels in required]
    state = "open_recorded" if any(value is False for value, _ in measures) else "unknown" if any(value is None for value, _ in measures) else "observed_closed"
    reasons = ["missing_recorded_milestone:" + "|".join(labels) for labels, (value, _) in zip(required, measures) if value is False]
    if any(value is None for value, _ in measures): reasons.append("missing_activity_label")
    return state, reasons or ["required_recorded_milestones_present"], sorted({rid for _, ids in measures for rid in ids}), required


def cohort_bpic19(prepared: PreparedData, query: dict, population_case_ids=None) -> dict | ImportRefusal:
    """Return exact partitions and a bounded evidence page; every selection keeps whole items."""
    bounds = _validate(prepared, query)
    if isinstance(bounds, ImportRefusal): return bounds
    try: parent = case_ids(prepared, population_case_ids)
    except SelectionError as error: return ImportRefusal(error.code, str(error), error.field)
    documents = {}; categories = {}; doc_items = defaultdict(list)
    for cid in parent:
        rows = prepared.histories[cid]
        state, value = invariant_value(rows, query["roles"]["purchasing_document"])
        documents[cid] = value if state == "invariant" else None
        if documents[cid] is not None: doc_items[documents[cid]].append(cid)
        state, value = invariant_value(rows, query["roles"]["item_category"])
        flow = FLOW_BY_CATEGORY.get(value) if state == "invariant" else None
        categories[cid] = (flow, "classified" if flow else state if state != "invariant" else "unrecognized")
    def support(ids, membership=True):
        ordered = sorted(ids)
        result = {"case_count": len(ordered), "record_count": sum(len(prepared.histories[c]) for c in ordered),
                  "document_count": len({documents[c] for c in ordered if documents[c] is not None}),
                  "document_unknown_case_count": sum(documents[c] is None for c in ordered)}
        if membership: result["case_ids"] = ordered
        return result
    inc = query["inclusion"]; outcomes = {}
    def references(rows):
        grouped = defaultdict(list)
        for row in sorted(rows, key=lambda r: r.source_position): grouped[row.case_id].append(row.row_id)
        return [{"case_id": cid, "row_ids": ids} for cid, ids in sorted(grouped.items())]
    def window(rows):
        times = [r.time_value for r in rows if r.timestamp_status == "usable" and r.timestamp_kind == inc["timestamp_kind"]]
        if inc["kind"] == "item_any_event_window":
            matching = [r for r in rows if r.timestamp_status == "usable" and r.timestamp_kind == inc["timestamp_kind"] and (bounds[0] is None or r.time_value >= bounds[0]) and (bounds[1] is None or r.time_value < bounds[1])]
            if matching: return "retained", "event_in_window", references(matching)
        invalid = [r for r in rows if r.timestamp_status != "usable" or r.timestamp_kind != inc["timestamp_kind"]]
        if len(times) != len(rows): return "unknown", "inclusion_clock_unavailable", references(invalid)
        if not times: return "unknown", "inclusion_clock_unavailable", []
        if inc["kind"] == "item_any_event_window": return "excluded", "no_recorded_event_in_window", references(rows)
        test = min(times)
        yes = (bounds[0] is None or test >= bounds[0]) and (bounds[1] is None or test < bounds[1])
        return ("retained" if yes else "excluded", "start_in_window" if yes else "start_outside_window", references([r for r in rows if r.time_value == test]))
    doc_outcomes = {}
    if inc["kind"] == "document_start_window":
        # Unknown sibling relations cannot be guessed. The grouping is within the frozen parent.
        for doc, ids in doc_items.items(): doc_outcomes[doc] = window([r for cid in ids for r in prepared.histories[cid]])
    for cid in parent:
        if inc["kind"] == "all_items": outcomes[cid] = ("retained", "all_original_items", [])
        elif inc["kind"] == "document_start_window": outcomes[cid] = doc_outcomes[documents[cid]] if documents[cid] is not None else ("unknown", "document_relation_unavailable", references(prepared.histories[cid]))
        else: outcomes[cid] = window(prepared.histories[cid])
    included = [c for c in parent if outcomes[c][0] == "retained"]
    excluded = [c for c in parent if outcomes[c][0] == "excluded"]
    inclusion_unknown = [c for c in parent if outcomes[c][0] == "unknown"]
    groups = {s: [] for s in STATES}; selected = []; page_rows = []
    page = query["page"]; page_ids = set(parent[page["offset"]:page["offset"] + page["limit"]])
    for cid in parent:
        state, reasons, witnesses, required = _completion(prepared.histories[cid], *categories[cid], query["completion"])
        if cid in page_ids:
            page_rows.append({"case_id": cid, "flow_id": categories[cid][0], "category_state": categories[cid][1],
                "inclusion_state": outcomes[cid][0], "inclusion_reason": outcomes[cid][1], "completion_state": state,
                "inclusion_witnesses": outcomes[cid][2],
                "reasons": reasons, "witness_row_ids": witnesses, "required_activity_sets": required,
                "record_count": len(prepared.histories[cid]), "document": documents[cid], "due_state": "unavailable"})
        if outcomes[cid][0] == "retained":
            groups[state].append(cid)
            if query["retain"] == "all_included" or query["retain"] == state: selected.append(cid)
    definition = {k: plain_json(v) for k, v in query.items() if k != "page"}
    did = content_identity("bpic19-cohorts", {"preparation_id": prepared.preparation_id, "parent_case_ids": list(parent), "definition": definition})
    removed = sorted(set(included) - set(selected))
    return {"definition_id": did, "definition": definition,
            "original": support(parent, False),
            "inclusion": {"before": support(parent, False), "retained": support(included), "excluded": support(excluded), "unknown": support(inclusion_unknown)},
            "completion_groups": [{"state": s, **support(groups[s])} for s in STATES],
            "retention": {"before": support(included, False), "retained": support(selected), "excluded": support(removed),
                          "unknown": support(groups["unknown"])},
            "selection": {"kind": "case_id_in", "case_ids": sorted(selected), "negate": False},
            "partition": {"covers_included": sum(map(len, groups.values())) == len(included), "is_disjoint": True},
            "page": {"offset": page["offset"], "limit": page["limit"], "total": len(parent), "items": page_rows},
            "limitations": ["Recorded completion is not compliance, payment receipt or a due-obligation judgement.",
                "The declared horizon is retained as reviewed provenance; no payment terms are supplied, so due assessment is unavailable.",
                "Document supports overlap across item cohorts; document inclusion uses siblings within the frozen parent.",
                "All selected items retain complete original histories; no event projection is applied."]}
