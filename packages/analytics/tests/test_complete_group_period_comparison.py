"""Literal descriptive cohorts, chronology coverage and complete history support."""
from copy import deepcopy

import pytest

from wise_platform_analytics.comparison import compare_groups, compare_periods
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.preparation import prepare
from wise_platform_analytics.prepared_operations import open_prepared_case
from wise_platform_analytics.selection import OPENING_CONTEXT_POLICY, select_cases
from test_csv_preparation_core import choices, dialect, roles

RAW=b'''Case,Activity,At,Team,Service,Priority
G01,Opened,2026-10-01T08:00:00Z,A,ERP,High
G01,Resolved,2026-10-01T11:00:00Z,A,ERP,High
G02,Opened,2026-10-01T09:00:00Z,A,ERP,High
G02,Assigned,2026-10-01T10:00:00Z,B,ERP,High
G02,Resolved,2026-10-01T13:00:00Z,B,ERP,High
G03,Opened,2026-10-02T08:00:00Z,B,CRM,Low
G03,Resolved,2026-10-02T13:00:00Z,B,CRM,Low
G04,Opened,2026-10-02T09:00:00Z,B,,High
G04,Reviewed,2026-10-02T10:00:00Z,B,ERP,High
G05,Opened,2026-10-09T08:00:00Z,A,ERP,Low
G05,Resolved,2026-10-09T15:00:00Z,A,ERP,Low
G06,Opened,2026-10-10T11:00:00Z,B,CRM,Low
G06,Reviewed,2026-10-10T11:15:00Z,B,CRM,Low
G07,Opened,2026-10-09T23:00:00Z,Unknown,Unknown,Unknown
G07,Resolved,2026-10-10T02:00:00Z,Unknown,Unknown,Unknown
G08,Opened,2026-10-02T08:00:00Z,,,High
G08,Assigned,2026-10-02T08:30:00Z,A,ERP,High
G08,Resolved,2026-10-02T09:00:00Z,A,ERP,High
'''


def prepared(raw=RAW,wall=False,cutoff='2026-10-10T12:00:00Z',context=(3,4,5)):
    p=choices('wall' if wall else 'recorded','iso8601')
    p['time']['parameters']['snapshot_cutoff_local' if wall else 'snapshot_cutoff_utc']=cutoff
    r=prepare(raw,dialect('utf-8',','),roles(context=context),p,True)
    assert r.state=='ready'; return r.preparation


def explicit(target=('G01','G02','G05','G08'),reference=('G02','G03','G04','G06')):
    def group(name,ids):return {'name':name,'definition':{'kind':'explicit_case_ids','case_ids':list(ids)}}
    return {'mode':'two_named_groups','target':group('Group A',target),'reference':group('Group B',reference)}


def opening(column,value,negate=False):
    return {'kind':'opening_attribute_equals','column_index':column,'value':value,'negate':negate,'anchor_policy':OPENING_CONTEXT_POLICY}


def windows(wall=False,endpoint='Resolved',minimum=4):
    kind='wall_clock' if wall else 'utc_instant'; suffix='' if wall else 'Z'
    def period(name,start,end):return {'name':name,'window':{'timestamp_kind':kind,'start_inclusive':start+suffix,'end_exclusive':end+suffix}}
    return {'target':period('Early','2026-10-01T00:00:00','2026-10-03T00:00:00'),
            'reference':period('Latest','2026-10-09T00:00:00','2026-10-11T00:00:00'),
            'minimum_followup_hours':minimum,'endpoint_activity':endpoint}


def call(p,d,parent=None,column=4,periods=False,identity=None,policy=OPENING_CONTEXT_POLICY):
    return (compare_periods if periods else compare_groups)(p,p.identity_dict() if identity is None else identity,parent,column,policy,d)


def assert_partitions(a):
    parent=set(a['parent']['case_ids'])
    for role in ('target','reference'):
        groups=[set(a[role][key]['case_ids']) for key in ('included','excluded','unevaluable')]
        assert set.union(*groups)==parent and sum(map(len,groups))==len(parent)
        assert sum(a[role][key]['record_count'] for key in ('included','excluded','unevaluable'))==a['parent']['record_count']
    groups=[set(s['case_ids']) for s in a['pair_support'].values()]
    assert set.union(*groups)==parent and sum(map(len,groups))==len(parent)
    assert sum(s['record_count'] for s in a['pair_support'].values())==a['parent']['record_count']


def test_literal_overlapping_groups_profiles_and_actual_empty_recipe_identity():
    p=prepared(); a=call(p,explicit()); assert_partitions(a)
    assert a['parent']=={'case_ids':[f'G{i:02}' for i in range(1,9)],'case_count':8,'record_count':18}
    assert a['target']['included']=={'case_ids':['G01','G02','G05','G08'],'case_count':4,'record_count':10}
    assert a['reference']['included']=={'case_ids':['G02','G03','G04','G06'],'case_count':4,'record_count':9}
    assert a['pair_support']['overlap']=={'case_ids':['G02'],'case_count':1,'record_count':3}
    assert a['pair_support']['neither']=={'case_ids':['G07'],'case_count':1,'record_count':2}
    for field,ids in [('parent_identity',tuple(p.histories))]:assert a[field]==select_cases(p,[],ids).identity_dict()
    for role in ('target','reference'):assert a[role]['identity']==select_cases(p,[],a[role]['included']['case_ids']).identity_dict()
    c={r['value']:r for r in a['context_profile']['categories']}
    assert set(c)=={None,'CRM','ERP','Unknown'} and len(a['context_profile']['categories'])==4
    assert c[None]['parent']['case_count']==2 and c['Unknown']['parent']['case_count']==1
    assert c['ERP']['target']=={'case_count':3,'denominator':4,'share':{'status':'available','value':0.75}}
    assert c['ERP']['difference_percentage_points']=={'status':'available','value':50}
    assert c['ERP']['concentration_ratio']=={'status':'available','value':3}
    assert c['CRM']['concentration_ratio']=={'status':'available','value':0}
    assert c['Unknown']['concentration_ratio']=={'status':'unavailable','reason':'zero_reference_share'}


def test_predicate_groups_preserve_missing_opening_context_and_fixed_parent():
    p=prepared(); d={'mode':'two_named_groups','target':{'name':'ERP','definition':{'kind':'predicates','predicates':[opening(4,'ERP')]}},'reference':{'name':'High','definition':{'kind':'predicates','predicates':[opening(5,'High')]}}}
    a=call(p,d); assert_partitions(a)
    assert a['target']['included']=={'case_ids':['G01','G02','G05'],'case_count':3,'record_count':7}
    assert a['reference']['included']=={'case_ids':['G01','G02','G04','G08'],'case_count':4,'record_count':10}
    assert a['pair_support']['overlap']['case_ids']==['G01','G02']
    assert a['pair_support']['neither']['case_ids']==['G03','G06','G07']
    a=call(p,explicit(['G01'],['G02']),parent=['G02','G01'])
    assert a['parent']['record_count']==5 and a['context_profile']['parent_fixed']=={'status':'fixed','value':'ERP','reason':None}
    a=call(p,explicit(['G04'],['G08']),parent=['G04','G08'])
    assert a['context_profile']['parent_fixed']=={'status':'fixed','value':None,'reason':None}


def test_empty_cohorts_and_explicit_empty_parent_do_not_invent_zero_denominators():
    p=prepared(); a=call(p,explicit(['G01'],[])); assert_partitions(a)
    for c in a['context_profile']['categories']:
        assert c['reference']['share']=={'status':'unavailable','reason':'empty_profile_denominator'}
        assert c['difference_percentage_points']==c['concentration_ratio']=={'status':'unavailable','reason':'empty_reference_profile'}
    a=call(p,explicit([],[]),parent=[]); assert_partitions(a)
    assert a['parent']=={'case_ids':[],'case_count':0,'record_count':0} and a['context_profile']['categories']==[]
    assert a['context_profile']['parent_fixed']=={'status':'unavailable','value':None,'reason':'empty_parent'}
    assert a['parent_identity']==select_cases(p,[],[]).identity_dict()


def test_known_inclusion_unknown_other_role_and_partition_negation_preserve_u():
    raw=b'Case,Activity,At,Context\nA,Observed,2026-10-09T08:00:00Z,\nA,Updated,2026-10-09T09:00:00Z,Later\nB,Observed,2026-10-09T08:00:00Z,Unknown\nU,Observed,2026-10-09T08:00:00Z,Unknown\nU,Updated,bad-time,Unknown\n'
    p=prepared(raw,context=(3,)); d=explicit(['A','B','U'],[])
    d['reference']['definition']={'kind':'predicates','predicates':[opening(3,'Unknown')]}
    a=call(p,d,column=3); assert_partitions(a)
    assert a['target']['included']['case_count']==3 and a['reference']['included']['case_ids']==['B']
    assert a['pair_support']['unevaluable']=={'case_ids':['U'],'case_count':1,'record_count':2}
    c={r['value']:r for r in a['context_profile']['categories']}
    assert c[None]['target']['denominator']==c['Unknown']['target']['denominator']==2
    assert c[None]['target']['share']['value']==c['Unknown']['target']['share']['value']==0.5
    assert a['context_profile']['parent_fixed']['reason']=='unevaluable_context'
    d={'mode':'selection_partition','target_name':'Kept','reference_name':'Removed','predicates':[opening(3,'Unknown')],'target_side':'kept'}
    a=call(p,d,column=3); assert_partitions(a)
    assert a['target']['included']['case_ids']==['B'] and a['reference']['included']['case_ids']==['A']
    assert a['target']['unevaluable']['case_ids']==a['reference']['unevaluable']['case_ids']==['U']
    d['target_side']='removed'; b=call(p,d,column=3)
    assert b['target']['included']==a['reference']['included'] and b['comparison_id']!=a['comparison_id']
    d['predicates']=[opening(3,'Unknown',True)]
    assert call(p,d,column=3)['target']['unevaluable']['case_ids']==['U']
    # False dominates unknown; the U case lacks this known raw label.
    d['predicates'].append({'kind':'contains_activity','activity':'never present','negate':False})
    assert call(p,d,column=3)['pair_support']['unevaluable']['case_ids']==[]


def test_half_open_periods_full_histories_declared_cutoff_and_equality():
    p=prepared(); a=call(p,windows(),periods=True); assert_partitions(a)
    assert a['target']['included']=={'case_ids':['G01','G02','G03','G04','G08'],'case_count':5,'record_count':12}
    assert a['reference']['included']=={'case_ids':['G05','G06','G07'],'case_count':3,'record_count':6}
    assert {c['case_id']:c['followup_hours'] for c in a['reference']['exposure']['cases']}=={'G05':28,'G06':1,'G07':13}
    assert a['reference']['exposure']['inadequate']['case_ids']==['G06']
    assert a['reference']['endpoint_coverage']['recorded']['case_ids']==['G05','G07']
    assert a['reference']['endpoint_coverage']['not_recorded']['case_ids']==['G06']
    d=windows(); d['reference']['window']['end_exclusive']='2026-10-10T00:00:00Z'
    b=call(p,d,periods=True); assert b['reference']['included']['case_ids']==['G05','G07']
    history=open_prepared_case(p,p.identity_dict(),'G07')
    assert [r['activity'] for r in history['records']]==['Opened','Resolved'] and history['records'][-1]['utc_instant']=='2026-10-10T02:00:00Z'
    d=windows(); d['target']['window'].update(start_inclusive='2026-10-01T08:00:00Z',end_exclusive='2026-10-01T09:00:00Z')
    d['reference']['window'].update(start_inclusive='2026-10-01T09:00:00Z',end_exclusive='2026-10-02T08:00:00Z')
    b=call(p,d,periods=True); assert b['target']['included']['case_ids']==['G01'] and b['reference']['included']['case_ids']==['G02']
    assert call(p,windows(minimum=1),periods=True)['reference']['exposure']['inadequate']['case_ids']==[]
    later=prepared(cutoff='2026-10-10T15:00:00Z')
    assert call(later,windows(),periods=True)['reference']['exposure']['inadequate']['case_ids']==[]


def test_wall_clock_no_timezone_fabrication_generic_labels_and_nullable_endpoint():
    raw=b'Case,Activity,At,Context\nA,Observed,2026-10-09T08:00:00,Known\nA,Updated,2026-10-09T09:00:00,Known\nB,Observed,2026-10-10T11:00:00,Known\n'
    p=prepared(raw,wall=True,cutoff='2026-10-10T12:00:00',context=(3,))
    d=windows(wall=True,endpoint=None); d['target']['window'].update(start_inclusive='2026-10-09T08:00:00',end_exclusive='2026-10-10T11:00:00')
    d['reference']['window']['start_inclusive']='2026-10-10T11:00:00'
    a=call(p,d,column=3,periods=True); assert_partitions(a)
    assert a['target']['included']['case_ids']==['A'] and a['reference']['included']['case_ids']==['B']
    assert a['followup_clock']['duration_clock']=='recorded_wall_clock_hours' and a['followup_clock']['clock_limitation']
    assert a['followup_clock']['snapshot_cutoff']=={'timestamp_kind':'wall_clock','utc_instant':None,'local_timestamp':'2026-10-10T12:00:00'}
    assert a['target']['endpoint_coverage'] is a['reference']['endpoint_coverage'] is None
    assert all(e['case_start']['utc_instant'] is None for role in ('target','reference') for e in a[role]['exposure']['cases'])


def test_semantic_id_excludes_names_orders_duplicate_predicates_but_binds_roles_scope_and_clock():
    p=prepared(); d=explicit(); a=call(p,d)
    changed=deepcopy(d); changed['target']['name']='New caption'; changed['target']['definition']['case_ids'].reverse()
    assert call(p,changed)['comparison_id']==a['comparison_id']
    changed=deepcopy(d); changed['target'],changed['reference']=changed['reference'],changed['target']
    assert call(p,changed)['comparison_id']!=a['comparison_id']
    d={'mode':'selection_partition','target_name':'T','reference_name':'R','predicates':[opening(4,'ERP'),opening(5,'High')],'target_side':'kept'}
    a=call(p,d); changed=deepcopy(d); changed['predicates']=[d['predicates'][1],d['predicates'][0],d['predicates'][0]]
    assert call(p,changed)['comparison_id']==a['comparison_id']
    assert call(p,d,parent=['G01','G02'])['comparison_id']!=a['comparison_id']
    assert call(p,windows(minimum=1),periods=True)['comparison_id']!=call(p,windows(),periods=True)['comparison_id']
    saved=deepcopy(a); d['target_name']='mutation'; d['predicates'][0]['value']='CRM'
    assert a==saved and call(p,explicit())==call(p,explicit())


@pytest.mark.parametrize(('integer','floating'),[(4,4.0),(1,1.0),(0,-0.0)])
def test_equal_numeric_followup_meaning_has_one_identity_and_preserves_wire_form(integer,floating):
    p=prepared()
    a=call(p,windows(minimum=integer),periods=True)
    b=call(p,windows(minimum=floating),periods=True)
    assert a['comparison_id']==b['comparison_id']
    assert type(a['definition']['minimum_followup_hours']) is int
    assert type(b['definition']['minimum_followup_hours']) is float
    assert b['definition']['minimum_followup_hours']==floating
    assert a['target']['exposure']==b['target']['exposure']
    assert a['reference']['exposure']==b['reference']['exposure']
    assert call(p,windows(minimum=integer+0.5),periods=True)['comparison_id']!=a['comparison_id']


@pytest.mark.parametrize('field',['source_id','preparation_id','representation_id','case_dictionary_id','population_id','implementation_version'])
def test_every_base_identity_component_mismatch_is_refused(field):
    p=prepared(); identity=p.identity_dict(); identity[field]='foreign'
    result=call(p,explicit(),identity=identity)
    assert isinstance(result,ImportRefusal) and result.code=='identity_mismatch'


@pytest.mark.parametrize(('change','code'),[
    ('outside','case_outside_parent'),('unknown','unknown_case'),('duplicate','invalid_parameter'),('bool_column','unmapped_context_column'),('column','unmapped_context_column'),('policy','unsupported_policy'),('bool_negate','invalid_predicate'),('extra','invalid_parameter')])
def test_groups_refuse_unbound_or_ambiguous_definitions(change,code):
    p=prepared(); d=explicit(); kwargs={}
    if change=='outside':kwargs['parent']=['G01']
    elif change=='unknown':d['target']['definition']['case_ids']=['never-present']
    elif change=='duplicate':d['target']['definition']['case_ids']=['G01','G01']
    elif change=='bool_column':kwargs['column']=True
    elif change=='column':kwargs['column']=2
    elif change=='policy':kwargs['policy']='latest'
    elif change=='bool_negate':d['target']['definition']={'kind':'predicates','predicates':[opening(4,'ERP',1)]}
    else:d['silent_extra']='ignored?'
    r=call(p,d,**kwargs); assert isinstance(r,ImportRefusal) and r.code==code


@pytest.mark.parametrize('change',['empty','reversed','invalid_date','clock','negative','nan','infinite','boolean','extra_cutoff','fraction'])
def test_periods_refuse_invalid_bounds_and_nonfinite_or_implicit_exposure(change):
    p=prepared(); d=windows(); w=d['target']['window']
    if change=='empty':w['end_exclusive']=w['start_inclusive']
    elif change=='reversed':w['start_inclusive'],w['end_exclusive']=w['end_exclusive'],w['start_inclusive']
    elif change=='invalid_date':w['start_inclusive']='2026-02-30T00:00:00Z'
    elif change=='clock':w['timestamp_kind']='wall_clock'
    elif change=='negative':d['minimum_followup_hours']=-1
    elif change=='nan':d['minimum_followup_hours']=float('nan')
    elif change=='infinite':d['minimum_followup_hours']=float('inf')
    elif change=='boolean':d['minimum_followup_hours']=True
    elif change=='extra_cutoff':d['snapshot_cutoff_utc']='2027-01-01T00:00:00Z'
    else:w['start_inclusive']='2026-10-01T00:00:00.1234567Z'
    r=call(p,d,periods=True); assert isinstance(r,ImportRefusal)
    assert r.code in {'invalid_window','clock_mismatch','invalid_parameter'}


@pytest.mark.parametrize('field',['name','activity','context_value','endpoint'])
def test_malformed_json_surrogate_text_refuses_before_utf8_hash_or_publication(field):
    p=prepared(); d=windows() if field=='endpoint' else explicit()
    if field=='name':d['target']['name']='\ud800'
    elif field=='activity':d['target']['definition']={'kind':'predicates','predicates':[{'kind':'contains_activity','activity':'\ud800','negate':False}]}
    elif field=='context_value':d['target']['definition']={'kind':'predicates','predicates':[opening(4,'\ud800')]}
    else:d['endpoint_activity']='\ud800'
    r=call(p,d,periods=field=='endpoint')
    assert isinstance(r,ImportRefusal) and r.code in {'invalid_parameter','invalid_predicate'}
