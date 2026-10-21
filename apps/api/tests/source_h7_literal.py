"""Issue 103's exact synthetic namespace and independently declared expectations."""
import csv
import hashlib
import io

from import_requests import envelope, policies

ROWS = [
    ['h1', 'A', 'Vendor creates invoice', '1948-01-01T00:00:00Z', 'D', '1'],
    ['h2', 'A', 'Create Purchase Order Item', '2018-01-01T00:00:00Z', 'D', '1'],
    ['h3', 'A', 'Clear Invoice', '2020-01-02T00:00:00Z', 'D', '1'],
    ['h4', 'B', 'Create Purchase Order Item', '2018-01-02T00:00:00Z', 'D', '2'],
    ['h5', 'B', 'Record Goods Receipt', '2018-01-03T00:00:00Z', 'D', '2'],
    ['h6', 'C', 'Create Purchase Order Item', '2018-01-02T00:00:00Z', 'E', '1'],
    ['h7', 'C', 'Clear Invoice', '2018-01-04T00:00:00Z', 'E', '1'],
]
ROLES = dict(source_case=10, item_category=4, item_type=5, goods_receipt=6,
             gr_based_iv=7, purchasing_document=8, item=9)
EXPECTED = {
    'all_source': (['A', 'B', 'C'], [], 7, 0, 2),
    'document_start': (['C'], ['A', 'B'], 2, 5, 1),
    'item_start': (['B', 'C'], ['A'], 4, 3, 2),
}
ROW_IDS = [
    'row.v1:sha256:dd3cba5d2b2fa245b787f9562ac59f74f66dcfd03b30ad3f4d6b9c7732acbcdb',
    'row.v1:sha256:9adaebf1604c37f6ff929611c13946233b17dd3ee722cb182d95f59b0e6c70e0',
    'row.v1:sha256:bebef646e3e6bcd5600b64a6102021d89a15c16287b32ef9733e1095fab179da',
    'row.v1:sha256:ed9400f49f66ddd25a165512489b3028db789a86da7c082fb1f95c9f9515ae3e',
    'row.v1:sha256:551d5e776f645e8ede5a1966837862d768ec93bbedc3660d3f1dce82bf5ee62b',
    'row.v1:sha256:94bc8f31136b7dea1509cd3bc1e10f1687b3b138fc5b2b4b589c928c75304a3b',
    'row.v1:sha256:409889f6a0e090bf3c0b474590b92bf0f46ab909914dd352809aee5e0b62ba72',
]


def source():
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(['row_id', 'case_id', 'activity', 'timestamp', 'item_category', 'item_type',
                     'goods_receipt', 'gr_based_iv', 'purchasing_document', 'item', 'source_case', 'resource', 'net_worth'])
    for rid, cid, activity, timestamp, doc, item in ROWS:
        writer.writerow([rid, cid, activity, timestamp, '3-way match, invoice before GR',
                         'Standard', 'true', 'false', doc, item, cid, 'user_1', 100])
    return stream.getvalue().encode()


def query(kind='all_source'):
    return dict(roles=ROLES.copy(), profile_columns=None, policy_id='bpic19.all_raw_case_attributes.v1',
        source_interpretation=dict(profile_name='Issue 103 '+kind, policy_id='bpic19.raw_source_interpretation.v1',
            inclusion=dict(kind=kind, timestamp_kind='utc_instant', start_inclusive=None if kind=='all_source' else '2018-01-01T00:00:00Z',
                           end_exclusive='2019-01-01T00:00:00Z' if kind=='record_projection' else None),
            horizon=dict(timestamp_kind='utc_instant', value='2019-01-28T00:00:00Z', provenance='Synthetic H7 observation contract'),
            discrepancies=[dict(reference='Synthetic report subtotal', reported_total=251734, reported_subtotal=251347)]))


def prepare(client, workspace, *, content=None, time_policy=None, mapping=None):
    opened=client.post('/api/workspaces/open', json=envelope('open_workspace_request',path=str(workspace)))
    assert opened.status_code==200, opened.text
    wid=opened.json()['workspace_id']
    uploaded=client.put('/api/sources',params=envelope('upload_source_metadata',workspace_id=wid,filename='H7.csv'),
        content=source() if content is None else content,headers={'Content-Type':'application/octet-stream'})
    assert uploaded.status_code==200, uploaded.text
    prepared=client.post('/api/preparations',json=envelope('confirm_mapping_request',workspace_id=wid,
        source_id=uploaded.json()['source']['source_id'], dialect=dict(encoding='utf-8',delimiter=',',quotechar='"',header='first_record'),
        mapping=mapping or dict(case_column=1,activity_column=2,timestamp_column=3,sequence_column=None,context_columns=[0,*range(4,13)]),
        policies=time_policy or policies('iso8601',None),accept_report_issues=True))
    assert prepared.status_code==200, prepared.text
    opened=client.post('/api/investigations/open-population',json=envelope('open_population_request',workspace_id=wid,
        preparation_id=prepared.json()['preparation']['preparation_id']))
    assert opened.status_code==200, opened.text
    return wid,opened.json()['identity']


def assert_profile(answer,kind):
    p=answer['profile']; r=p['source_review']
    assert [p['population'][key] for key in ['case_count','record_count','document_count']]==[3,7,2]
    assert p['definition']['roles']==ROLES
    assert r['source_id']=='source.v1:sha256:'+hashlib.sha256(source()).hexdigest()
    assert r['observed_raw_minimum']=='1948-01-01T00:00:00Z'
    assert r['observed_raw_maximum']=='2020-01-02T00:00:00Z'
    assert r['horizon_state']=='reviewed'
    assert r['interpretation']['horizon']==query()['source_interpretation']['horizon']
    assert r['discrepancies'][0]['difference']==387
    assert r['due_assessment']=='unavailable'
    for state,position in [('before_reference_2017',0),('at_or_after_reference_2020',2),('after_trusted_horizon',2)]:
        anomaly=next(entry for entry in r['anomalies'] if entry['state']==state)
        timestamp='1948-01-01T00:00:00Z' if position==0 else '2020-01-02T00:00:00Z'
        assert anomaly==dict(state=state,record_count=1,case_count=1,omitted_witness_count=0,witnesses=[
            dict(case_id='A',row_id=row_id(position),source_position=position,raw_timestamp=timestamp,interpreted_timestamp=timestamp)])
    if kind=='record_projection':
        assert r['projection']['case_ids']==['A','B','C']
        assert r['projection']['record_count']==5
        assert r['projection']['row_ids']==sorted(row_id(position) for position in [1,3,4,5,6])
    else:
        retained,excluded,records,excluded_records,documents=EXPECTED[kind]
        assert r['retained']['case_ids']==retained
        assert r['excluded']['case_ids']==excluded
        assert r['retained']['record_count']==records
        assert r['excluded']['record_count']==excluded_records
        assert r['retained']['document_count']==documents
        assert r['excluded']['document_count']==(0 if kind=='all_source' else 1)
        assert r['unavailable']['case_ids']==[]
        if kind in {'document_start','item_start'}:
            for cid in (['A','B'] if kind=='document_start' else ['A']):
                witness=next(entry for entry in r['inclusion_evidence'] if entry['case_id']==cid)
                assert witness==dict(case_id=cid,reason='earliest_raw_event_before_start',witness_case_ids=['A'],row_ids=[row_id(0)])


def row_id(position):
    return ROW_IDS[position]
