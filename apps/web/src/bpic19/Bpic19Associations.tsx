import { useEffect, useRef, useState } from "react";
import { bpic19Contract, type Bpic19Client } from "./scoring-client";
import type { AssociationQuery, AssociationSelection, Bpic19ReadRequest, Bpic19ScoreAnswer } from "./scoring-types";
import { associationSetMembers, type AssociationSet } from "./association-keep";

const policy = "bpic19.frozen_native_associations.v1" as const;
type ObjectValue = Record<string,unknown>;
function object(value: unknown): ObjectValue { return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {}; }
function objects(value: unknown): ObjectValue[] { return Array.isArray(value) ? value.map(object) : []; }
function text(value: unknown): string { return value === undefined || value === null ? "Unavailable" : String(value); }
function number(value: unknown): string { return typeof value === "number" ? value.toLocaleString(undefined,{maximumFractionDigits:8}) : "Unavailable"; }

interface Props {
  answer: Bpic19ScoreAnswer;
  client: Bpic19Client;
  revision?: number;
  onReviewed: (answer: Bpic19ScoreAnswer) => void;
  onValidityChange?: (valid: boolean) => void;
  onMembers: (filter: Bpic19ReadRequest["case_filter"]) => void;
  /** Keeps one named set's complete items as a typed selection step tied to this native association run. */
  onKeepSet?: (answer: Bpic19ScoreAnswer, set: AssociationSet, members: string[]) => void;
}

function selector(kind: string, ids: string, groups: Bpic19ScoreAnswer["report"]["groups"], keys: string[], saved?: AssociationSelection): AssociationSelection {
  if (kind === "saved" && saved) return saved;
  if (kind === "paper_packaging") return {kind:"group",group_values:{spend_area:"Packaging"}};
  if (kind === "paper_packaging_df2") return {kind:"group",group_values:{spend_area:"Packaging",flow:"DF2"}};
  if (kind === "paper_outside_packaging_df2") return {kind:"group",group_values:{flow:"DF2"},exclude_group_values:{spend_area:"Packaging"}};
  if (kind.startsWith("group:")) {
    const row=groups[Number(kind.slice(6))];
    return {kind:"group",group_values:Object.fromEntries(keys.map(key=>[key,typeof row?.[key] === "string" ? row[key] as string : null]))};
  }
  if (kind === "ids") return {kind:"case_ids",case_ids:ids.split(/[\n,]/).map(id=>id.trim()).filter(Boolean)};
  return {kind:kind === "outside_target" ? "outside_target" : "all"};
}

/** Explicit membership comparisons of the stored native result; the client never grades. */
export function Bpic19Associations({answer,client,revision,onReviewed,onValidityChange,onMembers,onKeepSet}: Props) {
  const ids=objects(object(answer.report.norm).constraints).map(c=>text(c.id));
  const rawQuery=object(answer.report.association_analysis).reviewed_query;
  const restored=bpic19Contract.associationQuery(rawQuery) ? rawQuery as AssociationQuery : null;
  const [target,setTarget]=useState(restored ? "saved" : answer.report.groups.length ? "group:0" : "all"),[comparator,setComparator]=useState(restored ? "saved" : "outside_target");
  const [targetIds,setTargetIds]=useState(""),[comparatorIds,setComparatorIds]=useState("");
  const [criteria,setCriteria]=useState<string[]>(restored?.criteria ?? ids.slice(0,2));
  const [mode,setMode]=useState<AssociationQuery["pair_mode"]>(restored?.pair_mode ?? "jointly_eligible");
  const [support,setSupport]=useState(restored?.min_support===undefined || restored?.min_support===null ? "" : String(restored.min_support)),[pooled,setPooled]=useState(restored?.pooled_sd ?? false);
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null),serial=useRef(0);
  const callbacks=useRef({onReviewed,onValidityChange});callbacks.current={onReviewed,onValidityChange};
  useEffect(()=>()=>{++serial.current;controller.current?.abort();},[]);
  const draftKey=JSON.stringify([target,comparator,targetIds,comparatorIds,criteria,mode,support,pooled]);
  const [reviewedKey,setReviewedKey]=useState<string|null>(answer.report.association_analysis ? draftKey : null);
  useEffect(()=>{
    ++serial.current;controller.current?.abort();setBusy(false);setProblem(null);
    callbacks.current.onValidityChange?.(reviewedKey===draftKey);
  },[draftKey,reviewedKey]);
  async function evaluate() {
    if (!client.associate || !criteria[0]) return;
    const token=++serial.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
    setBusy(true);setProblem(null);callbacks.current.onValidityChange?.(false);
    const query: AssociationQuery={policy_id:policy,target:{name:restored?.target.name ?? "Reviewed target",selector:selector(target,targetIds,answer.report.groups,answer.report.settings.group_by,restored?.target.selector)},
      comparator:{name:restored?.comparator.name ?? "Reviewed comparator",selector:selector(comparator,comparatorIds,answer.report.groups,answer.report.settings.group_by,restored?.comparator.selector)},
      criteria:[criteria[0],...criteria.slice(1)],positive_threshold:0,min_support:support.trim()==="" ? null : Number(support),pair_mode:mode,pooled_sd:pooled};
    const outcome=await client.associate({schema_version:1,message_type:"bpic19_association_request",request_id:crypto.randomUUID(),query_revision:revision ?? token,
      workspace_id:answer.workspace_id,run_id:answer.run_id,query,case_offset:0,case_limit:50,group_offset:0,group_limit:50},abort.signal);
    if (token!==serial.current || abort.signal.aborted) return;
    setBusy(false);
    if (!outcome.ok) {setProblem(outcome.message);return;}
    setReviewedKey(draftKey);callbacks.current.onReviewed(outcome.answer);callbacks.current.onValidityChange?.(true);
  }
  const [keeping,setKeeping]=useState(false);
  async function keep(set: AssociationSet, holder: ObjectValue, key: string) {
    if (!onKeepSet || keeping) return;
    const bounded=Array.isArray(holder[key]) ? (holder[key] as unknown[]).map(String) : null,receipt=object(holder[key+"_receipt"]);
    const abort=new AbortController();controller.current=abort;setKeeping(true);setProblem(null);
    const outcome=await associationSetMembers(client,answer,set,bounded,receipt.complete!==false,abort.signal);
    setKeeping(false);
    if (abort.signal.aborted) return;
    if (!outcome.ok) {setProblem(outcome.message);return;}
    if (outcome.members.length) onKeepSet(answer,set,outcome.members);
  }
  const analysis=object(answer.report.association_analysis),populations=object(analysis.populations);
  const ratio=(value: unknown, reason: unknown)=>typeof value === "number" ? number(value) : `Unavailable · ${text(reason)}`;
  const choices=<>{answer.report.groups.map((row,i)=><option key={i} value={`group:${i}`}>{answer.report.settings.group_by.map(key=>text(row[key])).join(" · ")}</option>)}<option value="all">All assessed items</option><option value="ids">Explicit original item IDs</option></>;
  const valid=support.trim()==="" || Number.isInteger(Number(support)) && Number(support)>=1;
  return <section aria-label="Frozen criterion associations"><h3>Target and comparator associations</h3>
    <p>Choose complete items from this frozen run. Default support is max(20, floor(0.02 × target count)); small fixtures can explicitly choose 1. No scoring or calibration is repeated. Raw medians use all native eligible items; positive-only witnesses remain separately identified.</p>
    <div className="bpic19-controls">
      <label>Target population<select value={target} onChange={e=>{setTarget(e.target.value);if(e.target.value.startsWith("paper_packaging")){setCriteria(["C04"]);setComparator(e.target.value==="paper_packaging_df2" ? "paper_outside_packaging_df2":"outside_target");}}}>{restored && <option value="saved">Saved reviewed target</option>}{ids.includes("C04") && <><option value="paper_packaging">Paper comparison · all eligible Packaging</option><option value="paper_packaging_df2">Paper comparison · eligible Packaging in DF2</option></>}{choices}</select></label>
      {target==="ids" && <label>Target item IDs<textarea value={targetIds} onChange={e=>setTargetIds(e.target.value)} placeholder="One exact original item ID per line" /></label>}
      <label>Comparator population<select value={comparator} onChange={e=>setComparator(e.target.value)}>{restored && <option value="saved">Saved reviewed comparator</option>}<option value="outside_target">All assessed items outside target</option>{ids.includes("C04") && <option value="paper_outside_packaging_df2">DF2 items outside Packaging</option>}{choices}</select></label>
      {comparator==="ids" && <label>Comparator item IDs<textarea value={comparatorIds} onChange={e=>setComparatorIds(e.target.value)} placeholder="One exact original item ID per line" /></label>}
      <label>Pair universe<select value={mode} onChange={e=>setMode(e.target.value as AssociationQuery["pair_mode"])}><option value="jointly_eligible">Jointly evaluated, positive-weight criteria</option><option value="legacy_total_case">Historical total-case pair convention</option></select></label>
      <label>Reviewed minimum support<input type="number" min="1" step="1" value={support} onChange={e=>setSupport(e.target.value)} placeholder="Production default" /></label>
      <label><input type="checkbox" checked={pooled} onChange={e=>setPooled(e.target.checked)} /> Show pooled sample-SD magnitude</label>
      <fieldset><legend>Native criteria to compare</legend>{ids.map(id=><label key={id}><input type="checkbox" checked={criteria.includes(id)} onChange={e=>setCriteria(current=>e.target.checked ? [...current,id] : current.filter(key=>key!==id))} />{id}</label>)}</fieldset>
      <button type="button" disabled={busy || !valid || !criteria.length || !client.associate} onClick={()=>void evaluate()}>{busy ? "Comparing…" : "Compare frozen criteria"}</button>
      {busy && <button type="button" onClick={()=>{++serial.current;controller.current?.abort();setBusy(false);setReviewedKey(null);callbacks.current.onValidityChange?.(false);}}>Cancel comparison</button>}
    </div>
    {problem && <p role="alert">{problem}</p>}
    {!!analysis.policy_id && reviewedKey!==draftKey && <p role="status">Association settings changed. Compare the frozen criteria to review this definition before saving.</p>}
    {!!analysis.policy_id && reviewedKey===draftKey && <>
      <p>{text(analysis.interpretation)} Pair recipe: {text(analysis.recipe_id)}. Minimum support {number(analysis.minimum_support)}. {typeof analysis.legacy_convention === "string" && analysis.legacy_convention}</p>
      {(["target","comparator"] as const).map(population=>{
        const summary=object(populations[population]),statistics=object(summary.criteria);
        return <div key={population}><h4>{population=== "target" ? "Target" : "Comparator"}: {text(summary.name)}</h4><p>{number(summary.case_count)} original items · {number(summary.scored_case_count)} scored · native mean penalty {number(summary.native_mean_penalty)} · native penalty mass {number(summary.native_penalty_mass)}.</p>
          <button type="button" onClick={()=>onMembers({association_set:{population,state:"all"}})}>Inspect {population} complete items</button>
          {onKeepSet && <button type="button" disabled={keeping || !summary.case_count} onClick={()=>void keep({population,state:"all"},summary,"case_ids")}>Keep {population} complete items</button>}
          <div className="bpic19-table-wrap"><table><caption>{population} criterion denominators and severity</caption><thead><tr><th>Criterion</th><th>Total</th><th>Eligible</th><th>Fired</th><th>Unavailable</th><th>Total prevalence</th><th>Eligible firing</th><th>Mean severity</th><th>Positive mean</th><th>Severity sum</th><th>Native contribution sum</th><th>Raw mean / median / unit</th><th>Evidence</th></tr></thead><tbody>{Object.entries(statistics).map(([id,value])=>{
            const row=object(value),raw=object(row.raw_measurement_statistics);
            return <tr key={id}><td>{id}</td>{["total_case_count","eligible_case_count","positive_case_count","unavailable_case_count","total_case_prevalence","eligible_firing_rate","eligible_mean_severity","conditional_positive_severity","unweighted_severity_sum","native_contribution_sum"].map(key=><td key={key}>{number(row[key])}</td>)}<td>{number(raw.mean)} / {number(raw.median)} / {text(raw.unit)}</td><td><button type="button" onClick={()=>onMembers({association_set:{population,criterion_id:id,state:"eligible"}})}>Inspect all eligible {id}</button><button type="button" onClick={()=>onMembers({association_set:{population,criterion_id:id,state:"positive"}})}>Inspect positive {id}</button><button type="button" onClick={()=>onMembers({association_set:{population,criterion_id:id,state:"unavailable"}})}>Inspect unavailable {id}</button>
              {onKeepSet && (["eligible","positive","unavailable"] as const).map(state=><button key={state} type="button" disabled={keeping || row[state+"_case_count"]===0} onClick={()=>void keep({population,criterion_id:id,state},row,state+"_case_ids")}>Keep {population} {state} {id}</button>)}</td></tr>;
          })}</tbody></table></div></div>;
      })}
      <div className="bpic19-table-wrap"><table><caption>Finite-population target minus comparator differences</caption><thead><tr><th>Criterion</th><th>Mean severity difference</th><th>Eligible firing difference</th><th>Total prevalence difference</th><th>Target / comparator eligible</th><th>Raw mean difference / unit</th><th>Pooled sample-SD magnitude</th><th>Availability</th></tr></thead><tbody>{objects(analysis.contrasts).map((row,i)=>{
        const magnitude=object(row.pooled_sample_sd_magnitude);
        return <tr key={i}><td>{text(row.criterion_id)}</td><td>{number(row.mean_difference)}</td><td>{number(row.eligible_firing_difference)}</td><td>{number(row.total_prevalence_difference)}</td><td>{number(row.target_eligible_count)} / {number(row.comparator_eligible_count)}</td><td>{number(row.raw_mean_difference)} / {text(row.raw_unit)}</td><td>{number(magnitude.value)}</td><td>{text(magnitude.reason ?? "available")}</td></tr>;
      })}</tbody></table></div>
      {(["accepted_pairs","suppressed_pairs"] as const).map(section=><div key={section} className="bpic19-table-wrap"><table><caption>{section=== "accepted_pairs" ? "Accepted" : "Suppressed"} native criterion pairs</caption><thead><tr><th>Pair</th><th>Universe N</th><th>Intersection support</th><th>Jaccard</th><th>Lift</th><th>State</th><th>Dependency and lineage</th><th>Complete item evidence</th></tr></thead><tbody>{objects(analysis[section]).map((row,i)=>{
        const dependency=object(row.dependency);
        return <tr key={i}><td>{text(row.left)} / {text(row.right)}</td><td>{number(row.universe_case_count)}</td><td>{number(row.support)}</td><td>{ratio(row.jaccard,row.jaccard_reason)}</td><td>{ratio(row.lift,row.lift_reason)}</td><td>{text(row.suppression_reason ?? "accepted")}</td><td>{text(dependency.flag)} · {text(dependency.left_attribute)} / {text(dependency.right_attribute)}</td><td>{(["intersection","union","jointly_eligible"] as const).map(set=><span key={set}><button type="button" onClick={()=>onMembers({association_set:{population:"target",state:"all",pair:{left:text(row.left),right:text(row.right),set}}})}>Inspect {set.replaceAll("_"," ")}</button>
          {onKeepSet && <button type="button" disabled={keeping || object(row[set+"_case_ids_receipt"]).count===0} onClick={()=>void keep({population:"target",state:"all",pair:{left:text(row.left),right:text(row.right),set}},row,set+"_case_ids")}>Keep {set.replaceAll("_"," ")} {text(row.left)}/{text(row.right)}</button>}</span>)}</td></tr>;
      })}</tbody></table></div>)}
      <details><summary>Formula and immutable comparison receipt</summary><pre>{JSON.stringify({definition:answer.definition_id,run:answer.run_id,formula:analysis.formulas,query:analysis.query,target:object(populations.target).case_ids_receipt,comparator:object(populations.comparator).case_ids_receipt},null,2)}</pre></details>
    </>}
  </section>;
}
