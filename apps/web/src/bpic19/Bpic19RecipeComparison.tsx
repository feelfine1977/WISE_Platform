import { useEffect, useRef, useState } from "react";
import type { AnswerIdentity, RecipeComparisonQuery, Bpic19RecipeComparisonAnswer } from "../generated/bpic19-recipe-comparison";
import { httpRecipeComparisonClient, type Bpic19RecipeComparisonClient } from "./recipe-comparison-client";

interface Props {
  workspaceId:string; identity:AnswerIdentity; revision:number; query:RecipeComparisonQuery;
  client?:Bpic19RecipeComparisonClient;
  onReviewed:(answer:Bpic19RecipeComparisonAnswer)=>void;
  onValidityChange:(current:boolean)=>void;
  onInspect:(caseId:string)=>void;
}

/** Explicit pair roles are saved with their verified definitions, never inferred on reopen. */
export function Bpic19RecipeComparison({workspaceId,identity,revision,query,client=httpRecipeComparisonClient,onReviewed,onValidityChange,onInspect}:Props) {
  const [answer,setAnswer]=useState<Bpic19RecipeComparisonAnswer|null>(null);
  const [problem,setProblem]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
  const callbacks=useRef({onReviewed,onValidityChange});callbacks.current={onReviewed,onValidityChange};
  const serial=useRef(0), key=JSON.stringify([workspaceId,identity,revision,query,retry]);
  useEffect(()=>{
    const token=++serial.current,abort=new AbortController();setAnswer(null);setProblem(null);callbacks.current.onValidityChange(false);
    void client.compare({schema_version:1,message_type:'bpic19_recipe_comparison_request',request_id:`recipe-pair-${revision}-${token}`,query_revision:revision,workspace_id:workspaceId,identity,query},abort.signal).then(outcome=>{
      if(abort.signal.aborted || token!==serial.current)return;
      if(!outcome.ok){setProblem(outcome.problem.kind==='refusal'?outcome.problem.refusal.message:outcome.problem.kind==='unreachable'?'The local comparison service could not be reached.':outcome.problem.detail);return;}
      setAnswer(outcome.answer);callbacks.current.onReviewed(outcome.answer);callbacks.current.onValidityChange(true);
    });
    return()=>{abort.abort();++serial.current;};
  },[key,client]);
  const operator=query.policy_id==='bpic19.ordinal_fifo_comparison.v1';
  return <section className="bpic19-profile" aria-label={operator?'Saved ordinal and FIFO comparison':'Saved completion comparison'}>
    <h3>{operator?'Reviewed ordinal and FIFO pair':'Reviewed completion definitions'}</h3>
    <p>Both explicitly named recipes use the same frozen source and PO-item population. Their roles and verified definition identifiers are retained when saving and reopening.</p>
    {!answer && !problem && <p role="status">Verifying both recorded definitions…</p>}
    {problem && <div role="alert"><p>{problem}</p><button onClick={()=>setRetry(value=>value+1)}>Retry saved comparison</button></div>}
    {answer && <>
      <p>Comparison definition: <code>{answer.definition_id}</code></p>
      {operator?<p>Ordinal: <code>{query.ordinal.definition_id}</code>; FIFO: <code>{query.fifo.definition_id}</code>. Exact recorded endpoint witnesses remain in the two recipe results.</p>:<p>Target: {query.target.name}; comparator: {query.reference.name}. Recorded closed/open/unknown and outside-inclusion states stay separate.</p>}
      {answer.comparison.completion_transitions.length>0 && <table className="plain-table"><caption>Completion outcomes on the same parent</caption><thead><tr><th>Target state</th><th>Comparator state</th><th>PO items</th><th>Evidence</th></tr></thead><tbody>{answer.comparison.completion_transitions.map(row=><tr key={`${row.target_state}/${row.reference_state}`}><td>{row.target_state}</td><td>{row.reference_state}</td><td>{row.case_count.toLocaleString('en')}</td><td>{row.case_ids[0] && <button onClick={()=>onInspect(row.case_ids[0])}>Inspect changed completion item</button>}</td></tr>)}</tbody></table>}
      {answer.comparison.support_differences.map(row=><p key={row.support}>{row.support}: {row.both.length.toLocaleString('en')} in both; {row.target_only.length.toLocaleString('en')} target only; {row.reference_only.length.toLocaleString('en')} comparator only.</p>)}
    </>}
  </section>;
}
