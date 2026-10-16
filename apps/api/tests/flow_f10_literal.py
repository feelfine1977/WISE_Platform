"""Issue 105's original F10, in its declared 13-column synthetic namespace."""
import csv
import io

ROLES = dict(item_category=4, item_type=5, goods_receipt=6, gr_based_iv=7,
             purchasing_document=8, item=9, source_case=10)
HEADERS = ['row_id', 'case_id', 'activity', 'timestamp', 'item_category', 'item_type',
           'goods_receipt', 'gr_based_iv', 'purchasing_document', 'item', 'source_case', 'resource', 'net_worth']
AFTER = '3-way match, invoice after GR'
BEFORE = '3-way match, invoice before GR'
ROWS = [
    ['f01','D1_1','Record Invoice Receipt','2018-01-02T00:00:00Z',AFTER,'Service','true','true','D1','1','D1_1','user_1','100'],
    ['f02','D1_1','Record Goods Receipt','2018-01-03T00:00:00Z',AFTER,'Service','true','true','D1','1','D1_1','user_1','100'],
    ['f03','D1_2','Create Purchase Order Item','2018-01-01T00:00:00Z',BEFORE,'Standard','true','false','D1','2','D1_2','user_1','100'],
    ['f04','D1_2','Record Goods Receipt','2018-01-04T00:00:00Z',BEFORE,'Standard','true','false','D1','2','D1_2','user_1','100'],
    ['f05','D2_1','Record Goods Receipt','','Consignment','Consignment','true','false','D2','1','D2_1','batch_1','0'],
    ['f06','D3_1','Record Invoice Receipt','2018-01-01T00:00:00Z','2-way match','Limit','false','false','D3','1','D3_1','user_1','100'],
    ['f07','M_1','Create Purchase Order Item','2018-01-01T00:00:00Z','','Standard','true','false','M','1','M_1','user_1','100'],
    ['f08','C_1','Record Invoice Receipt','not-a-time',AFTER,'Standard','true','true','C','1','C_1','user_1','100'],
    ['f09','C_1','Record Goods Receipt','2018-01-03T00:00:00Z',BEFORE,'Standard','true','false','C','1','C_1','user_1','100'],
    ['f10','U_1','Create Purchase Order Item','2018-01-01T00:00:00Z','Unknown','Standard','true','false','U','1','U_1','user_1','100'],
    ['f11','F_1','Create Purchase Order Item','2018-01-01T00:00:00Z',BEFORE,'Standard','true','true','F','1','F_1','user_1','100'],
    ['f12','B_1','Create Purchase Order Item','2018-01-01T00:00:00Z',BEFORE,'Standard','','false','B','1','B_1','user_1','100'],
    ['f13','G_1','Create Purchase Order Item','2018-01-01T00:00:00Z',BEFORE,'Standard','true','false','G','1','G_1','user_1','100'],
    ['f14','G_1','Change Quantity','2018-01-02T00:00:00Z',BEFORE,'Standard','true','false','Other','1','G_1','user_1','100'],
]


def source():
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(HEADERS)
    writer.writerows(ROWS)
    return stream.getvalue().encode()


def prepare(client, workspace):
    from import_requests import envelope, policies
    wid = client.post('/api/workspaces/open', json=envelope('open_workspace_request', path=str(workspace))).json()['workspace_id']
    uploaded = client.put('/api/sources', params=envelope('upload_source_metadata', workspace_id=wid, filename='f10.csv'),
                          content=source(), headers={'Content-Type':'application/octet-stream'})
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
