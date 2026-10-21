import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const [base, workspace, root, playwright, chrome] = process.argv.slice(2);
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({headless:true, executablePath:chrome});
process.once('SIGTERM',async()=>{await browser.close();process.exit(1);});
const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.setDefaultTimeout(15000);
const errors=[], saves=[], downloads=[], gates=[];
const http=[],httpPending=[];
page.on('response',response=>{
  if(response.request().method()==='POST'&&new URL(response.url()).pathname.startsWith('/api/'))httpPending.push((async()=>{
    const entry={route:new URL(response.url()).pathname,request:response.request().postDataJSON(),status:response.status()};
    try{entry.response=await response.json();}catch(error){entry.body_unavailable=String(error);}
    http.push(entry);
  })());
});
const fixture=JSON.parse(await readFile(root+'/fixture.json','utf8'));
const full={child:false,identity:fixture.identity};
const flowIds=['after_gr','before_gr','two_way','consignment'];
const fullIds=['B_1','C_1','D1_1','D1_2','D2_1','D3_1','F_1','G_1','M_1','U_1'];
function expected(column,scope){
  return column===4&&!scope.child?
    {members:[['D1_1'],['B_1','D1_2','F_1','G_1'],['D3_1'],['D2_1']],records:[2,6,1,1],documents:[1,3,1,1],unresolved:[1,1,1],checks:[5,4,1]}:
    {members:[[],[],[],['D2_1']],records:[0,0,0,1],documents:[0,0,0,1],unresolved:[0,0,scope.child?0:9],checks:[1,scope.child?0:9,0]};
}
async function paused(){
  assert(await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled());
  for(const button of await profile.getByRole('button',{name:/^(Keep |Inspect )/}).all())assert(await button.isDisabled());
  assert.equal(await profile.locator('.bpic19-answers').getAttribute('data-stale'),'true');
}
async function visible(column,scope){
  await current(column);
  const e=expected(column,scope),table=profile.getByRole('table',{name:'Purchasing flow at PO-item grain',exact:true});
  const rows=table.locator('tbody tr');assert.equal(await rows.count(),4);
  for(let i=0;i<4;i++){
    const cells=await rows.nth(i).locator('td').allTextContents();
    assert.equal(cells[0],String(e.members[i].length));assert.equal(cells[2],String(e.records[i]));assert.equal(cells[3],String(e.documents[i]));
  }
  assert.match(await profile.locator('.bpic19-population').innerText(),scope.child?/^1 PO items · 1 original records · 1 purchasing documents/:/^10 PO items · 14 original records · 8 purchasing documents/);
  await disclose(profile.getByText('Case attributes and source grain',{exact:true}));
  const attributes=profile.getByText(new RegExp('^row_id: '+(scope.child?1:14)+' values')).locator('..');
  await disclose(attributes.locator('summary').first());
  const values=await attributes.locator(':scope > ul > li').allTextContents();
  assert.deepEqual(values.map(v=>v.split(':')[0]),scope.child?['f05']:Array.from({length:12},(_,i)=>'f'+String(i+1).padStart(2,'0')));
  const evidence=await post('/api/investigations/case-evidence',()=>table.locator('tbody tr').nth(3).getByRole('button',{name:'Inspect an item',exact:true}).click());
  assert.equal(evidence.case_id,'D2_1');assert.deepEqual(evidence.identity,scope.identity);
  assert.deepEqual(evidence.records.map(r=>r.original_cells),[fixture.rows[4]]);
  const inspector=page.getByRole('region',{name:'Case D2_1',exact:true});
  await inspector.getByText('Original cells',{exact:true}).click();
  assert.deepEqual(await inspector.locator('.history-cells dd').allTextContents(),fixture.rows[4].map(v=>v||'missing'));
  await inspector.getByRole('button',{name:'Return to cases',exact:true}).click();
}
const nativeRequests=[];
page.on('pageerror', error=>errors.push(error.message));
page.on('request',request=>{if(/\/(bpic19-score|score)$/.test(new URL(request.url()).pathname))nativeRequests.push(request.url());});
await page.addInitScript(()=>{
  const actual=window.fetch.bind(window);
  window.flowQualification={next:null,held:null,delivered:[],release:null,patch:null,refusals:[],savePatch:null,saveRefusals:[]};
  window.fetch=async(input,init)=>{
    const q=window.flowQualification;
    if(String(input).endsWith('/api/investigations/save')&&q.savePatch){
      const request=JSON.parse(init.body),patch=q.savePatch;q.savePatch=null;
      if(patch==='action')request.bpic19_pipeline.actions[0].operation='python';
      else if(patch==='pipeline_version')request.bpic19_pipeline.schema_version=2;
      else if(patch==='schema')request.schema_version=2;
      else request.expected_revision_id=patch;
      const response=await actual(input,{...init,body:JSON.stringify(request)});
      q.saveRefusals.push(await response.clone().json());return response;
    }
    if(String(input).endsWith('/api/investigations/bpic19-profile')&&q.patch){
      const request=JSON.parse(init.body);Object.assign(request.query,q.patch);q.patch=null;
      const response=await actual(input,{...init,body:JSON.stringify(request)});
      q.refusals.push(await response.clone().json());return response;
    }
    if(!String(input).endsWith('/api/investigations/bpic19-profile')||!q.next)return actual(input,init);
    const kind=q.next;q.next=null;
    const request=JSON.parse(init.body);
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    // This public HTTP boundary deliberately ignores cancellation. The service
    // really answers; no React state, private collaborator, or expected data is injected.
    const response=await actual(input,{...init,signal:undefined});
    const payload=await response.json();
    q.held={kind,request,status:response.status,payload};q.release=release;
    response.json=async()=>{await gate;q.delivered.push({kind,request_id:request.request_id});return payload;};
    return response;
  };
});
const profile=page.getByRole('region',{name:'Understand the purchasing flows',exact:true});
const areas=page.getByRole('navigation',{name:'Areas'});
const review=profile.getByRole('button',{name:'Review these field roles',exact:true});
const category=profile.getByRole('combobox',{name:'Purchasing flow (Item Category)',exact:true,includeHidden:true});
const type=profile.getByRole('combobox',{name:'Item Type',exact:true,includeHidden:true});
async function post(route,action,status=200){
  const pending=page.waitForResponse(r=>r.url().endsWith(route)&&r.request().method()==='POST');
  pending.catch(()=>{});
  await action();const response=await pending;
  assert.equal(response.status(),status,await response.text());return response.json();
}
async function bindings(){if(await profile.locator('details.bpic19-bindings').getAttribute('open')===null)await profile.getByText('Reviewed source field roles',{exact:true}).click();}
async function disclose(locator){if(await locator.locator('..').getAttribute('open')===null)await locator.click();}
async function current(column){
  await page.waitForFunction(()=>!document.querySelector('.bpic19-profile[aria-busy="true"]'));
  assert.equal(await profile.locator('.bpic19-role-grid select').first().inputValue(),String(column));
  assert.notEqual(await profile.locator('.bpic19-answers').getAttribute('data-stale'),'true');
  assert.equal(await profile.getByRole('alert').count(),0);
}
async function choose(column){
  await bindings();await category.selectOption(String(column));await type.selectOption(column===4?'5':'4');
  await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled().then(v=>assert(v));
  const answer=await post('/api/investigations/bpic19-profile',()=>review.click());
  await current(column);return answer;
}
async function save(){
  await page.getByRole('button',{name:'Save',exact:true}).first().click();
  const saved=await post('/api/investigations/save',()=>page.getByRole('button',{name:'Save revision',exact:true}).click());
  saves.push(saved);
  const close=page.getByRole('button',{name:'Close',exact:true});if(await close.count())await close.click();
  await page.waitForLoadState('networkidle');return saved;
}
async function exported(tag,column,scope){
  const e=expected(column,scope);let currentDefinition;
  for(const [kind,label] of [['json','Export saved definitions, results and witnesses'],['md','Export readable purchasing analysis report']]){
    const pending=page.waitForEvent('download');pending.catch(()=>{});await page.getByRole('button',{name:label,exact:true}).click();
    const d=await pending;const path=root+'/'+tag+'.'+kind;await d.saveAs(path);const raw=await readFile(path);
    if(kind==='json'){
      const result=JSON.parse(raw);const outputs=result.manifest.outputs.filter(o=>o.operation==='bpic19_profile');
      const actions=saves.at(-1).revision.content.bpic19_pipeline.actions.filter(a=>a.operation==='bpic19_profile');
      assert.deepEqual(outputs.map(o=>o.definition_id),actions.map(a=>a.definition_id));
      assert.equal(outputs.at(-1).output.profile.definition.roles.item_category,column);
      const p=outputs.at(-1).output.profile;
      assert.deepEqual(outputs.at(-1).output.identity,scope.identity);
      assert.deepEqual(actions.at(-1).identity,scope.identity);
      assert.deepEqual(p.flows.map(f=>f.case_ids),e.members);
      assert.deepEqual([...p.flows,...p.unresolved].flatMap(f=>f.case_ids).sort(),scope.child?['D2_1']:fullIds);
      assert.deepEqual(p.population,{case_count:scope.child?1:10,record_count:scope.child?1:14,document_count:scope.child?1:8,document_unknown_case_count:scope.child?0:1});
      currentDefinition=p.definition_id;
      if(column===4&&!scope.child){
        assert.deepEqual(Object.fromEntries(p.unresolved.map(f=>[f.state,f.case_ids])),{missing:['M_1'],conflicting:['C_1'],unrecognized:['U_1']});
        assert.deepEqual(Object.fromEntries(p.cross_checks.map(f=>[f.state,f.case_ids])),{valid:['D1_1','D1_2','D2_1','D3_1','G_1'],unavailable:['B_1','C_1','M_1','U_1'],flag_disagreement:['F_1']});
      }
      assert.equal(result.revision.saved_revision_id,saves.at(-1).revision.saved_revision_id);
    }else{
      const text=raw.toString('utf8').replaceAll('\\_','_');
      assert(text.length>1000);assert(text.includes(saves.at(-1).revision.saved_revision_id));assert(text.includes(scope.identity.population_id));
      assert(text.includes('Bounded parent IDs: '+fullIds.join(', ')+'.'));
      assert(text.includes(scope.child?'Include explicit complete-item IDs: D2_1 (predicate definition, not final population)':'No additional selection predicates.'));
      assert(text.includes('[machine investigation export](purchasing-investigation.json)'));
      const section=text.split('### Step ').filter(s=>s.includes('Definition '+currentDefinition+'.')).at(-1);
      assert(section,'current definition is present in readable report');
      for(const [role,value] of [['item_category',column],['item_type',column===4?5:4],['goods_receipt',6],['gr_based_iv',7],['purchasing_document',8],['item',9],['source_case',10]])assert(section.includes(`| ${role} | ${value} |`));
      for(let i=0;i<4;i++)assert(section.split('\n').some(line=>line.startsWith('| '+flowIds[i]+' |')&&line.includes(` | ${e.members[i].length} | ${e.records[i]} | ${e.documents[i]} |`)));
      for(const [state,count] of [['missing',e.unresolved[0]],['conflicting',e.unresolved[1]],['unrecognized',e.unresolved[2]],['valid',e.checks[0]],['unavailable',e.checks[1]],['flag_disagreement',e.checks[2]]])assert(section.includes(`| ${state} | ${count} |`));
      for(const meaning of ['supplied_exact_invariant_category','bpic19.category_flags_and_consignment_type.v1','bpic19.all_raw_case_attributes.v1','Consignment','3-way match, invoice before GR','3-way match, invoice after GR','2-way match'])assert(section.includes(meaning));
      assert(section.includes('Complete source witnesses are retained'));
      assert(text.includes('not promoted to literature reproduction, causality, realised savings or business adoption'));
      assert(text.includes('complete rows are retained in the machine export')||text.includes('complete PO items/cases'));
    }
    downloads.push({tag,kind,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});
  }
}
try{
  await page.goto(base);await areas.getByRole('button',{name:'Data',exact:true}).click();
  if(!await page.getByLabel('Folder path').isVisible())await page.getByText('Use another folder',{exact:true}).click();
  await page.getByLabel('Folder path').fill(workspace);
  await post('/api/workspaces/open',()=>page.getByRole('button',{name:'Open workspace',exact:true}).click());
  await areas.getByRole('button',{name:'Saved',exact:true}).click();
  await post('/api/investigations/reopen',()=>page.getByRole('button',{name:'Reopen Issue 105 F10',exact:true}).click());
  await areas.getByRole('button',{name:'Purchasing analysis',exact:true}).click();
  await review.waitFor();await bindings();
  for(const [name,column] of [['Purchasing flow (Item Category)',4],['Item Type',5],['Goods Receipt setting',6],['GR-Based Invoice Verification setting',7],['Purchasing document',8],['Document item',9],['Original source case identifier (optional)',10]]){
    await profile.getByRole('combobox',{name,exact:true}).selectOption(String(column));
  }
  await profile.getByText('Additional attributes to profile',{exact:true}).click();
  await profile.getByRole('checkbox',{name:'row_id',exact:true}).check();
  await post('/api/investigations/bpic19-profile',()=>review.click());await current(4);
  await bindings();await category.selectOption('');
  assert(await review.isDisabled());
  await paused();
  await category.selectOption('5');
  const invalidRole=await post('/api/investigations/bpic19-profile',()=>review.click(),422);
  assert.equal(invalidRole.code,'invalid_parameter');assert.equal(invalidRole.field,'query.roles');
  await profile.getByRole('alert').waitFor();
  await paused();
  await choose(4);
  await save();await exported('A',4,full);
  await writeFile(root+'/snapshot-ready.json',JSON.stringify({revision:saves.at(-1).revision.saved_revision_id}));
  for(let i=0;;i++){
    try{await readFile(root+'/snapshot-ack');break;}catch(error){if(error.code!=='ENOENT'||i>400)throw error;await new Promise(resolve=>setTimeout(resolve,50));}
  }
  let column=4;
  for(const mode of ['cancel','supersede','unreviewed'])for(const [kind,changeParent] of [['success',false],['error',false],['page',false],['success',true],['error',true],['page',true]]){
    const tag=mode+'-'+kind+(changeParent?'-parent':'-definition');
    await save();
    let scope=full;
    if(changeParent&&mode!=='cancel'){
      const child=await post('/api/investigations/select-cases',()=>profile.getByRole('table',{name:'Purchasing flow at PO-item grain',exact:true}).getByRole('button',{name:'Keep Consignment',exact:true}).click());
      scope={child:true,identity:child.identity};await current(column);
    }
    await bindings();
    if(kind==='error'){
      // Distinct but invalid role binding obtains a real typed service refusal.
      await category.selectOption(column===4?'5':'4');
    }
    await page.evaluate(kind=>{window.flowQualification.next=kind;window.flowQualification.held=null;},kind);
    if(kind==='page'){
      await disclose(profile.getByText('Case attributes and source grain',{exact:true}));
      if(scope.child){
        await disclose(profile.getByText(/^row_id: 1 values/));
        await profile.getByRole('button',{name:'Review complete-item membership for f05',exact:true}).click();
      }else{
        await disclose(profile.getByText(/^row_id: 14 values/));
        await profile.getByRole('button',{name:'Next values for column 0: row_id',exact:true}).click();
      }
    }else await review.click();
    await page.waitForFunction(()=>window.flowQualification.held!==null);
    const held=await page.evaluate(()=>window.flowQualification.held);
    assert.equal(held.status,kind==='error'?422:200);
    if(mode==='cancel')await profile.getByRole('button',{name:'Cancel source review',exact:true}).click();
    else if(changeParent){
      const restored=await post('/api/investigations/select-cases',()=>page.getByRole('button',{name:'Undo',exact:true}).click());
      assert.deepEqual(restored.identity,full.identity);scope=full;await current(column);
    }else{
      await areas.getByRole('button',{name:'Saved',exact:true}).click();
      await post('/api/investigations/reopen',()=>page.getByRole('button',{name:'Reopen Issue 105 F10',exact:true}).click());
      await areas.getByRole('button',{name:'Purchasing analysis',exact:true}).click();
      await current(column);
    }
    column=column===4?5:4;
    let newer;
    if(mode==='unreviewed'){
      await bindings();await category.selectOption(String(column));await type.selectOption(column===4?'5':'4');await paused();
    }else newer=await choose(column);
    if(changeParent&&mode==='cancel'){
      const keep=profile.getByRole('table',{name:'Purchasing flow at PO-item grain',exact:true}).getByRole('button',{name:'Keep Consignment',exact:true});
      const child=await post('/api/investigations/select-cases',()=>keep.click());scope={child:true,identity:child.identity};
      await page.waitForLoadState('networkidle');
      await current(column);
    }
    await page.evaluate(()=>window.flowQualification.release());
    await page.waitForFunction(n=>window.flowQualification.delivered.length===n,gates.length+1);
    // Two rendered frames follow the resolved real JSON and synchronous HTTP-client validation.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(mode==='unreviewed'){
      await paused();assert.equal(await profile.getByRole('alert').count(),0);
      newer=await post('/api/investigations/bpic19-profile',()=>review.click());
    }
    await visible(column,scope);
    const saved=await save();
    const action=saved.revision.content.bpic19_pipeline.actions.filter(a=>a.operation==='bpic19_profile').at(-1);
    assert.equal(action.query.roles.item_category,column);
    if(!scope.child)assert.equal(action.definition_id,newer.profile.definition_id);
    await exported('current-'+tag,column,scope);gates.push({mode,kind,changeParent,held,expected_scope:scope,new_definition:action.definition_id,revision:saved.revision.saved_revision_id});
    if(scope.child){
      await post('/api/investigations/select-cases',()=>page.getByRole('button',{name:'Undo',exact:true}).click());
      await page.waitForLoadState('networkidle');await current(column);
      assert.match(await profile.locator('.bpic19-population').innerText(),/^10 PO items/);
    }
  }
  await save();
  const before=saves.at(-1).revision.saved_revision_id;
  const noOp=await save();assert.equal(noOp.revision.saved_revision_id,before);assert.equal(noOp.semantic_change,false);
  for(const [field,value,code] of [
    ...['after_gr','before_gr','two_way','consignment'].map(flow=>['category_labels',{[flow]:'unreviewed label'},'invalid_request']),
    ['policy_id','first_record.v1','unsupported_policy'],
    ['invariance_policy','majority','invalid_request'],
    ['flag_policy','infer_category','invalid_request'],
    ['unresolved_treatment','largest_flow','invalid_request'],
  ]){
    await bindings();await page.evaluate(([field,value])=>{window.flowQualification.patch={[field]:value};},[field,value]);
    const refusal=await post('/api/investigations/bpic19-profile',()=>review.click(),field==='policy_id'?422:400);
    assert.equal(refusal.code,code);assert.equal(refusal.field,'query.'+field);
    await profile.getByRole('alert').waitFor();
    assert((await profile.getByRole('alert').innerText()).includes(refusal.message));
    await paused();
    assert.match(await profile.locator('.bpic19-population').innerText(),/^10 PO items/);
    await post('/api/investigations/bpic19-profile',()=>profile.getByRole('button',{name:'Retry source profile',exact:true}).click());
    await current(column);
    await visible(column,full);
  }
  await page.setViewportSize({width:900,height:700});
  await profile.getByRole('combobox',{name:'Purchasing flow',exact:true}).selectOption('consignment');
  const presentation=await save();assert.equal(presentation.revision.saved_revision_id,before);assert.equal(presentation.semantic_change,false);
  assert.deepEqual(presentation.revision,noOp.revision);assert.deepEqual(presentation.bpic19_outputs,noOp.bpic19_outputs);
  await exported('presentation',column,full);
  for(const [mutation,code] of [['action','unsupported_action'],['pipeline_version','invalid_request'],['schema','unsupported_schema'],[saves[0].revision.saved_revision_id,'revision_conflict']]){
    await page.getByRole('button',{name:'Save',exact:true}).first().click();
    // Force a semantic edit so the current-revision no-op optimization cannot
    // bypass the public service refusal being qualified.
    const notes=page.getByRole('textbox',{name:/Notes/i});
    if(await notes.count())await notes.fill('Refusal control '+code);
    await page.evaluate(value=>{window.flowQualification.savePatch=value;},mutation);
    const refused=await post('/api/investigations/save',()=>page.getByRole('button',{name:'Save revision',exact:true}).click(),code==='revision_conflict'?409:400);
    assert.equal(refused.code,code);
    await page.getByRole('alert').filter({hasText:refused.message}).waitFor();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await visible(column,full);
    for(const label of ['Export saved definitions, results and witnesses','Export readable purchasing analysis report']){
      const buttons=page.getByRole('button',{name:label,exact:true});
      for(const button of await buttons.all())assert(await button.isDisabled());
    }
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(nativeRequests,[]);
  const delivered=await page.evaluate(()=>window.flowQualification.delivered);
  const refusals=await page.evaluate(()=>window.flowQualification.refusals);
  const saveRefusals=await page.evaluate(()=>window.flowQualification.saveRefusals);
  await Promise.all(httpPending);await writeFile(root+'/http.json',JSON.stringify(http,null,2));
  await writeFile(root+'/browser.json',JSON.stringify({success:true,saves,downloads,gates,delivered,refusals,saveRefusals,invalidRole,errors,nativeRequests,presentation_previous_revision:before},null,2));
}catch(error){console.error(error);console.error(await page.locator('body').innerText());throw error;}
finally{await browser.close();}
