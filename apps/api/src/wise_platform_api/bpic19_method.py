"""BPIC19 prepared-measure bindings to the installed Method.

This module translates raw measured attributes and scopes into native schema-3
norms. Method alone evaluates deviations, effective weights, scores and priority.
The assessment rows are transport records, never claimed as source events. Raw
row witnesses remain attached to the measured input. Resolution is unchanged.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from collections.abc import Callable
import hashlib
import json
import math
import re
from pathlib import Path
from functools import cached_property
from typing import Any, Mapping, Sequence

from wise_platform_analytics.bpic19_measures import FIRST_CREATION_POLICY, checked_measure_roles, derive_case_measures
from wise_platform_analytics.preparation import PreparedData
from wise_platform_analytics.selection import case_ids as checked_case_ids

from . import method

PAPER_PROFILE = "bpic19.paper.2026-10-12.v1"
HISTORICAL_PROFILE = "bpic19.notebook.1.0-paper-aligned.partial.v1"
# The upstream catalogue remains the authority for prepared-v1 declarations.
# The distribution copy removes only its unused machine-local source default.
HISTORICAL_UPSTREAM_CATALOGUE_SHA256 = "498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef"
HISTORICAL_PACKAGED_CATALOGUE_SHA256 = "54842010ffe89ea41a0e17ae7617e619a116d6ad7f0cb83bbb07df55faf87ffe"
HISTORICAL_CATALOGUE_ADAPTATION = "bpic19.catalogue.omit_unused_private_default.v1"
PAPER_SOURCE_SHA256 = "abc7d58c3558790395622c5758f55e005ed1816092f5cd47a186744569608408"
LAYERS = ("Completion", "Timing", "Rework", "Effort")
FLOWS = ("DF1", "DF2", "two_way", "Consignment")
INVOICE_FLOWS = FLOWS[:3]
PAPER_CRITERIA = (
    ("C01", "Completion", "invoice_presence", 1, 1, "low", INVOICE_FLOWS, "Invoice recorded"),
    ("C02", "Completion", "clearing_presence", 1, 1, "low", INVOICE_FLOWS, "Invoice cleared"),
    ("C03", "Completion", "receipt_presence", 1, 1, "low", FLOWS[:2], "Goods or service receipt recorded"),
    ("C04", "Timing", "invoice_to_clearing_days", 30, 60, "high", INVOICE_FLOWS, "Invoice to clearing within 30 days"),
    ("C05", "Timing", "invoice_precedes_receipt", 0, 1, "high", ("DF1",), "Receipt before invoice in DF1"),
    ("C06", "Rework", "cancellation_presence", 0, 1, "high", None, "No invoice cancellation"),
    ("C07", "Rework", "edit_count", 0, 3, "high", None, "Price and quantity changes"),
    ("C08", "Rework", "invoice_count", 1, 3, "high", INVOICE_FLOWS, "Repeated invoice receipts"),
    ("C09", "Effort", "user_event_count", 5, 10, "high", None, "User attributed event count"),
    ("C10", "Effort", "distinct_user_count", 2, 5, "high", None, "Distinct user identities"),
)
VIEW_WEIGHTS = {"Balanced": (1, 1, 1, 1), "Completion": (3, 2, 1, 1), "Operations": (1, 1, 2, 3)}
GROUP_KEYS = {"company", "spend_area", "flow", "document", "item_type"}
PRESENCE_SELECTORS = {
    "invoice_presence": ("invoice_count", ["Record Invoice Receipt"]),
    "clearing_presence": ("clearing_count", ["Clear Invoice"]),
    "receipt_presence": ("receipt_count", ["Record Goods Receipt", "Record Service Entry Sheet"]),
    "cancellation_presence": ("cancellation_count", ["Cancel Invoice Receipt"]),
}
CRITERIA_FAMILIES = {
    "completion": {"C01", "C02", "C03"},
    "completion_timing": {"C01", "C02", "C03", "C04", "C05"},
    "completion_rework_effort": {"C01", "C02", "C03", "C06", "C07", "C08", "C09", "C10"},
    "full": {criterion[0] for criterion in PAPER_CRITERIA},
}


class SettingError(ValueError):
    """A run setting the native assessment cannot honour, naming the settings field."""

    def __init__(self, message: str, field: str) -> None:
        super().__init__(message)
        self.field = field


def paper_norm_document(mode: str = "flat", criteria_family: str = "full") -> dict:
    _mode(mode)
    if criteria_family not in CRITERIA_FAMILIES:
        raise ValueError("Choose a supported paper criterion family.")
    selected = [criterion for criterion in PAPER_CRITERIA if criterion[0] in CRITERIA_FAMILIES[criteria_family]]
    return {
        "schema_version": 3,
        "missing_values": "three_valued",
        "name": PAPER_PROFILE if criteria_family == "full" else PAPER_PROFILE + "." + criteria_family,
        "version": "1",
        "scoring_mode": mode,
        "metadata": {
            "source_sha256": PAPER_SOURCE_SHA256,
            "grain": "PO item",
            "time_policy": "independent_parsed_minima_2017_inclusive_2020_exclusive",
            "criteria_family": criteria_family,
            "raw_binding_recipe": {
                "C01": {"activities": ["Record Invoice Receipt"], "operator": "witnessed_binary_presence"},
                "C02": {"activities": ["Clear Invoice"], "operator": "witnessed_binary_presence"},
                "C03": {"activities": ["Record Goods Receipt", "Record Service Entry Sheet"], "operator": "witnessed_binary_presence"},
                "C04": {"activation": ["Record Invoice Receipt"], "response": ["Clear Invoice"], "operator": "independent_parsed_minima_then_range_and_nonnegative", "unit": "elapsed_days"},
                "C05": {"invoice": ["Record Invoice Receipt"], "receipt": ["Record Goods Receipt", "Record Service Entry Sheet"], "operator": "strict_invoice_minimum_precedes_receipt_minimum_tie_zero"},
                "C06": {"activities": ["Cancel Invoice Receipt"], "operator": "witnessed_binary_presence"},
                "C07": {"activities": ["Change Price", "Change Quantity"], "operator": "exact_union_count"},
                "C08": {"activities": ["Record Invoice Receipt"], "operator": "exact_count"},
                "C09": {"operator": "all_event_resource_readiness_then_user_count", "user_pattern": "user_[0-9]+", "batch_pattern": "batch_[0-9]+", "match": "full", "normalization": "outer_trim_casefold"},
                "C10": {"operator": "all_event_resource_readiness_then_distinct_normalized_users", "user_pattern": "user_[0-9]+", "batch_pattern": "batch_[0-9]+", "match": "full", "normalization": "outer_trim_casefold"},
                "presence_edge_policy": "positive witness proves binary presence; no match proves absence only with complete labels; exact multiplicity remains separately unavailable",
            },
        },
        "layers": [{"id": layer} for layer in LAYERS],
        "views": [
            {
                "name": name,
                "constraint_weights": {criterion[0]: weights[LAYERS.index(criterion[1])] for criterion in selected},
            }
            for name, weights in VIEW_WEIGHTS.items()
        ],
        "constraints": [
            {
                "id": key,
                "layer": layer,
                "type": "metric",
                "description": label,
                "params": {"attribute": measure, "threshold": target, "width": width, "direction": direction},
                "applicability": {} if flows is None else {"flow": list(flows)},
            }
            for key, layer, measure, target, width, direction, flows, label in selected
        ],
    }


def historical_catalogue() -> dict:
    """Read the frozen historical source as data; never import its execution helpers."""
    raw = Path(__file__).with_name("bpic19_reference").joinpath("historical-notebook-norm.json").read_bytes()
    document = json.loads(raw)
    return {"source_sha256": hashlib.sha256(raw).hexdigest(), "source": document}


def verified_historical_catalogue() -> dict:
    """Verify distribution bytes separately from the immutable upstream authority."""
    catalogue = historical_catalogue()
    if catalogue["source_sha256"] != HISTORICAL_PACKAGED_CATALOGUE_SHA256:
        raise ValueError("The frozen historical catalogue differs from its verified distribution copy.")
    return {**catalogue, "provenance": {
        "upstream_source_sha256": HISTORICAL_UPSTREAM_CATALOGUE_SHA256,
        "packaged_source_sha256": catalogue["source_sha256"],
        "adaptation_policy_id": HISTORICAL_CATALOGUE_ADAPTATION,
        "omitted_json_pointers": ["/preparation/path_default"],
    }}


# Separately reviewed corrections of the frozen historical catalogue. Each one is a new norm and profile identity;
# the frozen catalogue itself is never edited or aliased.
HISTORICAL_CORRECTIONS = {
    "singular_change_payment_term": {
        "criterion_id": "c_l4_change_payment_terms_repeats", "frozen_activity": "Change Payment Terms",
        "corrected_activity": "Change payment term",
        "reason": "The source records the singular label; the frozen plural selector matches none of it.",
    },
}


def _historical_binding(corrections: Sequence[str] = ()) -> tuple[dict, list[dict], dict[str, dict]]:
    unknown = [name for name in corrections if name not in HISTORICAL_CORRECTIONS]
    if unknown or len(set(corrections)) != len(corrections):
        raise SettingError("Choose distinct registered historical corrections.", "settings.historical_corrections")
    applied = {HISTORICAL_CORRECTIONS[name]["criterion_id"]: HISTORICAL_CORRECTIONS[name] for name in corrections}
    catalogue = verified_historical_catalogue()
    source = catalogue["source"]
    constraints, omitted, bindings = [], [], {}
    historical_features = {
        "c_l2_df1_invoice_after_goods": "historical_invoice_precedes_receipt",
        "c_l2_df2_release_after_goods": "historical_release_precedes_receipt",
        "c_l3_df1_goods_to_invoice_days": "historical_goods_to_invoice_days",
        "c_l3_invoice_to_clear_days": "historical_invoice_to_clear_days",
        "c_l3_df2_goods_to_rpb_days": "historical_goods_to_release_days",
        "c_l3_df2_rpb_to_clear_days": "historical_release_to_clear_days",
        "c_l7_manual_touches": "historical_manual_touch_count",
        "c_l7_distinct_human_resources": "historical_distinct_human_resources",
        "c_l7_manual_share": "historical_manual_share",
        "c_l6_bal_networth_volatility": "historical_networth_cv",
        "c_l6_high_exposure_memo": "historical_memo_exposure",
        "c_l6_high_exposure_price_change": "historical_price_exposure",
    }
    for criterion in source["constraints"]:
        kind, params, key = criterion["type"], criterion["params"], criterion["id"]
        if kind in {"presence", "presence_any", "absence", "absence_any", "count_excess"}:
            activities = params.get("activities_any_of", [params.get("activity")])
            if key in applied:
                activities = [applied[key]["corrected_activity"]]
            binding = {"activities": activities, "selector_policy": "historical_slug_v1"}
            target = params.get("min_count", 1) if kind.startswith("presence") else params.get("allowed_count", 0)
            width = params.get("saturation_width", 1)
            direction = "low" if kind.startswith("presence") else "high"
        elif key == "c_l7_total_events":
            binding = {"record_count": True}
            target, width, direction = params["threshold"], params["saturation_width"], "high"
        elif key in historical_features:
            binding = {"measure": historical_features[key]}
            target = params.get("threshold_days", params.get("threshold", 0))
            width = params.get("saturation_width_days", params.get("saturation_width", 1))
            direction = "high"
        else:
            omitted.append(
                {
                    "criterion_id": key,
                    "layer": criterion["layer_id"],
                    "type": kind,
                    "reason": "historical_raw_measure_semantics_not_yet_qualified",
                    "source_params": params,
                    "applicable_flows": criterion["applicable_flows"],
                }
            )
            continue
        bindings[key] = binding
        constraints.append(
            {
                "id": key,
                "layer": criterion["layer_id"],
                "type": "metric",
                "description": criterion["description"],
                "weight": criterion["within_layer_weight"],
                "params": {"attribute": key, "threshold": target, "width": width, "direction": direction},
                "applicability": {"flow": ["two_way" if f == "2-way" else f for f in criterion["applicable_flows"]]},
            }
        )
    document = {
        "schema_version": 3,
        "missing_values": "three_valued",
        "name": (HISTORICAL_PROFILE.replace(".partial", "") if not omitted else HISTORICAL_PROFILE).replace(
            ".v1", "".join(".corrected." + name for name in sorted(corrections)) + ".v1"),
        "version": "1",
        "scoring_mode": "layer_balanced",
        "layers": [{"id": key} for key in source["layers"]],
        "views": [{"name": name, "layer_weights": view["layer_weights"]} for name, view in source["views"].items()],
        "constraints": constraints,
        "metadata": {
            "source_sha256": catalogue["source_sha256"],
            "source_provenance": catalogue["provenance"],
            "partial": bool(omitted),
            "requested_criterion_count": 29,
            "omissions": omitted,
            "compatibility": "source count, union-invoice, parsed-minimum, prefix resource, sample-CV and frozen max-absolute P95 recipes; Method uses explicit three-valued scope",
            "raw_bindings": bindings,
            "source_operators": {c["id"]:{"type":c["type"],"params":c["params"],"applicable_flows":c["applicable_flows"]} for c in source["constraints"]},
            "selector_policy": "historical_slug_v1_case_and_punctuation_normalization_without_plural_aliases",
            "timestamp_policy": "independent_parsed_minima_without_paper_range_filter; reversed_elapsed_interval_unavailable; tie_zero",
            "resource_policy": "outer_trim_lower_for_classification; exclude_empty_nan_none_null_and_batch_prefix; distinct_original_labels",
            "value_policy": "sample_SD_ddof1_divided_by_mean_clipped_at_1e-6; item_maxabs_global_linear_P95; explicit_legacy_missing_fill_zero",
            "corrections": [{"correction_id": name, **HISTORICAL_CORRECTIONS[name]} for name in sorted(corrections)],
        },
    }
    return document, omitted, bindings


def _mode(mode: str) -> None:
    if mode not in {"flat", "layer_balanced"}:
        raise ValueError("Scoring mode must be flat or layer_balanced.")


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _json(value: Any) -> Any:
    """Turn native dataframe scalars into JSON, preserving unavailable values as null."""
    if isinstance(value, Mapping):
        return {str(k): _json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json(v) for v in value]
    if hasattr(value, "item"):
        return _json(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _records(frame: Any) -> list[dict]:
    return _json(frame.to_dict(orient="records"))


def _slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")


def _activity_witness(feature: dict, binding: dict) -> dict:
    """Historical selectors retain the source slug policy, including plural mismatches."""
    wanted = {_slug(label) for label in binding["activities"]}
    labels = [label for label in feature.get("activity_counts", {}) if _slug(label) in wanted]
    rows = [row for label in labels for row in feature.get("activity_row_ids", {}).get(label, [])]
    available = feature.get("activity_counts_available") is not False
    return {"value": sum(feature.get("activity_counts", {}).get(label, 0) for label in labels) if available else None,
            "available": available, "reason": None if available else "missing_activity_label", "row_ids": rows,
            "unit": "event_occurrences",
            "selector": binding["activities"], "selector_policy": binding["selector_policy"],
            "unknown_row_ids": feature.get("missing_activity_row_ids", [])}


def _presence_witness(feature: dict, attribute: str) -> dict:
    count_name, labels = PRESENCE_SELECTORS[attribute]
    exact = feature.get("measures", {}).get(count_name, {})
    # Prepared literal attributes are supported for independent downstream arithmetic
    # fixtures. Real measured histories always disclose label coverage and row lists.
    if feature.get("activity_counts_available") is not False:
        value = _number(exact.get("value")) if exact.get("available") is True else None
        return {**exact, "value": int(value > 0) if value is not None else None,
                "available": value is not None, "operator": "witnessed_binary_presence", "unit":"case_presence_boolean"}
    known = sum(feature.get("activity_counts", {}).get(label, 0) for label in labels)
    rows = [row for label in labels for row in feature.get("activity_row_ids", {}).get(label, [])]
    return {"value": 1 if known else None, "available": bool(known),
            "reason": None if known else "missing_activity_label", "row_ids": rows,
            "known_matching_lower_bound": known, "exact_count": None,
            "unknown_row_ids": feature.get("missing_activity_row_ids", []),
            "operator": "witnessed_binary_presence", "unit":"case_presence_boolean"}


def representation_key(feature: dict, kind: str) -> str | None:
    representation = feature.get("representations", {})
    sequence = representation.get("exact_sequence" if kind == "exact" else "first_occurrence_signature")
    if not representation.get("available") or sequence is None: return None
    return "bpic19-" + kind + ".v1:sha256:" + hashlib.sha256(
        json.dumps({"policy": "exact_sequence.v1" if kind == "exact" else "first_occurrence.v1", "sequence": sequence},
                   sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _transport(features: Sequence[dict], bindings: dict | None) -> Any:
    wise, pandas = method._wise(), method._pandas()
    rows = []
    for feature in features:
        case_id = feature["case_id"]
        row = {
            "case_id": case_id,
            "activity": "prepared_measure_transport",
            "time": "2000-01-01T00:00:00Z",
            "assessment_row_id": case_id,
            "flow": feature.get("flow"),
            "document": feature.get("document"),
            "company": feature.get("company"),
            "spend_area": feature.get("spend_area"),
            "item_type": feature.get("context", {}).get("item_type", {}).get("value"),
            "exact_score_group": representation_key(feature, "exact"),
            "signature_score_group": representation_key(feature, "signature"),
        }
        for name, measure in feature["measures"].items():
            row["raw_exposure" if name == "exposure" else name] = (
                _number(measure.get("value")) if measure.get("available") is True else None
            )
        for attribute in PRESENCE_SELECTORS:
            row[attribute] = _presence_witness(feature, attribute)["value"]
        if bindings is not None:
            for key, binding in bindings.items():
                if binding.get("measure"):
                    measure = feature.get("historical_measures", {}).get(binding["measure"], {})
                    row[key] = _number(measure.get("value")) if measure.get("available") is True else None
                else:
                    row[key] = (
                        feature.get("record_count")
                        if binding.get("record_count")
                        else (
                            _activity_witness(feature, binding)["value"]
                        )
                    )
        rows.append(row)
    frame = pandas.DataFrame(rows)
    return wise.EventLog(
        frame,
        case_col="case_id",
        activity_col="activity",
        timestamp_col="time",
        event_id_col="assessment_row_id",
        case_attributes=[c for c in frame if c not in {"case_id", "activity", "time", "assessment_row_id"}],
        utc=True,
        dedupe=False,
    )


def prepared_score_inputs(prepared: PreparedData, case_ids: Sequence[str], roles: Mapping) -> tuple[list[dict], Callable[[str], dict]]:
    """Retain scoring/report inputs, deriving complete case evidence only on demand."""
    chosen = checked_measure_roles(prepared, roles)

    def evidence(case_id: str) -> dict:
        feature = derive_case_measures(prepared, case_id, chosen)
        for name in ("creation_value", "exposure"):
            feature["measures"][name]["unit"] = "source_value_units"
        return feature

    inputs = []
    for case_id in checked_case_ids(prepared, case_ids):
        feature = evidence(case_id)
        inputs.append({
            **{key: feature[key] for key in ("case_id", "flow", "document", "company", "spend_area", "record_count",
                                             "activity_counts", "activity_counts_available")},
            "context": {role: {key: value for key, value in feature["context"][role].items() if key != "row_ids"}
                        for role in ("purchasing_document", "company", "spend_area", "item_type")},
            "measures": {name: {"value": witness.get("value"), "available": witness.get("available")}
                         for name, witness in feature["measures"].items()},
            "representations": {key: feature["representations"][key]
                                for key in ("available", "exact_sequence", "first_occurrence_signature")},
        })
    return inputs, evidence


@dataclass(frozen=True)
class Bpic19Assessment:
    """An immutable native evaluation in memory, with bounded serializable pages."""

    features: dict[str, dict]
    result: Any
    norm_document: dict
    view: str
    gamma: float
    group_by: list[str]
    min_cases: int
    volume: str
    exposure_receipt: dict | None
    omissions: list[dict]
    association_min_support: int = 1
    _evidence: Callable[[str], dict] | None = field(default=None, repr=False, compare=False)

    @cached_property
    def effective_weights(self) -> Any:
        return self.result.effective_weights(self.view)

    @cached_property
    def penalties(self) -> Any:
        return self.result.penalties(self.view)

    @cached_property
    def historical_bindings(self) -> dict:
        if not self.norm_document["name"].startswith("bpic19.notebook"):
            return {}
        corrections = [entry["correction_id"] for entry in self.norm_document.get("metadata", {}).get("corrections", [])]
        return _historical_binding(corrections)[2]

    @cached_property
    def native_tables(self) -> dict:
        """Views of native values for chunk serialization; no second evaluator."""
        return {
            "weights": self.effective_weights.to_numpy(copy=False),
            "penalties": self.penalties.to_numpy(copy=False),
            "scope": self.result.in_scope.to_numpy(copy=False),
            "evaluated": self.result.applicable.to_numpy(copy=False),
            "reasons": self.result.reasons.to_numpy(copy=False),
            "deviations": self.result.violations.to_numpy(copy=False),
            "scores": self.result.scores.to_numpy(copy=False),
            "layers": self.result.contributions[self.view].to_numpy(copy=False),
        }

    @cached_property
    def native_positions(self) -> dict[str, int]:
        return {case_id: index for index, case_id in enumerate(self.result.cases.index)}

    @cached_property
    def raw_weights(self) -> dict:
        return self.result.norm.raw_weights(self.view)

    def case(self, case_id: str) -> dict:
        if case_id not in self.features:
            raise ValueError("The item is outside this frozen assessment.")
        result = self.result
        feature = self._evidence(case_id) if self._evidence is not None else self.features[case_id]
        position = self.native_positions[case_id]
        native = self.native_tables
        weights, penalties, known, evaluated, reasons = (
            native[key][position] for key in ["weights", "penalties", "scope", "evaluated", "reasons"]
        )
        raw = self.raw_weights
        # Native masks follow constraint order; the ID→weight lookup may be
        # grouped by layer and must not supply a second positional order.
        constraint_ids = [constraint.id for constraint in result.norm.constraints]
        denominator = sum(raw[key] for index, key in enumerate(constraint_ids) if bool(known[index]))
        numerator = sum(raw[key] for index, key in enumerate(constraint_ids) if bool(evaluated[index]))
        scope_unknown = sum(str(reason) == "scope_unknown" for reason in reasons)
        criteria = []
        for index, constraint in enumerate(result.norm.constraints):
            key = constraint.id
            attribute = constraint.constraint.attribute
            if self.norm_document["name"].startswith("bpic19.notebook"):
                binding = self.historical_bindings[key]
                if binding.get("measure"):
                    witness = feature.get("historical_measures", {}).get(binding["measure"], {})
                elif binding.get("record_count"):
                    witness = {"value": feature.get("record_count"), "row_ids": feature.get("record_row_ids", [])}
                else:
                    witness = _activity_witness(feature, binding)
            else:
                witness = (_presence_witness(feature, attribute) if attribute in PRESENCE_SELECTORS
                           else feature["measures"].get(attribute, {}))
            criteria.append(
                {
                    "criterion_id": key,
                    "layer": constraint.layer,
                    "measurement": _json(witness.get("value")),
                    "measurement_reason": witness.get("reason"),
                    "row_ids": witness.get("row_ids", []),
                    "measurement_evidence": _json(witness),
                    "in_scope": bool(known[index]),
                    "reason": str(reasons[index]),
                    "deviation": _json(native["deviations"][position, index]),
                    "raw_weight": raw[key],
                    "effective_weight": _json(weights[index]),
                    "penalty": _json(penalties[index]),
                }
            )
        return {
            "case_id": case_id,
            "flow": feature.get("flow"),
            "document": feature.get("document"),
            "company": feature.get("company"),
            "spend_area": feature.get("spend_area"),
            "score": _json(native["scores"][position, list(result.scores.columns).index(self.view)]),
            "native_penalty": _json(sum(penalties)) if _number(native["scores"][position, list(result.scores.columns).index(self.view)].item()) is not None else None,
            "scores": {view: _json(native["scores"][position, i]) for i, view in enumerate(result.scores.columns)},
            "coverage": numerator / denominator if denominator and not scope_unknown else None,
            "in_scope_raw_weight": denominator,
            "evaluated_raw_weight": numerator,
            "scope_unknown_count": scope_unknown,
            "layers": {
                layer: _json(native["layers"][position, i])
                for i, layer in enumerate(result.contributions[self.view].columns)
            },
            "criteria": criteria,
            "record_row_ids": feature.get("record_row_ids", []),
            "context_evidence": _json(feature.get("context", {})),
            "historical_artifacts": _json(feature.get("historical_artifacts")),
            "value_evidence": _json({key: feature.get("measures", {}).get(key, {}) for key in
                                     ("creation_value", "creation_unique_event", "exposure", "creation_first_source_position")
                                     if key != "creation_first_source_position" or key in feature.get("measures", {})}),
        }

    def case_chunks(self, chunk_size: int = 1000):
        """Stream complete native case snapshots for durable compressed artifacts."""
        if type(chunk_size) is not int or not 1 <= chunk_size <= 2000:
            raise ValueError("Snapshot chunks contain between 1 and 2000 cases.")
        ids = list(self.features)
        for offset in range(0, len(ids), chunk_size):
            yield {"offset": offset, "cases": [self.case(key) for key in ids[offset : offset + chunk_size]]}

    def backlog(self, group_by: Sequence[str] | None = None) -> Any:
        keys = list(group_by or self.group_by)
        frame = self.result.frame(self.view)
        for key in keys:
            if frame[key].isna().any() and frame[key].eq("(missing)").any():
                raise ValueError(f"Native grouping cannot distinguish unavailable {key} from literal '(missing)'. Choose another grouping; original source values remain unchanged.")
        return method._wise().prioritize(
            self.result,
            by=keys,
            view=self.view,
            gamma=self.gamma,
            volume="reviewed_exposure" if self.volume == "exposure" else "cases",
            min_cases=self.min_cases,
        )

    def _group_records(self, frame: Any, keys: Sequence[str]) -> list[dict]:
        rows = _records(frame)
        # Method labels missing keys for display; public selectors use null.
        # A literal label is retained when that source key has no missingness.
        source = self.result.frame(self.view)
        missing_keys = [key for key in keys if source[key].isna().any()]
        for row in rows:
            for key in missing_keys:
                if row.get(key) == "(missing)":
                    row[key] = None
        return rows

    def report(
        self, *, case_offset: int = 0, case_limit: int = 100, group_offset: int = 0, group_limit: int = 100
    ) -> dict:
        if type(case_offset) is not int or case_offset < 0 or type(case_limit) is not int or not 1 <= case_limit <= 200:
            raise ValueError("A case page needs a nonnegative offset and a limit from 1 to 200.")
        if (
            type(group_offset) is not int
            or group_offset < 0
            or type(group_limit) is not int
            or not 1 <= group_limit <= 100000
        ):
            raise ValueError(
                "A group page has a nonnegative offset and a limit from 1 to 100000; browser pages must be bounded by their request contract."
            )
        wise, result = method._wise(), self.result
        scored = result.scores[self.view].notna()
        raw = result.norm.raw_weights(self.view)
        denominator = result.in_scope.mul(raw).sum(axis=1)
        numerator = result.applicable.mul(raw).sum(axis=1)
        coverage = numerator.div(denominator.where(denominator > 0))
        coverage = coverage.where(~result.reasons.eq("scope_unknown").any(axis=1))
        backlog_rows, drivers, documents, spec = [], [], [], None
        group_total, document_total = 0, 0
        if bool(scored.any()):
            backlog = self.backlog()
            group_total = len(backlog.table)
            backlog_rows = self._group_records(backlog.table.reset_index().iloc[group_offset : group_offset + group_limit], self.group_by)
            spec = _json(asdict(backlog.spec))
            native_drivers = wise.layer_drivers(result, backlog, as_index=False)
            ranked = backlog.table.reset_index().iloc[group_offset : group_offset + group_limit]
            joined = ranked[self.group_by + ["volume"]].merge(native_drivers, on=self.group_by, how="left", sort=False)
            for layer in result.norm.layer_ids:
                # Display decomposition only: native delta and native multiplier.
                # Negative terms are retained before the final positive-gap truncation.
                joined[f"{layer}__signed_PI"] = joined[f"{layer}__delta"] * joined["volume"]
                joined[f"{layer}__signed_stable_PI"] = (
                    joined[f"{layer}__signed_PI"] * joined["n_cases"] / (joined["n_cases"] + self.gamma)
                )
            drivers = self._group_records(joined, self.group_by)
            document_backlog = self.backlog(["document"])
            document_total = len(document_backlog.table)
            documents = self._group_records(document_backlog.table.reset_index().iloc[group_offset : group_offset + group_limit], ["document"])
            document_members = {}
            for feature in self.features.values():
                document_members.setdefault(feature.get("document"), []).append(feature["case_id"])
            positive_mass = float(document_backlog.table["PI"].sum())
            for document in documents:
                document["member_count"] = len(document_members.get(document.get("document"), []))
                document["unscored_member_count"] = document["member_count"] - document["n_cases"]
                document["positive_PI_share"] = document["PI"] / positive_mass if positive_mass else None
        ids = list(self.features)
        return {
            "profile_id": self.norm_document["name"],
            "profile_complete": not self.omissions,
            "requested_criterion_count": 29 if self.norm_document["name"].startswith("bpic19.notebook") else 10,
            "admitted_criterion_count": len(result.norm.constraints),
            "omissions": self.omissions,
            "method_artifact": dict(method.METHOD_ARTIFACT),
            "norm": self.norm_document,
            "norm_fingerprint": result.norm_fingerprint,
            "assessment_log_fingerprint": result.log.fingerprint(),
            "transport": "prepared measurements; assessment rows are not source events",
            "settings": {
                "view": self.view,
                "criteria_family": self.norm_document.get("metadata", {}).get("criteria_family", "full"),
                "mode": result.mode,
                "gamma": self.gamma,
                "group_by": self.group_by,
                "volume": self.volume,
                "min_cases": self.min_cases,
                "association_min_support": self.association_min_support,
                **({"historical_corrections": corrections} if (corrections := [entry["correction_id"] for entry in
                    self.norm_document.get("metadata", {}).get("corrections", [])]) else {}),
            },
            "exposure_calibration": self.exposure_receipt,
            "population_case_count": len(ids),
            "scored_case_count": int(scored.sum()),
            "unscored_case_count": int((~scored).sum()),
            "mean_score": _json(result.scores.loc[scored, self.view].mean()),
            "mean_coverage": _json(coverage.loc[scored].mean()),
            "coverage_available_case_count": int((coverage.notna() & scored).sum()),
            "view_summaries": _records(result.summary().reset_index()),
            "criterion_summary": (
                [] if not bool(scored.any()) else _records(wise.constraint_drivers(result, self.view).reset_index())
            ),
            "backlog_spec": spec,
            "groups": backlog_rows,
            "group_page": {
                "offset": group_offset,
                "limit": group_limit,
                "total": group_total,
                "document_total": document_total,
            },
            "layer_drivers": drivers,
            "documents": documents,
            "document_grain": "scored PO items within each purchasing document",
            "driver_units": "native mean penalty deltas; signed PI terms use native volume before positive-gap truncation",
            "associations": self.associations(minimum_support=self.association_min_support),
            "suppressed_associations": self.associations(minimum_support=self.association_min_support, suppressed=True),
            "criterion_statistics": self.criterion_statistics(),
            "selector_warnings": self.selector_warnings(),
            "exemplars": self.timing_exemplars(),
            "representation_scores": {kind: self.representation_scores(kind)[group_offset:group_offset+group_limit]
                                      for kind in ("exact","signature")},
            "representation_page": {"offset": group_offset, "limit": group_limit,
                "exact_total": len(self.representation_scores("exact")), "signature_total": len(self.representation_scores("signature")),
                "unavailable_case_count": sum(representation_key(f,"exact") is None for f in self.features.values()),
                "reference": "same frozen item assessment, native arithmetic scored-item reference; no refit"},
            "ranking_comparisons": self.ranking_comparisons,
            "case_page": {
                "offset": case_offset,
                "limit": case_limit,
                "total": len(ids),
                "cases": [self.case(key) for key in ids[case_offset : case_offset + case_limit]],
            },
        }

    def criterion_statistics(self) -> list[dict]:
        """Descriptive summaries of native deviations and penalties, with explicit denominators."""
        rows = []
        penalties = self.penalties
        for key in self.result.violations:
            values = self.result.violations[key]
            eligible, positive = values.notna(), values.gt(0)
            n, fired, total = int(eligible.sum()), int(positive.sum()), len(values)
            rows.append({"criterion_id": key, "total_case_count": total, "eligible_case_count": n,
                         "positive_case_count": fired, "unavailable_case_count": total - n,
                         "known_in_scope_case_count": int(self.result.in_scope[key].sum()),
                         "out_of_scope_case_count": int(self.result.reasons[key].eq("out_of_scope").sum()),
                         "scope_unknown_case_count": int(self.result.reasons[key].eq("scope_unknown").sum()),
                         "in_scope_unavailable_case_count": int((self.result.in_scope[key] & ~eligible).sum()),
                         "eligible_firing_rate": fired / n if n else None,
                         "total_case_positive_fraction": fired / total if total else None,
                         "eligible_mean_severity": _json(values.loc[eligible].mean()),
                         "conditional_positive_severity": _json(values.loc[positive].mean()),
                         "unweighted_severity_sum": _json(values.sum(min_count=1)),
                         "native_penalty_sum": _json(penalties[key].sum(min_count=1))})
        return rows

    def selector_warnings(self) -> list[dict]:
        if not self.norm_document["name"].startswith("bpic19.notebook"): return []
        observed = sum(count for feature in self.features.values() for label,count in feature.get("activity_counts",{}).items()
                       if _slug(label) == "change_payment_term")
        corrected = any(entry["criterion_id"] == "c_l4_change_payment_terms_repeats"
                        for entry in self.norm_document.get("metadata", {}).get("corrections", []))
        if not observed or corrected: return []
        return [{"criterion_id":"c_l4_change_payment_terms_repeats","selected_label":"Change Payment Terms",
                 "observed_alternate_label":"Change payment term","observed_occurrence_count":observed,
                 "policy":"historical_slug_v1_preserve_plural_difference",
                 "message":"The original plural selector does not match the observed singular activity. A correction requires a new norm identity."}]

    @cached_property
    def representation_tables(self) -> dict:
        return {kind:self._representation_scores(kind) for kind in ("exact","signature")}

    def representation_scores(self,kind: str) -> list[dict]:
        return self.representation_tables[kind]

    @cached_property
    def ranking_comparisons(self) -> dict:
        """Finite native view/policy shortlists; every reference is recorded separately."""
        wise = method._wise()
        views, overlaps = {}, []
        for view in self.result.norm.view_names:
            if not self.result.scores[view].notna().any():
                views[view] = {"state":"unscored","documents":[],"groups":[],"document_reference":None,"group_reference":None}
                continue
            doc = wise.prioritize(self.result,by=["document"],view=view,gamma=self.gamma,
                volume="reviewed_exposure" if self.volume == "exposure" else "cases",min_cases=self.min_cases)
            group = wise.prioritize(self.result,by=self.group_by,view=view,gamma=self.gamma,
                volume="reviewed_exposure" if self.volume == "exposure" else "cases",min_cases=self.min_cases)
            views[view] = {"state":"evaluated", "documents":self._group_records(doc.table.loc[doc.table["stable_PI"]>0].head(20).reset_index(), ["document"]),
                "groups":self._group_records(group.table.loc[group.table["stable_PI"]>0].head(10).reset_index(), self.group_by),
                "document_reference":_json(asdict(doc.spec)), "group_reference":_json(asdict(group.spec))}
        names = list(views)
        for i,left in enumerate(names):
            for right in names[i+1:]:
                a={row["document"] for row in views[left]["documents"]}
                b={row["document"] for row in views[right]["documents"]}
                overlaps.append({"left":left,"right":right,"left_count":len(a),"right_count":len(b),
                    "intersection_count":len(a&b),"union_count":len(a|b),"jaccard":len(a&b)/len(a|b) if a|b else None,
                    "reason":None if a|b else "zero_union", "population":"positive-priority document top 20 in each native view"})
        policies = {}
        if self.result.scores[self.view].notna().any():
            mass = wise.penalty_mass(self.result,self.view,by=self.group_by,as_index=False)
            mass = mass.loc[mass["n_cases"]>=self.min_cases]
            policies["total_penalty"] = self._group_records(mass.head(10), self.group_by)
            policies["mean_penalty"] = self._group_records(mass.sort_values(["mean_penalty","n_cases"],ascending=[False,False],kind="mergesort").head(10), self.group_by)
            for gamma in (0,20):
                backlog = wise.prioritize(self.result,by=self.group_by,view=self.view,gamma=gamma,
                    volume="reviewed_exposure" if self.volume == "exposure" else "cases",min_cases=self.min_cases)
                policies["PI_gamma_"+str(gamma)] = self._group_records(backlog.table.head(10).reset_index(), self.group_by)
        return {"views":views,"document_overlaps":overlaps,"group_policies":policies,
                "top_document_limit":20,"top_group_limit":10,"tie_policy":"native descending priority, descending scored count, ascending grouping keys with missing last",
                "interpretation":"descriptive ranking comparisons on one frozen evaluation; each view has its own arithmetic item reference"}

    def _representation_scores(self, kind: str) -> list[dict]:
        if kind not in {"exact","signature"}: raise ValueError("Choose exact or signature representation.")
        groups = {}
        for cid, feature in self.features.items():
            key = representation_key(feature,kind)
            if key is not None: groups.setdefault(key,[]).append(cid)
        if not groups: return []
        attribute = kind + "_score_group"
        grouping = self.result.cases[attribute]
        mass = self.penalties.groupby(grouping,sort=False).sum(min_count=1).to_dict(orient="index")
        scored_counts = self.result.scores[self.view].groupby(grouping,sort=False).count().to_dict()
        native_mass = ({row[attribute]: row for row in _records(method._wise().penalty_mass(
            self.result, self.view, by=[attribute], as_index=False))}
            if self.result.scores[self.view].notna().any() else {})
        ranked = {}
        if self.result.scores[self.view].notna().any():
            backlog = method._wise().prioritize(self.result,by=[attribute],view=self.view,gamma=self.gamma,
                volume="reviewed_exposure" if self.volume == "exposure" else "cases",min_cases=self.min_cases)
            ranked = {row[attribute]: row for row in _records(backlog.table.reset_index())}
        rows = []
        for key, members in groups.items():
            scored_count = int(scored_counts.get(key,0))
            native = ranked.get(key)
            row = {"group_id": key, "kind": kind,
                "sequence": self.features[members[0]]["representations"]["exact_sequence" if kind == "exact" else "first_occurrence_signature"],
                "member_count": len(members), "record_count": sum(self.features[cid].get("record_count",0) for cid in members),
                "scored_case_count": scored_count, "unscored_case_count": len(members)-scored_count,
                "state": "ranked" if native is not None else "unscored" if not scored_count else "support_below_minimum",
                "mean_score": native.get("mean_score") if native is not None else None,
                "PI": native.get("PI") if native is not None else None,
                "stable_PI": native.get("stable_PI") if native is not None else None,
                "volume": native.get("volume") if native is not None else None,
                "global_mean": native.get("global_mean") if native is not None else None,
                "native_penalty_mass": _json(mass.get(key,{})),
                "mean_penalty": native_mass.get(key,{}).get("mean_penalty"),
                "summed_penalty_mass": native_mass.get(key,{}).get("penalty_mass"),
                "reference": "same native scored-item reference; representation join never rescores"}
            rows.append(row)
        return sorted(rows,key=lambda row:(-(row["stable_PI"] or 0),-row["scored_case_count"],row["group_id"]))

    def timing_exemplars(self) -> list[dict]:
        """Positive timing witness nearest each group's all-evaluable median.

        The deterministic display tie is ascending original item identity. This
        selects evidence; it does not alter a grade, scope or ranked reference.
        """
        if "C04" not in self.result.violations: return []
        by_group = {}
        deviations = self.result.violations["C04"].to_dict()
        for cid, feature in self.features.items():
            value = feature["measures"].get("invoice_to_clearing_days", {}).get("value")
            if deviations[cid] != deviations[cid]: continue
            key = tuple(feature.get(k) if k != "item_type" else feature.get("context", {}).get(k, {}).get("value") for k in self.group_by)
            by_group.setdefault(key, []).append((cid, value, float(deviations[cid])))
        rows = []
        for key, members in by_group.items():
            median = float(method._pandas().Series([value for _, value, _ in members]).median())
            candidates = [(cid, value, dev) for cid, value, dev in members if dev > 0]
            if not candidates: continue
            cid, value, dev = min(candidates, key=lambda item: (abs(item[1] - median), item[0]))
            rows.append({**dict(zip(self.group_by, key)), "case_id": cid, "criterion_id": "C04",
                         "reference_median_days": median, "evaluated_support": len(members), "positive_support": len(candidates),
                         "measurement_days": value, "deviation": dev,
                         "row_ids": (self._evidence(cid) if self._evidence is not None else self.features[cid])["measures"]["invoice_to_clearing_days"].get("row_ids", []),
                         "selection_recipe": "positive_nearest_all_evaluable_median_then_case_id_ascending"})
        return rows

    def associations(self, *, minimum_support: int = 1, suppressed: bool = False) -> list[dict]:
        """Descriptive pairwise co-occurrence on each pair's jointly evaluated cases."""
        if type(minimum_support) is not int or minimum_support < 1:
            raise ValueError("Association support must be a positive integer.")
        values = self.result.violations
        pairs = []
        for i, left in enumerate(values.columns):
            for right in values.columns[i + 1 :]:
                eligible = values[left].notna() & values[right].notna()
                a, b = values.loc[eligible, left] > 0, values.loc[eligible, right] > 0
                n, na, nb, both = int(eligible.sum()), int(a.sum()), int(b.sum()), int((a & b).sum())
                union = na + nb - both
                if (both < minimum_support) is not suppressed:
                    continue
                pairs.append(
                    {
                        "left": left,
                        "right": right,
                        "eligible_case_count": n,
                        "left_positive": na,
                        "right_positive": nb,
                        "support": both,
                        "jaccard": both / union if union else None,
                        "lift": both * n / (na * nb) if na and nb else None,
                        "minimum_support": minimum_support,
                        "suppression_reason": "support_below_minimum" if both < minimum_support else None,
                        "lift_reason": None if na and nb else "zero_support",
                        "jaccard_reason": None if union else "zero_union",
                        "dependency": "deterministic_derived" if left == "C01" and right == "C08" else "not_established",
                        "feature_lineage": "shared_exact_Record_Invoice_Receipt_count" if left == "C01" and right == "C08" else "criterion recipes in frozen norm metadata",
                        "interpretation": "descriptive association, not causal or independent evidence",
                    }
                )
        return sorted(pairs, key=lambda p: (-p["support"], p["left"], p["right"]))


def evaluate_features(
    features: Sequence[dict],
    *,
    profile: str = "paper",
    criteria_family: str = "full",
    view: str = "Balanced",
    mode: str = "flat",
    gamma: float = 0,
    group_by: Sequence[str] = ("company", "spend_area"),
    min_cases: int = 1,
    volume: str = "cases",
    exposure_policy: str = "max_absolute_p95",
    exposure_calibration: Mapping | None = None,
    exposure_provenance: Mapping | None = None,
    association_min_support: int = 1,
    historical_corrections: Sequence[str] = (),
) -> Bpic19Assessment:
    """Bind reviewed raw features to native Method; no application score formula."""
    problem = method.method_problem()
    if problem:
        raise ValueError(problem.message)
    if not features or any(not isinstance(f.get("case_id"), str) or not f["case_id"] for f in features):
        raise ValueError("The assessment needs named PO items.")
    if len({f["case_id"] for f in features}) != len(features):
        raise ValueError("Assessment item identities must be unique.")
    for feature in features:
        for key in ("invoice_count", "clearing_count", "receipt_count", "cancellation_count", "edit_count",
                    "user_event_count", "distinct_user_count"):
            measure = feature.get("measures", {}).get(key, {})
            if measure.get("available") is True:
                value = _number(measure.get("value"))
                if value is None or value < 0 or not value.is_integer():
                    raise ValueError("invalid_count: measured occurrence and resource counts must be nonnegative integers.")
        for key in set(group_by) | {"purchasing_document"}:
            role = "purchasing_document" if key == "document" else key
            context = feature.get("context", {}).get(role, {})
            if context.get("reason") in {"conflicting_context", "conflicting_case_attribute", "conflicting_values"} or context.get("state") == "conflicting":
                raise ValueError("context_conflict: business grouping cannot choose an arbitrary event value.")
    if not group_by or len(set(group_by)) != len(group_by) or set(group_by) - GROUP_KEYS:
        raise ValueError("Choose distinct supported business grouping keys.")
    if _number(gamma) is None or gamma < 0 or type(min_cases) is not int or min_cases < 1:
        raise SettingError("Gamma must be finite and nonnegative; minimum support must be a positive integer.", "settings")
    if volume not in {"cases", "exposure"}:
        raise SettingError("Volume must be cases or exposure.", "settings.volume")
    if type(association_min_support) is not int or association_min_support < 1:
        raise ValueError("Association minimum support must be a positive integer.")
    _mode(mode)
    bindings, omitted = None, []
    if historical_corrections and profile != "historical":
        raise SettingError("Historical corrections apply only to the historical notebook profile.", "settings.historical_corrections")
    if profile == "paper":
        document = paper_norm_document(mode, criteria_family)
        omitted = [
            {"criterion_id": c[0], "layer": c[1], "reason": "not_requested_in_partial_family"}
            for c in PAPER_CRITERIA
            if c[0] not in CRITERIA_FAMILIES[criteria_family]
        ]
    elif profile == "historical":
        if criteria_family != "full":
            raise ValueError("The historical profile uses its full separate 29-criterion catalogue.")
        if mode != "layer_balanced":
            raise ValueError("The historical compatibility profile requires layer_balanced mode.")
        document, omitted, bindings = _historical_binding(tuple(historical_corrections))
    else:
        raise ValueError("Choose paper or historical profile.")
    wise, pandas = method._wise(), method._pandas()
    norm = wise.Norm.from_dict(document)
    norm.validate()
    if view not in norm.view_names:
        raise ValueError("The requested view is outside this profile.")
    log = _transport(features, bindings)
    receipt = None
    if volume == "exposure":
        if exposure_policy not in {"creation_value", "creation_unique_value", "creation_unique_event", "max_absolute_p95", "creation_first_source_position"}:
            raise SettingError("Choose the reviewed creation value or maximum absolute 95th percentile exposure recipe.", "settings.exposure_policy")
        if profile == "historical" and exposure_policy == "max_absolute_p95":
            calibrations = [f.get("historical_policy", {}).get("calibration") for f in features]
            if (
                any(not c or not c.get("available") for c in calibrations)
                or len({c["calibration_id"] for c in calibrations}) != 1
            ):
                raise SettingError("Historical exposure needs one available frozen global calibration for every item.", "settings.exposure_policy")
            receipt = dict(calibrations[0])
            if exposure_calibration is not None and exposure_calibration.get("calibration_id") != receipt.get(
                "calibration_id"
            ):
                raise SettingError("Historical exposure cannot recalibrate the selected population.", "settings.exposure_policy")
            amounts = {
                f["case_id"]: (
                    _number(f.get("historical_measures", {}).get("exposure_norm", {}).get("value"))
                    if f.get("historical_measures", {}).get("exposure_norm", {}).get("available") is True
                    else None
                )
                for f in features
            }
            if any(value is None or value < 0 for value in amounts.values()):
                raise ValueError(
                    "Historical exposure has an unavailable item; it cannot become zero without the declared compatibility recipe."
                )
            receipt["policy"], receipt["unit"] = exposure_policy, "normalized_exposure"
            if exposure_provenance is not None:
                receipt["measurement_calibration_id"] = receipt["calibration_id"]
                receipt.update(_checked_exposure_provenance(exposure_provenance, exposure_policy))
                receipt["priority_unit"] = "normalized exposure-score units"
                receipt.pop("calibration_id")
                receipt["calibration_id"] = hashlib.sha256(json.dumps(receipt, sort_keys=True, allow_nan=False).encode()).hexdigest()
            log = log.with_case_attributes({"reviewed_exposure": pandas.Series(amounts, dtype=float)})
        else:
            log, receipt = _reviewed_exposure(log, features, exposure_policy, exposure_calibration, exposure_provenance)
    result = wise.score(log, norm, mode=mode, derive=False)
    result.check_decomposition()
    if result.calibrations:
        raise method.MethodContractError("A fixed raw-metric norm unexpectedly fitted a Method calibration.")
    return Bpic19Assessment(
        {f["case_id"]: f for f in features},
        result,
        document,
        view,
        float(gamma),
        list(group_by),
        min_cases,
        volume,
        receipt,
        omitted,
        association_min_support,
    )


def _checked_exposure_provenance(provenance: Mapping, exposure_policy: str) -> dict:
    """Metadata supplied only after the server verifies a measures reference.

    No amounts or new measurement/scoring instruction can be transported here.
    The native Method still consumes the already derived amount column.
    """
    required = {"reviewed_measure_definition_id", "reviewed_population_identity", "source_field",
                "source_column_name", "source_unit", "value_reducer", "unit_provenance"}
    optional = {"source_id", "preparation_id", "fit_population_identity", "fit_membership_sha256", "source_record_basis", "source_value_missing_policy", "source_value_negative_policy", "first_creation_policy"}
    if (not isinstance(provenance, Mapping) or not required.issubset(provenance)
            or set(provenance) - required - optional):
        raise ValueError("Reviewed exposure provenance needs its finite source/unit/definition fields, never client amounts.")
    if (type(provenance["source_field"]) is not int or provenance["source_field"] < 0
            or not isinstance(provenance["source_unit"], str) or not provenance["source_unit"].strip()
            or len(provenance["source_unit"]) > 64 or not isinstance(provenance["source_column_name"], str)
            or not isinstance(provenance["reviewed_measure_definition_id"], str)
            or not isinstance(provenance["reviewed_population_identity"], Mapping)
            or provenance["unit_provenance"] != "explicit_raw_measures_definition.v1"):
        raise ValueError("Reviewed exposure provenance has an unavailable source field, declared unit or definition.")
    reducer = {"creation_value": "unique_creation_value", "creation_unique_value": "unique_creation_value",
               "creation_unique_event": "unique_creation_event", "max_absolute_p95": "maximum_absolute_event_value",
               "creation_first_source_position": "first_creation_source_position"}[exposure_policy]
    if provenance["value_reducer"] != reducer:
        raise ValueError("The reviewed value reducer differs from the chosen native exposure recipe.")
    if exposure_policy == "creation_first_source_position" and provenance.get("first_creation_policy") != FIRST_CREATION_POLICY:
        raise ValueError("First-source creation exposure needs its exact reviewed panel occurrence policy.")
    return dict(provenance)


def _reviewed_exposure(
    log: Any, features: Sequence[dict], exposure_policy: str, exposure_calibration: Mapping | None,
    exposure_provenance: Mapping | None = None,
) -> tuple[Any, dict]:
    if exposure_policy == "creation_first_source_position" and exposure_provenance is None:
        raise ValueError("First-source creation exposure requires its reviewed panel occurrence policy.")
    pandas = method._pandas()
    measure = ("creation_first_source_position" if exposure_policy == "creation_first_source_position" else
               "creation_unique_event" if exposure_policy == "creation_unique_event" else
               "creation_value" if exposure_policy in {"creation_value", "creation_unique_value"} else "exposure")
    amounts = {
        f["case_id"]: (
            _number(f["measures"].get(measure, {}).get("value"))
            if f["measures"].get(measure, {}).get("available") is True
            else None
        )
        for f in features
    }
    if any(value is None or value < 0 for value in amounts.values()):
        raise SettingError("Exposure ranking needs a finite nonnegative reviewed value for every assessment item; unavailable values cannot become zero.", "settings.exposure_policy")
    receipt = (
        dict(exposure_calibration)
        if exposure_calibration is not None
        else {
            "policy": exposure_policy,
            "population_case_ids": [f["case_id"] for f in features],
            "quantile": 0.95 if exposure_policy == "max_absolute_p95" else None,
            "cutoff": float(pandas.Series(amounts).quantile(0.95)) if exposure_policy == "max_absolute_p95" else None,
        }
    )
    if receipt.get("policy") != exposure_policy:
        raise SettingError("The frozen exposure calibration uses another recipe.", "settings.exposure_policy")
    if exposure_policy == "max_absolute_p95":
        cutoff = _number(receipt.get("cutoff"))
        if cutoff is None or cutoff <= 0:
            raise SettingError("Maximum absolute exposure calibration needs a positive finite 95th percentile cutoff.", "settings.exposure_policy")
        amounts = {key: min(value / cutoff, 1) for key, value in amounts.items()}
    receipt["unit"] = "source_value_units" if exposure_policy != "max_absolute_p95" else "normalized_exposure"
    receipt["quantile_method"] = "linear" if exposure_policy == "max_absolute_p95" else None
    receipt["reducer"] = "maximum_absolute_event_value" if exposure_policy == "max_absolute_p95" else measure
    receipt["missing_policy"], receipt["negative_policy"] = "refuse", "refuse_negative_derived_exposure"
    receipt["raw_negative_policy"] = "preserve_then_absolute" if exposure_policy == "max_absolute_p95" else "refuse_negative_creation"
    if exposure_provenance is not None:
        receipt.update(_checked_exposure_provenance(exposure_provenance, exposure_policy))
        receipt["unit"] = "normalized_exposure" if exposure_policy == "max_absolute_p95" else receipt["source_unit"]
        receipt["priority_unit"] = "normalized exposure-score units" if exposure_policy == "max_absolute_p95" else receipt["source_unit"] + "-score units"
    receipt.pop("calibration_id", None)
    receipt["calibration_id"] = hashlib.sha256(
        json.dumps(receipt, sort_keys=True, allow_nan=False).encode()
    ).hexdigest()
    log = log.with_case_attributes({"reviewed_exposure": pandas.Series(amounts, dtype=float)})
    return log, receipt
