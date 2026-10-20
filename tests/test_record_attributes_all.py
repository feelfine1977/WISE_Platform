"""Independently literal T03-AC08 and missing-cell oracles; no analyst scripts run."""
from dataclasses import replace
from datetime import datetime
from pathlib import Path
import json

import pytest
from jsonschema import Draft202012Validator
from wise_platform_analytics.preparation import PreparedData, PreparedRecord
from wise_platform_analytics.selection import (
    ContainsActivity, RecordAttributeCondition, RecordAttributesAll, SAME_RECORD_POLICY,
    SelectionError, predicate_descriptor, select_cases,
)


def source():
    # K matches each flag somewhere, never both on one row. M is explicitly blank.
    # U has a structurally absent IV cell, while F's known false GR dominates it.
    # T has one confirmed witness and one unknown candidate: existential stays true.
    cells = [("K", "true", "false"), ("K", "false", "true"),
             ("P", "true", "true"), ("P", "false", "false"),
             ("M", "true", ""), ("L", "true", "Unknown"),
             ("U", "true"), ("F", "false"),
             ("T", "true", "true"), ("T", "true"), ("S", " true", "true")]
    records = tuple(PreparedRecord(f"row.v1:sha256:{index:064x}", index, row[0], None,
        "A", "wall_clock", None, None, "invalid", (), row, None)
        for index, row in enumerate(cells, 1))
    histories = {case: tuple(row for row in records if row.case_id == case) for case in sorted({row[0] for row in cells})}
    identity = [prefix + ".v1:sha256:" + "a" * 64 for prefix in ["source", "preparation", "representation", "case-dictionary", "population"]]
    return PreparedData(*identity, "0.1.0", ("item", "GR", "IV"), records, histories, {},
        {"context_columns": ()}, {"time": {"id": "incident.time.wall_clock_as_recorded.v1"}}, {})


def compound(negate=False, iv=("true",)):
    return RecordAttributesAll((RecordAttributeCondition(1, ("true",)), RecordAttributeCondition(2, iv)), negate)


def test_same_record_not_different_rows_bad_times_and_complete_history():
    prepared = source()
    result = select_cases(prepared, [compound()])
    assert result.kept.case_ids == ("P", "T")
    assert result.kept.record_count == 4  # nonmatching/unknown sibling rows retained
    assert result.removed.case_ids == ("F", "K", "L", "M", "S")
    assert result.unevaluable.case_ids == ("U",)
    evidence = result.to_dict()["predicate_results"][0]["record_evidence"]
    assert evidence == {"policy_id": SAME_RECORD_POLICY, "cases": [
        {"case_id": "P", "matching_row_ids": [f"row.v1:sha256:{3:064x}"], "unevaluable_row_ids": []},
        {"case_id": "T", "matching_row_ids": [f"row.v1:sha256:{9:064x}"], "unevaluable_row_ids": [f"row.v1:sha256:{10:064x}"]},
        {"case_id": "U", "matching_row_ids": [], "unevaluable_row_ids": [f"row.v1:sha256:{7:064x}"]}]}
    assert prepared.histories["K"][0].original_cells == ("K", "true", "false")
    assert select_cases(prepared, [ContainsActivity("A")]).to_dict()["predicate_results"][0].keys() == {"predicate", "kept", "removed", "unevaluable", "kept_after_step"}


def test_negation_missing_literal_unknown_and_row_false_case_true_truth_table():
    prepared = source()
    positive, negative = select_cases(prepared, [compound()]), select_cases(prepared, [compound(True)])
    assert negative.kept == positive.removed and negative.removed == positive.kept
    assert negative.unevaluable == positive.unevaluable
    assert negative.predicate_results[0].record_evidence == positive.predicate_results[0].record_evidence
    assert select_cases(prepared, [compound(iv=(None,))]).kept.case_ids == ("M",)
    assert select_cases(prepared, [compound(iv=("Unknown",))]).kept.case_ids == ("L",)
    assert select_cases(prepared, [compound(iv=("true", None, "Unknown"))]).kept.case_ids == ("L", "M", "P", "T")
    assert select_cases(prepared, [compound(), ContainsActivity("Z")]).unevaluable.case_ids == ()


def test_exact_semantic_identity_invariant_to_condition_value_order_and_histories():
    prepared = source()
    first = compound(iv=(None, "true"))
    second = RecordAttributesAll(tuple(reversed((RecordAttributeCondition(1, ("true",)), RecordAttributeCondition(2, ("true", None))))))
    one = select_cases(prepared, [first], parent_ids=["U", "P", "K", "M"])
    reversed_histories = replace(prepared, histories={case: tuple(reversed(rows)) for case, rows in prepared.histories.items()})
    two = select_cases(reversed_histories, [second], parent_ids=["K", "M", "P", "U"])
    assert one.identity == two.identity
    assert one.predicate_results[0].record_evidence == two.predicate_results[0].record_evidence
    assert predicate_descriptor(second)["conditions"][0]["column_index"] == 2  # wire receipt preserves chosen order


@pytest.mark.parametrize("predicate", [RecordAttributesAll(()), RecordAttributesAll((RecordAttributeCondition(True, ("true",)),)),
    RecordAttributesAll((RecordAttributeCondition(1, ("",)),)), RecordAttributesAll((RecordAttributeCondition(1, ("true", "true")),)),
    RecordAttributesAll((RecordAttributeCondition(1, ("true",)), RecordAttributeCondition(1, ("false",)))),
    RecordAttributesAll((RecordAttributeCondition(99, ("true",)),)), RecordAttributesAll((RecordAttributeCondition(1, ("true",)),), negate="false"),
    RecordAttributesAll((RecordAttributeCondition(1, ("true",)),), policy_id="guess")])
def test_invalid_definition_is_refused_without_parent_changes(predicate):
    with pytest.raises(SelectionError) as error:
        select_cases(source(), [predicate])
    assert error.value.code == "invalid_predicate"


def test_schema_and_result_witnesses_are_closed_and_serializable():
    schema = json.loads((Path(__file__).resolve().parents[1] / "contracts/selection.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    result = select_cases(source(), [compound()]).to_dict()["predicate_results"][0]
    Draft202012Validator({"$ref": "#/$defs/PredicateResult", "$defs": schema["$defs"]}).validate(result)
    json.dumps(result, allow_nan=False)
    selection = select_cases(source(), [compound()])
    exported = selection.to_dict()
    exported["predicate_results"][0]["record_evidence"]["cases"][0]["matching_row_ids"].clear()
    assert len(selection.to_dict()["predicate_results"][0]["record_evidence"]["cases"][0]["matching_row_ids"]) == 1
