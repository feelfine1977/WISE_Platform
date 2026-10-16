import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const [base,workspace,root,playwright,chrome,phase]=process.argv.slice(2);
const {chromium}=await import(pathToFileURL(playwright).href);
const browser=await chromium.launch({headless:true,executablePath:chrome});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.setDefaultTimeout(12000);
const errors=[],http=[],pending=[],saves=[],downloads=[],gates=[],mutationEvidence=[],markdownControls=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.request().method()==='POST'&&r.url().includes('/api/'))pending.push((async()=>{
  const entry={route:new URL(r.url()).pathname,status:r.status(),request:r.request().postDataJSON()};
  try{entry.response=await r.json();}catch(e){entry.body_unavailable=String(e);}http.push(entry);
})());});
const fixture=JSON.parse(await readFile(root+'/fixture.json','utf8'));
const areas=page.getByRole('navigation',{name:'Areas'});
const comparison=page.getByRole('region',{name:'Compare the reviewed item types',exact:true});
const profile=page.getByRole('region',{name:'Understand the purchasing flows',exact:true});
const limitations=[
  'This is a descriptive count comparison; it does not estimate a causal subtype effect.',
  'Item and record shares use the named union comparison parent, not the entire source or target complement.',
  'Document memberships can overlap; their summed supports are not a count of distinct documents.',
  'Amount and interval comparisons require their separately admitted measure definitions.',
];
function expectedBase(swapped){
  return {parent:[['B_1','C_1','D1_1','D1_2','D2_1','D3_1','D4_1','F_1','G_1','I_1','M_1','Q_1','U_1','X_1','X_2','Y_1','Z_1'],24,14],
    flow_parent:[['D1_1','D4_1','I_1','Q_1','X_1','X_2','Y_1','Z_1'],12,7],comparison_parent:[['D1_1','D4_1','X_1','X_2'],6,3],
    target:swapped?[['D1_1','X_2'],4,2]:[['D4_1','X_1'],2,2],reference:swapped?[['D4_1','X_1'],2,2]:[['D1_1','X_2'],4,2],
    outside:[['I_1','Q_1','Y_1','Z_1'],6,4],unavailable:[['I_1','Y_1','Z_1'],5,3],scope_unavailable:[['C_1','M_1','U_1'],4,3],
    outside_flow:[['B_1','C_1','D1_2','D2_1','D3_1','F_1','G_1','M_1','U_1'],12,8],
    documents:['D1','D4','X'],overlap:['X'],shares:[4,6,.5,.5,swapped?2/3:1/3,swapped?1/3:2/3,null],
    item_type:5,target_value:swapped?'Service':'Standard',reference_value:swapped?'Standard':'Service'};
}
function checkExpected(answer,e){
  const c=answer.comparison;
  for(const key of ['parent','flow_parent','comparison_parent','target','reference','outside','unavailable','outside_flow','scope_unavailable']){
    const [ids,records,documents]=e[key];
    assert.deepEqual([c[key].case_ids,c[key].case_count,c[key].record_count,c[key].document_count],[ids,ids.length,records,documents],key);
  }
  assert.deepEqual(c.shares,Object.fromEntries(['item_denominator','record_denominator','target_item_share','reference_item_share','target_record_share','reference_record_share','reason'].map((key,i)=>[key,e.shares[i]])));
  assert.deepEqual(c.documents,{union_document_ids:e.documents,union_document_count:e.documents.length,overlap_document_ids:e.overlap,overlap_document_count:e.overlap.length,
    target_document_count:e.target[2],reference_document_count:e.reference[2],unknown_document_case_ids:[],supports_overlap:e.overlap.length>0});
  for(const definition of [answer.query,answer.definition,c.definition]){
    assert.deepEqual(definition.profile_query.roles,{item_category:4,item_type:e.item_type,goods_receipt:6,gr_based_iv:7,purchasing_document:8,item:9,source_case:10});
    assert.deepEqual(definition.target,{flow_id:'after_gr',item_type_state:'invariant',item_type_value:e.target_value});
    assert.deepEqual(definition.reference,{flow_id:'after_gr',item_type_state:'invariant',item_type_value:e.reference_value??'Service'});
  }
  assert.deepEqual(c.limitations,limitations);
}
function reportSection(text,saved){
  const actions=saved.revision.content.bpic19_pipeline.actions;
  const index=actions.findLastIndex(a=>a.operation==='bpic19_flow_comparison');
  const sections=text.split(/(?=^#{2,3} )/m),heading=`### Step ${index+1}: bpic19_flow_comparison\n`;
  const matches=sections.filter(s=>s.startsWith(heading));assert.equal(matches.length,1,'exact current action section');
  assert(matches[0].includes(`\nDefinition ${actions[index].definition_id}. Output SHA-256 `),'current definition, not retained A');
  return matches[0];
}
function assertReadable(text,saved,e){
  const section=reportSection(text,saved);
  function block(heading){
    const parts=section.split(heading+'\n\n');assert.equal(parts.length,2,heading);
    return parts[1].split(/\n(?:\*\*|[a-z_]+:)/)[0];
  }
  for(const [heading,value] of [['Target subgroup predicate',e.target_value],['Comparator subgroup predicate',e.reference_value??'Service']]){
    const predicate=block(`**${heading}**`);
    for(const [key,expected] of [['flow_id','after_gr'],['item_type_state','invariant'],['item_type_value',value]])assert(predicate.includes(`| ${key} | ${expected} |`),heading+': '+key);
  }
  assert(block('**Original-column role bindings**').includes(`| item_type | ${e.item_type} |`));
  for(const key of ['target','reference','outside','unavailable']){
    const [,records,documents]=e[key],support=block(key+':');
    for(const [field,value] of [['case_count',e[key][0].length],['record_count',records],['document_count',documents]])assert(support.includes(`| ${field} | ${value} |`),key+': '+field);
  }
  for(const key of ['parent','flow_parent','comparison_parent','target','reference','outside','unavailable','scope_unavailable']){
    const ids=e[key][0],preview=ids.length?ids.slice(0,10).join(', ')+(ids.length>10?`; ${ids.length-10} further IDs in the machine export`:''):'none';
    assert(section.split('\n').includes(`${key} complete-item IDs: ${preview}.`),key+' exact bounded members');
  }
  for(const [key,ids] of [['union_document_ids',e.documents],['overlap_document_ids',e.overlap],['unknown_document_case_ids',[]]])assert(section.split('\n').includes(`${key}: ${ids.join(', ')||'none'}.`),key);
  const shares=block('shares:');
  for(const [key,i] of [['item_denominator',0],['record_denominator',1],['target_item_share',2],['reference_item_share',3],['target_record_share',4],['reference_record_share',5],['reason',6]])assert(shares.includes(`| ${key} | ${e.shares[i]??'unavailable / not supplied'} |`),key);
  for(const limitation of limitations)assert(block('**Recorded limitations**').includes('- '+limitation),limitation);
  return section;
}
await page.addInitScript(()=>{
  const actual=window.fetch.bind(window);
  window.subtypeQualification={next:null,held:null,release:null,delivered:[],patch:null,savePatch:null};
  window.fetch=async(input,init)=>{
    const q=window.subtypeQualification,url=String(input);
    if(url.endsWith('/api/investigations/save')&&q.savePatch){
      const request=JSON.parse(init.body),patch=q.savePatch;q.savePatch=null;
      if(patch==='action')request.bpic19_pipeline.actions.at(-1).operation='python';
      else if(patch==='version')request.bpic19_pipeline.schema_version=2;
      else if(patch==='schema')request.schema_version=2;
      else request.expected_revision_id=patch;
      return actual(input,{...init,body:JSON.stringify(request)});
    }
    if(!url.endsWith('/api/investigations/bpic19-flow-comparison'))return actual(input,init);
    const request=JSON.parse(init.body);
    if(q.patch){Object.assign(request.query,q.patch);q.patch=null;return actual(input,{...init,body:JSON.stringify(request)});}
    if(!q.next)return actual(input,init);
    const kind=q.next;q.next=null;
    if(kind==='error')request.query.reference=structuredClone(request.query.target);
    let release;const gate=new Promise(resolve=>{release=resolve;});
    // Deliver actual HTTP JSON even when its original consumer has cancelled.
    const response=await actual(input,{...init,body:JSON.stringify(request),signal:undefined});
    const payload=await response.json();q.held={kind,request,status:response.status,payload};q.release=release;
    response.json=async()=>{await gate;q.delivered.push(kind);return payload;};return response;
  };
});
async function post(route,action,status=200){
  const wait=page.waitForResponse(r=>r.url().endsWith(route)&&r.request().method()==='POST');wait.catch(()=>{});
  await action();const r=await wait;assert.equal(r.status(),status,await r.text());return r.json();
}
async function ready(empty=false){
  await page.waitForFunction(()=>!document.querySelector('.bpic19-profile[aria-busy="true"]'));
  assert.equal(await comparison.getByRole('button',{name:'Keep target',exact:true}).isEnabled(),!empty);
}
function check(answer,swapped){
  checkExpected(answer,expectedBase(swapped));
  const c=answer.comparison;
  assert.deepEqual(c.parent.case_ids,['B_1','C_1','D1_1','D1_2','D2_1','D3_1','D4_1','F_1','G_1','I_1','M_1','Q_1','U_1','X_1','X_2','Y_1','Z_1']);
  assert.equal(c.parent.record_count,24);
  assert.deepEqual(c.target.case_ids,swapped?['D1_1','X_2']:['D4_1','X_1']);
  assert.deepEqual(c.reference.case_ids,swapped?['D4_1','X_1']:['D1_1','X_2']);
  assert.deepEqual(c.outside.case_ids,['I_1','Q_1','Y_1','Z_1']);
  assert.deepEqual(c.unavailable.case_ids,['I_1','Y_1','Z_1']);
  assert.deepEqual(c.documents.overlap_document_ids,['X']);assert.equal(c.documents.union_document_count,3);
  assert.equal(c.shares.item_denominator,4);assert.equal(c.shares.record_denominator,6);
  assert.equal(c.shares.target_item_share,.5);assert.equal(c.shares.target_record_share,swapped?2/3:1/3);
  assert.equal(answer.query.target.item_type_value,swapped?'Service':'Standard');
  assert.equal(answer.definition.document_policy,'all_record_invariant_document_overlap_preserved');
}
async function visible(swapped){
  await ready();
  assert((await comparison.innerText()).includes(`Target: after gr × ${swapped?'Service':'Standard'}. Comparator: after gr × ${swapped?'Standard':'Service'}.`));
  const cells=await comparison.getByRole('table',{name:'Exact subgroup support and distinct denominators',exact:true}).locator('tbody tr').first().locator('td').allTextContents();
  assert.deepEqual(cells.slice(0,3),['2',swapped?'4':'2','2']);
  assert.equal(await comparison.getByRole('combobox',{name:'Evidence side',exact:true}).inputValue(),'target');
  const items=await comparison.getByRole('table',{name:'Comparison complete-item evidence',exact:true}).locator('tbody th').allTextContents();
  assert.deepEqual(items,swapped?['D1_1 · target','X_2 · target']:['D4_1 · target','X_1 · target']);
}
async function evidence(swapped){
  const answer=await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('combobox',{name:'Evidence side',exact:true}).selectOption('target'));
  check(answer,swapped);
  const id=swapped?'D1_1':'D4_1';
  const result=await post('/api/investigations/case-evidence',async()=>{
    await comparison.getByRole('button',{name:`Inspect comparison item ${id}`,exact:true}).focus();await page.keyboard.press('Enter');
  });
  const expected=fixture.rows.filter(r=>r[1]===id);
  assert.deepEqual(result.records.map(r=>r.original_cells),expected);
  const positions=id==='D1_1'?[0,1]:[14];
  assert.deepEqual(result.records.map(r=>r.row_id),positions.map(source_position=>'row.v1:sha256:'+createHash('sha256').update(JSON.stringify({format_version:1,source_id:'source.v1:sha256:'+fixture.source_sha256,source_position})).digest('hex')));
  const inspector=page.getByRole('region',{name:`Incident ${id}`,exact:true});
  assert.equal(await inspector.getByText(/^Contributing source record/).count(),expected.length);
  await inspector.getByRole('button',{name:'Return to incidents',exact:true}).click();
}
async function subtypeEvidence(swapped){
  const answer=await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('combobox',{name:'Evidence side',exact:true}).selectOption('outside'));
  check(answer,swapped);
  assert.deepEqual(answer.comparison.page.items.map(r=>[r.case_id,r.item_type_state,r.item_type_value]),[
    ['I_1','conflicting',null],['Q_1','invariant','Alien type'],['Y_1','conflicting',null],['Z_1','missing',null]]);
  for(const id of ['I_1','Q_1','Y_1','Z_1']){
    const result=await post('/api/investigations/case-evidence',async()=>{
      await comparison.getByRole('button',{name:`Inspect comparison item ${id}`,exact:true}).focus();await page.keyboard.press('Enter');
    });
    assert.deepEqual(result.records.map(r=>r.original_cells),fixture.rows.filter(r=>r[1]===id));
    const inspector=page.getByRole('region',{name:`Incident ${id}`,exact:true});
    assert.equal(await inspector.getByText(/^Contributing source record/).count(),id==='I_1'||id==='Y_1'?2:1);
    await inspector.getByRole('button',{name:'Return to incidents',exact:true}).click();
  }
  await evidence(swapped);
}
async function open(name='subtype',empty=false){
  await areas.getByRole('button',{name:'Saved',exact:true}).click();
  const response=await post('/api/investigations/reopen',()=>page.getByRole('button',{name:'Reopen Issue 106 '+name,exact:true}).click());
  await areas.getByRole('button',{name:'Purchasing analysis',exact:true}).click();await ready(empty);return response;
}
async function save(){
  await page.getByRole('button',{name:'Save',exact:true}).first().click();
  const response=await post('/api/investigations/save',()=>page.getByRole('button',{name:'Save revision',exact:true}).click());
  saves.push(response);await page.getByRole('button',{name:'Close',exact:true}).click();return response;
}
async function exported(tag,swapped,saved,mutation=null){
  const expected=mutation?fixture.mutations[mutation]:expectedBase(swapped);
  for(const [kind,name] of [['json','Export saved definitions, results and witnesses'],['md','Export readable purchasing analysis report']]){
    const wait=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const d=await wait;
    const path=root+'/'+tag+'.'+kind;await d.saveAs(path);const raw=await readFile(path);
    if(kind==='json'){
      const machine=JSON.parse(raw),outputs=machine.manifest.outputs.filter(o=>o.operation==='bpic19_flow_comparison');
      const actions=saved.revision.content.bpic19_pipeline.actions.filter(o=>o.operation==='bpic19_flow_comparison');
      assert.deepEqual(machine.revision,saved.revision);assert.deepEqual(outputs.map(o=>o.definition_id),actions.map(o=>o.definition_id));
      checkExpected(outputs.at(-1).output,expected);assert.deepEqual(outputs.at(-1).output.identity,saved.revision.content.selection_identity);
    }else{
      const text=raw.toString().replaceAll('\\_','_');assert(text.length>1000);assert(text.includes(saved.revision.saved_revision_id));
      const section=assertReadable(text,saved,expected);
      if(swapped&&!mutation){
        // Retained A stays valid, but cannot satisfy missing or stale B content.
        assert.throws(()=>assertReadable(text.replace(section,''),saved,expected));
        const stale=section.replace('**Target subgroup predicate**\n\n| Recorded field | Actual value |\n| --- | --- |\n| flow_id | after_gr |\n| item_type_state | invariant |\n| item_type_value | Service |',
          '**Target subgroup predicate**\n\n| Recorded field | Actual value |\n| --- | --- |\n| flow_id | after_gr |\n| item_type_state | invariant |\n| item_type_value | Standard |');
        assert.notEqual(stale,section);assert.throws(()=>assertReadable(text.replace(section,stale),saved,expected));
        const staleMembers=section.replace('target complete-item IDs: D1_1, X_2.','target complete-item IDs: D4_1, X_1.');
        assert.notEqual(staleMembers,section);assert.throws(()=>assertReadable(text.replace(section,staleMembers),saved,expected));
        markdownControls.push({tag,current_definition:saved.revision.content.bpic19_pipeline.actions.filter(a=>a.operation==='bpic19_flow_comparison').at(-1).definition_id,
          rejected:['missing-current-B-with-retained-A','stale-A-target-predicate-under-B','stale-A-members-under-B']});
      }
    }
    downloads.push({tag,kind,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});
  }
}
async function visibleMutation(kind){
  const e=fixture.mutations[kind];await ready(kind==='binding');
  assert((await comparison.innerText()).includes(`Target: after gr × ${e.target_value}. Comparator: after gr × Service.`));
  const rows=comparison.getByRole('table',{name:'Exact subgroup support and distinct denominators',exact:true}).locator('tbody tr');
  for(const [i,key] of ['target','reference','outside','unavailable'].entries()){
    assert.deepEqual((await rows.nth(i).locator('td').allTextContents()).slice(0,3),[e[key][0].length,e[key][1],e[key][2]].map(String));
  }
  if(kind==='binding')assert((await comparison.innerText()).includes('Target item share: unavailable of 0 union items; target record share: unavailable of 0 original union records.'));
  for(const role of ['target','reference','outside','unavailable']){
    const answer=await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('combobox',{name:'Evidence side',exact:true}).selectOption(role));
    checkExpected(answer,e);
    assert.deepEqual(answer.comparison.page.items.map(item=>item.case_id),e[role][0]);
    assert.deepEqual(await comparison.getByRole('table',{name:'Comparison complete-item evidence',exact:true}).locator('tbody th').allTextContents(),e[role][0].map(id=>`${id} · ${role}`));
  }
  await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('combobox',{name:'Evidence side',exact:true}).selectOption('target'));
}
async function authorMutation(kind){
  await open(kind);
  const roles=profile.getByText('Reviewed source field roles',{exact:true});
  if(await roles.locator('..').getAttribute('open')===null)await roles.click();
  for(const [name,value] of [['Purchasing flow (Item Category)',4],['Item Type',kind==='binding'?12:5],['Goods Receipt setting',6],['GR-Based Invoice Verification setting',7],['Purchasing document',8],['Document item',9],['Original source case identifier (optional)',10]]){
    await profile.getByRole('combobox',{name,exact:true}).selectOption(String(value));
  }
  await post('/api/investigations/bpic19-profile',()=>profile.getByRole('button',{name:'Review these field roles',exact:true}).click());
  if(kind==='parent'){
    const filter=page.getByRole('region',{name:'Same-original-record attribute filter',exact:true});
    await filter.getByRole('button',{name:'Remove condition 2',exact:true}).click();
    await filter.getByRole('combobox',{name:'Original field 1',exact:true}).selectOption('10');
    await filter.getByRole('textbox',{name:'Exact value 1.1',exact:true}).fill('D1_1');
    await filter.getByRole('button',{name:'Add alternative for field 1',exact:true}).click();
    await filter.getByRole('textbox',{name:'Exact value 1.2',exact:true}).fill('D4_1');
    const selected=await post('/api/investigations/select-cases',()=>filter.getByRole('button',{name:'Keep complete items by this record filter',exact:true}).click());
    assert.deepEqual(selected.kept.case_ids,['D1_1','D4_1']);assert.equal(selected.kept.record_count,3);
    await profile.getByText('2 PO items',{exact:true}).waitFor();
  }
  await profile.getByRole('combobox',{name:'Target subtype',exact:true}).selectOption({label:kind==='predicate'?'Alien type':'Standard'});
  await profile.getByRole('combobox',{name:'Comparator subtype',exact:true}).selectOption({label:'Service'});
  const answer=await post('/api/investigations/bpic19-flow-comparison',()=>profile.getByRole('button',{name:'Compare these subgroups',exact:true}).click());
  checkExpected(answer,fixture.mutations[kind]);
  assert.throws(()=>checkExpected(JSON.parse(JSON.stringify(saves[0].bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_flow_comparison').at(-1).output)),fixture.mutations[kind]));
  await visibleMutation(kind);const saved=await save();
  const output=saved.bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_flow_comparison').at(-1).output;
  checkExpected(output,fixture.mutations[kind]);assert.deepEqual(output.identity,saved.revision.content.selection_identity);
  await exported(kind,false,saved,kind);
  mutationEvidence.push({kind,definition:output.definition_id,identity:output.identity,revision:saved.revision.saved_revision_id,stale_A_rejected:true});
}
try{
  await page.goto(base);await areas.getByRole('button',{name:'Data',exact:true}).click();
  if(!await page.getByLabel('Folder path').isVisible())await page.getByText('Use another folder',{exact:true}).click();
  await page.getByLabel('Folder path').fill(workspace);
  await post('/api/workspaces/open',()=>page.getByRole('button',{name:'Open workspace',exact:true}).click());
  if(phase==='missing'||phase==='checksum'){
    await areas.getByRole('button',{name:'Saved',exact:true}).click();
    const refused=await post('/api/investigations/reopen',()=>page.getByRole('button',{name:'Reopen Issue 106 subtype',exact:true}).click(),409);
    assert.equal(refused.code,phase==='missing'?'artifact_unavailable':'checksum_mismatch');
    assert((await page.getByRole('alert').allTextContents()).some(s=>s.includes(refused.message)));
  }else if(phase==='reopen'){
    const proof=JSON.parse(await readFile(root+'/review.json','utf8'));
    const saved=await open();const swapped=proof.final_swapped;check(saved.bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_flow_comparison').at(-1).output,swapped);
    await visible(swapped);await subtypeEvidence(swapped);await exported('reopened',swapped,saved);
    assert.deepEqual(downloads.map(({kind,bytes,sha256})=>({kind,bytes,sha256})),proof.downloads.filter(d=>d.tag==='final').map(({kind,bytes,sha256})=>({kind,bytes,sha256})));
    for(const kind of ['binding','predicate','parent']){
      const saved=await open(kind,kind==='binding');
      checkExpected(saved.bpic19_outputs.outputs.filter(o=>o.operation==='bpic19_flow_comparison').at(-1).output,fixture.mutations[kind]);
      await visibleMutation(kind);await exported(kind+'-reopened',false,saved,kind);
      assert.deepEqual(downloads.filter(d=>d.tag===kind+'-reopened').map(({kind,bytes,sha256})=>({kind,bytes,sha256})),
        proof.downloads.filter(d=>d.tag===kind).map(({kind,bytes,sha256})=>({kind,bytes,sha256})));
    }
  }else{
    await open();let swapped=false;await visible(false);await subtypeEvidence(false);const a=await save();await exported('A',false,a);
    await writeFile(root+'/snapshot-ready.json',JSON.stringify({revision:a.revision.saved_revision_id}));
    for(let i=0;;i++){
      try{await readFile(root+'/snapshot-ack');break;}catch(e){if(e.code!=='ENOENT'||i>400)throw e;await new Promise(resolve=>setTimeout(resolve,50));}
    }
    for(const mode of ['cancel','supersede','unreviewed'])for(const kind of ['success','error','page']){
      await page.evaluate(kind=>{window.subtypeQualification.next=kind;window.subtypeQualification.held=null;},kind);
      await comparison.getByRole('combobox',{name:'Evidence side',exact:true}).selectOption(kind==='page'?'outside':'reference');
      await page.waitForFunction(()=>window.subtypeQualification.held!==null);
      const held=await page.evaluate(()=>window.subtypeQualification.held);assert.equal(held.status,kind==='error'?422:200);
      if(mode==='cancel'){
        await comparison.getByRole('button',{name:'Cancel comparison',exact:true}).click();
        await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('button',{name:'Retry subtype comparison',exact:true}).click());
      }else await open();
      await comparison.getByRole('button',{name:'Swap target and comparator',exact:true}).click();swapped=!swapped;
      assert(await comparison.getByRole('button',{name:'Keep target',exact:true}).isDisabled());
      assert(await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled());
      if(mode!=='unreviewed')await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('button',{name:'Review comparison roles',exact:true}).click());
      await page.evaluate(()=>window.subtypeQualification.release());
      await page.waitForFunction(n=>window.subtypeQualification.delivered.length===n,gates.length+1);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      if(mode==='unreviewed'){
        assert(await comparison.getByRole('button',{name:'Keep target',exact:true}).isDisabled());
        assert(await page.getByRole('button',{name:'Save',exact:true}).first().isDisabled());
        await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('button',{name:'Review comparison roles',exact:true}).click());
      }
      await visible(swapped);await evidence(swapped);const saved=await save();await exported(mode+'-'+kind,swapped,saved);
      gates.push({mode,kind,held,swapped,revision:saved.revision.saved_revision_id});
    }
    for(const kind of ['success','error','page']){
      const kept=await post('/api/investigations/select-cases',()=>comparison.getByRole('button',{name:'Keep target',exact:true}).click());
      assert.deepEqual(kept.kept.case_ids,swapped?['D1_1','X_2']:['D4_1','X_1']);
      const disclosure=page.getByText(/^Reviewed and retained flow comparisons/);
      if(await disclosure.locator('..').getAttribute('open')===null)await disclosure.click();
      await page.evaluate(kind=>{window.subtypeQualification.next=kind;window.subtypeQualification.held=null;},kind);
      await page.getByRole('combobox',{name:'Retained flow comparison',exact:true}).selectOption({index:1});
      await page.waitForFunction(()=>window.subtypeQualification.held!==null);
      const held=await page.evaluate(()=>window.subtypeQualification.held);assert.equal(held.status,kind==='error'?422:200);
      const restored=await post('/api/investigations/select-cases',()=>page.getByRole('button',{name:'Undo',exact:true}).click());
      assert.deepEqual(restored.identity,fixture.identity);await ready();
      await page.evaluate(()=>window.subtypeQualification.release());
      await page.waitForFunction(n=>window.subtypeQualification.delivered.length===n,gates.length+1);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await visible(swapped);await evidence(swapped);const saved=await save();await exported('parent-'+kind,swapped,saved);
      gates.push({mode:'parent-undo',kind,held,swapped,revision:saved.revision.saved_revision_id});
    }
    for(const [field,value] of [['policy_id','discovery.v1'],['normalization','lowercase'],['item_type_reducer','first_record'],['document_policy','disjoint'],['measure','amount'],['measure','time']]){
      await page.evaluate(([field,value])=>{window.subtypeQualification.patch={[field]:value};},[field,value]);
      const refused=await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('combobox',{name:'Evidence side',exact:true}).selectOption('outside'),400);
      assert.equal(refused.code,'invalid_request');assert.equal(refused.field,'query.'+field);
      assert((await comparison.getByRole('alert').innerText()).includes(refused.message));
      assert(await comparison.getByRole('button',{name:'Keep target',exact:true}).isDisabled());
      await post('/api/investigations/bpic19-flow-comparison',()=>comparison.getByRole('button',{name:'Retry subtype comparison',exact:true}).click());
      await evidence(swapped);await visible(swapped);
    }
    await evidence(swapped);const final=await save();await exported('final',swapped,final);
    await page.setViewportSize({width:900,height:700});const same=await save();
    assert.equal(same.semantic_change,false);assert.deepEqual(same.revision,final.revision);assert.deepEqual(same.bpic19_outputs,final.bpic19_outputs);
    for(const [patch,code] of [['action','unsupported_action'],['version','invalid_request'],['schema','unsupported_schema'],[a.revision.saved_revision_id,'revision_conflict']]){
      await page.getByRole('button',{name:'Save',exact:true}).first().click();
      await page.getByRole('textbox',{name:'Note',exact:true}).fill('Subtype refusal '+code);
      await page.evaluate(patch=>{window.subtypeQualification.savePatch=patch;},patch);
      const refused=await post('/api/investigations/save',()=>page.getByRole('button',{name:'Save revision',exact:true}).click(),code==='revision_conflict'?409:400);
      assert.equal(refused.code,code);await page.getByRole('button',{name:'Close',exact:true}).click();await visible(swapped);
    }
    for(const kind of ['binding','predicate','parent'])await authorMutation(kind);
    assert.deepEqual(markdownControls.map(control=>control.tag),['cancel-success','cancel-page','supersede-error','unreviewed-success','unreviewed-page','parent-success','parent-error','parent-page','final']);
    assert.deepEqual(mutationEvidence.map(evidence=>evidence.kind),['binding','predicate','parent']);
    await writeFile(root+'/review.json',JSON.stringify({saves,downloads,gates,mutationEvidence,markdownControls,final_swapped:swapped,errors},null,2));
  }
  assert.deepEqual(errors,[]);await Promise.all(pending);await writeFile(root+'/'+phase+'-http.json',JSON.stringify(http,null,2));
  if(phase!=='review')await writeFile(root+'/'+phase+'.json',JSON.stringify({downloads,markdownControls,errors},null,2));
}catch(e){console.error(e);console.error(await page.locator('body').innerText());throw e;}
finally{await browser.close();}
