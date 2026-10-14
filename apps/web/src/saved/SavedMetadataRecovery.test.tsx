import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SavedMetadataRecovery } from "./SavedMetadataRecovery";
import { httpSavingMetadataClient, savingContract, type SavingMetadataClient, type SavingOutcome } from "./client";
import type { RecoverInvestigationMetadataAnswer, RecoverInvestigationMetadataRequest } from "../generated/saving";
import { firstRevisionId, investigationId } from "../test/saving";
import rawEvidence from "../bpic19/retained-cohort-h7-evidence.json";
import { importContract, type ImportClient } from "../data/client";

if (!importContract.caseEvidenceAnswer(rawEvidence)) throw new Error("The independent H7 source evidence fixture is invalid");
const evidence = rawEvidence;
const wid = evidence.workspace_id;
function metadata(request: RecoverInvestigationMetadataRequest): RecoverInvestigationMetadataAnswer {
  return { schema_version: 1, message_type: "recover_investigation_metadata_answer", request_id: request.request_id, query_revision: request.query_revision,
    workspace_id: request.workspace_id, saved_revision_id: request.saved_revision_id, investigation_id: investigationId,
    status: "historical_metadata_only", metadata_integrity: "saved_content_hash_verified", outputs_restored: false, selection_restored: false, source_verified: false,
    metadata: { name: "Saved control hypothesis", name_truncated: false, base_identity: evidence.identity, selection_identity: evidence.identity,
      notes: { offset: request.page.notes_offset, total: 4004, text: request.page.notes_offset ? "😀END" : "😀".repeat(4000), next_offset: request.page.notes_offset ? null : 4000 },
      bookmarks: { offset: request.page.bookmarks_offset, total: 1, next_offset: null, items: [{ label: "Original A witness", label_truncated: false, identity: evidence.identity,
        case_id: "A", row_ids: [evidence.records[0].row_id], row_count: 1, row_ids_complete: true, note: "A user-entered annotation, not a computed finding", note_truncated: false }] },
      literature_claims: { offset: request.page.claims_offset, total: 1, next_offset: null, items: [{ claim_id: "reported-r04", report_id: "R04", source_locator: "Merged PDF 82",
        claim: "Reported training population; not rerun", claim_level: "reported_not_rerun", compared_run_id: "score-run-unavailable" }] } } };
}
const client = (): SavingMetadataClient => ({ recoverMetadata: vi.fn(async request => ({ ok: true as const, answer: metadata(request) })) });
afterEach(() => { vi.unstubAllGlobals(); });

describe("historical metadata recovery", () => {
  it("requires an explicit read, preserves reported claims and verifies complete original evidence independently by keyboard", async () => {
    const user = userEvent.setup(), service = client();
    const source: Pick<ImportClient, "caseEvidence"> = { caseEvidence: vi.fn(async request => ({ ok: true as const, answer: { ...evidence,
      request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity } })) };
    render(<SavedMetadataRecovery workspaceId={wid} savedRevisionId={firstRevisionId} client={service} evidenceClient={source} />);
    expect(service.recoverMetadata).not.toHaveBeenCalled();
    const read = screen.getByRole("button", { name: "Read historical notes and references" }); read.focus(); await user.keyboard("{Enter}");
    await screen.findByText(/Historical metadata only/);
    expect(screen.getByText(/Saved selected population/).textContent).toContain("membership has not been restored");
    expect(screen.getByText(/reported_not_rerun/).textContent).toContain("no linked output was restored");
    expect(screen.queryByText(/mean score/i)).toBeNull();expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    await user.click(screen.getByText("Original A witness · A"));
    const inspect = screen.getByRole("button", { name: "Inspect independent source history A" }); inspect.focus(); await user.keyboard("{Enter}");
    await screen.findByText(/Complete history in the declared order/);
    expect(source.caseEvidence).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ identity: evidence.identity, case_id: "A" }), expect.any(AbortSignal));
    expect(document.querySelectorAll(".imported-inspector .history-entry")).toHaveLength(3);
    const contributing = document.querySelectorAll('.imported-inspector [data-contributing="true"]');
    expect(contributing).toHaveLength(1);expect(contributing[0].textContent).toContain(evidence.records[0].row_id);
    expect(screen.getByText(/Original-source times and records are independently verified/)).toBeTruthy();
    expect(screen.getAllByText(/1948/).length).toBeGreaterThan(0);
  });
  it("follows server Unicode code-point note cursors and leaves historical qualification explicit", async () => {
    const user = userEvent.setup(), service = client();
    render(<SavedMetadataRecovery workspaceId={wid} savedRevisionId={firstRevisionId} client={service} />);
    await user.click(screen.getByRole("button", { name: "Read historical notes and references" })); await screen.findByText(/Historical metadata only/);
    await user.click(screen.getByRole("button", { name: "Next note page" })); await screen.findByText("😀END");
    expect(vi.mocked(service.recoverMetadata).mock.calls[1][0].page.notes_offset).toBe(4000);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next note page" }).disabled).toBe(true);
    expect(screen.getByText(/outputs unverified and not restored/)).toBeTruthy();
  });
  it("fences delayed replies after changing workspace/revision and after cancellation", async () => {
    let release: ((value: SavingOutcome<RecoverInvestigationMetadataAnswer>) => void) | undefined;
    let requested: RecoverInvestigationMetadataRequest | undefined;
    const service: SavingMetadataClient = { recoverMetadata: vi.fn((request: RecoverInvestigationMetadataRequest): Promise<SavingOutcome<RecoverInvestigationMetadataAnswer>> => {
      requested = request; return new Promise<SavingOutcome<RecoverInvestigationMetadataAnswer>>(resolve => { release = resolve; });
    }) };
    const user = userEvent.setup();const view = render(<SavedMetadataRecovery workspaceId={wid} savedRevisionId={firstRevisionId} client={service} />);
    await user.click(screen.getByRole("button", { name: "Read historical notes and references" }));
    view.rerender(<SavedMetadataRecovery workspaceId="workspace.v1:another-fixture" savedRevisionId={firstRevisionId} client={service} />);
    if (!release || !requested) throw new Error("Deferred metadata request was not made");release({ ok: true, answer: metadata(requested) });
    await waitFor(() => expect(screen.queryByText(/Saved control hypothesis/)).toBeNull());
    await user.click(screen.getByRole("button", { name: "Read historical notes and references" })); await user.click(screen.getByRole("button", { name: "Cancel metadata read" }));
    if (!release || !requested) throw new Error("Deferred metadata request was not made");release({ ok: true, answer: metadata(requested) });
    await waitFor(() => expect(screen.queryByText(/Saved control hypothesis/)).toBeNull());
  });
  it("accepts exact artifact failure codes and refuses a reply that claims current computed outputs", async () => {
    const request: RecoverInvestigationMetadataRequest = { schema_version: 1, message_type: "recover_investigation_metadata_request", request_id: "recovery-1", query_revision: 1,
      workspace_id: wid, saved_revision_id: firstRevisionId, page: { notes_offset: 0, bookmarks_offset: 0, claims_offset: 0 } };
    expect(savingContract.metadataRequest(request)).toBe(true);expect(savingContract.metadataAnswer(metadata(request))).toBe(true);
    for (const code of ["artifact_unavailable", "checksum_mismatch"] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ schema_version: 1, message_type: "saving_refusal", request_id: request.request_id,
        query_revision: 1, workspace_id: wid, operation: "recover_investigation_metadata", code, message: "Original result remains unavailable", field: "saved_revision_id", retryable: false }), { status: 409 })));
      const result = await httpSavingMetadataClient.recoverMetadata(request, new AbortController().signal);
      expect(result).toMatchObject({ ok: false, problem: { kind: "refusal", refusal: { code } } });
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...metadata(request), outputs_restored: true }), { status: 200 })));
    expect(await httpSavingMetadataClient.recoverMetadata(request, new AbortController().signal)).toMatchObject({ ok: false, problem: { kind: "unsupported_reply" } });
  });
});
