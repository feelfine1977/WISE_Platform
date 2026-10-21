import { useEffect, useRef, useState } from "react";
import type { Bpic19Client } from "./scoring-client";
import type { AnalysisReview, Bpic19ScoreAnswer, ReviewEvidence, ReviewFinding } from "./scoring-types";

interface Props { answer: Bpic19ScoreAnswer; client: Bpic19Client; revision?: number; onReviewed:(answer:Bpic19ScoreAnswer)=>void; onValidityChange?:(valid:boolean)=>void; }
const emptyEvidence: ReviewEvidence={case_ids:[],row_ids:[],criterion_ids:[]};
function newFinding(): ReviewFinding {return {id:crypto.randomUUID(),title:"",observation:{status:"unconfirmed",note:"",evidence:emptyEvidence},proposed_change:{status:"not_proposed",note:"",evidence:emptyEvidence},adoption:{status:"unknown",note:"",evidence:emptyEvidence},tested_outcome:{status:"untested",note:"",evidence:emptyEvidence}};}
const stages=["observation","proposed_change","adoption","tested_outcome"] as const;
const labels={observation:"Observation",proposed_change:"Proposed change",adoption:"Adoption",tested_outcome:"Tested outcome"};
const statuses={observation:["unconfirmed","observed"],proposed_change:["not_proposed","proposed"],adoption:["unknown","not_adopted","adopted"],tested_outcome:["untested","tested","unknown"]};
const split=(value:string)=>value.split(/[\n,]/).map(v=>v.trim()).filter(Boolean);
/** User-entered evidence and statuses remain distinct from the native result. */
export function Bpic19Review({answer,client,revision,onReviewed,onValidityChange}:Props) {
 const restored=answer.report.analysis_review;
 const [review,setReview]=useState<AnalysisReview>(restored ?? {policy_id:"bpic19.user_entered_interpretation.v1",mandatory_controls:[],findings:[]});
 const [finding,setFinding]=useState<ReviewFinding>(newFinding),[busy,setBusy]=useState(false),[problem,setProblem]=useState<string|null>(null);
 const [dirty,setDirty]=useState(false);const serial=useRef(0),controller=useRef<AbortController|null>(null);
 const callbacks=useRef({onReviewed,onValidityChange});callbacks.current={onReviewed,onValidityChange};
 useEffect(()=>()=>{++serial.current;controller.current?.abort();},[]);
 function changed(){++serial.current;controller.current?.abort();setBusy(false);setDirty(true);callbacks.current.onValidityChange?.(false);}
 function update(next:AnalysisReview){changed();setReview(next);}
 function updateFinding(next:ReviewFinding){changed();setFinding(next);}
 async function save(){if(!client.review)return;const token=++serial.current,abort=new AbortController();controller.current=abort;setBusy(true);setProblem(null);
  const outcome=await client.review({schema_version:1,message_type:"bpic19_review_request",request_id:crypto.randomUUID(),query_revision:revision ?? token,workspace_id:answer.workspace_id,run_id:answer.run_id,review,case_offset:0,case_limit:50,group_offset:0,group_limit:50},abort.signal);
  if(token!==serial.current || abort.signal.aborted)return;setBusy(false);if(!outcome.ok){setProblem(outcome.message);return;}setDirty(false);callbacks.current.onReviewed(outcome.answer);callbacks.current.onValidityChange?.(true);
 }
 const norm=answer.report.norm as {constraints?:{id:string}[]};
 const pendingFinding=!!finding.title.trim() || stages.some(stage=>!!finding[stage].note.trim() ||
  Object.values(finding[stage].evidence).some(ids=>ids.length>0) || finding[stage].status!==statuses[stage][0]);
 return <section aria-label="Analyst interpretation"><h3>Mandatory controls and improvement evidence</h3><p>These are explicitly supplied analyst statements. They create a new frozen interpretation and retain the original native scores, weights, coverage and reference. No causal or savings claim is inferred.</p>
 <div className="bpic19-table-wrap"><table><caption>Separately supplied mandatory-control flags</caption><thead><tr><th>Criterion</th><th>Control flag</th><th>Rationale</th></tr></thead><tbody>{norm.constraints?.map(c=>{const control=review.mandatory_controls.find(v=>v.criterion_id===c.id);return <tr key={c.id}><td>{c.id}</td><td><label>Mandatory control {c.id}<select value={control ? String(control.mandatory):"unsupplied"} onChange={e=>{const kept=review.mandatory_controls.filter(v=>v.criterion_id!==c.id);update({...review,mandatory_controls:e.target.value==="unsupplied" ? kept:[...kept,{criterion_id:c.id,mandatory:e.target.value==="true",rationale:control?.rationale ?? "",evidence:control?.evidence ?? emptyEvidence}]});}}><option value="unsupplied">No flag supplied</option><option value="true">Mandatory</option><option value="false">Not mandatory</option></select></label></td><td>{control && <label>Control rationale {c.id}<input value={control.rationale} onChange={e=>update({...review,mandatory_controls:review.mandatory_controls.map(v=>v.criterion_id===c.id ? {...v,rationale:e.target.value}:v)})} /></label>}</td></tr>;})}</tbody></table></div>
 <label>Finding title<input value={finding.title} onChange={e=>updateFinding({...finding,title:e.target.value})} /></label>
 {stages.map(stage=><fieldset key={stage}><legend>{labels[stage]}</legend><label>{labels[stage]} status<select value={finding[stage].status} onChange={e=>updateFinding({...finding,[stage]:{...finding[stage],status:e.target.value}})}>{statuses[stage].map(value=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label><label>{labels[stage]} note<textarea value={finding[stage].note} onChange={e=>updateFinding({...finding,[stage]:{...finding[stage],note:e.target.value}})} /></label>{(["case_ids","row_ids","criterion_ids"] as const).map(key=><label key={key}>{labels[stage]} {key.replaceAll("_"," ")}<textarea value={finding[stage].evidence[key].join("\n")} onChange={e=>updateFinding({...finding,[stage]:{...finding[stage],evidence:{...finding[stage].evidence,[key]:split(e.target.value)}}})} /></label>)}</fieldset>)}
 <button type="button" disabled={!finding.title.trim() || busy} onClick={()=>{update({...review,findings:[...review.findings,finding]});setFinding(newFinding());}}>Add finding to review</button>
 {review.findings.map(item=><details key={item.id}><summary>{item.title}</summary>{stages.map(stage=><p key={stage}>{labels[stage]}: {item[stage].status.replaceAll("_"," ")} · {item[stage].note}</p>)}<pre>{JSON.stringify(item,null,2)}</pre><button type="button" onClick={()=>update({...review,findings:review.findings.filter(v=>v.id!==item.id)})}>Remove finding from this draft</button></details>)}
 {dirty && <p role="status">Interpretation changed. Freeze the review before saving the investigation.</p>}{problem && <p role="alert">{problem}</p>}
 {pendingFinding && <button type="button" onClick={()=>setFinding(newFinding())}>Discard unadded finding draft</button>}
 <button type="button" disabled={busy || !dirty || !client.review || pendingFinding} onClick={()=>void save()}>{busy ? "Freezing review…":"Freeze analyst review"}</button>
 </section>;
}
