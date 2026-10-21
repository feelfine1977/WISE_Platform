import { useEffect, useRef, useState } from 'react';
import { sameJson } from '../data/coordinator';
import type { AnswerIdentity, Bpic19PipelineAction } from '../generated/saving';
import type { Bpic19CohortsAnswer, CohortQuery } from '../generated/bpic19-cohorts';
import { httpCohortsClient, type CohortsClient } from './cohorts-client';
import './cohorts.css';

export interface RetainedCohortsProps {
  workspaceId: string; currentIdentity: AnswerIdentity; actions: readonly Bpic19PipelineAction[]; revision: number;
  client?: CohortsClient;
  onInspect: (identity: AnswerIdentity, caseId: string, rowIds: string[], reason: string) => void;
}
/** Replays only server-verified ancestors; viewing excluded evidence never changes the current selection. */
export function Bpic19RetainedCohorts({workspaceId,currentIdentity,actions,revision,client=httpCohortsClient,onInspect}:RetainedCohortsProps) {
  const ancestors=actions.filter(action=>action.operation==='bpic19_cohorts' && !sameJson(action.identity,currentIdentity));
  const [selected,setSelected]=useState(''),[answer,setAnswer]=useState<Bpic19CohortsAnswer|null>(null),[problem,setProblem]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const serial=useRef(0),abort=useRef<AbortController|null>(null);
  const key=JSON.stringify([workspaceId,currentIdentity,ancestors]);
  function actionKey(action:Bpic19PipelineAction){return JSON.stringify([action.definition_id,action.identity]);}
  const chosen=ancestors.find(action=>actionKey(action)===selected);
  async function load(action:Bpic19PipelineAction,offset?:number){
    const mine=++serial.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
    setBusy(true);setAnswer(null);setProblem(null);
    const query=structuredClone(action.query) as unknown as CohortQuery;
    if(offset!==undefined)query.page={...query.page,offset};
    const result=await client.cohorts({schema_version:1,message_type:'bpic19_cohorts_request',request_id:`retained-cohort-${revision}-${mine}`,query_revision:revision,workspace_id:workspaceId,identity:action.identity,query},controller.signal);
    if(mine!==serial.current || controller.signal.aborted)return;
    setBusy(false);
    if(!result.ok){setProblem(result.problem.kind==='refusal'?result.problem.refusal.message:result.problem.kind==='unreachable'?'The retained parent could not be reached. Retry its definition.':result.problem.detail);return;}
    if(result.answer.definition_id!==action.definition_id || !sameJson(result.answer.identity,action.identity)){setProblem('The answer differs from the retained parent definition. No current-selection substitute was used.');return;}
    setAnswer(result.answer);
  }
  useEffect(()=>{++serial.current;abort.current?.abort();setSelected('');setAnswer(null);setProblem(null);setBusy(false);return()=>{++serial.current;abort.current?.abort();};},[key]);
  if(!ancestors.length)return null;
  const cohorts=answer?.cohorts;
  return <details className="bpic19-cohorts"><summary>Inspect retained parent inclusion and exclusion evidence</summary>
    <p>The current selection stays fixed. These definitions refer to earlier, replayed complete-item populations.</p>
    <label>Retained parent cohort<select disabled={busy} value={selected} onChange={event=>{
      setSelected(event.target.value);const action=ancestors.find(a=>actionKey(a)===event.target.value);if(action)void load(action);else setAnswer(null);
    }}><option value="">Choose retained parent evidence</option>{ancestors.map(action=><option key={actionKey(action)} value={actionKey(action)}>{action.definition_id} · {action.identity.population_id}</option>)}</select></label>
    {busy && <p role="status">Reading the retained parent definition…</p>}
    {problem && <p role="alert">{problem}{chosen && <button onClick={()=>void load(chosen)}>Retry retained parent</button>}</p>}
    {cohorts && answer && <><p>Parent support: {cohorts.original.case_count} PO items and {cohorts.original.record_count} original records. Excluded by inclusion: {cohorts.inclusion.excluded.case_count} items. Unknown inclusion: {cohorts.inclusion.unknown.case_count} items.</p>
      <table className="plain-table"><caption>Retained parent complete-item witnesses</caption><thead><tr><th>PO item</th><th>Inclusion and reason</th><th>Original record evidence</th></tr></thead><tbody>{cohorts.page.items.map(item=><tr key={item.case_id}>
        <th scope="row">{item.case_id}</th><td>{item.inclusion_state}: {item.inclusion_reason}; {item.reasons.join('; ')}</td>
        <td><button onClick={()=>onInspect(answer.identity,item.case_id,item.witness_row_ids,`${item.inclusion_state}: ${item.inclusion_reason}`)}>Inspect retained item {item.case_id}</button>
          {item.inclusion_witnesses.map(witness=><button key={witness.case_id} onClick={()=>onInspect(answer.identity,witness.case_id,witness.row_ids,`${item.case_id}: ${item.inclusion_state}: ${item.inclusion_reason}; inclusion witness from ${witness.case_id}`)}>Inspect retained inclusion witness {witness.case_id} for {item.case_id}</button>)}</td>
      </tr>)}</tbody></table>
      <button disabled={!chosen || cohorts.page.offset===0} onClick={()=>chosen && void load(chosen,Math.max(0,cohorts.page.offset-cohorts.page.limit))}>Previous retained evidence page</button>
      <button disabled={!chosen || cohorts.page.offset+cohorts.page.limit>=cohorts.page.total} onClick={()=>chosen && void load(chosen,cohorts.page.offset+cohorts.page.limit)}>Next retained evidence page</button>
    </>}
  </details>;
}
