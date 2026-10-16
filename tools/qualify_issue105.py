"""Finite actual HTTP/built-browser qualification; only fresh synthetic workspaces."""
import argparse
import hashlib
import json
from importlib.metadata import version
import os
import signal
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import tomllib

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / p) for p in ['apps/api/tests','packages/analytics/tests','tests']]
from flow_f10_literal import ROLES, ROWS, prepare, source
from import_requests import envelope
from test_bpic19_profile_http import request


def process_table():
    rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,lstart='], text=True, timeout=2)
    return {int(parts[0]): (int(parts[1]), int(parts[2]), parts[3])
            for line in rows.splitlines() if len(parts := line.split(None, 3)) == 4}


def run_browser(command, log, timeout, identities, tick=lambda: None):
    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    owned = {}
    end = time.monotonic() + timeout

    def observe():
        table = process_table()
        descendants = {process.pid}
        while True:
            children = {pid for pid, (parent, group, _) in table.items()
                        if parent in descendants or group == process.pid}
            if children <= descendants: break
            descendants |= children
        for pid in descendants:
            if pid in table:
                owned.setdefault(pid, table[pid][1:])
        identities.update(owned)

    try:
        while process.poll() is None:
            observe()
            tick()
            if time.monotonic() >= end: raise TimeoutError('browser_deadline')
            time.sleep(.05)
        return process.returncode
    finally:
        observe()
        for sig, seconds in [(signal.SIGTERM, 2), (signal.SIGKILL, 5)]:
            table = process_table()
            for pid, birth in owned.items():
                if pid in table and table[pid][1:] == birth:
                    try: os.kill(pid, sig)
                    except ProcessLookupError: pass
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                process.poll()
                table = process_table()
                if not any(pid in table and table[pid][1:] == birth for pid, birth in owned.items()): break
                time.sleep(.05)
        process.wait(timeout=5)
        table = process_table()
        assert not any(pid in table and table[pid][1:] == birth for pid, birth in owned.items()), 'owned_browser_survived'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', required=True)
    parser.add_argument('--playwright', required=True)
    parser.add_argument('--chrome', required=True)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='wise-issue105-'))
    os.chmod(root, 0o700)
    source_paths=subprocess.check_output(['git','ls-files'],cwd=ROOT,text=True).splitlines()
    source_paths += ['apps/api/tests/flow_f10_literal.py','apps/api/tests/test_bpic19_flow_revision_http.py',
                     'tools/qualify_issue105.py','tools/qualify_issue105.mjs','tools/qualify_issue105_refusal.mjs']
    files={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sorted(set(source_paths)) if (ROOT/name).is_file()}
    built={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest()
           for path in sorted((ROOT/'apps/api/src/wise_platform_api/static').rglob('*')) if path.is_file()}
    provenance=dict(head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                    python=sys.version,api=tomllib.loads((ROOT/'pyproject.toml').read_text())['project']['version'],fastapi=version('fastapi'),
                    source_files=files,built_files=built,node=subprocess.check_output([args.node,'--version'],text=True).strip())
    (root/'provenance.json').write_text(json.dumps(provenance,indent=2))
    workspace = root / 'workspace'
    workspace.mkdir()
    env = {**os.environ, 'HOME':str(root), 'PYTHONDONTWRITEBYTECODE':'1',
           'PYTHONPATH':os.pathsep.join(str(ROOT / p) for p in ['apps/api/src','packages/analytics/src'])}
    services = []
    ports = []
    browser_pids = {}
    def start(port=None):
        if port is None:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
        ports.append(port)
        code = ('from pathlib import Path;import uvicorn;from wise_platform_api.app import create_app;'
                f'uvicorn.run(create_app(workspace_path=Path({str(workspace)!r})),host="127.0.0.1",port={port},log_level="error")')
        process = subprocess.Popen([sys.executable,'-B','-c',code], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        services.append(process)
        client = httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=20,trust_env=False)
        for _ in range(200):
            assert process.poll() is None
            try:
                if client.get('/api/health').status_code == 200: return process, client, port
            except httpx.TransportError: pass
            time.sleep(.05)
        raise RuntimeError('readiness_timeout')
    def stop(process, client):
        client.close()
        if process.poll() is None: process.terminate()
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
    started = time.monotonic()
    try:
        controls=[]
        for mode in ['timeout','crash']:
            code = (f"const {{chromium}}=await import({Path(args.playwright).as_uri()!r});"
                    f"await chromium.launch({{headless:true,executablePath:{args.chrome!r}}});"
                    "process.on('SIGTERM',()=>{});"
                    + ("setTimeout(()=>process.exit(3),700);" if mode=='crash' else "")
                    + "setInterval(()=>{},1000);")
            before=set(browser_pids)
            with (root/('cleanup-'+mode+'.log')).open('wb') as log:
                try:
                    status=run_browser([args.node,'--input-type=module','-e',code],log,2,browser_pids)
                    assert mode=='crash' and status==3
                except TimeoutError:
                    assert mode=='timeout'
            assert len(set(browser_pids)-before)>2, 'negative_control_did_not_launch_browser'
            controls.append(dict(mode=mode,pids=sorted(set(browser_pids)-before),all_absent=True))
        service, client, port = start()
        wid, base = prepare(client, workspace)
        selected = client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=base,parent_case_ids=None,predicates=[])).json()
        current = selected['identity']
        (root/'fixture.json').write_text(json.dumps(dict(rows=ROWS,identity=current)))
        given = request(wid,current,ROLES)
        given['query']['profile_columns'] = list(range(13))
        response = client.post('/api/investigations/bpic19-profile',json=given)
        assert response.status_code == 200,response.text
        saved = client.post('/api/investigations/save',json=envelope('save_investigation_request',workspace_id=wid,investigation_id=None,
            expected_revision_id=None,name='Issue 105 F10',base_identity=base,selection_identity=current,
            selection_recipe=dict(parent_case_ids=selected['parent']['case_ids'],predicates=[]),context_policy='incident.context.first_record_in_declared_order.v1',
            comparison=None,notes='',bookmarks=[]))
        assert saved.status_code == 200,saved.text
        command=[args.node,str(ROOT/'tools/qualify_issue105.mjs'),f'http://127.0.0.1:{port}',str(workspace),str(root),args.playwright,args.chrome]
        immutable={}
        def snapshot():
            nonlocal service,client
            if not (root/'snapshot-ready.json').exists() or immutable: return
            stop(service,client)
            for path in (workspace/'investigations/revisions').glob('*.json'):
                immutable[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
            service,client,_=start(port)
            assert client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code==200
            frozen=json.loads((root/'snapshot-ready.json').read_text())
            assert client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=frozen['revision'])).status_code==200
            (root/'snapshot-ack').write_text('stopped-copy-recorded')
        with (root/'browser.log').open('wb') as log:
            result=run_browser(command,log,240,browser_pids,snapshot)
        assert result == 0, f'browser_failed: {root}/browser.log'
        stop(service,client)
        proof=json.loads((root/'browser.json').read_text())
        service,client,port=start()
        opened=client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace)))
        assert opened.status_code==200 and opened.json()['workspace_id']==wid
        for saved in proof['saves']:
            reopened=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,
                saved_revision_id=saved['revision']['saved_revision_id']))
            assert reopened.status_code==200,reopened.text
            assert reopened.json()['revision']==saved['revision']
            assert reopened.json()['bpic19_outputs']==saved['bpic19_outputs']
        with (root/'reopened-browser.log').open('wb') as log:
            checked=run_browser([args.node,str(ROOT/'tools/qualify_issue105_refusal.mjs'),f'http://127.0.0.1:{port}',str(workspace),str(root),args.playwright,args.chrome,'healthy'],log,90,browser_pids)
        assert checked==0,f'{root}/reopened-browser.log'
        stop(service,client)
        assert immutable
        assert immutable=={name:hashlib.sha256((workspace/'investigations/revisions'/name).read_bytes()).hexdigest() for name in immutable}
        corruptions=[]
        latest=proof['saves'][-1]['revision']['saved_revision_id']
        target=workspace/'investigations/revisions'/(latest.split(':')[-1]+'.json')
        original=target.read_bytes()
        for mutation,code in [('missing','artifact_unavailable'),('checksum','checksum_mismatch')]:
            # External corruption injection only, while every serving PID is stopped.
            assert all(p.poll() is not None for p in services)
            damaged=json.loads(original)
            output=[entry for entry in damaged['results']['bpic19_pipeline']['outputs'] if entry['operation']=='bpic19_profile'][-1]
            if mutation=='missing': del output['output']
            else: output['output']['profile']['population']['case_count']=999
            target.write_text(json.dumps(damaged))
            corrupted=target.read_bytes() if target.exists() else None
            service,client,port=start()
            opened=client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace)))
            assert opened.status_code==200
            refused=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=latest))
            assert refused.status_code==409 and refused.json()['code']==code,refused.text
            with (root/(mutation+'-browser.log')).open('wb') as log:
                checked=run_browser([args.node,str(ROOT/'tools/qualify_issue105_refusal.mjs'),f'http://127.0.0.1:{port}',str(workspace),str(root),args.playwright,args.chrome,code],log,90,browser_pids)
            assert checked==0,f'{root}/{mutation}-browser.log'
            stop(service,client)
            assert (target.read_bytes() if target.exists() else None)==corrupted
            target.write_bytes(original)
            corruptions.append(dict(mutation=mutation,code=code,no_automatic_repair=True))
        summary=dict(success=True,root=str(root),elapsed_seconds=time.monotonic()-started,pids=[p.pid for p in services],
                     ports=ports,browser_pids=sorted(browser_pids),browser_process_identities=browser_pids,cleanup_controls=controls,
                     immutable_revision_hashes=immutable,source_sha256=hashlib.sha256(source()).hexdigest(),
                     reopened_revisions=len(proof['saves']),unique_revision_count=len({s['revision']['saved_revision_id'] for s in proof['saves']}),
                     current_revision=latest,downloads=proof['downloads'],full_identity=current,
                     scripts={name:files[name] for name in source_paths if name.startswith('tools/qualify_issue105') or name in ['apps/api/tests/flow_f10_literal.py','apps/api/tests/test_bpic19_flow_revision_http.py']},
                     corruptions=corruptions)
        (root/'result.json').write_text(json.dumps(summary,indent=2))
        print(json.dumps(summary))
    finally:
        for process in services:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        for port in ports:
            with socket.socket() as sock: assert sock.connect_ex(('127.0.0.1',port)) != 0
        present=set(map(int,subprocess.check_output(['ps','-axo','pid='],text=True,timeout=2).split()))
        assert not present & (set(browser_pids) | {p.pid for p in services}), 'owned_pid_survived'
        print(json.dumps(dict(private_root=str(root),owned_service_pids=[p.pid for p in services],all_owned_services_waited=True,ports_closed=ports)))


if __name__ == '__main__': main()
