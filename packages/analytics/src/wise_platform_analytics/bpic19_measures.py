"""Versioned descriptive BPIC19 measures over retained original item histories.

This module supplies raw measurements and source witnesses. Method owns scope,
deviations, weights and scores; no normative thresholds are evaluated here.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
from datetime import datetime
import math
import re
from statistics import mean, stdev

from .mapping import ImportRefusal
from .preparation import PreparedData, PreparedRecord, content_identity
from .selection import SelectionError, case_ids as checked_case_ids
from .time_formats import iso_local, iso_utc

MEASURES_POLICY = "bpic19.source_witnessed_measures.v1"
PAPER_TIME_POLICY = "bpic19.paper.independent_parsed_minima.2017_2020.v1"
RESOURCE_POLICY = "bpic19.paper.complete_user_batch_attribution.v1"
HISTORICAL_POLICY = "bpic19.historical.source_compatible_features.v1"
SIGNATURE_POLICY = "bpic19.first_occurrence_signature.v1"
EXACT_POLICY = "bpic19.exact_original_sequence.v1"
ACTIVITY_POLICY = "bpic19.exact_activity_finite_indicators.v1"
VALUE_POLICY = "bpic19.unique_finite_creation_value.v1"
FIRST_CREATION_POLICY = {
    "policy_id": "bpic19.panel_first_creation_source_position.v1",
    "authority": "panel_product_decision",
    "order": "original_source_position_ascending",
    "duplicate_policy": "retain_all_creation_records",
    "selected_value_policy": "first_candidate_only_no_fallback",
    "negative_value_policy": "preserve_sign_in_raw_measure",
}
DEFAULT_SELECTOR = ("Record Invoice Receipt",)
DEFAULT_SOURCE = ("Record Invoice Receipt",)
DEFAULT_TARGET = ("Clear Invoice",)
DEFINITION_DEFAULTS = {
    "activity_selector": list(DEFAULT_SELECTOR), "activity_operator": "count",
    "interval_source": list(DEFAULT_SOURCE), "interval_target": list(DEFAULT_TARGET),
    "interval_policy": "independent_minimum", "value_reducer": "unique_creation_value",
    "representation_policy": "first_occurrence", "value_unit": "source_units", "value_band_edges": [],
}
ROLE_HEADERS = {
    "item_category": "case Item Category", "item_type": "case Item Type",
    "goods_receipt": "case Goods Receipt", "gr_based_iv": "case GR-Based Inv. Verif.",
    "purchasing_document": "case Purchasing Document", "item": "case Item",
    "source_case": "case concept:name", "company": "case Company",
    "spend_area": "case Spend area text", "resource": "event org:resource",
    "net_worth": "event Cumulative net worth (EUR)", "value": "event Cumulative net worth (EUR)",
    "activity": "event concept:name",
}
FLOW_LABELS = {
    "3-way match, invoice after GR": "DF1",
    "3-way match, invoice before GR": "DF2",
    "2-way match": "two_way", "Consignment": "Consignment",
}
_RESOURCE = re.compile(r"(user|batch)_[0-9]+")


def proposed_measure_roles(prepared: PreparedData) -> dict[str, int | None]:
    """Exact header proposals; they never replace a confirmed role dictionary."""
    columns = [name.removeprefix("source__").strip() for name in prepared.columns]
    roles = {role: columns.index(header) if columns.count(header) == 1 else None
             for role, header in ROLE_HEADERS.items()}
    roles["activity"] = prepared.mapping.get("activity_column", roles["activity"])
    return roles


def checked_measure_roles(prepared: PreparedData, roles: Mapping[str, int | None] | None) -> dict[str, int | None]:
    chosen = proposed_measure_roles(prepared) if roles is None else dict(roles)
    if set(chosen) - set(ROLE_HEADERS):
        raise ValueError("The role dictionary contains an unsupported role.")
    for role, index in chosen.items():
        if index is not None and (type(index) is not int or not 0 <= index < len(prepared.columns)):
            raise ValueError(f"The {role} role must name an original column or null.")
    resolved = {role: chosen.get(role) for role in ROLE_HEADERS}
    if "activity" not in chosen:
        resolved["activity"] = prepared.mapping.get("activity_column")
    activity = resolved["activity"]
    if activity is not None and prepared.mapping.get("activity_column", activity) != activity:
        raise ValueError("The activity role must use the confirmed preparation activity column.")
    if resolved["net_worth"] is None:
        resolved["net_worth"] = resolved["value"]
    if resolved["value"] is None:
        resolved["value"] = resolved["net_worth"]
    if resolved["value"] != resolved["net_worth"]:
        raise ValueError("The net_worth and legacy value alias must identify the same field.")
    return resolved


def _measure(value: int | float | None, rows: Iterable[str] = (), reason: str | None = None, **evidence) -> dict:
    if isinstance(value, float) and not math.isfinite(value):
        value, reason = None, "nonfinite_derived_value"
    return {"value": value, "available": reason is None, "reason": reason,
            "row_ids": list(dict.fromkeys(rows)), **evidence}


def _context(records: tuple[PreparedRecord, ...], column: int | None) -> dict:
    if column is None:
        return {"value": None, "available": False, "reason": "role_unmapped", "row_ids": []}
    values = {row.original_cells[column] for row in records}
    if len(values) != 1:
        return {"value": None, "available": False, "reason": "conflicting_case_attribute",
                "row_ids": [row.row_id for row in records]}
    value = next(iter(values))
    return {"value": value or None, "available": bool(value), "reason": None if value else "missing_case_attribute",
            "row_ids": [records[0].row_id] if records else []}


def checked_measure_definition(given: Mapping[str, object] | None = None) -> dict:
    """Canonical finite recipes; display order and duplicate labels have no meaning."""
    given = {} if given is None else given
    resolved = {name: given.get(name, default) for name, default in DEFINITION_DEFAULTS.items()}
    admitted = {"activity_operator": {"count", "presence", "repeat_quantity", "repeated_presence"},
                "interval_policy": {"independent_minimum"},
                "value_reducer": {"unique_creation_value", "unique_creation_event", "maximum_absolute_event_value", "first_creation_source_position"},
                "representation_policy": {"exact", "first_occurrence"}}
    for name, choices in admitted.items():
        if resolved[name] not in choices:
            raise ValueError(f"Unsupported {name}: {resolved[name]}.")
    if not isinstance(resolved["value_unit"], str) or not resolved["value_unit"].strip():
        raise ValueError("The value_unit must name a reviewed source unit.")
    edges = resolved["value_band_edges"]
    if not isinstance(edges, (list, tuple)) or any(type(edge) not in {int, float} or not math.isfinite(edge) for edge in edges) or any(a >= b for a, b in zip(edges, edges[1:])):
        raise ValueError("Value band boundaries must be finite and strictly increasing.")
    resolved["value_band_edges"] = list(edges)
    for name in ("activity_selector", "interval_source", "interval_target"):
        values = resolved[name]
        if not isinstance(values, (list, tuple)) or not values or any(not isinstance(value, str) or not value for value in values):
            raise ValueError(f"The {name} must contain exact nonempty activity labels.")
        resolved[name] = sorted(set(values))
    return resolved


def activity_measure(records: tuple[PreparedRecord, ...], selector: Iterable[str]) -> dict:
    selected = frozenset(selector)
    matching = [row.row_id for row in records if row.activity in selected]
    unknown = [row.row_id for row in records if row.activity is None]
    absence = [row.row_id for row in records] if not matching and not unknown else []
    quantity_reason = "missing_activity_label" if unknown else None
    support = {"lower_bound": len(matching), "unknown_label_count": len(unknown),
               "unknown_row_ids": unknown, "absence_row_ids": absence, "policy_id": ACTIVITY_POLICY}
    def finite(value, reason, unit):
        return _measure(value, matching, reason, unit=unit, **support)
    presence = 1 if matching else None if unknown else 0
    repeated = 1 if len(matching) >= 2 else None if unknown else 0
    return {"matching_row_ids": matching, **support,
            "count": finite(None if unknown else len(matching), quantity_reason, "event_occurrences"),
            "presence": finite(presence, "missing_activity_label" if presence is None else None, "case_presence_boolean"),
            "repeat_quantity": finite(None if unknown else max(len(matching) - 1, 0), quantity_reason, "repeated_event_occurrences"),
            "repeated_presence": finite(repeated, "missing_activity_label" if repeated is None else None, "case_repeated_presence_boolean")}


def _minimum(records: tuple[PreparedRecord, ...], activities: frozenset[str], admissibility: bool = True) -> tuple[dict, datetime | None]:
    unknown_labels = [row.row_id for row in records if row.activity is None]
    activity_rows = [row for row in records if row.activity in activities]
    candidates = [row for row in activity_rows if row.time_value is not None]
    support = {"candidate_row_ids": [row.row_id for row in activity_rows],
               "unparseable_row_ids": [row.row_id for row in activity_rows if row.time_value is None],
               "unknown_activity_row_ids": unknown_labels}
    if not candidates:
        return {"available": False, "reason": "missing_activity_label" if unknown_labels else "no_parsed_endpoint",
                "endpoint_state": "missing", "timestamp": None, "selected_row_id": None, "row_ids": [],
                "later_row_ids": [], **support}, None
    earliest = min(row.time_value for row in candidates)
    ties = sorted((row for row in candidates if row.time_value == earliest), key=lambda row: row.source_position)
    within_range = not admissibility or datetime(2017, 1, 1, tzinfo=earliest.tzinfo) <= earliest < datetime(2020, 1, 1, tzinfo=earliest.tzinfo)
    usable = not unknown_labels and within_range
    reason = "missing_activity_label" if unknown_labels else "minimum_outside_admissible_range" if not within_range else None
    format_time = iso_local if earliest.tzinfo is None else iso_utc
    return {"available": usable, "reason": reason,
            "endpoint_state": "unknown_activity" if unknown_labels else "out_of_range" if not within_range else "available",
            "timestamp": format_time(earliest), "selected_row_id": ties[0].row_id,
            "row_ids": [row.row_id for row in ties],
            "later_row_ids": [row.row_id for row in candidates if row.time_value > earliest], **support}, earliest


def _interval(activation: dict, response: dict, first: datetime | None, last: datetime | None) -> dict:
    evidence = {"activation_row_ids": activation["row_ids"], "response_row_ids": response["row_ids"],
                "activation_timestamp": activation["timestamp"], "response_timestamp": response["timestamp"],
                "policy_id": PAPER_TIME_POLICY, "unit": "days"}
    ids = activation["row_ids"] + response["row_ids"]
    difference = (last - first).total_seconds() / 86400 if first is not None and last is not None else None
    if difference is not None:
        evidence["recorded_difference_days"] = difference
    if not activation["available"] or not response["available"]:
        return _measure(None, ids, activation["reason"] or response["reason"], interval_state="endpoint_unavailable", **evidence)
    assert difference is not None
    if difference < 0:
        return _measure(None, ids, "reversed_interval", interval_state="reversed", **evidence)
    return _measure(difference, ids, interval_state="available", **evidence)


def derive_interval_evidence(prepared: PreparedData, case_id: str,
                             source: Iterable[str], target: Iterable[str]) -> dict:
    """The admitted independent-minimum interval without actor/value prerequisites.

    Every endpoint and witness comes from the complete retained item history.
    The independent minima are selected before the paper's range/direction gate;
    later usable candidates never replace an out-of-range minimum.
    """
    recipe = checked_measure_definition({"interval_source": list(source), "interval_target": list(target)})
    records = prepared.histories[case_id]
    activation, first = _minimum(records, frozenset(recipe["interval_source"]))
    response, last = _minimum(records, frozenset(recipe["interval_target"]))
    return {"case_id": case_id, "record_count": len(records),
            "record_row_ids": [row.row_id for row in records],
            "source": activation, "target": response,
            "interval": _interval(activation, response, first, last)}


def _actor_evidence(records: tuple[PreparedRecord, ...], column: int | None) -> tuple[list[dict], dict, dict, dict]:
    actors = []
    for row in records:
        raw = row.original_cells[column] if column is not None else None
        normalized = raw.strip().casefold() if raw is not None else None
        match = _RESOURCE.fullmatch(normalized) if normalized is not None else None
        actors.append({"row_id": row.row_id, "raw": raw, "normalized": normalized,
                       "classification": match[1] if match else "unknown"})
    users = [actor for actor in actors if actor["classification"] == "user"]
    batch = [actor for actor in actors if actor["classification"] == "batch"]
    unknown = [actor for actor in actors if actor["classification"] == "unknown"]
    breadth = len({actor["normalized"] for actor in users})
    reason = "role_unmapped" if column is None else "incomplete_resource_attribution" if unknown else None
    support = {"invalid_row_ids": [actor["row_id"] for actor in unknown], "policy_id": RESOURCE_POLICY,
               "unknown_label_count": len(unknown)}
    user_count = _measure(len(users) if reason is None else None, (actor["row_id"] for actor in users), reason,
                          lower_bound=len(users), unit="user_attributed_events", **support)
    distinct_count = _measure(breadth if reason is None else None, (actor["row_id"] for actor in users), reason,
                              lower_bound=breadth, unit="distinct_user_identities", **support)
    summary = {"known_user_event_count": len(users), "distinct_normalized_user_count": breadth,
               "batch_event_count": len(batch), "unknown_event_count": len(unknown), "event_count": len(records),
               "available": reason is None, "reason": reason,
               "batch_all_share": len(batch) / len(records) if column is not None and records else None,
               "batch_human_ratio": len(batch) / len(users) if column is not None and users else None,
               "batch_all_denominator": len(records), "batch_human_denominator": len(users)}
    return actors, summary, user_count, distinct_count


def _amount_evidence(records: tuple[PreparedRecord, ...], column: int | None) -> list[dict]:
    amounts = []
    for row in records:
        raw = row.original_cells[column] if column is not None else None
        value = None
        if raw is None:
            state = "role_unmapped"
        elif not raw.strip():
            state = "missing"
        else:
            try:
                value = float(raw)
                state = "finite" if math.isfinite(value) else "invalid_nonfinite"
                if state != "finite": value = None
            except (ValueError, OverflowError):
                state = "invalid_numeric"
        amounts.append({"row_id": row.row_id, "raw": raw, "value": value, "state": state})
    return amounts


def _value_measure(amounts: list[dict], reducer: str, candidate_ids: list[str], unknown_activity: bool = False) -> dict:
    candidate_set = set(candidate_ids)
    candidates = [amount for amount in amounts if amount["row_id"] in candidate_set]
    states = {amount["state"] for amount in candidates}
    reason = "role_unmapped" if any(amount["state"] == "role_unmapped" for amount in amounts) else "invalid_nonfinite" if "invalid_nonfinite" in states else "invalid_numeric" if "invalid_numeric" in states else "missing_value" if "missing" in states or not candidates else None
    value = None
    if unknown_activity:
        reason = "missing_activity_label"
    if reducer == "unique_creation_event" and len(candidates) != 1:
        reason = "creation_event_not_unique"
    if reason is None:
        finite = {amount["value"] for amount in candidates}
        if reducer == "maximum_absolute_event_value":
            value = max(abs(amount) for amount in finite)
        elif len(finite) != 1:
            reason = "conflicting_creation_values"
        else:
            value = next(iter(finite))
    winners = [amount["row_id"] for amount in candidates if reason is None and
               (abs(amount["value"]) == value if reducer == "maximum_absolute_event_value" else amount["value"] == value)]
    return _measure(value, candidate_ids, reason, candidate_count=len(candidates), winner_row_ids=winners,
                    invalid_row_ids=[amount["row_id"] for amount in candidates if amount["state"].startswith("invalid")],
                    state="available" if reason is None else "conflicting" if reason == "conflicting_creation_values" else reason,
                    unit="EUR", reducer=reducer)


def _first_source_creation_value(amounts: list[dict], records: tuple[PreparedRecord, ...]) -> dict:
    """An explicit panel occurrence choice, independent of clock/display order.

    Later candidates remain evidence; none can replace a missing/invalid first
    amount. Original source ordinals are unique and no records are deduplicated.
    """
    candidates = sorted((row for row in records if row.activity == "Create Purchase Order Item"),
                        key=lambda row: row.source_position)
    by_id = {amount["row_id"]: amount for amount in amounts}
    first = candidates[0] if candidates else None
    amount = None if first is None else by_id[first.row_id]
    state = "missing" if amount is None else amount["state"]
    reason = {"finite": None, "missing": "missing_value", "role_unmapped": "role_unmapped",
              "invalid_nonfinite": "invalid_nonfinite", "invalid_numeric": "invalid_numeric"}[state]
    if any(row.activity is None for row in records):
        reason = "missing_activity_label"
    return _measure(amount["value"] if reason is None else None,
                    [row.row_id for row in candidates], reason,
                    candidate_count=len(candidates),
                    first_candidate_row_id=None if first is None else first.row_id,
                    first_candidate_source_position=None if first is None else first.source_position,
                    winner_row_ids=[first.row_id] if first is not None and reason is None else [],
                    invalid_row_ids=[row.row_id for row in candidates if by_id[row.row_id]["state"].startswith("invalid")],
                    state="available" if reason is None else reason, unit="EUR",
                    reducer="first_creation_source_position", policy_id=FIRST_CREATION_POLICY["policy_id"])


def derive_case_measures(prepared: PreparedData, case_id: str, roles: Mapping[str, int | None] | None = None,
                         definition: Mapping[str, object] | None = None) -> dict:
    """Independent evidence over complete original item histories."""
    roles = checked_measure_roles(prepared, roles)
    recipe = checked_measure_definition(definition)
    records = prepared.histories[case_id]
    counts = Counter(row.activity for row in records if row.activity is not None)
    missing_labels = [row.row_id for row in records if row.activity is None]
    by_activity: dict[str, list[str]] = {}
    for row in records:
        if row.activity is not None: by_activity.setdefault(row.activity, []).append(row.row_id)
    def count(*labels):
        return activity_measure(records, labels)["count"]
    context = {role: _context(records, roles[role]) for role in ("item_category", "item_type", "goods_receipt", "gr_based_iv", "purchasing_document", "item", "source_case", "company", "spend_area")}
    flow = FLOW_LABELS.get(context["item_category"]["value"]) if context["item_category"]["available"] else None
    invoice, invoice_time = _minimum(records, frozenset({"Record Invoice Receipt"}))
    clearing, clearing_time = _minimum(records, frozenset({"Clear Invoice"}))
    receipt, receipt_time = _minimum(records, frozenset({"Record Goods Receipt", "Record Service Entry Sheet"}))
    interval = _interval(invoice, clearing, invoice_time, clearing_time)
    source, source_time = _minimum(records, frozenset(recipe["interval_source"]))
    target, target_time = _minimum(records, frozenset(recipe["interval_target"]))
    order_ids = invoice["row_ids"] + receipt["row_ids"]
    if not invoice["available"] or not receipt["available"]:
        precedes = _measure(None, order_ids, invoice["reason"] or receipt["reason"], unit="boolean_observation")
    else:
        precedes = _measure(int(invoice_time < receipt_time), order_ids, unit="boolean_observation")
    actors, actor_summary, user_count, distinct_count = _actor_evidence(records, roles["resource"])
    amounts = _amount_evidence(records, roles["value"])
    creation_ids = [row.row_id for row in records if row.activity == "Create Purchase Order Item"]
    all_ids = [row.row_id for row in records]
    creation = _value_measure(amounts, "unique_creation_value", creation_ids, bool(missing_labels))
    max_abs = _value_measure(amounts, "maximum_absolute_event_value", all_ids)
    creation["unit"] = max_abs["unit"] = recipe["value_unit"]
    chosen_value = (_first_source_creation_value(amounts, records) if recipe["value_reducer"] == "first_creation_source_position" else
                    _value_measure(amounts, recipe["value_reducer"], all_ids if recipe["value_reducer"] == "maximum_absolute_event_value" else creation_ids,
                                   bool(missing_labels) and recipe["value_reducer"] != "maximum_absolute_event_value"))
    chosen_value["unit"] = recipe["value_unit"]
    value_band = sum(chosen_value["value"] >= edge for edge in recipe["value_band_edges"]) if chosen_value["available"] and recipe["value_band_edges"] else None
    sequence_known = prepared.sequence_evaluable(case_id) and not missing_labels
    sequence = [row.activity for row in records if row.activity is not None]
    retained, suppressed, seen = [], [], set()
    if sequence_known:
        for row in records:
            (suppressed if row.activity in seen else retained).append(row.row_id)
            seen.add(row.activity)
    signature = list(dict.fromkeys(sequence)) if sequence_known else None
    selected_activity = activity_measure(records, recipe["activity_selector"])
    representations = {"exact_sequence": sequence if sequence_known else None,
                       "first_occurrence_signature": signature, "signature_policy_id": SIGNATURE_POLICY,
                       "available": sequence_known, "reason": None if sequence_known else "missing_activity_label" if missing_labels else "order_unknown",
                       "omitted_activity_row_ids": missing_labels, "signature_suppressed_row_ids": suppressed,
                       "signature_retained_row_ids": retained,
                       "exact_representation_id": content_identity("bpic19-exact", {"preparation_id": prepared.preparation_id, "case_id": case_id, "policy_id": EXACT_POLICY}),
                       "signature_representation_id": content_identity("bpic19-signature", {"preparation_id": prepared.preparation_id, "case_id": case_id, "policy_id": SIGNATURE_POLICY})}
    return {"case_id": case_id, "flow": flow, "flow_available": flow is not None,
            "document": context["purchasing_document"]["value"], "company": context["company"]["value"],
            "spend_area": context["spend_area"]["value"], "context": context,
            "record_count": len(records), "record_row_ids": all_ids,
            "activity_counts": dict(sorted(counts.items())), "activity_row_ids": by_activity,
            "activity_counts_available": not missing_labels, "missing_activity_row_ids": missing_labels,
            "activity_measure": selected_activity, "selected_value_band": value_band, "actor_records": actors, "actor_summary": actor_summary, "amount_records": amounts,
            "milestones": {"invoice": invoice, "clearing": clearing, "receipt": receipt, "source": source, "target": target},
            "measures": {"invoice_count": count("Record Invoice Receipt"), "clearing_count": count("Clear Invoice"),
                         "receipt_count": count("Record Goods Receipt", "Record Service Entry Sheet"),
                         "cancellation_count": count("Cancel Invoice Receipt"), "edit_count": count("Change Price", "Change Quantity"),
                         "invoice_to_clearing_days": interval, "invoice_precedes_receipt": precedes,
                         "user_event_count": user_count, "distinct_user_count": distinct_count,
                         "creation_value": creation, "exposure": max_abs, "selected_value": chosen_value,
                         "selected_activity": selected_activity[recipe["activity_operator"]],
                         "selected_interval": _interval(source, target, source_time, target_time)},
            "representations": representations}


def build_paper_features(prepared: PreparedData, case_ids: Iterable[str], roles: Mapping[str, int | None] | None = None) -> list[dict]:
    """Method-facing raw inputs; each measure's availability stays independent."""
    chosen = checked_measure_roles(prepared, roles)
    return [derive_case_measures(prepared, case_id, chosen) for case_id in checked_case_ids(prepared, case_ids)]


def _historical_amounts(records: tuple[PreparedRecord, ...], column: int | None) -> tuple[list[tuple[PreparedRecord, float]], list[str], list[str]]:
    values, missing, invalid = [], [], []
    for row in records:
        if column is None:
            missing.append(row.row_id)
            continue
        text = row.original_cells[column].strip()
        if not text or text.casefold() == "nan":
            missing.append(row.row_id)
            continue
        try:
            value = float(text)
            if not math.isfinite(value):
                raise ValueError
            values.append((row, value))
        except (ValueError, OverflowError):
            invalid.append(row.row_id)
    return values, missing, invalid


def historical_exposure_calibration(prepared: PreparedData, case_ids: Iterable[str], roles: Mapping[str, int | None] | None = None, unit: str = "source_units") -> dict:
    """Pandas/NumPy linear95th percentile over original items, including missing→0."""
    members = checked_case_ids(prepared, case_ids)
    chosen = checked_measure_roles(prepared, roles)
    values = []
    invalid_cases = []
    missing_cases = []
    for case_id in members:
        amounts, missing, invalid = _historical_amounts(prepared.histories[case_id], chosen["net_worth"])
        values.append(max((abs(value) for _, value in amounts), default=0.0))
        if not amounts:
            missing_cases.append(case_id)
        if invalid:
            invalid_cases.append(case_id)
    if not members:
        raise ValueError("The frozen calibration population is empty.")
    ordered = sorted(values)
    if ordered:
        position = (len(ordered) - 1) * .95
        lower = math.floor(position)
        q95 = ordered[lower] + (ordered[min(lower + 1, len(ordered) - 1)] - ordered[lower]) * (position - lower)
    else:
        q95 = 0.0
    receipt = {"policy_id": "bpic19.historical.max_abs_linear_p95.v1", "case_count": len(members),
               "population_case_ids_hash": content_identity("calibration-population", {"case_ids": list(members)}),
               "preparation_id": prepared.preparation_id, "population_case_ids": list(members),
               "net_worth_column": chosen["net_worth"], "percentile": .95, "quantile": q95, "interpolation": "linear", "position": (len(ordered) - 1) * .95,
               "denominator": q95 or 1.0, "unit": unit, "missing_case_count": len(missing_cases),
               "invalid_case_count": len(invalid_cases), "missing_policy": "source_compatible_fill_zero",
               "available": chosen["net_worth"] is not None and not invalid_cases,
               "finite_guard": "panel_guard_not_present_in_original_historical_helper"}
    receipt["calibration_id"] = content_identity("bpic19-calibration", {"preparation_id": prepared.preparation_id, **receipt})
    return receipt


def add_historical_measures(prepared: PreparedData, feature: dict, roles: Mapping[str, int | None], calibration: Mapping[str, object]) -> dict:
    """Historical raw inputs with explicit legacy missing/resource compatibility."""
    records = prepared.histories[feature["case_id"]]
    invoice, ti = _minimum(records, frozenset({"Record Invoice Receipt", "Vendor creates invoice"}), False)
    receipt, tg = _minimum(records, frozenset({"Record Goods Receipt", "Record Service Entry Sheet"}), False)
    clearing, tc = _minimum(records, frozenset({"Clear Invoice"}), False)
    release, tr = _minimum(records, frozenset({"Remove Payment Block"}), False)
    def historical_interval(a, b, first, last):
        value = _interval(a, b, first, last)
        value["policy_id"] = "bpic19.historical.independent_parsed_minima.v1"
        return value
    def ordering(a, b, first, last):
        if not a["available"] or not b["available"]:
            return _measure(None, a["row_ids"] + b["row_ids"], a["reason"] or b["reason"], unit="boolean_observation")
        return _measure(int(last < first), a["row_ids"] + b["row_ids"], unit="boolean_observation")
    resource = roles["resource"]
    human_rows = []
    raw_users = set()
    if resource is not None:
        for row in records:
            raw = row.original_cells[resource]
            normalized = raw.strip().lower()
            human = normalized not in {"", "nan", "none", "null"} and not normalized.startswith("batch")
            if human:
                human_rows.append(row.row_id)
                raw_users.add(raw)
    resource_reason = "role_unmapped" if resource is None else None
    amounts, missing_amounts, invalid_amounts = _historical_amounts(records, roles["net_worth"])
    numeric = [value for _, value in amounts]
    numeric_reason = "role_unmapped" if roles["net_worth"] is None else "invalid_event_value" if invalid_amounts else None
    average = mean(numeric) if numeric else 0.0
    standard_deviation = stdev(numeric) if len(numeric) > 1 else 0.0
    cv = standard_deviation / max(average, 1e-6) if numeric else 0.0
    maximum = max((abs(value) for value in numeric), default=0.0)
    normalized_exposure = min(1.0, max(0.0, maximum / float(calibration["denominator"])))
    exposure_reason = numeric_reason or (None if calibration["available"] else "calibration_unavailable")
    count_reason = None if feature["activity_counts_available"] else "missing_activity_label"
    proxy_reason = exposure_reason or count_reason
    counts = feature["activity_counts"]
    invoice_rows = [row.row_id for row in records if row.activity in {"Record Invoice Receipt", "Vendor creates invoice"}]
    times = {row.time_value for row in records if row.time_value is not None}
    measures = {
        "historical_invoice_count": _measure(None if count_reason else counts.get("Record Invoice Receipt", 0) + counts.get("Vendor creates invoice", 0), invoice_rows, count_reason, unit="event_occurrences"),
        "invoice_plus_subsequent_count": _measure(None if count_reason else counts.get("Record Invoice Receipt", 0) + counts.get("Record Subsequent Invoice", 0),
            (row.row_id for row in records if row.activity in {"Record Invoice Receipt", "Record Subsequent Invoice"}), count_reason, unit="event_occurrences"),
        "historical_invoice_precedes_receipt": ordering(receipt, invoice, tg, ti),
        "historical_release_precedes_receipt": ordering(receipt, release, tg, tr),
        "historical_goods_to_invoice_days": historical_interval(receipt, invoice, tg, ti),
        "historical_invoice_to_clear_days": historical_interval(invoice, clearing, ti, tc),
        "historical_goods_to_release_days": historical_interval(receipt, release, tg, tr),
        "historical_release_to_clear_days": historical_interval(release, clearing, tr, tc),
        "historical_manual_touch_count": _measure(len(human_rows) if resource_reason is None else None, human_rows, resource_reason, unit="resource_proxy_events"),
        "historical_distinct_human_resources": _measure(len(raw_users) if resource_reason is None else None, human_rows, resource_reason, unit="resource_proxy_identities"),
        "historical_manual_share": _measure(len(human_rows) / len(records) if resource_reason is None else None, human_rows, resource_reason, unit="share_of_original_events"),
        "historical_networth_cv": _measure(cv if numeric_reason is None else None, (row.row_id for row, _ in amounts), numeric_reason, unit="coefficient_of_variation", ddof=1,
            missing_fill_row_ids=missing_amounts, invalid_row_ids=invalid_amounts),
        "exposure_abs_max": _measure(maximum if numeric_reason is None else None, (row.row_id for row, _ in amounts), numeric_reason, unit=calibration["unit"], missing_fill_row_ids=missing_amounts),
        "exposure_norm": _measure(normalized_exposure if exposure_reason is None else None, (row.row_id for row, _ in amounts), exposure_reason, unit="normalized_proxy", calibration_id=calibration["calibration_id"]),
        "historical_memo_exposure": _measure(normalized_exposure * int(counts.get("Vendor creates debit memo", 0) + counts.get("Vendor creates credit memo", 0) > 0) if proxy_reason is None else None,
            (row.row_id for row in records if row.activity in {"Vendor creates debit memo", "Vendor creates credit memo"}), proxy_reason, unit="normalized_proxy", calibration_id=calibration["calibration_id"]),
        "historical_price_exposure": _measure(normalized_exposure * int(counts.get("Change Price", 0) > 0) if proxy_reason is None else None,
            (row.row_id for row in records if row.activity == "Change Price"), proxy_reason, unit="normalized_proxy", calibration_id=calibration["calibration_id"]),
        "event_replication_ratio": _measure(len(records) / max(1, len(times)), (), unit="events_per_distinct_parsed_time"),
    }
    feature["historical_measures"] = measures
    feature["historical_policy"] = {"policy_id": HISTORICAL_POLICY, "resource_rule": "exclude_empty_nan_none_null_and_batch_prefix; raw_identity_distinct",
        "timestamp_rule": "parsed_minimum_without_range_filter; reversed_lag_unavailable", "value_rule": "sample_SD_over_mean_clipped_at_1e-6; missing_result_fill_zero",
        "calibration": calibration}
    return feature


def build_historical_features(prepared: PreparedData, case_ids: Iterable[str], roles: Mapping[str, int | None] | None = None,
                              calibration_case_ids: Iterable[str] | None = None) -> list[dict]:
    chosen = checked_measure_roles(prepared, roles)
    members = checked_case_ids(prepared, case_ids)
    calibration = historical_exposure_calibration(prepared, members if calibration_case_ids is None else calibration_case_ids, chosen)
    return [add_historical_measures(prepared, derive_case_measures(prepared, case_id, chosen), chosen, calibration) for case_id in members]


def _distribution(values: list[float]) -> dict:
    if not values:
        return {"available_case_count": 0, "zero_case_count": 0, "reason": "empty_support", "minimum": None, "maximum": None, "mean": None, "median": None}
    ordered = sorted(values)
    center = len(values) // 2
    midpoint = ordered[center] if len(values) % 2 else ordered[center - 1] / 2 + ordered[center] / 2
    return {"available_case_count": len(values), "zero_case_count": values.count(0), "reason": None, "minimum": ordered[0], "maximum": ordered[-1],
            "mean": math.fsum(value / len(values) for value in values), "median": midpoint}


def measure_population(prepared: PreparedData, case_ids: Iterable[str], roles: Mapping[str, int | None] | None = None,
                       offset: int = 0, limit: int = 100, measure_profile: str = "paper_v1",
                       calibration_case_ids: Iterable[str] | None = None,
                       definition: Mapping[str, object] | None = None) -> dict | ImportRefusal:
    """Summaries and exact support over a frozen parent; bounded evidence pages."""
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
        return ImportRefusal("invalid_parameter", "Page offset must be nonnegative and limit must be 1–200.", "query")
    if measure_profile not in {"paper_v1", "historical_v1"}:
        return ImportRefusal("unsupported_policy", "Choose paper_v1 or historical_v1 measurements.", "query.measure_profile")
    try:
        members = checked_case_ids(prepared, case_ids)
    except SelectionError as error:
        return ImportRefusal("invalid_parameter", str(error), "identity.population_id")
    try:
        chosen = checked_measure_roles(prepared, roles)
    except ValueError as error:
        return ImportRefusal("invalid_parameter", str(error), "query.roles")
    if roles is not None and "activity" in roles and roles["activity"] is None:
        return ImportRefusal("role_unavailable", "The activity measure needs the confirmed activity binding.", "query.roles.activity")
    try:
        recipe = checked_measure_definition(definition)
    except (ValueError, TypeError) as error:
        return ImportRefusal("unsupported_definition", str(error), "query")
    calibration = None
    if measure_profile == "historical_v1":
        try:
            calibration = historical_exposure_calibration(prepared, members if calibration_case_ids is None else calibration_case_ids, chosen, recipe["value_unit"])
        except (SelectionError, ValueError) as error:
            return ImportRefusal("empty_calibration", str(error), "query.calibration_population")
    definition = {"policy_id": MEASURES_POLICY, "measure_profile": measure_profile, "time_policy_id": PAPER_TIME_POLICY,
                  "resource_policy_id": RESOURCE_POLICY, "roles": chosen, **recipe,
                  "clock_kind": next((row.timestamp_kind for row in prepared.records), "unavailable"),
                  "clock_policy_id": prepared.policies.get("time", {}).get("id", "prepared_clock"),
                  "elapsed_unit": "days", "endpoint_admissibility": "select_parsed_minimum_then_2017_inclusive_2020_exclusive",
                  "resource_normalization": "strip_casefold_fullmatch_user_or_batch_numeric_suffix",
                  "resource_unknown_policy": "full_effort_unavailable_keep_classified_lower_bounds",
                  "creation_selector": ["Create Purchase Order Item"], "value_unit": recipe["value_unit"],
                  "numeric_policy": "finite_float_scientific_notation_no_locale_conversion",
                  "value_missing_policy": "unavailable", "creation_conflict_policy": recipe["value_reducer"],
                  "source_representation": "complete_original_item_histories",
                  "activity_labels": {"invoice": "Record Invoice Receipt", "clearing": "Clear Invoice",
                                      "receipt_any": ["Record Goods Receipt", "Record Service Entry Sheet"]}}
    if recipe["value_reducer"] == "first_creation_source_position":
        definition["first_creation_policy"] = dict(FIRST_CREATION_POLICY)
    if calibration is not None:
        definition["historical_policy_id"] = HISTORICAL_POLICY
        definition["calibration"] = calibration
    definition_id = content_identity("bpic19-measure-definition", {"preparation_id": prepared.preparation_id, **definition})
    definition["definition_id"] = definition_id
    result_id = content_identity("bpic19-measures", {"preparation_id": prepared.preparation_id,
                                "case_ids": list(members), "definition_id": definition_id})
    values: dict[str, list[float]] = {}
    unavailable: Counter = Counter()
    page = []
    records = 0
    flow_counts: Counter = Counter()
    cohorts = {name: [] for name in ("positive_case_ids", "zero_case_ids", "unavailable_case_ids", "presence_positive_case_ids", "presence_absent_case_ids", "presence_unknown_case_ids", "repeated_positive_case_ids", "repeated_absent_case_ids", "repeated_unknown_case_ids")}
    groups = {"exact": {}, "first_occurrence": {}}
    representation_unavailable = []
    band_edges = recipe["value_band_edges"]
    value_bands = [{"band_index": index, "lower_inclusive": band_edges[index - 1] if index else None,
                    "upper_exclusive": band_edges[index] if index < len(band_edges) else None, "case_ids": []}
                   for index in range(len(band_edges) + 1)] if band_edges else []
    value_band_unavailable = []
    for index, case_id in enumerate(members):
        feature = derive_case_measures(prepared, case_id, chosen, recipe)
        if calibration is not None:
            add_historical_measures(prepared, feature, chosen, calibration)
        records += feature["record_count"]
        flow_counts[feature["flow"] or "unknown"] += 1
        for name, measure in (feature["measures"] | feature.get("historical_measures", {})).items():
            if measure["available"]:
                values.setdefault(name, []).append(float(measure["value"]))
            else:
                unavailable[name] += 1
        selected = feature["measures"]["selected_activity"]
        cohort = "unavailable_case_ids" if not selected["available"] else "positive_case_ids" if selected["value"] > 0 else "zero_case_ids"
        cohorts[cohort].append(case_id)
        for measure_name, prefix in (("presence", "presence"), ("repeated_presence", "repeated")):
            value = feature["activity_measure"][measure_name]
            suffix = "unknown_case_ids" if not value["available"] else "positive_case_ids" if value["value"] else "absent_case_ids"
            cohorts[prefix + "_" + suffix].append(case_id)
        if value_bands:
            if feature["selected_value_band"] is None:
                value_band_unavailable.append(case_id)
            else:
                value_bands[feature["selected_value_band"]]["case_ids"].append(case_id)
        reps = feature["representations"]
        if not reps["available"]:
            representation_unavailable.append(case_id)
        else:
            for name, field in (("exact", "exact_sequence"), ("first_occurrence", "first_occurrence_signature")):
                sequence = tuple(reps[field])
                group = groups[name].setdefault(sequence, {"group_id": content_identity("bpic19-variant-group", {
                    "preparation_id": prepared.preparation_id, "representation_policy": name, "sequence": list(sequence)}),
                    "sequence": list(sequence), "case_ids": [], "case_count": 0, "record_count": 0})
                group["case_ids"].append(case_id)
                group["case_count"] += 1
                group["record_count"] += feature["record_count"]
        if offset <= index < offset + limit:
            page.append(feature)
    cohorts.update({"population_case_count": len(members),
                    "presence_fraction": len(cohorts["presence_positive_case_ids"]) / len(members) if members else None,
                    "repeated_presence_fraction": len(cohorts["repeated_positive_case_ids"]) / len(members) if members else None,
                    "denominator": len(members), "reason": None if members else "empty_denominator"})
    names = {"invoice_count", "clearing_count", "receipt_count", "cancellation_count", "edit_count",
             "invoice_to_clearing_days", "invoice_precedes_receipt", "user_event_count", "distinct_user_count",
             "creation_value", "exposure", "selected_value", "selected_activity", "selected_interval"}
    names |= set(values) | set(unavailable)
    return {"result_id": result_id, "definition_id": definition_id, "definition": definition,
            "roles_proposed_from_headers": roles is None,
            "population_case_count": len(members), "population_record_count": records, "flow_case_counts": dict(flow_counts),
            "activity_cohorts": cohorts,
            "representation_groups": {name: list(value.values()) for name, value in groups.items()},
            "representation_unavailable_case_ids": representation_unavailable,
            "value_bands": value_bands, "value_band_unavailable_case_ids": value_band_unavailable,
            "summaries": {name: {**_distribution(values.get(name, [])), "unavailable_case_count": unavailable[name]}
                          for name in sorted(names)},
            "offset": offset, "limit": limit, "next_offset": offset + limit if offset + limit < len(members) else None,
            "cases": page}
