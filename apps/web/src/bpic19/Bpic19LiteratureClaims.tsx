import { useEffect, useRef, useState } from "react";
import type { Bpic19LiteratureClaim } from "../generated/saving";

export type PurchasingLiteratureClaim = Bpic19LiteratureClaim;
const reportIds = ["R01","R02","R03","R04","R05","R06","R07","R08","R09","R10","R11","R12","R13","R14","R15","notebook","wise-paper"] as const;
function isReportId(value: string): value is PurchasingLiteratureClaim["report_id"] { return reportIds.some(id => id === value); }
export interface Bpic19LiteratureClaimsProps {
  claims: readonly PurchasingLiteratureClaim[];
  runIds: readonly string[];
  onChange: (claims: PurchasingLiteratureClaim[]) => void;
  onValidityChange?: (valid: boolean) => void;
}
interface Draft { report_id: PurchasingLiteratureClaim["report_id"] | ""; source_locator: string; claim: string; compared_run_id: string | null }
const empty = (): Draft => ({ report_id: "", source_locator: "", claim: "", compared_run_id: null });
function validClaim(claim: PurchasingLiteratureClaim, runIds: readonly string[]): boolean {
  return !!claim.claim_id.trim() && claim.claim_id.length <= 128 && isReportId(claim.report_id) && !!claim.source_locator.trim() && claim.source_locator.length <= 2000 &&
    !!claim.claim.trim() && claim.claim.length <= 4000 && claim.claim_level === "reported_not_rerun" && (claim.compared_run_id === null || runIds.includes(claim.compared_run_id));
}

/** Explicit source-cited statements, persisted by the existing immutable pipeline; no finding is prefilled or verified here. */
export function Bpic19LiteratureClaims({ claims, runIds, onChange, onValidityChange }: Bpic19LiteratureClaimsProps) {
  const [draft, setDraft] = useState<Draft>(empty);
  const callbacks=useRef({onChange,onValidityChange});callbacks.current={onChange,onValidityChange};
  const pending=draft.report_id!=="" || draft.source_locator!=="" || draft.claim!=="" || draft.compared_run_id!==null;
  const sourceValid=claims.length<=100 && new Set(claims.map(claim=>claim.claim_id)).size===claims.length && claims.every(claim=>validClaim(claim,runIds));
  const draftValid=isReportId(draft.report_id) && !!draft.source_locator.trim() && draft.source_locator.length<=2000 && !!draft.claim.trim() && draft.claim.length<=4000 && (draft.compared_run_id===null || runIds.includes(draft.compared_run_id));
  useEffect(()=>{callbacks.current.onValidityChange?.(sourceValid && !pending);},[sourceValid,pending,claims,runIds]);
  function change(next:Draft){callbacks.current.onValidityChange?.(false);setDraft(next);}
  function add(){if(!draftValid || claims.length>=100 || !isReportId(draft.report_id))return;
    const claim:PurchasingLiteratureClaim={claim_id:crypto.randomUUID(),report_id:draft.report_id,source_locator:draft.source_locator,claim:draft.claim,
      claim_level:"reported_not_rerun",compared_run_id:draft.compared_run_id};
    setDraft(empty());callbacks.current.onChange([...claims,claim]);
  }
  return <section className="bpic19-panel" aria-label="Reported literature claims">
    <h3>Source-cited literature statements</h3>
    <p>Each note is explicitly reported, not rerun. A link to a current native run identifies a comparison; matching numbers do not verify the supplied report or establish causality, adoption or savings.</p>
    <p>{claims.length} supplied notes of at most 100. No literature claim is inferred from the platform output.</p>
    {claims.length>0 && <table className="plain-table"><caption>Reported literature claims · reported_not_rerun</caption><thead><tr><th>Source and locator</th><th>Supplied statement</th><th>Claim level / compared run</th><th>Action</th></tr></thead><tbody>{claims.map((claim,index)=><tr key={`${claim.claim_id}-${index}`}><th scope="row">{claim.report_id} · {claim.source_locator}<small>{claim.claim_id}</small></th><td>{claim.claim}</td><td>reported_not_rerun<small>{claim.compared_run_id ?? "No linked computation"}</small>{!validClaim(claim,runIds) && <strong>Unresolved or invalid note; review or remove it before saving.</strong>}</td><td><button type="button" onClick={()=>callbacks.current.onChange(claims.filter((_,position)=>position!==index))}>Remove literature note {index+1}</button></td></tr>)}</tbody></table>}
    {!sourceValid && <p role="alert">Saved notes need unique IDs, a supplied source/locator, a statement, the fixed reported_not_rerun level and an admitted run reference. The list cannot exceed 100. No invalid note is silently dropped.</p>}
    <fieldset><legend>Add an explicit literature note</legend>
      <label>Supplied literature source<select value={draft.report_id} onChange={event=>{const value=event.target.value;if(value==="" || isReportId(value))change({...draft,report_id:value});}}><option value="">Choose a supplied source</option>{reportIds.map(id=><option key={id} value={id}>{id}</option>)}</select></label>
      <label>Source page, cell or exact locator<input maxLength={2000} value={draft.source_locator} onChange={event=>change({...draft,source_locator:event.target.value})}/></label>
      <label>Reported statement<textarea maxLength={4000} value={draft.claim} onChange={event=>change({...draft,claim:event.target.value})}/></label>
      <label>Compared saved native run (optional)<select value={draft.compared_run_id ?? ""} onChange={event=>change({...draft,compared_run_id:event.target.value || null})}><option value="">No linked computation</option>{draft.compared_run_id!==null && !runIds.includes(draft.compared_run_id) && <option value={draft.compared_run_id}>Unavailable run reference · review required: {draft.compared_run_id}</option>}{[...new Set(runIds)].map(id=><option key={id} value={id}>{id}</option>)}</select></label>
      <p>Claim level: reported_not_rerun. Source locators use the named document's one-based PDF page or explicitly declared notebook cell index.</p>
      <button type="button" disabled={!draftValid || claims.length>=100} onClick={add}>Add reported literature note</button>
      {pending && <button type="button" onClick={()=>setDraft(empty())}>Cancel unadded literature note</button>}
    </fieldset>
    {pending && <p role="status">This note is unfinished. Add it or cancel the draft before saving or exporting the investigation.</p>}
  </section>;
}
