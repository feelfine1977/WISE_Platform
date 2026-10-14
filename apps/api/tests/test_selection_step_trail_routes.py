"""The new cursor and full-trail supports pass the strict real HTTP boundary."""
import pytest
from test_selection_routes import client,workspace_id,base,selection_request,contains,follows,SELECT,VALIDATOR,graph_of

@pytest.mark.parametrize("active", [None,0,1,2])
def test_supplied_full_trail_with_active_prefix_identity(client,workspace_id,base,active):
    steps=[follows("Opened","Resolved"),contains("Resolved")]
    request=selection_request(workspace_id,base["identity"],steps)
    if active is not None:request["active_step_count"]=active
    response=client.post(SELECT,json=request);assert response.status_code==200,response.text
    answer=response.json();VALIDATOR.validate(answer)
    count=2 if active is None else active
    assert answer["active_step_count"]==count and len(answer["step_results"])==2
    assert answer["step_results"][0]["kept"]=={"case_ids":["B"],"case_count":1,"record_count":2}
    assert answer["step_results"][1]["removed"]=={"case_ids":["A","C","D"],"case_count":3,"record_count":8}
    assert answer["predicate_results"][1]["kept"]["case_ids"]==["A","B"]
    assert [s["step_number"] for s in answer["step_results"]]==[1,2]
    plain=client.post(SELECT,json=selection_request(workspace_id,base["identity"],steps[:count])).json()
    assert answer["identity"]==plain["identity"]
    assert graph_of(client,workspace_id,answer["identity"])["meta"]["selected_case_ids"]==answer["kept"]["case_ids"]

@pytest.mark.parametrize("active", [None,True,False,0.5,1.0,-1,3,"1"])
def test_explicit_invalid_cursor_is_a_typed_refusal(client,workspace_id,base,active):
    request=selection_request(workspace_id,base["identity"],[contains("Assigned"),contains("Resolved")]);request["active_step_count"]=active
    response=client.post(SELECT,json=request);answer=response.json();VALIDATOR.validate(answer)
    assert response.status_code==400 and answer["message_type"]=="selection_refusal",answer
    assert answer["code"]=="invalid_request" and answer["field"]=="active_step_count"
