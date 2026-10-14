"""Literal cumulative support, distinct from independent predicate support."""
import pytest
from literal_logs import prepared_from
from wise_platform_analytics.selection import ContainsActivity, DirectlyFollows, select_cases, SelectionError

def prepared():
    return prepared_from(["Case;Activity;At;Desk;Priority", "A;Opened;2026-10-09T08:00:00Z;East;1", "A;Assigned;2026-10-09T09:00:00Z;East;1", "A;Resolved;2026-10-09T11:00:00Z;East;1", "B;Opened;2026-10-09T08:00:00Z;West;2", "B;Resolved;2026-10-09T08:30:00Z;West;2", "C;Opened;2026-10-09T08:00:00Z;West;2", "C;Assigned;2026-10-09T10:00:00Z;West;2", "C;Assigned;2026-10-09T12:00:00Z;West;2", "D;Opened;not-a-time;Unknown;3", "D;Assigned;2026-10-09T09:00:00Z;Unknown;3"])

def test_prefixes_have_literal_raw_support_and_false_dominates_unknown():
    p=prepared(); steps=[DirectlyFollows("Opened", "Resolved"), ContainsActivity("Resolved")]
    result=select_cases(p, steps)
    first, second=result.step_results
    assert first.to_dict()["kept"] == {"case_ids":["B"],"case_count":1,"record_count":2}
    assert first.to_dict()["removed"] == {"case_ids":["A","C"],"case_count":2,"record_count":6}
    assert first.to_dict()["unevaluable"] == {"case_ids":["D"],"case_count":1,"record_count":2}
    assert second.to_dict()["kept"] == {"case_ids":["B"],"case_count":1,"record_count":2}
    assert second.to_dict()["removed"] == {"case_ids":["A","C","D"],"case_count":3,"record_count":8}
    assert second.unevaluable.case_ids == ()
    assert result.predicate_results[1].kept.case_ids == ("A","B")
    assert [s.step_number for s in result.step_results] == [1,2]

@pytest.mark.parametrize("active", [0,1,2])
def test_active_identity_is_standalone_prefix_even_with_future_steps(active):
    p=prepared();steps=[DirectlyFollows("Opened","Resolved"),ContainsActivity("Resolved")]
    result=select_cases(p,steps,active_step_count=active);plain=select_cases(p,steps[:active])
    assert result.identity_dict()==plain.identity_dict()
    assert (result.kept,result.removed,result.unevaluable)==(plain.kept,plain.removed,plain.unevaluable)
    assert result.active_step_count==active and len(result.step_results)==2

def test_reordering_changes_prefixes_not_final_identity_and_duplicates_remain_ordered():
    p=prepared(); a=ContainsActivity("Resolved");b=DirectlyFollows("Opened","Resolved")
    left=select_cases(p,[a,b]);right=select_cases(p,[b,a]);dup=select_cases(p,[a,a])
    assert left.identity_dict()==right.identity_dict()
    assert left.step_results[0].kept.case_ids == ("A","B")
    assert right.step_results[0].kept.case_ids == ("B",)
    assert [s.kept.case_ids for s in dup.step_results] == [("A","B"),("A","B")]
    assert dup.identity_dict()==select_cases(p,[a]).identity_dict()

def test_empty_trail_empty_and_subset_parent_keep_original_raw_records():
    p=prepared(); steps=[ContainsActivity("Assigned"),DirectlyFollows("Opened","Resolved")]
    empty=select_cases(p);assert empty.active_step_count==0 and empty.step_results==()
    assert empty.kept.record_count==10
    subset=select_cases(p,steps,["D","A"])
    assert subset.parent.case_ids==("A","D") and subset.parent.record_count==5
    assert subset.step_results[0].kept.case_ids==("A","D") and subset.step_results[0].kept.record_count==5
    assert subset.step_results[1].removed.case_ids==("A",) and subset.step_results[1].unevaluable.case_ids==("D",)
    none=select_cases(p,steps,[])
    assert all(s.kept.record_count==s.removed.record_count==s.unevaluable.record_count==0 for s in none.step_results)

@pytest.mark.parametrize("active", [True,False,1.0,0.5,-1,3,"1"])
def test_invalid_active_counts_are_refused_before_selection(active):
    with pytest.raises(SelectionError) as caught:select_cases(prepared(),[ContainsActivity("Assigned"),ContainsActivity("Resolved")],active_step_count=active)
    assert caught.value.field=="active_step_count"


def test_each_prefix_record_support_includes_unlabelled_raw_records():
    p=prepared_from(["Case;Activity;At;Desk;Priority", "X;A;2026-10-09T08:00:00Z;East;1", "X;;2026-10-09T09:00:00Z;East;1", "X;B;2026-10-09T10:00:00Z;East;1", "Y;B;2026-10-09T08:00:00Z;West;2"])
    result=select_cases(p,[ContainsActivity("A"),DirectlyFollows("A","B")])
    assert [step.kept.to_dict() for step in result.step_results] == [
        {"case_ids":["X"],"case_count":1,"record_count":3},
        {"case_ids":["X"],"case_count":1,"record_count":3}]
