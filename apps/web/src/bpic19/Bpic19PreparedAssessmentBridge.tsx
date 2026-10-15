import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {sameJson} from "../data/coordinator";
import type {AssessmentRow,Bpic19PreparedReadAnswer,Bpic19PreparedRunAnswer,PreparedCase,PreparedInput,PreparedReference} from "../generated/bpic19-prepared-runs";
import {Bpic19PreparedAssessment,BPIC19_PREPARED_ATTRIBUTES,type Bpic19PreparedAttribute,type Bpic19PreparedContext,type Bpic19PreparedDraft,
  type Bpic19PreparedDraftCell,type Bpic19PreparedNativeRun,type Bpic19PreparedNativeValue,type Bpic19PreparedReviewIntent,type Bpic19PreparedReviewReceipt,
  type Bpic19PreparedRunIntent,type Bpic19PreparedOutcome} from "./Bpic19PreparedAssessment";
import {httpPreparedClient,inputFromPreparedExport,preparedContract,preparedProblemText,type PreparedClient,type PreparedDownload} from "./prepared-client";
import type {PreparedAssessmentSession} from "./prepared-session";

type StoredRun={page:Bpic19PreparedRunAnswer|Bpic19PreparedReadAnswer;cases:PreparedCase[]};
function grid<T>(read:(attribute:Bpic19PreparedAttribute)=>T):Record<Bpic19PreparedAttribute,T>{return {
  c_l1_invoice_present:read("c_l1_invoice_present"),
  c_l1_clear_invoice_present:read("c_l1_clear_invoice_present"),
  c_l1_goods_or_ses_present:read("c_l1_goods_or_ses_present"),
  c_l2_df1_invoice_after_goods:read("c_l2_df1_invoice_after_goods"),
  c_l2_df2_release_after_goods:read("c_l2_df2_release_after_goods"),
  c_l2_2way_no_goods_expected:read("c_l2_2way_no_goods_expected"),
  c_l2_consignment_no_clear_invoice:read("c_l2_consignment_no_clear_invoice"),
  c_l3_df1_goods_to_invoice_days:read("c_l3_df1_goods_to_invoice_days"),
  c_l3_invoice_to_clear_days:read("c_l3_invoice_to_clear_days"),
  c_l3_df2_goods_to_rpb_days:read("c_l3_df2_goods_to_rpb_days"),
  c_l3_df2_rpb_to_clear_days:read("c_l3_df2_rpb_to_clear_days"),
  c_l4_goods_fragmentation:read("c_l4_goods_fragmentation"),
  c_l4_change_approval_repeats:read("c_l4_change_approval_repeats"),
  c_l4_repeated_invoice_receipt:read("c_l4_repeated_invoice_receipt"),
  c_l4_change_payment_terms_repeats:read("c_l4_change_payment_terms_repeats"),
  c_l5_cancel_invoice_receipt:read("c_l5_cancel_invoice_receipt"),
  c_l5_cancel_goods_receipt:read("c_l5_cancel_goods_receipt"),
  c_l5_delete_item:read("c_l5_delete_item"),
  c_l5_debit_memo:read("c_l5_debit_memo"),
  c_l5_credit_memo:read("c_l5_credit_memo"),
  c_l6_change_price:read("c_l6_change_price"),
  c_l6_change_quantity:read("c_l6_change_quantity"),
  c_l6_high_exposure_memo:read("c_l6_high_exposure_memo"),
  c_l6_high_exposure_price_change:read("c_l6_high_exposure_price_change"),
  c_l7_manual_touches:read("c_l7_manual_touches"),
  c_l7_distinct_human_resources:read("c_l7_distinct_human_resources"),
  c_l7_total_events:read("c_l7_total_events"),
  c_l7_manual_share:read("c_l7_manual_share"),
  c_l6_bal_networth_volatility:read("c_l6_bal_networth_volatility")
};}
function draftOf(rows:AssessmentRow[]):Bpic19PreparedDraft{return {rows:rows.map(row=>({...row,measurements:grid(attribute=>{
  const cell=row.measurements[attribute];
  const shared={unit:cell.unit,provenance:structuredClone(cell.provenance)};
  return cell.state==="available"?{...shared,state:"available" as const,value:String(cell.value),reason:null}:
    {...shared,state:"unavailable" as const,value:null,reason:cell.reason??""};
})}))};}
/** JSON syntax and duplicate-key admission only. Analytical domains remain server-owned. */
function declaredJSON(text:string):unknown{
  if(new Blob([text]).size>32*1024*1024)throw new Error("Declared JSON exceeds the public 32 MiB input limit.");
  const value:unknown=JSON.parse(text);
  const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g)??[];let index=0;
  function scan(depth:number):void{
    if(depth>100)throw new Error("Declared JSON is too deeply nested.");
    const token=tokens[index++];
    if(token==="{"){
      const names=new Set<string>();
      while(tokens[index]!=="}"){
        const name=JSON.parse(tokens[index++]) as string;
        if(names.has(name))throw new Error("Duplicate declared JSON field: "+name);names.add(name);index++;scan(depth+1);
        if(tokens[index]!==",")break;index++;
      }
      index++;
    }else if(token==="["){
      while(tokens[index]!=="]"){scan(depth+1);if(tokens[index]!==",")break;index++;}index++;
    }
  }
  scan(0);return value;
}
function numeric(cell:Bpic19PreparedDraftCell,attribute:string){
  if(cell.state==="unavailable")return {...cell,value:null};
  let value:unknown;try{value=JSON.parse(cell.value);}catch{throw new Error(attribute+" requires a finite JSON number; an incomplete edit is not zero.");}
  if(typeof value!=="number"||!Number.isFinite(value))throw new Error(attribute+" requires a finite JSON number; an incomplete edit is not zero.");
  return {...cell,value};
}
function value(label:string,unit:string,number:number|null,reason:string,refs:readonly string[]):Bpic19PreparedNativeValue{
  const common={label,unit,provenance:"Supplied stored Method result",references:refs};
  return number===null?{...common,state:"unavailable",value:null,reason}:{...common,state:"available",value:number,reason:null};
}
function projection(stored:StoredRun,context:Bpic19PreparedContext):Bpic19PreparedNativeRun{
  const {reference,definition}=stored.page;
  return {context,review_id:reference.input_id,input_id:reference.input_id,run_id:reference.run_id,definition_id:reference.definition_id,view:reference.view,
    scope:{state:"unavailable",label:"Run-level scope is not supplied",reason:"Inspect the supplied applicability and evaluation state of each criterion."},
    totals:stored.cases.flatMap(item=>[
      value(item.assessment_item_id+" native score","native_score",item.score,item.score_state,[item.assessment_row_ref]),
      value(item.assessment_item_id+" native coverage","coverage",item.coverage,item.coverage_state,[item.assessment_row_ref]),
      value(item.assessment_item_id+" in-scope criteria","criteria",item.in_scope_count,"",[item.assessment_row_ref]),
      value(item.assessment_item_id+" evaluated criteria","criteria",item.evaluated_count,"",[item.assessment_row_ref]),
      ...item.layer_contributions.map(layer=>value(item.assessment_item_id+" "+layer.layer+" native contribution","native_contribution",layer.value,item.score_state,[item.assessment_row_ref])),
    ]),
    contributions:stored.cases.flatMap(item=>item.criteria.map(criterion=>({assessment_item_id:item.assessment_item_id,attribute:criterion.criterion_id,
      scope:{state:!criterion.native_in_scope?"out_of_scope" as const:!criterion.native_evaluated?"unavailable" as const:"in_scope" as const,
        label:criterion.native_evaluated?"Evaluated":"Not evaluated",reason:criterion.native_reason||null},
      measurement:{...value("Declared measurement",criterion.unit,criterion.declared_value,criterion.declared_reason??criterion.native_reason,criterion.provenance.assessment_row_refs),
        provenance:"Declared measurement: "+criterion.provenance.declaration_ref},
      contribution:value("Native penalty; applicability remains separate","native_penalty",criterion.native_penalty,criterion.native_reason,[reference.run_id]),
    }))),
  };
}
function download(result:PreparedDownload){
  const url=URL.createObjectURL(result.blob),link=document.createElement("a");link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
}
export function Bpic19PreparedAssessmentBridge({session,client=httpPreparedClient}:{session:PreparedAssessmentSession;client?:PreparedClient}){
  const state=useSyncExternalStore(session.subscribe,session.getState);
  const key=JSON.stringify([state.context,state.reset]);const active=useRef(key);active.current=key;
  if(!state.context)return <section><h2>Declared measurement assessment</h2><p>Open a workspace reading before declaring assessment items.</p></section>;
  return <PreparedBridgeSession key={key} session={session} client={client} context={state.context} isActive={()=>active.current===key}/>;
}
function PreparedBridgeSession({session,client,context,isActive}:{session:PreparedAssessmentSession;client:PreparedClient;context:Bpic19PreparedContext;isActive:()=>boolean}){
  const state=useSyncExternalStore(session.subscribe,session.getState);
  const [text,setText]=useState(""),[initialDraft,setInitialDraft]=useState<Bpic19PreparedDraft|null>(null);
  const [labels,setLabels]=useState(()=>grid(attribute=>attribute as string));
  const [presentationOrder,setPresentationOrder]=useState<string[]|undefined>();
  const [problem,setProblem]=useState<string|null>(null),[stored,setStored]=useState<Record<string,StoredRun>>({});
  const [shown,setShown]=useState<StoredRun|null>(null);
  const [nativeItem,setNativeItem]=useState("");
  const serial=useRef(0),sequence=useRef(0),reviewed=useRef<PreparedInput|null>(null);
  const controllers=useRef(new Set<AbortController>());
  useEffect(()=>()=>{serial.current++;for(const controller of controllers.current)controller.abort();},[]);
  const stamp=(kind:string)=>({schema_version:1 as const,request_id:"prepared-"+kind+"-"+(++sequence.current),query_revision:sequence.current,workspace_id:context.workspace_id});
  const current=(token:number,signal:AbortSignal)=>token===serial.current&&!signal.aborted&&isActive()&&session.getState().available;
  function changed(){serial.current++;reviewed.current=null;session.changed();setProblem(null);}
  function open(){
    try{
      const parsed=declaredJSON(text);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Supply an object containing rows and optional presentation_order.");
      const candidate={...stamp("draft"),message_type:"bpic19_prepared_review_request",...parsed};
      if(Object.keys(parsed).some(key=>!["rows","presentation_order"].includes(key))||!preparedContract.reviewRequest(candidate))throw new Error("Supply all 29 declared cells per item with their exact units, availability and provenance. No norms, scores or raw-population fields are admitted.");
      changed();setPresentationOrder(candidate.presentation_order);setInitialDraft(draftOf(candidate.rows));
    }catch(error){changed();setInitialDraft(null);setProblem(error instanceof Error?error.message:"Declared JSON could not be opened.");}
  }
  async function review(intent:Bpic19PreparedReviewIntent,signal:AbortSignal):Promise<Bpic19PreparedOutcome<Bpic19PreparedReviewReceipt>>{
    if(!isActive()||!session.getState().available)return {status:"cancelled"};
    const token=++serial.current,finish=session.begin();reviewed.current=null;
    try{
      const rows=intent.draft.rows.map(row=>({...row,measurements:grid(attribute=>numeric(row.measurements[attribute],attribute))}));
      const request={...stamp("review"),message_type:"bpic19_prepared_review_request",rows,...(presentationOrder===undefined?{}:{presentation_order:presentationOrder})};
      if(!preparedContract.reviewRequest(request))return {status:"error",message:"Declared values, units or provenance do not match the closed prepared-input contract. Correct the draft and Review again."};
      const outcome=await client.review(request,signal);if(!current(token,signal))return {status:"cancelled"};
      if(!outcome.ok)return {status:"error",message:preparedProblemText(outcome.problem)};
      const {input,bindings}=outcome.answer;
      if(bindings.length!==29||new Set(bindings.map(binding=>binding.criterion_id)).size!==29||
        BPIC19_PREPARED_ATTRIBUTES.some(attribute=>!bindings.some(binding=>binding.criterion_id===attribute&&input.rows.every(row=>row.measurements[attribute].unit===binding.unit))))
        return {status:"error",message:"The supplied criterion bindings do not cover the exact 29 declared attributes and units."};
      reviewed.current=input;session.reviewed(input.content_id);setLabels(grid(attribute=>bindings.find(binding=>binding.criterion_id===attribute)!.label));
      // The wire authority is input.content_id. This adapter mapping creates no server review identity.
      return {status:"success",value:{context,draft:intent.draft,review_id:input.content_id,input_id:input.content_id}};
    }catch(error){return {status:"error",message:error instanceof Error?error.message:"Prepared review failed."};}finally{finish();}
  }
  async function complete(page:Bpic19PreparedRunAnswer|Bpic19PreparedReadAnswer,token:number,signal:AbortSignal):Promise<StoredRun>{
    const cases=[...page.cases];let next=page.next_offset;
    while(next!==null){
      if(!current(token,signal))throw new Error("Stored result read cancelled.");
      const outcome=await client.read({...stamp("read"),message_type:"bpic19_prepared_read_request",run_id:page.reference.run_id,offset:next,limit:100},signal);
      if(!outcome.ok)throw new Error(preparedProblemText(outcome.problem));
      const answer=outcome.answer;
      if(!sameJson(answer.reference,page.reference)||!sameJson(answer.basis,page.basis)||!sameJson(answer.definition,page.definition)||answer.total!==page.total||answer.offset!==cases.length)
        throw new Error("A stored page belongs to another declared input or native result.");
      cases.push(...answer.cases);next=answer.next_offset;
      if(cases.length>1000)throw new Error("Stored assessment item limit exceeded.");
    }
    if(!sameJson(cases.map(item=>item.assessment_item_id),page.basis.assessment_item_ids))throw new Error("Stored result pages do not cover the exact declared assessment order.");
    return {page,cases};
  }
  async function run(intent:Bpic19PreparedRunIntent,signal:AbortSignal):Promise<Bpic19PreparedOutcome<Bpic19PreparedNativeRun>>{
    if(!isActive()||!session.getState().available)return {status:"cancelled"};
    const input=reviewed.current;if(!input||intent.input_id!==input.content_id||intent.review_id!==input.content_id)return {status:"error",message:"Review this declared input before running it."};
    const token=++serial.current,finish=session.begin();
    try{
      const outcome=await client.run({...stamp("run"),message_type:"bpic19_prepared_run_request",input_id:input.content_id,profile_id:input.profile_id,
        catalogue_sha256:input.catalogue_sha256,mode:"layer_balanced",view:intent.view},signal);
      if(!current(token,signal))return {status:"cancelled"};if(!outcome.ok)return {status:"error",message:preparedProblemText(outcome.problem)};
      const answer=await complete(outcome.answer,token,signal);if(!current(token,signal))return {status:"cancelled"};
      setStored(old=>({...old,[answer.page.reference.run_id]:answer}));setShown(answer);setNativeItem(answer.cases[0]?.assessment_item_id??"");
      return {status:"success",value:projection({...answer,cases:answer.cases.slice(0,1)},context)};
    }catch(error){return {status:"error",message:error instanceof Error?error.message:"Native prepared assessment failed."};}finally{finish();}
  }
  useEffect(()=>{
    if(!state.restoration||!state.references.length)return;
    const references=[...state.references],controller=new AbortController(),token=++serial.current,finish=session.begin();controllers.current.add(controller);
    void (async()=>{
      try{
        const reads:Record<string,StoredRun>={};let input:PreparedInput|null=null;
        for(const reference of references){
          const outcome=await client.read({...stamp("reopen"),message_type:"bpic19_prepared_read_request",run_id:reference.run_id,offset:0,limit:100},controller.signal);
          if(!current(token,controller.signal))return;if(!outcome.ok)throw new Error(preparedProblemText(outcome.problem));
          if(!sameJson(outcome.answer.reference,reference))throw new Error("Stored prepared reference differs from the reopened investigation.");
          reads[reference.run_id]=await complete(outcome.answer,token,controller.signal);
          if(!input){const exported=await client.export({...stamp("input"),message_type:"bpic19_prepared_export_request",run_id:reference.run_id,format:"json"},controller.signal);
            if(!exported.ok)throw new Error(preparedProblemText(exported.problem));input=await inputFromPreparedExport(exported.answer,reference);if(!input)throw new Error("The stored declared input does not match its immutable prepared reference.");}
        }
        if(!current(token,controller.signal)||!input)return;
        setInitialDraft(draftOf(input.rows));setPresentationOrder(input.presentation?.item_order);setText(JSON.stringify({rows:input.rows,...(input.presentation?{presentation_order:input.presentation.item_order}:{})},null,2));setStored(reads);setShown(reads[references[0].run_id]);setNativeItem(reads[references[0].run_id].cases[0]?.assessment_item_id??"");
        const criteria=reads[references[0].run_id].page.definition.criteria;setLabels(grid(attribute=>criteria.find(criterion=>criterion.criterion_id===attribute)?.label??attribute));
      }catch(error){if(current(token,controller.signal)){session.changed();setProblem(error instanceof Error?error.message:"Stored prepared assessment could not be reopened.");}}
      finally{controllers.current.delete(controller);finish();}
    })();return ()=>controller.abort();
  },[state.restoration]);
  async function exportRun(reference:PreparedReference,format:"json"|"markdown"|"native_zip"){
    const controller=new AbortController(),token=serial.current,finish=session.begin();controllers.current.add(controller);setProblem(null);
    try{const outcome=await client.export({...stamp("export"),message_type:"bpic19_prepared_export_request",run_id:reference.run_id,format},controller.signal);
      if(!current(token,controller.signal))return;if(!outcome.ok){setProblem(preparedProblemText(outcome.problem));return;}download(outcome.answer);
    }catch(error){if(current(token,controller.signal))setProblem(error instanceof Error?error.message:"Prepared export failed.");}
    finally{controllers.current.delete(controller);finish();}
  }
  const native=shown?projection({...shown,cases:shown.cases.filter(item=>item.assessment_item_id===nativeItem)},context):null;
  return <section className="bpic19-panel" aria-label="Prepared arithmetic workflow">
    <h2>Declared prepared arithmetic</h2>
    <p>Assess explicitly declared measurements independently of original event histories. Raw selection changes do not select assessment items or establish raw-source equivalence.</p>
    <label>Declared measurement JSON<textarea aria-label="Declared measurement JSON" rows={8} style={{width:"100%",maxWidth:"100%"}} value={text} onChange={event=>{changed();setInitialDraft(null);setText(event.target.value);}}/></label>
    <p>Supply an object containing rows and optional presentation_order. Every item declares an identity, assessment reference, flow and all 29 measurement cells, with units, availability and declared provenance. Criterion labels are supplied by the service after Review.</p>
    <button type="button" disabled={!state.available||state.pending} onClick={open}>Open declared JSON draft</button>
    <button type="button" disabled={state.pending} onClick={()=>session.discard()}>Discard declared assessment changes</button>
    {problem&&<p role="alert">{problem}</p>}
    {!state.available&&<p role="status">Prepared actions are paused while the workspace reading changes.</p>}
    {shown&&<label>Native assessment item<select aria-label="Native assessment item" value={nativeItem} onChange={event=>setNativeItem(event.target.value)}>
      {shown.cases.map(item=><option key={item.assessment_item_id} value={item.assessment_item_id}>{item.assessment_item_id}</option>)}
    </select><small>Display one assessment item's supplied results. The stored run retains all {shown.cases.length} items and its original basis.</small></label>}
    {initialDraft&&<div inert={!state.available||undefined}><Bpic19PreparedAssessment context={context} input={{status:"ready",draft:initialDraft}} criterionLabels={labels} nativeRun={native}
      onDraftChange={changed} onReview={review} onRun={run} onRetain={intent=>{
        const result=stored[intent.run_id];if(!result||!reviewed.current||!sameJson(intent.context,context)||intent.input_id!==reviewed.current.content_id||
          intent.review_id!==intent.input_id||intent.definition_id!==result.page.reference.definition_id||intent.view!==result.page.reference.view)return;
        if(!session.retain(result.page.reference))setProblem("This native result no longer belongs to the reviewed declaration.");
      }}/></div>} 
    {state.dirty&&<p role="status">Declared changes are not retained. Review, run and request retain, or discard these changes before saving the investigation.</p>}
    {!!state.references.length&&<section aria-label="Retained declared assessments"><h3>Retained declared assessments</h3><ul>{state.references.map(reference=><li key={reference.view}>{reference.view} · {reference.input_id} · {reference.run_id}
      {(["json","markdown","native_zip"] as const).map(format=><button type="button" key={format} disabled={!session.readyForSave()||!stored[reference.run_id]}
        onClick={()=>void exportRun(reference,format)}>Export prepared {reference.view} {format}</button>)}</li>)}</ul></section>}
    {shown&&<p>Method {shown.page.definition.method_artifact.distribution} {shown.page.definition.method_artifact.version} · {shown.page.definition.method_artifact.qualification}. {shown.page.definition.method_artifact.eligible_release?"Eligible released artifact":"Packed unreleased Method artifact; eligible release remains unqualified."}</p>}
    {shown&&<details><summary>Exact native definition, scope, deviations and weights</summary>
      <p>Score, coverage and layer contributions are supplied separately per assessment item. Partial-not-qualified coverage remains unavailable; it is never replaced by zero or an inferred fraction.</p>
      <pre tabIndex={0} aria-label="Exact supplied prepared native result" style={{maxHeight:"32rem",overflow:"auto",whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({reference:shown.page.reference,definition:shown.page.definition,cases:shown.cases},null,2)}</pre>
    </details>}
  </section>;
}
