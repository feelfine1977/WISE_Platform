"""Literal independent endpoint histories: T07-AC09, gates, ties and whole items."""
import csv
import io
from copy import deepcopy

from wise_platform_analytics.bpic19_interval_comparison import POLICY_ID, compare_intervals
from wise_platform_analytics.bpic19_measures import derive_case_measures
from wise_platform_analytics.mapping import ImportRefusal
from test_csv_preparation_core import choices, ready

IR = 'Record Invoice Receipt'
CLEAR = 'Clear Invoice'


def interval_source():
    # Explicit raw input, not an expected-answer generator or a report-code run.
    triples = [
        ('T0', IR, '2018-01-01T00:00:00'), ('T0', IR, '2018-01-01T00:00:00'),
        ('T0', CLEAR, '2018-01-01T00:00:00'), ('T0', IR, '2018-01-05T00:00:00'), ('T0', IR, 'bad-time'),
        ('T1', IR, '2018-01-01T00:00:00'), ('T1', CLEAR, '2018-01-02T00:00:00'),
        ('T2', IR, '2018-01-01T00:00:00'), ('T2', CLEAR, '2018-01-03T00:00:00'),
        ('TM', IR, '2018-01-01T00:00:00'),
        ('R2', IR, '2018-01-01T00:00:00'), ('R2', CLEAR, '2018-01-03T00:00:00'),
        ('RN', IR, '2018-01-02T00:00:00'), ('RN', CLEAR, '2018-01-01T00:00:00'),
        ('OLD', IR, '2016-12-31T00:00:00'), ('OLD', IR, '2018-01-01T00:00:00'), ('OLD', CLEAR, '2018-01-03T00:00:00'),
        ('UPPER', IR, '2020-01-01T00:00:00'), ('UPPER', CLEAR, '2020-01-01T00:00:00'),
        ('UNKNOWN', IR, '2018-01-01T00:00:00'), ('UNKNOWN', CLEAR, '2018-01-02T00:00:00'), ('UNKNOWN', '', '2018-01-03T00:00:00'),
        ('BAD', IR, 'bad-time'), ('BAD', CLEAR, '2018-01-02T00:00:00'),
        ('OUTSIDE', 'Unrelated', '2018-01-01T00:00:00'),
    ]
    stream = io.StringIO(); writer = csv.writer(stream)
    writer.writerow(['Case', 'Activity', 'Time', 'Category', 'Subtype', 'GR', 'IV', 'Document', 'Item', 'Source case'])
    for cid, label, timestamp in triples:
        writer.writerow([cid, label, timestamp, '3-way match, invoice after GR', 'Standard', 'true', 'true', cid, '1', cid])
    return stream.getvalue().encode()


def interval_prepared(clock='wall'):
    return ready(interval_source(), delimiter=',', policies=choices(clock, 'iso8601'),
        mapping={'case_column':0,'activity_column':1,'timestamp_column':2,'sequence_column':None,'context_columns':list(range(3,10))})


def interval_query():
    return {'policy_id':POLICY_ID,'interval_policy':'independent_minimum','interval_source':[IR],'interval_target':[CLEAR],
        'target':{'label':'Target zero, one, two and missing','recipe':{'kind':'complete_case_ids','case_ids':['T0','T1','T2','TM']}},
        'reference':{'label':'Comparator two and reversed','recipe':{'kind':'complete_case_ids','case_ids':['R2','RN']}},
        'page':{'role':'target','offset':0,'limit':100}}


def test_literal_target_three_eligible_and_missing_reference_one_and_reversed():
    p=interval_prepared(); a=compare_intervals(p,interval_query())
    assert a['parent']['case_count']==11 and a['parent']['record_count']==25
    assert a['target']['case_count']==4 and a['target']['record_count']==10
    assert a['target']['summary']=={'available_case_count':3,'zero_case_count':1,'minimum':0,'maximum':2,'mean':1,'median':1,'reason':None,'unavailable_case_count':1}
    assert a['reference']['summary']=={'available_case_count':1,'zero_case_count':0,'minimum':2,'maximum':2,'mean':2,'median':2,'reason':None,'unavailable_case_count':1}
    assert a['target']['available_case_ids']==['T0','T1','T2'] and a['target']['zero_case_ids']==['T0']
    assert a['target']['unavailable_case_ids']==['TM'] and a['target']['unavailable_reasons']=={'no_parsed_endpoint':1}
    assert a['reference']['unavailable_case_ids']==['RN'] and a['reference']['unavailable_reasons']=={'reversed_interval':1}
    assert a['union_case_ids']==['R2','RN','T0','T1','T2','TM'] and a['overlap_case_ids']==[]
    assert a['outside_case_ids']==['BAD','OLD','OUTSIDE','UNKNOWN','UPPER']
    t0=a['page']['items'][0]
    assert t0['case_id']=='T0' and t0['record_count']==5 and len(t0['record_row_ids'])==5
    assert t0['interval']['value']==0 and t0['interval']['recorded_difference_days']==0
    assert len(t0['source']['row_ids'])==2 and len(t0['source']['later_row_ids'])==1 and len(t0['source']['unparseable_row_ids'])==1
    assert t0['source']['selected_row_id']==p.records[0].row_id
    assert t0['source']['row_ids']==[p.records[0].row_id,p.records[1].row_id]
    # Same admitted reducer, no actor/value role is needed and no later endpoint replaces minima.
    assert t0['interval']==derive_case_measures(p,'T0',{'activity':1})['measures']['selected_interval']


def test_local_range_missing_time_unknown_activity_and_direction_states():
    p=interval_prepared();q=interval_query();q['target']['recipe']['case_ids']=['BAD','OLD','UNKNOWN','UPPER'];q['reference']['recipe']['case_ids']=['RN']
    a=compare_intervals(p,q);items={row['case_id']:row for row in a['page']['items']}
    assert a['target']['summary']['available_case_count']==0 and a['target']['summary']['zero_case_count']==0
    assert a['target']['summary']['median'] is None and a['target']['summary']['unavailable_case_count']==4
    assert items['OLD']['source']['timestamp']=='2016-12-31T00:00:00'
    assert items['OLD']['source']['endpoint_state']=='out_of_range' and len(items['OLD']['source']['later_row_ids'])==1
    assert items['OLD']['interval']['reason']=='minimum_outside_admissible_range'
    assert items['UPPER']['source']['endpoint_state']=='out_of_range' and items['UPPER']['interval']['recorded_difference_days']==0
    assert items['UPPER']['interval']['value'] is None  # Out-of-range equality is not an admitted zero.
    assert items['UNKNOWN']['source']['endpoint_state']=='unknown_activity' and len(items['UNKNOWN']['source']['unknown_activity_row_ids'])==1
    assert items['UNKNOWN']['interval']['reason']=='missing_activity_label'
    assert items['BAD']['source']['timestamp'] is None and len(items['BAD']['source']['unparseable_row_ids'])==1
    assert items['BAD']['interval']['reason']=='no_parsed_endpoint'
    q['page']['role']='reference';r=compare_intervals(p,q)['page']['items'][0]
    assert r['interval']['value'] is None and r['interval']['recorded_difference_days']==-1 and r['interval']['interval_state']=='reversed'


def test_same_parent_recipe_overlap_empty_swap_and_page_identity_are_explicit():
    p=interval_prepared();q=interval_query();a=compare_intervals(p,q)
    page=deepcopy(q);page['page']={'role':'reference','offset':1,'limit':1}
    b=compare_intervals(p,page);assert b['definition_id']==a['definition_id'] and b['page']['items'][0]['case_id']=='RN'
    permutation=deepcopy(q);permutation['target']['recipe']['case_ids'].reverse()
    assert compare_intervals(p,permutation)['definition_id']==a['definition_id']
    overlap=deepcopy(q);overlap['reference']['recipe']['case_ids']=['T2','RN']
    c=compare_intervals(p,overlap);assert c['overlap_case_ids']==['T2'] and len(c['union_case_ids'])==5
    assert c['target']['summary']['available_case_count']==3 and c['reference']['summary']['available_case_count']==1
    swapped=deepcopy(q);swapped['target'],swapped['reference']=swapped['reference'],swapped['target']
    assert compare_intervals(p,swapped)['definition_id']!=a['definition_id']
    empty=deepcopy(q);empty['target']['recipe']['case_ids']=[]
    zero=compare_intervals(p,empty);assert zero['target']['case_count']==0 and zero['target']['summary']['median'] is None
    assert zero['target']['summary']['reason']=='empty_eligible_support' and zero['page']['items']==[]
    assert compare_intervals(interval_prepared('fixed'),q)['definition_id']!=a['definition_id']
    changed=deepcopy(q);changed['interval_source']=['Unrelated']
    assert compare_intervals(p,changed)['definition_id']!=a['definition_id']
    child=compare_intervals(p,q,['R2','RN','T0','T1','T2','TM'])
    assert child['definition_id']!=a['definition_id'] and child['parent']['case_count']==6


def test_memberships_policies_and_pages_refuse_without_widening_parent():
    p=interval_prepared();q=interval_query()
    for field,value in [('foreign',['never-in-dictionary']),('duplicate',['T0','T0'])]:
        bad=deepcopy(q);bad['target']['recipe']['case_ids']=value
        refusal=compare_intervals(p,bad);assert isinstance(refusal,ImportRefusal)
        assert refusal.field=='query.target.recipe.case_ids'
    assert isinstance(compare_intervals(p,q,['T0','T1']),ImportRefusal)
    for field,value in [('interval_policy','first_after'),('interval_source',[]),('page',{'role':'target','offset':True,'limit':1})]:
        bad=deepcopy(q);bad[field]=value;assert isinstance(compare_intervals(p,bad),ImportRefusal)
