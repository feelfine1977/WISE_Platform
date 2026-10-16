"""Bounded synthetic HTTP/production-browser subtype qualification, owned processes only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

import httpx

from qualify_issue105 import ROOT, run_browser
from flow_f11_literal import IDS, MUTATIONS, ROWS, assert_mutation, prepare, source
from import_requests import envelope
from test_bpic19_subtype_revision_http import comparison_request


def main():
    parser = argparse.ArgumentParser()
    for name in ['node','playwright','chrome']:
        parser.add_argument('--'+name,required=True)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='wise-issue106-'))
    os.chmod(root,0o700)
    workspace = root/'workspace'
    workspace.mkdir()
    services, ports, browser_pids = [], [], {}
    env = {**os.environ,'HOME':str(root),'PYTHONDONTWRITEBYTECODE':'1',
           'PYTHONPATH':os.pathsep.join(str(ROOT/p) for p in ['apps/api/src','packages/analytics/src'])}
    def start(port=None):
        if port is None:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0))
                port = sock.getsockname()[1]
        ports.append(port)
        code = ('from pathlib import Path;import uvicorn;from wise_platform_api.app import create_app;'
                f'uvicorn.run(create_app(workspace_path=Path({str(workspace)!r})),host="127.0.0.1",port={port},log_level="error")')
        process = subprocess.Popen([sys.executable,'-B','-c',code],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        services.append(process)
        client = httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=20,trust_env=False)
        for _ in range(200):
            assert process.poll() is None
            try:
                if client.get('/api/health').status_code == 200:
                    return process,client,port
            except httpx.TransportError:
                pass
            time.sleep(.05)
        raise RuntimeError('readiness_timeout')
    def stop(process,client):
        client.close()
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    def browser(port,phase,tick=lambda:None):
        with (root/(phase+'.log')).open('wb') as log:
            code = run_browser([args.node,str(ROOT/'tools/qualify_issue106.mjs'),f'http://127.0.0.1:{port}',
                str(workspace),str(root),args.playwright,args.chrome,phase],log,180,browser_pids,tick)
        assert code == 0, f'{root}/{phase}.log'
    started = time.monotonic()
    try:
        paths = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
        provenance = dict(head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),python=sys.version,
            node=subprocess.check_output([args.node,'--version'],text=True).strip(),
            files={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths if (ROOT/p).is_file()},
            built={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'apps/api/src/wise_platform_api/static').rglob('*') if p.is_file()})
        (root/'provenance.json').write_text(json.dumps(provenance,indent=2))
        process,client,port = start()
        wid,base = prepare(client,workspace)
        selected = client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=base,parent_case_ids=None,predicates=[])).json()
        identity = selected['identity']
        given = comparison_request(client,wid,identity)
        answer = client.post('/api/investigations/bpic19-flow-comparison',json=given)
        assert answer.status_code == 200,answer.text
        save_request = envelope('save_investigation_request',workspace_id=wid,
            investigation_id=None,expected_revision_id=None,name='Issue 106 subtype',base_identity=base,selection_identity=identity,
            selection_recipe=dict(parent_case_ids=IDS,predicates=[]),context_policy='incident.context.first_record_in_declared_order.v1',
            comparison=None,notes='',bookmarks=[],bpic19_pipeline=dict(schema_version=1,actions=[dict(operation='bpic19_flow_comparison',
                identity=identity,query=given['query'],definition_id=answer.json()['definition_id'],selection_prefix_length=0)]))
        for name in ['Issue 106 subtype',*[f'Issue 106 {kind}' for kind in MUTATIONS]]:
            save_request['name'] = name
            saved = client.post('/api/investigations/save',json=save_request)
            assert saved.status_code == 200,saved.text
        (root/'fixture.json').write_text(json.dumps(dict(rows=ROWS,identity=identity,mutations=MUTATIONS,
            source_sha256=hashlib.sha256(source()).hexdigest())))
        initial_immutable = {}
        def snapshot():
            nonlocal process,client
            if initial_immutable or not (root/'snapshot-ready.json').exists():
                return
            stop(process,client)
            initial_immutable.update({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (workspace/'investigations/revisions').glob('*.json')})
            frozen = json.loads((root/'snapshot-ready.json').read_text())
            process,client,_ = start(port)
            assert client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code == 200
            assert client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=frozen['revision'])).status_code == 200
            (root/'snapshot-ack').write_text('observed process exit and immutable A checkpoint')
        browser(port,'review',snapshot)
        stop(process,client)
        assert initial_immutable
        assert initial_immutable == {name:hashlib.sha256((workspace/'investigations/revisions'/name).read_bytes()).hexdigest() for name in initial_immutable}
        proof = json.loads((root/'review.json').read_text())
        immutable = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (workspace/'investigations/revisions').glob('*.json')}
        process,client,port = start()
        assert client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code == 200
        for saved in proof['saves']:
            reopened = client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=saved['revision']['saved_revision_id']))
            assert reopened.status_code == 200,reopened.text
            assert reopened.json()['revision'] == saved['revision']
            assert reopened.json()['bpic19_outputs'] == saved['bpic19_outputs']
            kind = saved['revision']['content']['name'].removeprefix('Issue 106 ')
            if kind in MUTATIONS:
                assert_mutation(reopened.json()['bpic19_outputs']['outputs'][-1]['output'],kind)
        browser(port,'reopen')
        stop(process,client)
        assert immutable == {name:hashlib.sha256((workspace/'investigations/revisions'/name).read_bytes()).hexdigest() for name in immutable}
        latest = [saved for saved in proof['saves'] if saved['revision']['content']['name'] == 'Issue 106 subtype'][-1]['revision']['saved_revision_id']
        target = workspace/'investigations/revisions'/(latest.split(':')[-1]+'.json')
        original = target.read_bytes()
        for phase,code in [('missing','artifact_unavailable'),('checksum','checksum_mismatch')]:
            assert all(p.poll() is not None for p in services)
            damaged = json.loads(original)
            entry = [o for o in damaged['results']['bpic19_pipeline']['outputs'] if o['operation']=='bpic19_flow_comparison'][-1]
            if phase == 'missing':
                del entry['output']
            else:
                entry['output']['comparison']['target']['case_count'] = 999
            target.write_text(json.dumps(damaged))
            injected = target.read_bytes()
            process,client,port = start()
            assert client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code == 200
            refusal = client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=latest))
            assert refusal.status_code == 409 and refusal.json()['code'] == code,refusal.text
            browser(port,phase)
            stop(process,client)
            assert target.read_bytes() == injected
            target.write_bytes(original)
        summary = dict(success=True,root=str(root),elapsed_seconds=time.monotonic()-started,services=[dict(pid=p.pid,exit=p.returncode) for p in services],
            ports=ports,browser_identities=browser_pids,immutable=immutable,initial_immutable=initial_immutable,revision_count=len(proof['saves']),
            evidence_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir() if p.is_file()})
        (root/'result.json').write_text(json.dumps(summary,indent=2))
        print(json.dumps(summary))
    finally:
        for p in services:
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=10)
                except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
        for port in ports:
            with socket.socket() as sock:
                assert sock.connect_ex(('127.0.0.1',port)) != 0
        print(json.dumps(dict(root=str(root),all_services_waited=True,ports_closed=ports)))


if __name__ == '__main__':
    main()
