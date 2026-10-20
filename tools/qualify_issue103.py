"""Finite H7 source-policy qualification; no real source or normative run."""
import argparse
import hashlib
import json
from importlib.metadata import version
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import tomllib

import httpx

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/p) for p in ['apps/api/tests','packages/analytics/tests','tests']]
from qualify_issue105 import process_table, run_browser
from import_requests import envelope
from source_h7_literal import ROW_IDS, assert_profile, prepare, query, source


def main():
    parser=argparse.ArgumentParser()
    for name in ['node','playwright','chrome']:
        parser.add_argument('--'+name)
    parser.add_argument('--cleanup-control',choices=['primary','success'],help='Exercise diagnostic-write failure around a real owned service, without a browser.')
    args=parser.parse_args()
    if not args.cleanup_control and not all([args.node,args.playwright,args.chrome]):
        parser.error('--node, --playwright and --chrome are required for browser qualification')
    root=Path(tempfile.mkdtemp(prefix='wise-issue103-'));os.chmod(root,0o700)
    workspace=root/'workspace';workspace.mkdir()
    startup_workspace=root/'startup-workspace';startup_workspace.mkdir()
    processes=[];ports=[];browser_pids={}
    env={**os.environ,'HOME':str(root),'PYTHONDONTWRITEBYTECODE':'1',
         'PYTHONPATH':os.pathsep.join(str(ROOT/p) for p in ['apps/api/src','packages/analytics/src'])}
    def start():
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        code=('from pathlib import Path;import uvicorn;from wise_platform_api.app import create_app;'
              f'uvicorn.run(create_app(workspace_path=Path({str(startup_workspace)!r})),host="127.0.0.1",port={port},log_level="error")')
        process=subprocess.Popen([sys.executable,'-B','-c',code],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        processes.append(process);ports.append(port)
        client=httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=20,trust_env=False)
        for _ in range(200):
            assert process.poll() is None
            try:
                if client.get('/api/health').status_code==200:return process,client,port
            except httpx.TransportError:pass
            time.sleep(.05)
        raise RuntimeError('readiness_timeout')
    def stop(process,client):
        client.close()
        if process.poll() is None:process.terminate()
        try:process.wait(timeout=15)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
    def browser(port,phase,expected=0):
        with (root/(phase+'.log')).open('wb') as log:
            result=run_browser([args.node,str(ROOT/'tools/qualify_issue103.mjs'),f'http://127.0.0.1:{port}',
                str(workspace),str(root),args.playwright,args.chrome,phase],log,180,browser_pids)
        assert result==expected,str(root/(phase+'.log'))
    started=time.monotonic()
    try:
        if args.cleanup_control:
            process,client,port=start()
            (root/'cleanup.json').mkdir()
            if args.cleanup_control=='primary':raise RuntimeError('issue103_control_primary')
            return
        files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
        provenance=dict(head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),python=sys.version,
            api=tomllib.loads((ROOT/'pyproject.toml').read_text())['project']['version'],fastapi=version('fastapi'),
            node=subprocess.check_output([args.node,'--version'],text=True).strip(),
            playwright_sha256=hashlib.sha256(Path(args.playwright).read_bytes()).hexdigest(),
            chrome_sha256=hashlib.sha256(Path(args.chrome).read_bytes()).hexdigest(),
            files={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in files if (ROOT/p).is_file()},
            built={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'apps/api/src/wise_platform_api/static').rglob('*') if p.is_file()})
        assert provenance['built'] and (ROOT/'apps/api/src/wise_platform_api/static/index.html').is_file(),'production_build_missing'
        (root/'provenance.json').write_text(json.dumps(provenance,indent=2))
        process,client,port=start()
        wid,base=prepare(client,workspace)
        selected_response=client.post('/api/investigations/select-cases',json=envelope('select_cases_request',workspace_id=wid,identity=base,parent_case_ids=None,predicates=[]))
        assert selected_response.status_code==200,selected_response.text
        selected=selected_response.json()
        identity=selected['identity']
        given=envelope('bpic19_profile_request',workspace_id=wid,identity=identity,query=query('all_source'))
        answer=client.post('/api/investigations/bpic19-profile',json=given)
        assert answer.status_code==200,answer.text
        assert_profile(answer.json(),'all_source')
        seed=envelope('save_investigation_request',workspace_id=wid,investigation_id=None,expected_revision_id=None,
            name='Issue 103 source',base_identity=base,selection_identity=identity,
            selection_recipe=dict(parent_case_ids=['A','B','C'],predicates=[]),context_policy='incident.context.first_record_in_declared_order.v1',
            comparison=None,notes='Synthetic H7 only',bookmarks=[],bpic19_pipeline=dict(schema_version=1,actions=[dict(
                operation='bpic19_profile',identity=identity,query=given['query'],definition_id=answer.json()['profile']['definition_id'],selection_prefix_length=0)]))
        saved=client.post('/api/investigations/save',json=seed);assert saved.status_code==200,saved.text
        seed_saved=saved.json()
        seed_path=workspace/'investigations/revisions'/(seed_saved['revision']['saved_revision_id'].split(':')[-1]+'.json')
        seed_bytes=seed_path.read_bytes()
        (root/'fixture.json').write_text(json.dumps(dict(source_sha256=hashlib.sha256(source()).hexdigest(),identity=identity,workspace_id=wid,row_ids=ROW_IDS)))
        cleanup_controls=[]
        for mode in ['primary','success']:
            phase='cleanup-'+mode
            before=set(browser_pids)
            browser(port,phase,expected=1)
            log=(root/(phase+'.log')).read_text()
            assert ('Error: issue103_browser_control_primary' in log)==(mode=='primary'),log
            assert ('AggregateError: browser_cleanup_failed' in log)==(mode=='success'),log
            assert ('Cleanup diagnostics (original failure preserved)' in log)==(mode=='primary'),log
            assert 'EISDIR' in log,log
            owned=set(browser_pids)-before
            assert len(owned)>2,'control_did_not_launch_actual_browser'
            table=process_table()
            assert not any(pid in table and table[pid][1:]==browser_pids[pid] for pid in owned)
            cleanup_controls.append(dict(mode=mode,status=1,diagnostic='EISDIR',pids=sorted(owned),survivors=[]))
        browser(port,'review')
        proof=json.loads((root/'review.json').read_text())
        stop(process,client)
        assert seed_path.read_bytes()==seed_bytes
        immutable={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (workspace/'investigations/revisions').glob('*.json')}
        assert set(immutable)=={snapshot['revision']['saved_revision_id'].split(':')[-1]+'.json' for snapshot in [seed_saved,*proof['saves']]}
        process,client,port=start()
        assert processes[0].returncode is not None and processes[0].pid!=process.pid
        assert client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code==200
        assert len(proof['gates'])==18
        assert len(proof['saves'])==23
        for saved,kind in [(seed_saved,'all_source'),*zip(proof['saves'],['all_source','document_start','record_projection',*(['item_start']*20)],strict=True)]:
            response=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=saved['revision']['saved_revision_id']))
            assert response.status_code==200,response.text
            assert response.json()['revision']==saved['revision']
            assert response.json()['bpic19_outputs']==saved['bpic19_outputs']
            output=[entry['output'] for entry in response.json()['bpic19_outputs']['outputs'] if entry['operation']=='bpic19_profile'][-1]
            assert output['profile']['source_review']['interpretation']['inclusion']['kind']==kind
            assert_profile(output,kind)
        browser(port,'reopen')
        stop(process,client)
        assert immutable=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (workspace/'investigations/revisions').glob('*.json')}
        faults=[]
        current=proof['saves'][-1]['revision']
        for target in ['source','preparation','output']:
            mutations=[('missing','artifact_unavailable'),('checksum','checksum_mismatch')]
            if target=='preparation':mutations.extend([('malformed','checksum_mismatch'),('unreadable','artifact_unavailable')])
            for mutation,code in mutations:
                recovery=target=='preparation' and mutation=='missing'
                if target=='output':
                    path=workspace/'investigations/revisions'/(current['saved_revision_id'].split(':')[-1]+'.json')
                    field='results.bpic19_pipeline.outputs.0'
                else:
                    ref=current['content']['base_identity'][target+'_id']
                    path=workspace/(target+'s')/(ref.split(':')[-1]+('.csv' if target=='source' else '.json'))
                    field='base_identity.source_id' if target=='source' else 'saved_revision_id'
                original=path.read_bytes()
                before={str(p.relative_to(workspace)):hashlib.sha256(p.read_bytes()).hexdigest() for p in workspace.rglob('*') if p.is_file() and p!=path}
                fault_error=None
                try:
                    if target=='output':
                        damaged=json.loads(original);entry=damaged['results']['bpic19_pipeline']['outputs'][0]
                        if mutation=='missing':del entry['output']
                        else:entry['output']['profile']['population']['case_count']=999
                        path.write_text(json.dumps(damaged))
                    elif mutation=='missing':path.unlink()
                    elif mutation=='unreadable':path.unlink();path.mkdir()
                    elif target=='preparation' and mutation=='checksum':
                        damaged=json.loads(original);damaged['preparation']['mapping']['context_columns']=[]
                        path.write_text(json.dumps(damaged))
                    else:path.write_bytes(original+b'!')
                    injected='directory' if path.is_dir() else path.read_bytes() if path.exists() else None
                    process,client,port=start()
                    assert all(p.returncode is not None for p in processes[:-1])
                    assert client.post('/api/workspaces/open',json=envelope('open_workspace_request',path=str(workspace))).status_code==200
                    response=client.post('/api/investigations/reopen',json=envelope('reopen_investigation_request',workspace_id=wid,saved_revision_id=current['saved_revision_id']))
                    if recovery:
                        assert response.status_code==200,response.text
                        assert response.json()['revision']==current
                        assert response.json()['bpic19_outputs']==proof['saves'][-1]['bpic19_outputs']
                        recovered=json.loads(path.read_bytes());previous=json.loads(original)
                        assert {k:v for k,v in recovered.items() if k!='stored_utc'}=={k:v for k,v in previous.items() if k!='stored_utc'}
                        stop(process,client)
                        path.unlink()
                        process,client,port=start()
                        assert all(p.returncode is not None for p in processes[:-1])
                    else:
                        assert response.status_code==409 and response.json()['code']==code,response.text
                        assert response.json()['field']==field,response.text
                    if not recovery:(root/'fault.json').write_text(json.dumps(dict(code=code,field=field)))
                    phase=target+'-'+mutation;browser(port,phase)
                    stop(process,client)
                    if recovery:
                        recovered=json.loads(path.read_bytes())
                        assert {k:v for k,v in recovered.items() if k!='stored_utc'}=={k:v for k,v in previous.items() if k!='stored_utc'}
                    if not recovery:assert ('directory' if path.is_dir() else path.read_bytes() if path.exists() else None)==injected
                    after={str(p.relative_to(workspace)):hashlib.sha256(p.read_bytes()).hexdigest() for p in workspace.rglob('*') if p.is_file() and p!=path}
                    assert before==after,{key:dict(before=before.get(key),after=after.get(key)) for key in before.keys()|after.keys() if before.get(key)!=after.get(key)}
                    faults.append(dict(target=target,mutation=mutation,status=response.status_code,code=None if recovery else code,
                        field=None if recovery else field,pid=process.pid,exit=process.returncode,non_target_files_unchanged=True,
                        **(dict(exact_analytical_wrapper=True,previous_stored_utc=previous['stored_utc'],recovered_stored_utc=recovered['stored_utc']) if recovery else {})))
                except BaseException as error:
                    fault_error=error;raise
                finally:
                    cleanup_errors=[]
                    try:
                        if processes[-1].poll() is None:stop(process,client)
                    except Exception as error:cleanup_errors.append(error)
                    try:
                        if path.is_dir():path.rmdir()
                        path.write_bytes(original)
                    except Exception as error:cleanup_errors.append(error)
                    if cleanup_errors:
                        if fault_error is not None:fault_error.add_note('Fault cleanup: '+repr(cleanup_errors))
                        else:raise ExceptionGroup('fault_cleanup_failed',cleanup_errors)
                assert immutable=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (workspace/'investigations/revisions').glob('*.json')}
        result=dict(root=str(root),elapsed_seconds=time.monotonic()-started,services=[dict(pid=p.pid,exit=p.returncode) for p in processes],
                    ports=ports,browser_identities=browser_pids,immutable=immutable,faults=faults,cleanup_controls=cleanup_controls,
                    evidence={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir() if p.is_file()})
        (root/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
    finally:
        original_error=sys.exception()
        cleanup_errors=[]
        for process in processes:
            try:
                if process.poll() is None:
                    process.terminate()
                    try:process.wait(timeout=10)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            except Exception as error:cleanup_errors.append(repr(error))
        closed=[]
        for port in ports:
            try:
                with socket.socket() as sock:
                    if sock.connect_ex(('127.0.0.1',port))!=0:closed.append(port)
            except Exception as error:cleanup_errors.append(repr(error))
        survivors=None
        try:
            table=process_table()
            survivors=[pid for pid,birth in browser_pids.items() if pid in table and table[pid][1:]==birth]
        except Exception as error:cleanup_errors.append(repr(error))
        cleanup=dict(root=str(root),services=[dict(pid=p.pid,exit=p.returncode) for p in processes],ports=ports,
            all_services_waited=all(p.returncode is not None for p in processes),ports_closed=closed,browser_survivors=survivors,errors=cleanup_errors)
        try:
            (root/'cleanup.json').write_text(json.dumps(cleanup,indent=2))
        except Exception as error:cleanup_errors.append(repr(error))
        print(json.dumps(cleanup))
        if cleanup_errors or not cleanup['all_services_waited'] or survivors!=[] or closed!=ports:
            if original_error is not None:original_error.add_note('Cleanup diagnostics: '+repr(cleanup))
            else:raise RuntimeError('owned_cleanup_incomplete: '+repr(cleanup))


if __name__=='__main__':main()
