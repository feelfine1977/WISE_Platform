"""Exact F11 plus separately declared synthetic subtype boundary witnesses."""
import csv
import io

from flow_f10_literal import AFTER, HEADERS, ROLES, ROWS as F10

F11 = [*F10, ['f15','D4_1','Record Invoice Receipt','2018-01-01T00:00:00Z',AFTER,'Standard','true','true','D4','1','D4_1','user_1','100']]
BOUNDARIES = [
    ['s01','X_1','Create Purchase Order Item','2018-01-01T00:00:00Z',AFTER,'Standard','true','true','X','1','X_1','user_1',''],
    ['s02','X_2','Record Invoice Receipt','not-a-time',AFTER,'Service','true','true','X','2','X_2','user_1','100'],
    ['s03','X_2','Record Goods Receipt','2018-01-03T00:00:00Z',AFTER,'Service','true','true','X','2','X_2','user_1','100'],
    ['s04','Y_1','Create Purchase Order Item','2018-01-01T00:00:00Z',AFTER,'Standard','true','true','Y','1','Y_1','user_1','100'],
    ['s05','Y_1','Change Quantity','2018-01-02T00:00:00Z',AFTER,'Service','true','true','Y','1','Y_1','user_1','100'],
    ['s06','I_1','Create Purchase Order Item','2018-01-01T00:00:00Z',AFTER,'Standard','true','true','I','1','I_1','user_1','100'],
    ['s07','I_1','Change Quantity','2018-01-02T00:00:00Z',AFTER,'','true','true','I','1','I_1','user_1','100'],
    ['s08','Z_1','Create Purchase Order Item','2018-01-01T00:00:00Z',AFTER,'','true','true','Z','1','Z_1','user_1','100'],
    ['s09','Q_1','Create Purchase Order Item','2018-01-01T00:00:00Z',AFTER,'Alien type','true','true','Q','1','Q_1','user_1','100'],
]
ROWS = [*F11, *BOUNDARIES]
IDS = ['B_1','C_1','D1_1','D1_2','D2_1','D3_1','D4_1','F_1','G_1','I_1','M_1','Q_1','U_1','X_1','X_2','Y_1','Z_1']

# Literal memberships/counts, not a second implementation of subtype evaluation.
FLOW = ['D1_1','D4_1','I_1','Q_1','X_1','X_2','Y_1','Z_1']
OUTSIDE_FLOW = ['B_1','C_1','D1_2','D2_1','D3_1','F_1','G_1','M_1','U_1']
MUTATIONS = {
    'binding': dict(parent=(IDS,24,14), flow_parent=(FLOW,12,7),
        comparison_parent=([],0,0), target=([],0,0), reference=([],0,0),
        outside=(FLOW,12,7), unavailable=(['X_1'],1,1),
        outside_flow=(OUTSIDE_FLOW,12,8), scope_unavailable=(['C_1','M_1','U_1'],4,3),
        documents=[], overlap=[], shares=(0,0,None,None,None,None,'empty_comparison_parent'),
        item_type=12, target_value='Standard'),
    'predicate': dict(parent=(IDS,24,14), flow_parent=(FLOW,12,7),
        comparison_parent=(['D1_1','Q_1','X_2'],5,3), target=(['Q_1'],1,1), reference=(['D1_1','X_2'],4,2),
        outside=(['D4_1','I_1','X_1','Y_1','Z_1'],7,5), unavailable=(['I_1','Y_1','Z_1'],5,3),
        outside_flow=(OUTSIDE_FLOW,12,8), scope_unavailable=(['C_1','M_1','U_1'],4,3),
        documents=['D1','Q','X'], overlap=[], shares=(3,5,1/3,2/3,1/5,4/5,None),
        item_type=5, target_value='Alien type'),
    'parent': dict(parent=(['D1_1','D4_1'],3,2), flow_parent=(['D1_1','D4_1'],3,2),
        comparison_parent=(['D1_1','D4_1'],3,2), target=(['D4_1'],1,1), reference=(['D1_1'],2,1),
        outside=([],0,0), unavailable=([],0,0), outside_flow=([],0,0), scope_unavailable=([],0,0),
        documents=['D1','D4'], overlap=[], shares=(2,3,1/2,1/2,1/3,2/3,None),
        item_type=5, target_value='Standard'),
}


def assert_mutation(answer, kind):
    expected = MUTATIONS[kind]
    c = answer['comparison']
    for key in ['parent','flow_parent','comparison_parent','target','reference','outside','unavailable','outside_flow','scope_unavailable']:
        ids, records, documents = expected[key]
        assert {field:c[key][field] for field in ['case_ids','case_count','record_count','document_count']} == dict(
            case_ids=ids,case_count=len(ids),record_count=records,document_count=documents), key
    assert c['shares'] == dict(zip(['item_denominator','record_denominator','target_item_share','reference_item_share',
        'target_record_share','reference_record_share','reason'],expected['shares']))
    assert c['documents'] == dict(union_document_ids=expected['documents'],union_document_count=len(expected['documents']),
        overlap_document_ids=expected['overlap'],overlap_document_count=len(expected['overlap']),
        target_document_count=expected['target'][2],reference_document_count=expected['reference'][2],
        unknown_document_case_ids=[],supports_overlap=False)
    for definition in [answer['query'],answer['definition'],c['definition']]:
        assert definition['profile_query']['roles'] == dict(ROLES,item_type=expected['item_type'])
        assert definition['target'] == dict(flow_id='after_gr',item_type_state='invariant',item_type_value=expected['target_value'])
        assert definition['reference'] == dict(flow_id='after_gr',item_type_state='invariant',item_type_value='Service')


def source(rows=ROWS):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return stream.getvalue().encode()


def prepare(client, workspace, rows=ROWS):
    from import_requests import envelope, policies
    wid = client.post('/api/workspaces/open', json=envelope('open_workspace_request', path=str(workspace))).json()['workspace_id']
    uploaded = client.put('/api/sources', params=envelope('upload_source_metadata', workspace_id=wid, filename='f11.csv'),
                          content=source(rows), headers={'Content-Type':'application/octet-stream'})
    assert uploaded.status_code == 200, uploaded.text
    confirmed = client.post('/api/preparations', json=envelope('confirm_mapping_request', workspace_id=wid,
        source_id=uploaded.json()['source']['source_id'], dialect=dict(encoding='utf-8',delimiter=',',quotechar='"',header='first_record'),
        mapping=dict(case_column=1,activity_column=2,timestamp_column=3,sequence_column=None,context_columns=[0,*range(4,13)]),
        policies=policies('iso8601',None),accept_report_issues=True))
    assert confirmed.status_code == 200, confirmed.text
    population = client.post('/api/investigations/open-population', json=envelope('open_population_request', workspace_id=wid,
        preparation_id=confirmed.json()['preparation']['preparation_id']))
    assert population.status_code == 200, population.text
    return wid, population.json()['identity']
