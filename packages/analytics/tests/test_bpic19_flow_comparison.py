"""Independent F11 subtype sides, unavailable outside support and shared documents."""
import csv
import io
from copy import deepcopy

from test_bpic19_profiles import ROLES, source
from test_csv_preparation_core import ready, choices
from wise_platform_analytics.bpic19_flow_comparison import POLICY_ID, compare_flow_subtypes
from wise_platform_analytics.bpic19_profiles import profile_bpic19
from wise_platform_analytics.mapping import ImportRefusal


def f11_source(shared_document=False,unknown=True):
    rows=list(csv.reader(io.StringIO(source().decode())))
    document='D1' if shared_document else 'D4';item='3' if shared_document else '1';case=document+'_'+item
    rows.append([case,'Record Invoice Receipt','2018-01-01T00:00:00','3-way match, invoice after GR','Standard','true','true',document,item,case])
    if unknown:rows.append(['Z_1','Observed','not-a-time','3-way match, invoice after GR','','true','true','Z','1','Z_1'])
    stream=io.StringIO();writer=csv.writer(stream);writer.writerows(rows);return stream.getvalue().encode()


def comparison_prepared(shared_document=False,unknown=True):
    return ready(f11_source(shared_document,unknown),delimiter=',',policies=choices('wall','iso8601'),mapping={'case_column':0,'activity_column':1,'timestamp_column':2,'sequence_column':None,'context_columns':list(range(3,10))})


def comparison_query(p,parent=None):
    q={'roles':ROLES,'profile_columns':None,'policy_id':'bpic19.all_raw_case_attributes.v1'}
    profile=profile_bpic19(p,ROLES,parent)
    return {'policy_id':POLICY_ID,'profile_definition_id':profile['definition_id'],'profile_query':q,
      'target':{'flow_id':'after_gr','item_type_state':'invariant','item_type_value':'Standard'},
      'reference':{'flow_id':'after_gr','item_type_state':'invariant','item_type_value':'Service'},
      'page':{'role':'target','offset':0,'limit':50}}


def test_f11_typed_sides_preserve_reviewed_parent_union_outside_and_unknown_grain():
    p=comparison_prepared();q=comparison_query(p);a=compare_flow_subtypes(p,q)
    assert a['parent']['case_count']==12 and a['parent']['record_count']==16
    assert a['flow_parent']['case_ids']==['D1_1','D4_1','Z_1']
    assert a['flow_parent']['record_count']==4 and a['flow_parent']['document_count']==3
    assert a['target']['case_ids']==['D4_1'] and a['target']['record_count']==1
    assert a['reference']['case_ids']==['D1_1'] and a['reference']['record_count']==2
    assert a['comparison_parent']['case_ids']==['D1_1','D4_1']
    assert a['outside']['case_ids']==a['unavailable']['case_ids']==['Z_1']
    assert a['shares']['target_item_share']==1/2 and a['shares']['target_record_share']==1/3
    assert a['documents']['union_document_count']==2 and a['documents']['overlap_document_count']==0
    assert a['definition']['target']==q['target'] and a['definition']['reference']==q['reference']
    assert a['page']['items'][0]['case_id']=='D4_1' and len(a['page']['items'][0]['witness_row_ids'])==1
    at_reference=deepcopy(q);at_reference['page']['role']='reference'
    b=compare_flow_subtypes(p,at_reference)
    assert b['definition_id']==a['definition_id']
    assert len(b['page']['items'][0]['witness_row_ids'])==2
    at_unknown=deepcopy(q);at_unknown['page']['role']='unavailable'
    unknown=compare_flow_subtypes(p,at_unknown)['page']['items'][0]
    assert unknown['case_id']=='Z_1' and unknown['item_type_state']=='missing'
    # Reviewing just the after parent changes source profile identity and never widens it.
    after=['D1_1','D4_1','Z_1'];small=comparison_query(p,after)
    child=compare_flow_subtypes(p,small,after)
    assert child['parent']['case_ids']==after and child['outside_flow']['case_count']==0
    assert isinstance(compare_flow_subtypes(p,q,after),ImportRefusal)


def test_document_overlap_swapped_definition_empty_side_and_presentation_page():
    p=comparison_prepared(shared_document=True,unknown=False);q=comparison_query(p);a=compare_flow_subtypes(p,q)
    assert a['target']['case_ids']==['D1_3'] and a['reference']['case_ids']==['D1_1']
    assert a['documents']['union_document_ids']==a['documents']['overlap_document_ids']==['D1']
    assert a['documents']['target_document_count']==a['documents']['reference_document_count']==1
    assert a['shares']['target_record_share']==1/3
    swapped=deepcopy(q);swapped['target'],swapped['reference']=swapped['reference'],swapped['target']
    b=compare_flow_subtypes(p,swapped);assert b['definition_id']!=a['definition_id']
    assert b['shares']['target_record_share']==2/3
    empty=deepcopy(q);empty['target']['item_type_value']='Not recorded';empty['reference']['item_type_value']='Another unknown'
    zero=compare_flow_subtypes(p,empty)
    assert zero['comparison_parent']['case_count']==0 and zero['shares']['target_item_share'] is None
    assert zero['shares']['reason']=='empty_comparison_parent'
    page=deepcopy(q);page['page']['offset']=100
    assert compare_flow_subtypes(p,page)['definition_id']==a['definition_id']
    same=deepcopy(q);same['reference']=deepcopy(same['target'])
    assert isinstance(compare_flow_subtypes(p,same),ImportRefusal)
