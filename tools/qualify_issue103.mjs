import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const [base,workspace,root,playwright,chrome,phase]=process.argv.slice(2);
const {chromium}=await import(pathToFileURL(playwright).href);
const browser=await chromium.launch({headless:true,executablePath:chrome});
process.once('SIGTERM',async()=>{await browser.close();process.exit(1);});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.setDefaultTimeout(15000);
const errors=[],saves=[],downloads=[],http=[],gates=[];
page.on('pageerror',error=>errors.push(error.message));
const fixture=JSON.parse(await readFile(root+'/fixture.json','utf8'));
await page.addInitScript(()=>{
  const actual=window.fetch.bind(window);
  window.sourceQualification={next:null,held:null,release:null,delivered:[],savePatch:null,patch:null};
  window.fetch=async(input,init)=>{
    const q=window.sourceQualification;
    if(String(input).endsWith('/api/investigations/save')&&q.savePatch){
      const request=JSON.parse(init.body),patch=q.savePatch;q.savePatch=null;
      if(patch==='action')request.bpic19_pipeline.actions[0].operation='python';
      else if(patch==='schema')request.schema_version=2;
      else if(patch==='version')request.bpic19_pipeline.schema_version=2;
      else request.expected_revision_id=patch;
      return actual(input,{...init,body:JSON.stringify(request)});
    }
    if(String(input).endsWith('/api/investigations/bpic19-profile')&&q.patch){
      const request=JSON.parse(init.body),[field,value]=q.patch;q.patch=null;
      if(field==='roles')request.query.roles=value;
      else request.query.source_interpretation[field]=value;
      return actual(input,{...init,body:JSON.stringify(request)});
    }
    if(!String(input).endsWith('/api/investigations/bpic19-profile')||!q.next)return actual(input,init);
    const kind=q.next;q.next=null;const request=JSON.parse(init.body);
    if(kind==='error')request.query.source_interpretation.policy_id='unsupported.source.v99';
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const response=await actual(input,{...init,body:JSON.stringify(request),signal:undefined});
    const payload=await response.json();q.held={kind,request,status:response.status,payload};q.release=release;
    response.json=async()=>{await gate;q.delivered.push(kind);return payload;};return response;
  };
});
const areas=page.getByRole('navigation',{name:'Areas'});
const profile=page.getByRole('region',{name:'Understand the purchasing flows',exact:true});
const expected={all_source:[['A','B','C'],[],7,0,2],document_start:[['C'],['A','B'],2,5,1],item_start:[['B','C'],['A'],4,3,2]};
const rowId=position=>fixture.row_ids[position];
async function post(route,action,status=200){
  const pending=page.waitForResponse(r=>r.url().endsWith(route)&&r.request().method()==='POST');
  pending.catch(()=>{});await action();const response=await pending;
  const body=await response.json();http.push({route,request:response.request().postDataJSON(),status:response.status(),body});
  assert.equal(response.status(),status,JSON.stringify(body));return body;
}
function check(output,kind){
  const p=output.profile,r=p.source_review;
  assert.deepEqual([p.population.case_count,p.population.record_count,p.population.document_count],[3,7,2]);
  assert.equal(r.source_id,'source.v1:sha256:'+fixture.source_sha256);
  assert.deepEqual(output.identity,fixture.identity);
  assert.equal(r.observed_raw_minimum,'1948-01-01T00:00:00Z');assert.equal(r.observed_raw_maximum,'2020-01-02T00:00:00Z');
  assert.equal(r.interpretation.horizon.value,'2019-01-28T00:00:00Z');assert.equal(r.horizon_state,'reviewed');
  assert.equal(r.discrepancies[0].difference,387);assert.equal(r.due_assessment,'unavailable');
  for(const [state,position]of [['before_reference_2017',0],['at_or_after_reference_2020',2],['after_trusted_horizon',2]]){
    const timestamp=position===0?'1948-01-01T00:00:00Z':'2020-01-02T00:00:00Z';
    assert.deepEqual(r.anomalies.find(a=>a.state===state),{state,record_count:1,case_count:1,omitted_witness_count:0,witnesses:[{case_id:'A',row_id:rowId(position),source_position:position,raw_timestamp:timestamp,interpreted_timestamp:timestamp}]});
  }
  assert.equal(r.interpretation.inclusion.kind,kind);assert.deepEqual(r.unavailable.case_ids,[]);
  if(kind==='record_projection'){
    assert.deepEqual(r.projection.case_ids,['A','B','C']);assert.equal(r.projection.record_count,5);
    assert.deepEqual(r.projection.row_ids,[1,3,4,5,6].map(rowId).sort());
  }else{
    const [retained,excluded,records,excludedRecords,documents]=expected[kind];
    assert.deepEqual(r.retained.case_ids,retained);assert.deepEqual(r.excluded.case_ids,excluded);
    assert.equal(r.retained.record_count,records);assert.equal(r.excluded.record_count,excludedRecords);assert.equal(r.retained.document_count,documents);
    assert.equal(r.excluded.document_count,kind==='all_source'?0:1);
    if(kind!=='all_source')for(const caseId of kind==='document_start'?['A','B']:['A'])assert.deepEqual(r.inclusion_evidence.find(e=>e.case_id===caseId),{case_id:caseId,reason:'earliest_raw_event_before_start',witness_case_ids:['A'],row_ids:[rowId(0)]});
  }
  return p.definition_id;
}
async function disclose(label){const summary=profile.getByText(label,{exact:true});if(await summary.locator('..').getAttribute('open')===null)await summary.click();}
async function ready(){await page.waitForFunction(()=>!document.querySelector('.bpic19-profile[aria-busy="true"]')&&!document.querySelector('.bpic19-answers[data-stale="true"]'));await page.waitForLoadState('networkidle');}
async function inspect(projected=false,caseId='A',allSource=false,future=false,sibling=false,documentStart=false){
  if(projected)assert((await profile.innerText()).includes('Derived record projection: 5 records across 3 items. Original histories remain complete.'));
  else if(!allSource){
    const text=await profile.innerText();
    if(caseId==='A')assert(text.includes(documentStart?"Item A: its document's earliest raw event before start.":'Item A: earliest raw event before start.'));
    else assert(text.includes(sibling?"Item B: its document's earliest raw event before start.":'Item '+caseId+': all raw events at or after start.'));
  }
  const anomaly=future?/^after trusted horizon:/:/^before reference 2017:/;
  if(allSource)await disclose(anomaly);
  const scope=allSource?profile.getByText(anomaly).locator('..'):profile;
  const button=scope.getByRole('button',{name:projected?'Inspect projected records in original '+caseId:allSource?'Inspect timestamp witness A':sibling?'Inspect original item '+caseId:'Inspect source inclusion '+caseId,exact:true}).first();
  const answer=await post('/api/investigations/case-evidence',async()=>{await button.focus();await page.keyboard.press('Enter');});
  assert.equal(answer.case_id,caseId);
  const positions=caseId==='A'?[0,1,2]:caseId==='B'?[3,4]:[5,6];
  assert.deepEqual(answer.records.map(r=>r.original_cells[0]),caseId==='A'?['h1','h2','h3']:caseId==='B'?['h4','h5']:['h6','h7']);
  assert.deepEqual(answer.records.map(r=>r.source_position),positions);
  assert.deepEqual(answer.records.map(r=>r.row_id),positions.map(rowId));
  assert.deepEqual(answer.records.map(r=>r.original_cells[3]),caseId==='A'?['1948-01-01T00:00:00Z','2018-01-01T00:00:00Z','2020-01-02T00:00:00Z']:['2018-01-02T00:00:00Z',caseId==='B'?'2018-01-03T00:00:00Z':'2018-01-04T00:00:00Z']);
  const panel=page.getByRole('region',{name:'Incident '+caseId,exact:true});
  assert.deepEqual(await panel.getByText(/^Contributing source record/).allTextContents(),(sibling?[]:caseId==='A'?[projected?1:future?2:0]:positions).map(p=>'Contributing source record · '+rowId(p)));
  assert.equal(await panel.locator('li.history-entry').count(),positions.length);
  await panel.getByRole('button',{name:'Return to incidents',exact:true}).click();
  return answer.records.map(r=>r.row_id);
}
async function savedListing(){
  const response=await page.request.post(base+'/api/investigations/list-saved',{data:{schema_version:1,message_type:'list_saved_request',request_id:'issue103-refusal-inventory',query_revision:1,workspace_id:fixture.workspace_id}});
  const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));return body.investigations;
}
async function save(){
  await page.getByRole('button',{name:'Save',exact:true}).first().click();
  const saved=await post('/api/investigations/save',()=>page.getByRole('button',{name:'Save revision',exact:true}).click());saves.push(saved);
  await page.getByRole('button',{name:'Close',exact:true}).click();return saved;
}
async function exported(kind,saved){
  for(const [extension,label]of [['json','Export saved definitions, results and witnesses'],['md','Export readable purchasing analysis report']]){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();
    const download=await pending,path=`${root}/${phase}-${downloads.length}-${kind}.${extension}`;await download.saveAs(path);const bytes=await readFile(path);
    if(extension==='json'){
      const machine=JSON.parse(bytes.toString());assert.equal(machine.revision.saved_revision_id,saved.revision.saved_revision_id);
      check(machine.manifest.outputs.filter(o=>o.operation==='bpic19_profile').at(-1).output,kind);
    }else{
      const md=bytes.toString().replaceAll('\\_','_');const outputs=saved.bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_profile');
      const definition=outputs.at(-1).definition_id;
      const sections=md.split(/(?=^### Step )/m);const current=sections.find(s=>s.includes(`Definition ${definition}. Output SHA-256 `));
      assert(current);assert(current.includes('| Synthetic report subtotal | 251734 | 251347 | 387 | 3 |'));
      if(kind!=='record_projection'){
        assert(current.includes(`retained complete-item IDs: ${expected[kind][0].join(', ')}.`));
        assert(current.includes(`excluded complete-item IDs: ${expected[kind][1].join(', ')||'none'}.`));
        assert(current.includes('unavailable complete-item IDs: none.'));
        if(kind!=='all_source')assert(current.includes(`| A | earliest_raw_event_before_start | A | ${rowId(0)} |`));
        if(kind==='document_start')assert(current.includes(`| B | earliest_raw_event_before_start | A | ${rowId(0)} |`));
      }else{
        assert(!current.includes('projection complete-item IDs:'));
        assert(!current.includes('retained complete-item IDs: none.'));assert(!current.includes('excluded complete-item IDs: none.'));
        assert(current.includes('Whole-item inclusion supports are not applicable to this derived record projection'));
        assert(current.includes('Items with projected records: A, B, C.'));
        assert(current.includes(`Derived projection original-row references: ${[1,3,4,5,6].map(rowId).sort().join(', ')}.`));
      }
      assert(current.includes('2019-01-28T00:00:00Z'));assert(current.includes('2020-01-02T00:00:00Z'));
    }
    downloads.push({kind,extension,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}
let originalError;
try{
  if(phase==='cleanup-primary'||phase==='cleanup-success'){
    await mkdir(root+'/'+phase+'-http.json');
    if(phase==='cleanup-primary')throw new Error('issue103_browser_control_primary');
  }else{
  await page.goto(base);await areas.getByRole('button',{name:'Data',exact:true}).click();
  await page.getByText('Use another folder',{exact:true}).click();await page.getByLabel('Folder path').fill(workspace);
  await post('/api/workspaces/open',()=>page.getByRole('button',{name:'Open workspace',exact:true}).click());
  if(phase==='review'){
    await areas.getByRole('button',{name:'Saved',exact:true}).click();
    await post('/api/investigations/reopen',()=>page.getByRole('button',{name:'Reopen Issue 103 source',exact:true}).click());
    await areas.getByRole('button',{name:'Purchasing analysis',exact:true}).click();
    await ready();await disclose('Source scope and observation review · Issue 103 all_source');
    assert((await profile.innerText()).includes('Raw parent: 3 items / 7 original records / 2 known documents.'));
    assert((await profile.innerText()).includes('Observation horizon: 2019-01-28T00:00:00Z; Synthetic H7 observation contract.'));
    await inspect(false,'A',true);await inspect(false,'A',true,true);const allSource=await save();
    check(allSource.bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_profile').at(-1).output,'all_source');
    await exported('all_source',allSource);
    for(const kind of ['document_start','record_projection','item_start']){
      await disclose('Reviewed source field roles');await disclose('Named source and observation policy');
      await profile.getByLabel('Source profile name',{exact:true}).fill('Issue 103 '+kind);
      await profile.getByRole('combobox',{name:/^Source inclusion/}).selectOption(kind);
      await profile.getByLabel('Inclusive source start',{exact:true}).fill('2018-01-01T00:00:00Z');
      if(kind==='record_projection')await profile.getByLabel('Exclusive projection end',{exact:true}).fill('2019-01-01T00:00:00Z');
      assert(await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled());
      const reviewed=await post('/api/investigations/bpic19-profile',()=>profile.getByRole('button',{name:'Review these field roles',exact:true}).click());check(reviewed,kind);
      await ready();
      await disclose('Source scope and observation review · Issue 103 '+kind);
      const rows={A:await inspect(kind==='record_projection','A',false,false,false,kind==='document_start')};
      rows.B=await inspect(kind==='record_projection','B',false,false,kind==='document_start');
      rows.C=await inspect(kind==='record_projection','C');
      if(kind!=='record_projection'){
        const r=reviewed.profile.source_review;
        assert.deepEqual(r.retained.case_ids.flatMap(id=>rows[id]).sort(),(kind==='document_start'?[5,6]:[3,4,5,6]).map(rowId).sort());
        assert.deepEqual(r.excluded.case_ids.flatMap(id=>rows[id]).sort(),(kind==='document_start'?[0,1,2,3,4]:[0,1,2]).map(rowId).sort());
      }
      const saved=await save();await exported(kind,saved);
    }
    const baseline=saves[0].revision.saved_revision_id;
    for(const [patch,code,status]of [[baseline,'revision_conflict',409],['action','unsupported_action',400],['schema','unsupported_schema',400],['version','invalid_request',400]]){
      const beforeRefusal=await savedListing();
      await page.getByRole('button',{name:'Save',exact:true}).first().click();
      await page.getByRole('textbox',{name:'Note',exact:true}).fill('Synthetic refusal '+code);
      await page.evaluate(patch=>{window.sourceQualification.savePatch=patch;},patch);
      const refusal=await post('/api/investigations/save',()=>page.getByRole('button',{name:'Save revision',exact:true}).click(),status);
      assert.equal(refusal.code,code);
      await page.getByRole('alert').filter({hasText:refusal.message}).waitFor();
      await page.getByRole('button',{name:'Close',exact:true}).click();
      assert.deepEqual(await savedListing(),beforeRefusal);
    }
    for(const mode of ['cancel','supersede','unreviewed'])for(const kind of ['success','error','page'])for(const parent of [false,true]){
      const tag=`${mode}-${kind}-${parent?'parent':'definition'}`;
      if(parent){
        await disclose('Source scope and observation review · '+saves.at(-1).bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_profile').at(-1).output.profile.source_review.interpretation.profile_name);
        await post('/api/investigations/select-cases',()=>profile.getByRole('button',{name:'Keep source inclusion',exact:true}).click());
        await ready();
      }
      await disclose('Reviewed source field roles');await disclose('Named source and observation policy');
      await page.evaluate(kind=>{window.sourceQualification.next=kind;window.sourceQualification.held=null;},kind);
      if(kind==='page'){
        await disclose('Case attributes and source grain');
        await disclose(/^item_category: 1 values/);
        await profile.getByRole('button',{name:'Review complete-item membership for 3-way match, invoice before GR',exact:true}).click();
      }else await profile.getByRole('button',{name:'Review these field roles',exact:true}).click();
      await page.waitForFunction(()=>window.sourceQualification.held!==null);
      const held=await page.evaluate(()=>window.sourceQualification.held);
      assert.equal(held.status,kind==='error'?422:200);
      assert(await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled());
      if(mode==='cancel')await profile.getByRole('button',{name:/Cancel/}).click();
      if(parent){
        const restored=await post('/api/investigations/select-cases',()=>page.getByRole('button',{name:'Undo',exact:true}).click());
        assert.deepEqual(restored.identity,fixture.identity);await ready();
      }else if(mode!=='cancel'){
        await areas.getByRole('button',{name:'Saved',exact:true}).click();
        await post('/api/investigations/reopen',()=>page.getByRole('button',{name:'Reopen Issue 103 source',exact:true}).click());
        await areas.getByRole('button',{name:'Purchasing analysis',exact:true}).click();await ready();
      }
      await disclose('Reviewed source field roles');await disclose('Named source and observation policy');
      await profile.getByLabel('Source profile name',{exact:true}).fill('Issue 103 current '+tag);
      assert(await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled());
      if(mode!=='unreviewed')check(await post('/api/investigations/bpic19-profile',()=>profile.getByRole('button',{name:'Review these field roles',exact:true}).click()),'item_start');
      if(mode!=='unreviewed')await ready();
      await page.evaluate(()=>window.sourceQualification.release());
      await page.waitForFunction(count=>window.sourceQualification.delivered.length===count,gates.length+1);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await profile.getByRole('alert').count(),0);
      if(mode==='unreviewed'){
        assert(await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled());
        for(const button of await profile.getByRole('button',{name:/Inspect source inclusion|Keep source inclusion/}).all())assert(await button.isDisabled());
        check(await post('/api/investigations/bpic19-profile',()=>profile.getByRole('button',{name:'Review these field roles',exact:true}).click()),'item_start');await ready();
      }
      assert(await page.getByRole('button',{name:'Save',exact:true}).first().isEnabled());
      const summary=profile.getByText('Source scope and observation review · Issue 103 current '+tag,{exact:true});
      assert.equal(await summary.count(),1);
      await disclose('Source scope and observation review · Issue 103 current '+tag);await inspect();
      const coherent=await save();
      const current=coherent.bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_profile').at(-1).output;
      assert.equal(current.profile.source_review.interpretation.profile_name,'Issue 103 current '+tag);
      check(current,'item_start');
      await exported('item_start',coherent);gates.push({mode,kind,parent,held,current:current.profile.definition_id,revision:coherent.revision.saved_revision_id});
    }
    for(const [field,value,code,location,message]of [
      ['policy_id','unsupported.source.v99','unsupported_policy','query.source_interpretation.policy_id','This named source interpretation policy is not supported.'],
      ['horizon',{timestamp_kind:'utc_instant',value:'2019-01-28T00:00:00Z',provenance:null},'invalid_parameter','query.source_interpretation.horizon.provenance','A trusted observation horizon requires reviewed evidence or provenance.'],
      ['roles',{source_case:10,item_category:4,item_type:5,goods_receipt:6,gr_based_iv:7,purchasing_document:99,item:9},'invalid_parameter','query.roles.purchasing_document',null],
    ]){
      await disclose('Reviewed source field roles');
      await page.evaluate(patch=>{window.sourceQualification.patch=patch;},[field,value]);
      const refusal=await post('/api/investigations/bpic19-profile',()=>profile.getByRole('button',{name:'Review these field roles',exact:true}).click(),422);
      assert.equal(refusal.code,code);assert.equal(refusal.field,location);if(message)assert.equal(refusal.message,message);
      await profile.getByRole('alert').filter({hasText:refusal.message}).waitFor();
      assert(await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled());
      check(await post('/api/investigations/bpic19-profile',()=>profile.getByRole('button',{name:'Review these field roles',exact:true}).click()),'item_start');await ready();
    }
    const beforeView=saves.at(-1);await page.setViewportSize({width:900,height:700});
    await disclose('Reviewed source field roles');await disclose('Named source and observation policy');
    const afterView=await save();assert.deepEqual(afterView.revision,beforeView.revision);assert.deepEqual(afterView.bpic19_outputs,beforeView.bpic19_outputs);
    await exported('item_start',saves.at(-1));
  }else if(phase==='reopen'||phase==='preparation-missing'){
    const before=JSON.parse(await readFile(root+'/review.json','utf8'));
    const saved=before.saves.at(-1);
    await areas.getByRole('button',{name:'Saved',exact:true}).click();
    const reopened=await post('/api/investigations/reopen',()=>page.getByRole('button',{name:'Reopen Issue 103 source',exact:true}).click());
    assert.deepEqual(reopened.revision,saved.revision);
    assert.deepEqual(reopened.bpic19_outputs,saved.bpic19_outputs);
    await areas.getByRole('button',{name:'Purchasing analysis',exact:true}).click();
    await disclose('Source scope and observation review · '+saved.bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_profile').at(-1).output.profile.source_review.interpretation.profile_name);await inspect();
    await exported('item_start',saved);
    assert.deepEqual(downloads,before.downloads.slice(-2));
  }else{
    const expected=JSON.parse(await readFile(root+'/fault.json','utf8'));
    await areas.getByRole('button',{name:'Saved',exact:true}).click();
    const refusal=await post('/api/investigations/reopen',()=>page.getByRole('button',{name:'Reopen Issue 103 source',exact:true}).click(),409);
    assert.equal(refusal.code,expected.code);assert.equal(refusal.field,expected.field);
    await page.getByRole('alert').filter({hasText:refusal.message}).waitFor();
    assert.equal(await profile.count(),0);
    for(const button of await page.getByRole('button',{name:'Save',exact:true}).all())assert(await button.isDisabled());
  }
  }
  assert.deepEqual(errors,[]);await writeFile(root+'/'+phase+'.json',JSON.stringify({saves,downloads,errors,gates},null,2));
}catch(error){originalError=error;throw error;}
finally{
  const cleanupErrors=[];
  try{await writeFile(root+'/'+phase+'-http.json',JSON.stringify(http,null,2));}catch(error){cleanupErrors.push(error);}
  try{await browser.close();}catch(error){cleanupErrors.push(error);}
  if(cleanupErrors.length){
    if(originalError)console.error('Cleanup diagnostics (original failure preserved):',cleanupErrors);
    else throw new AggregateError(cleanupErrors,'browser_cleanup_failed');
  }
}
