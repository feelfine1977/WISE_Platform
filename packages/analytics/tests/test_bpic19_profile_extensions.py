"""Independent literal omitted values, zero cells and reported population claims."""
import csv
import io

from test_bpic19_profiles import HEADERS, ROLES, prepared, keyed, source_definition
from test_csv_preparation_core import ready, choices
from wise_platform_analytics.bpic19_profiles import profile_bpic19
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.selection import CaseIdIn, select_cases


def many_values_source():
    stream=io.StringIO();writer=csv.writer(stream);writer.writerow([*HEADERS,"event reviewed attribute"])
    for n in range(12):
        for day in (1,2):
            writer.writerow([f"D{n}_1","Observed",f"2018-01-0{day}T00:00:00","3-way match, invoice before GR","Standard","true","false",f"D{n}","1",f"D{n}_1",f"common-{n:02d}"])
    writer.writerow(["D12_1","Observed","2018-01-01T00:00:00","3-way match, invoice before GR","Standard","true","false","D12","1","D12_1","z-singleton"])
    writer.writerow(["D12_1","Unrelated","2018-01-02T00:00:00","3-way match, invoice before GR","Standard","true","false","D12","1","D12_1","common-00"])
    return stream.getvalue().encode()


def many_values_prepared():
    return ready(many_values_source(),delimiter=",",policies=choices("wall","iso8601"),mapping={"case_column":0,"activity_column":1,"timestamp_column":2,"sequence_column":None,"context_columns":list(range(3,11))})


def view(offset=0,select=False,value=None):
    return {"column_index":10,"offset":offset,"limit":12,"select_value":select,"value":value}


def test_all_values_page_including_singleton_keep_full_history_and_page_identity():
    p=many_values_prepared()
    first=profile_bpic19(p,ROLES,profile_columns=[10],attribute_view=view())
    last=profile_bpic19(p,ROLES,profile_columns=[10],attribute_view=view(12))
    assert first['definition_id']==last['definition_id']
    assert first['population']['case_count']==13 and first['population']['record_count']==26
    assert first['attribute_view']['total_value_count']==13
    assert first['attribute_view']['next_offset']==12
    assert last['attribute_view']['values']==[{'value':'z-singleton','case_count':1,'record_count':1,'document_count':1,'example_case_ids':['D12_1']}]
    selected=profile_bpic19(p,ROLES,profile_columns=[10],attribute_view=view(12,True,'z-singleton'))
    membership=selected['attribute_view']['selection']
    assert membership['case_ids']==['D12_1'] and membership['record_count']==2
    assert membership['witnesses'][0]['row_ids']==[p.records[24].row_id]
    assert selected['definition']['attribute_selection']=={'column_index':10,'value':'z-singleton','policy_id':'bpic19.any_original_record_exact_value.v1'}
    assert selected['definition_id']!=first['definition_id']
    kept=select_cases(p,[CaseIdIn(('D12_1',),False)])
    assert kept.kept.record_count==2
    assert [row.original_cells[10] for row in p.histories['D12_1']]==['z-singleton','common-00']
    assert isinstance(profile_bpic19(p,ROLES,attribute_view={**view(),'column_index':100}),ImportRefusal)


def test_known_zero_subtype_cells_and_column_totals_keep_unresolved_counts_separate():
    a=profile_bpic19(prepared(),ROLES,include_zero_cells=True)
    cells={(c['flow_id'],c['item_type_value']):c for c in a['flow_item_types'] if c['item_type_state']=='invariant'}
    assert cells[('after_gr','Standard')]['case_count']==0
    assert cells[('after_gr','Service')]['case_count']==1
    assert cells[('consignment','Service')]['case_count']==0
    assert keyed(a['item_type_totals'],'item_type_value')['Standard']['case_ids']==['B_1','D1_2','F_1','G_1']
    assert sum(total['case_count'] for total in a['item_type_totals'])==7
    assert a['partition']['unresolved_case_count']==3
    without=profile_bpic19(prepared(),ROLES)
    assert without['definition_id']==a['definition_id'] # Zero-cell presentation does not redefine membership.


def reported_definition():
    d=source_definition(clock='wall_clock')
    d['reported_populations']=[
      {'label':'Complete','count':190283,'grain':'po_item','reference':'Meyer et al., merged PDF82','denominator':'Authors\' reported complete population','parent_label':None},
      {'label':'Compliant model-training','count':189584,'grain':'po_item','reference':'Meyer et al., merged PDF82','denominator':'Subset of Complete','parent_label':'Complete'},
      {'label':'Complete but incompliant','count':699,'grain':'po_item','reference':'Meyer et al., merged PDF82','denominator':'Subset of Complete','parent_label':'Complete'}]
    return d


def test_reported_complete_and_compliant_training_are_claims_not_measured_membership():
    p=prepared();d=reported_definition();a=profile_bpic19(p,ROLES,source_interpretation=d)
    assert a['population']['case_count']==10
    claims=a['source_review']['reported_populations']
    assert [figure['count'] for figure in claims]==[190283,189584,699]
    assert all(figure['claim_status']=='reported_source_claim' for figure in claims)
    assert claims[1]['parent_label']==claims[2]['parent_label']=='Complete'
    assert 189584+699==190283
    changed=reported_definition();changed['reported_populations'][2]['count']=700
    assert profile_bpic19(p,ROLES,source_interpretation=changed)['definition_id']!=a['definition_id']
    bad=reported_definition();bad['reported_populations'][1]['parent_label']='Invented'
    assert isinstance(profile_bpic19(p,ROLES,source_interpretation=bad),ImportRefusal)


def test_requested_document_siblings_are_outside_parent_without_widening_totals():
    p=prepared();a=profile_bpic19(p,ROLES,['D1_1'],include_document_siblings=True)
    assert a['population']['case_count']==1 and a['population']['record_count']==2 and a['population']['document_count']==1
    sibling=a['grain']['outside_parent_siblings']
    assert sibling['case_ids']==['D1_2'] and sibling['record_count']==2 and sibling['document_count']==1
    assert a['definition_id']==profile_bpic19(p,ROLES,['D1_1'])['definition_id']
