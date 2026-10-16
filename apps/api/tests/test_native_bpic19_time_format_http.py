"""Native22-column timestamp policy reaches the public preparation/profile boundary."""
from fastapi.testclient import TestClient
from wise_platform_api.app import create_app
from import_requests import envelope, wall_policies, policies
from test_csv_dmy_dash_seconds import native_source, MAPPING, ROLES


def opened(client,path,raw):
    wid=client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(path))).json()['workspace_id']
    stored=client.put('/api/sources',params=envelope('upload_source_metadata',workspace_id=wid,filename='synthetic-native22.csv'),content=raw,headers={'Content-Type':'application/octet-stream'})
    assert stored.status_code==200,stored.text
    return wid,stored.json()['source']['source_id']


def test_native22_wall_and_fixed_utc_http_keep_source_bytes_field_indices_and_exact_instants(tmp_path):
    root=tmp_path/'workspace';root.mkdir();raw=native_source()
    with TestClient(create_app()) as client:
        wid,sid=opened(client,root,raw)
        def confirm(time):
            return client.post('/api/preparations',json=envelope('confirm_mapping_request',workspace_id=wid,source_id=sid,dialect={'encoding':'windows-1252','delimiter':',','quotechar':'"','header':'first_record'},mapping=MAPPING,policies=time,accept_report_issues=True))
        wall=confirm(wall_policies('dmy_dash_second','2027-01-01T00:00:00'))
        assert wall.status_code==200 and wall.json()['state']=='ready',wall.text
        prep=wall.json()['preparation']
        pop=client.post('/api/investigations/open-population',json=envelope('open_population_request',workspace_id=wid,preparation_id=prep['preparation_id']))
        assert pop.status_code==200,pop.text
        identity=pop.json()['identity']
        reviewed=client.post('/api/investigations/bpic19-profile',json=envelope('bpic19_profile_request',workspace_id=wid,identity=identity,query={'roles':ROLES,'profile_columns':None,'policy_id':'bpic19.all_raw_case_attributes.v1'}))
        assert reviewed.status_code==200,reviewed.text
        assert reviewed.json()['profile']['population']['case_count']==4
        assert reviewed.json()['profile']['population']['record_count']==7
        evidence=client.post('/api/investigations/case-evidence',json=envelope('imported_case_evidence_request',workspace_id=wid,identity=identity,case_id='D1_1'))
        assert evidence.status_code==200,evidence.text
        rows=evidence.json()['records'];assert len(rows)==4
        assert rows[0]['local_timestamp']=='1948-01-26T23:59:00'
        assert rows[1]['local_timestamp']=='2018-01-01T08:00:00.001000'
        assert rows[1]['original_cells'][21]=='01-01-2018 08:00:00.001' and rows[1]['original_cells'][9]=='3-way match, invoice before GR'
        assert all(len(r['original_cells'])==22 and r['timestamp_status']=='usable' for r in rows)
        refused=confirm(policies('dmy_dash_second',None,cutoff='2027-01-01T00:00:00Z'))
        assert refused.status_code==422 and refused.json()['code']=='timezone_required'
        utc=confirm(policies('dmy_dash_second',120,cutoff='2027-01-01T00:00:00Z'))
        assert utc.status_code==200 and utc.json()['state']=='ready',utc.text
        assert utc.json()['preparation']['preparation_id']!=prep['preparation_id']
        assert utc.json()['source_id']==sid
