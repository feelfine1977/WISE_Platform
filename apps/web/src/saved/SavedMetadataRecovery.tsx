import { useEffect, useRef, useState } from "react";
import type { RecoverInvestigationMetadataAnswer, MetadataRecoveryPage } from "../generated/saving";
import { httpSavingMetadataClient, type SavingMetadataClient, type SavingProblem } from "./client";
import { describeSavingProblem } from "./wording";
import { useLineageEvidence } from "../bpic19/useLineageEvidence";
import { ImportedInspector } from "../imported/ImportedInspector";
import type { ImportClient } from "../data/client";

interface Props {
  workspaceId: string;
  savedRevisionId: string;
  client?: SavingMetadataClient;
  evidenceClient?: Pick<ImportClient, "caseEvidence">;
}
const initialPage = (): MetadataRecoveryPage => ({ notes_offset: 0, bookmarks_offset: 0, claims_offset: 0 });

/** Historical content only. No metadata read restores a selection, score, current output or save draft. */
export function SavedMetadataRecovery({ workspaceId, savedRevisionId, client = httpSavingMetadataClient, evidenceClient }: Props) {
  const [answer, setAnswer] = useState<RecoverInvestigationMetadataAnswer | null>(null);
  const [problem, setProblem] = useState<SavingProblem | null>(null), [busy, setBusy] = useState(false);
  const [page, setPage] = useState(initialPage), [layout, setLayout] = useState<"side" | "full" | "collapsed">("side");
  const serial = useRef(0), abort = useRef<AbortController | null>(null), lastPage = useRef(initialPage());
  const heading = useRef<HTMLHeadingElement>(null);
  const lineage = useLineageEvidence(workspaceId, answer?.metadata.base_identity, Math.max(1, serial.current), evidenceClient);
  useEffect(() => {
    ++serial.current; abort.current?.abort(); setAnswer(null); setProblem(null); setBusy(false); setPage(initialPage());
    return () => { ++serial.current; abort.current?.abort(); };
  }, [workspaceId, savedRevisionId, client]);
  async function read(next: MetadataRecoveryPage) {
    const mine = ++serial.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    lastPage.current = next; setBusy(true); setProblem(null); setAnswer(null);
    const request = { schema_version: 1 as const, message_type: "recover_investigation_metadata_request" as const,
      request_id: `metadata-recovery-${mine}`, query_revision: mine, workspace_id: workspaceId, saved_revision_id: savedRevisionId, page: next };
    let result;
    try { result = await client.recoverMetadata(request, controller.signal); }
    catch { result = { ok: false as const, problem: { kind: "unreachable" as const } }; }
    if (mine !== serial.current || controller.signal.aborted) return;
    setBusy(false);
    if (!result.ok) {
      if (result.problem.kind === "refusal" && (result.problem.refusal.request_id !== request.request_id || result.problem.refusal.query_revision !== request.query_revision || result.problem.refusal.workspace_id !== workspaceId)) {
        setProblem({ kind: "unsupported_reply", detail: "The refusal names another metadata request or workspace. Nothing was restored." });
      } else setProblem(result.problem);
      return;
    }
    const a = result.answer;
    if (a.request_id !== request.request_id || a.query_revision !== request.query_revision || a.workspace_id !== workspaceId ||
      a.saved_revision_id !== savedRevisionId || a.status !== "historical_metadata_only" || a.metadata_integrity !== "saved_content_hash_verified" || a.outputs_restored !== false || a.selection_restored !== false || a.source_verified !== false ||
      a.metadata.notes.offset !== next.notes_offset || a.metadata.bookmarks.offset !== next.bookmarks_offset || a.metadata.literature_claims.offset !== next.claims_offset) {
      setProblem({ kind: "unsupported_reply", detail: "The metadata reply names another revision, page or verified output. Nothing was restored." }); return;
    }
    setPage(next); setAnswer(a);
  }
  const current = answer?.workspace_id === workspaceId && answer.saved_revision_id === savedRevisionId ? answer : null;
  const metadata = current?.metadata;
  const failed = problem ? describeSavingProblem(problem) : null;
  return <section className="saved-panel" aria-label="Read-only saved metadata recovery">
    <h3>Read saved notes and original evidence</h3>
    <p>This view can read integrity-checked saved content while a saved source or analytical reference is unavailable or damaged. It does not restore the saved selection or any computed output, and it leaves the current investigation unchanged.</p>
    <button type="button" disabled={busy} onClick={() => void read(initialPage())}>Read historical notes and references</button>
    {busy && <p role="status">Reading saved metadata… <button type="button" onClick={() => { ++serial.current; abort.current?.abort(); setBusy(false); setAnswer(null); }}>Cancel metadata read</button></p>}
    {failed && <div role="alert"><p>{failed.message}</p><p>{failed.remedy}</p><button type="button" onClick={() => void read(lastPage.current)}>Retry metadata read</button></div>}
    {metadata && answer && <>
      <p><strong>Historical metadata only · outputs unverified and not restored</strong></p>
      <p>{metadata.name}{metadata.name_truncated && " [name preview shortened]"} · {answer.saved_revision_id}</p>
      <p>Declared saved source: {metadata.base_identity.source_id}. Declared preparation: {metadata.base_identity.preparation_id}. Saved selected population: {metadata.selection_identity.population_id}; its membership has not been restored here.</p>
      <h4>Saved investigation notes</h4><p className="saved-notes">{metadata.notes.text || "No note text on this page."}</p>
      <p>Note page starts at code-point {metadata.notes.offset} of {metadata.notes.total}.</p>
      <button type="button" disabled={metadata.notes.offset === 0} onClick={() => void read({ ...page, notes_offset: Math.max(0, metadata.notes.offset - 4000) })}>Previous note page</button>
      <button type="button" disabled={metadata.notes.next_offset === null} onClick={() => void read({ ...page, notes_offset: metadata.notes.next_offset ?? 0 })}>Next note page</button>
      <h4>Saved original-evidence references</h4>
      <p>These are declared bookmark references. A separate source read verifies an original item's rows; it does not verify the saved selected membership, score or native result.</p>
      {metadata.bookmarks.items.map((bookmark, index) => <details key={`${bookmark.case_id}-${metadata.bookmarks.offset + index}`}><summary>{bookmark.label}{bookmark.label_truncated && " [label preview shortened]"} · {bookmark.case_id}</summary>
        <p className="saved-notes">{bookmark.note}{bookmark.note_truncated && " [annotation preview shortened; full annotation remains in the immutable revision]"}</p>
        <p>{bookmark.row_ids.length} shown of {bookmark.row_count} declared original-row references{!bookmark.row_ids_complete && "; this is a bounded preview"}. Declared bookmark population: {bookmark.identity.population_id}.</p>
        <button type="button" onClick={() => { setLayout("side"); void lineage.open({ identity: metadata.base_identity, caseId: bookmark.case_id, rowIds: bookmark.row_ids,
          reason: "Independent original-source bookmark read; saved membership and computed outputs remain unverified" }); }}>Inspect independent source history {bookmark.case_id}</button>
      </details>)}
      <p>{metadata.bookmarks.total} saved bookmarks.</p>
      <button type="button" disabled={metadata.bookmarks.offset === 0} onClick={() => void read({ ...page, bookmarks_offset: Math.max(0, metadata.bookmarks.offset - 20) })}>Previous bookmark page</button>
      <button type="button" disabled={metadata.bookmarks.next_offset === null} onClick={() => void read({ ...page, bookmarks_offset: metadata.bookmarks.next_offset ?? 0 })}>Next bookmark page</button>
      <h4>Reported literature notes</h4>
      {metadata.literature_claims.items.map(claim => <p key={claim.claim_id}>{claim.report_id} · {claim.source_locator}: {claim.claim} · reported_not_rerun. Saved run reference: {claim.compared_run_id ?? "none"}; no linked output was restored.</p>)}
      <p>{metadata.literature_claims.total} explicitly supplied literature notes.</p>
      <button type="button" disabled={metadata.literature_claims.offset === 0} onClick={() => void read({ ...page, claims_offset: Math.max(0, metadata.literature_claims.offset - 10) })}>Previous literature page</button>
      <button type="button" disabled={metadata.literature_claims.next_offset === null} onClick={() => void read({ ...page, claims_offset: metadata.literature_claims.next_offset ?? 0 })}>Next literature page</button>
    </>}
    {metadata && lineage.state.phase !== "closed" && <div onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); lineage.close(); } }}>
      <p>{lineage.context?.reason}</p>
      <p>{lineage.state.phase === "ready" ? "Original-source times and records are independently verified by this read" :
        lineage.state.phase === "loading" ? "Original-source verification is pending; no source history is verified yet" :
        "Original-source verification failed; no source history was verified by this read"}; native outputs and saved selected membership remain unverified.</p>
      <ImportedInspector inspected={lineage.state} summary={undefined} layout={layout} onLayout={setLayout} onReturn={lineage.close} onRetry={lineage.retry} headingRef={heading} highlightedRowIds={lineage.context?.rowIds} />
    </div>}
  </section>;
}
