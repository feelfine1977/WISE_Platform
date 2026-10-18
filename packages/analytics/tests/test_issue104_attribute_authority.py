"""Independent raw actor/value support and profile identity at the public seam."""

from copy import deepcopy
import hashlib
import json

import pytest

from test_csv_preparation_core import choices, ready
from wise_platform_analytics.bpic19_profiles import profile_bpic19
from wise_platform_analytics.mapping import ImportRefusal


ROLES = {"item_category": 3, "item_type": 4, "goods_receipt": 5,
         "gr_based_iv": 6, "purchasing_document": 7, "item": 8, "source_case": 9}
RAW = b'''case_id,activity,time,case Item Category,case Item Type,case Goods Receipt,case GR-Based Inv. Verif.,case Purchasing Document,case Item,case concept:name,event resource,event amount
001_1,Opened,2018-01-01T00:00:00,2-way match,Limit,false,false,001,1,001_1,user_1,100
001_1,Changed,not-a-time,2-way match,Limit,false,false,001,1,001_1,batch_2,200
1_1,Opened,,2-way match,Limit,false,false,1,1,1_1,user_1,100
'''
EXPECTED_SOURCE_ID = "source.v1:sha256:" + hashlib.sha256(RAW).hexdigest()
EXPECTED_CHANGED_ROW_ID = "row.v1:sha256:" + hashlib.sha256(json.dumps({
    "format_version": 1, "source_id": EXPECTED_SOURCE_ID, "source_position": 1,
}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@pytest.fixture
def source():
    return ready(RAW, delimiter=",", policies=choices("wall", "iso8601"),
                 mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2,
                          "sequence_column": None, "context_columns": list(range(3, 12))})


@pytest.mark.parametrize("column,expected", [(10, ["user_1", "batch_2"]), (11, ["100", "200"])])
def test_varying_actor_and_amount_keep_raw_values_and_exact_complete_item(source, column, expected):
    answer = profile_bpic19(source, ROLES, profile_columns=[column])
    assert answer["population"] == {"case_count": 2, "record_count": 3,
                                    "document_count": 2, "document_unknown_case_count": 0}
    attribute = next(field for field in answer["attributes"] if field["column_index"] == column)
    assert attribute["distinct_nonmissing_value_count"] == 2
    assert (attribute["invariant_case_count"], attribute["missing_case_count"],
            attribute["conflicting_case_count"]) == (1, 0, 1)
    assert [(value["value"], value["case_count"], value["record_count"], value["document_count"])
            for value in attribute["values"]] == [(expected[0], 2, 2, 2), (expected[1], 1, 1, 1)]
    assert [(row["source_position"], row["value"]) for row in attribute["conflicting_witnesses"][0]["rows"]] == [
        (0, expected[0]), (1, expected[1])]
    assert attribute["conflicting_witnesses"][0]["case_id"] == "001_1"
    selected = profile_bpic19(source, ROLES, profile_columns=[column], attribute_view={
        "column_index": column, "offset": 1, "limit": 1, "select_value": True, "value": expected[1]})
    support = selected["attribute_view"]["selection"]
    assert (support["case_ids"], support["case_count"], support["record_count"], support["document_count"]) == (
        ["001_1"], 1, 2, 1)
    assert selected["definition"]["attribute_selection"] == {
        "column_index": column, "value": expected[1], "policy_id": "bpic19.any_original_record_exact_value.v1"}
    assert selected["definition"]["roles"] == ROLES
    assert support["witnesses"][0]["case_id"] == "001_1"
    assert support["witnesses"][0]["row_ids"] == [EXPECTED_CHANGED_ROW_ID]
    assert selected["attribute_view"]["total_value_count"] == 2
    assert selected["definition_id"] != answer["definition_id"]


def test_presentation_does_not_redefine_but_roles_parent_and_profiled_columns_do(source):
    original = profile_bpic19(source, ROLES, profile_columns=[10, 11])
    snapshot = deepcopy(original)
    presented = profile_bpic19(source, ROLES, profile_columns=[11, 10],
                              include_zero_cells=True, include_document_siblings=True,
                              attribute_view={"column_index": 10, "offset": 1, "limit": 1,
                                              "select_value": False, "value": None})
    assert presented["definition_id"] == original["definition_id"]
    parent = profile_bpic19(source, ROLES, ["001_1"], profile_columns=[10, 11])
    assert parent["population"] == {"case_count": 1, "record_count": 2,
                                  "document_count": 1, "document_unknown_case_count": 0}
    changed = profile_bpic19(source, {**ROLES, "item_category": 10}, profile_columns=[10, 11])
    assert next(group for group in changed["unresolved"] if group["state"] == "conflicting")["case_ids"] == ["001_1"]
    assert next(group for group in changed["unresolved"] if group["state"] == "unrecognized")["case_ids"] == ["1_1"]
    fewer_columns = profile_bpic19(source, ROLES, profile_columns=[10])
    assert fewer_columns["definition"]["profile_columns"] == [3, 4, 5, 6, 7, 8, 9, 10]
    assert len({original["definition_id"], parent["definition_id"], changed["definition_id"],
                fewer_columns["definition_id"]}) == 4
    assert original == snapshot
    assert profile_bpic19(source, ROLES, profile_columns=[10, 11]) == snapshot


@pytest.mark.parametrize("roles,columns,code,field", [
    ({**ROLES, "item_category": None}, [10], "invalid_parameter", "query.roles.item_category"),
    ({**ROLES, "purchasing_document": 8}, [10], "invalid_parameter", "query.roles"),
    (ROLES, [10, 10], "invalid_parameter", "query.profile_columns"),
    (ROLES, [True], "invalid_parameter", "query.profile_columns"),
])
def test_binding_and_profile_column_refusal_codes_and_fields(source, roles, columns, code, field):
    before = profile_bpic19(source, ROLES, profile_columns=[10, 11])
    refused = profile_bpic19(source, roles, profile_columns=columns)
    assert isinstance(refused, ImportRefusal)
    assert (refused.code, refused.field) == (code, field)
    assert profile_bpic19(source, ROLES, profile_columns=[10, 11]) == before
