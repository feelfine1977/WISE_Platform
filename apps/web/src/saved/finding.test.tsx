import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { pinNote, readPinNote } from "../pinned/pins";
import { evidenceAnswer, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { baseIdentity, containingOpenedIdentity, investigationId, reopenAnswer, savedContent, savedSummary, savingRefusal, scriptedSavingClient, secondRevisionId } from "../test/saving";
import { containingOpened, contains, everyIncident, graphAnswer, opened, parentPopulation, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { savingContract } from "./client";
import { SavingCoordinator } from "./coordinator";
import { composeNotes, emptyNotes, readNotes } from "./notes";

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

async function opened_investigation() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const saving = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const coordinator = new SavingCoordinator(saving.client, investigation);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={investigation} saving={coordinator} initialView="incidents" onShowData={() => undefined} />);
  act(() => investigation.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  const app = { imports, selecting, saving, investigation, coordinator, user };
  await answer(app, 0, everyIncident, ["A-1", "B-2"]);
  return app;
}

async function answer(app: { selecting: ReturnType<typeof scriptedSelectionClient> }, index: number, figures: typeof everyIncident, kept: string[]) {
  const selection = app.selecting.selections[index];
  await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) }));
  const graph = app.selecting.graphs[index];
  await deliver(() => graph.reply({ ok: true, answer: graphAnswer(graph.request, kept) }));
}

describe("#25 structured notes and pinned witnesses in one saved revision", () => {
  it("writes and reads the notes as labelled paragraphs, a note written before as it was", () => {
    const fields = { ...emptyNotes, question: "Why late?", counterexample: "B-2", other: "Free text." };
    expect(composeNotes(fields)).toBe("Question: Why late?\n\nCounterexample: B-2\n\nFree text.");
    expect(readNotes(composeNotes(fields))).toEqual(fields);
    expect(readNotes("Only A-1 was opened in a known order.")).toEqual({ ...emptyNotes, other: "Only A-1 was opened in a known order." });
    const pin = { role: "contrary" as const, observation: "Late", limitation: "", nextCheck: "Ask the desk" };
    expect(pinNote(pin)).toBe("Role: contrary\nObservation: Late\nNext check: Ask the desk");
    expect(readPinNote(pinNote(pin))).toEqual(pin);
  });

  it("saves the pins as bookmarks with their roles and words, says what the save holds, and keeps a refused save's words as a draft", async () => {
    const app = await opened_investigation();
    act(() => app.investigation.addStep(contains(opened)));
    await answer(app, 1, containingOpened, ["A-1"]);
    act(() => app.investigation.openCase("A-1"));
    await deliver(() => app.imports.evidence.at(-1)!.reply({ ok: true, answer: evidenceAnswer(app.imports.evidence.at(-1)!.request) }));
    act(() => { app.investigation.pin("supporting", { label: "", observation: "Opened first", limitation: "", nextCheck: "" }); });
    act(() => app.investigation.openCase("B-2", "removed"));
    await deliver(() => app.imports.evidence.at(-1)!.reply({ ok: true, answer: evidenceAnswer(app.imports.evidence.at(-1)!.request) }));
    act(() => { app.investigation.pin("contrary", { label: "The other one", observation: "", limitation: "Unordered", nextCheck: "" }); });

    await app.user.click(screen.getByRole("button", { name: "Save" }));
    const form = screen.getByRole("region", { name: "Save this investigation" });
    const summary = within(form).getByLabelText("What this save holds");
    expect(summary.textContent).toContain("Pinned witnessesSupporting · Case A-1 (A-1); Contrary · The other one (B-2)");
    await app.user.type(within(form).getByLabelText("Question"), "Which opened first?");
    await app.user.type(within(form).getByLabelText("Counterexample"), "B-2");
    // Closed and opened again: the words come back, said to be an unsaved draft.
    await app.user.click(within(form).getByRole("button", { name: "Close" }));
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    const again = screen.getByRole("region", { name: "Save this investigation" });
    expect((within(again).getByLabelText("Question") as HTMLTextAreaElement).value).toBe("Which opened first?");
    expect(within(again).getByRole("note").textContent).toContain("Unsaved draft: these words were written here before and are not saved yet.");
    await app.user.click(within(again).getByRole("button", { name: "Save" }));
    const request = app.saving.saves[0].request;
    expect(savingContract.saveRequest(request)).toBe(true);
    expect(request.notes).toBe("Question: Which opened first?\n\nCounterexample: B-2");
    expect(request.bookmarks.map((bookmark) => [bookmark.case_id, bookmark.identity.population_id, bookmark.note])).toEqual([
      ["A-1", `population.v1:sha256:${"5".repeat(64)}`, "Role: supporting\nObservation: Opened first"],
      ["B-2", parentPopulation, "Role: contrary\nLimitation: Unordered"],
    ]);
    // A refused save keeps what was typed, as a draft and in the form.
    await deliver(() => app.saving.saves[0].reply(savingRefusal(request, "save_investigation", "publication_failed", "The disk is full.")));
    expect(within(again).getByText(/What you typed is kept as an unsaved draft/)).toBeTruthy();
    expect((within(again).getByLabelText("Counterexample") as HTMLTextAreaElement).value).toBe("B-2");
  });

  it("brings the pinned witnesses back as pins when the saved investigation reopens", async () => {
    const app = await opened_investigation();
    const bookmarks = [
      { label: "Witness", identity: containingOpenedIdentity, case_id: "A-1", row_ids: [], note: "Role: supporting\nObservation: Opened first" },
      { label: "Counter", identity: { ...baseIdentity, population_id: parentPopulation }, case_id: "B-2", row_ids: [], note: "Role: contrary" },
    ];
    void app.coordinator.reopen(savedSummary, workspaceId);
    const reopened = reopenAnswer(app.saving.reopens[0].request);
    await deliver(() => app.saving.reopens[0].reply({ ok: true, answer: { ...reopened, revision: { ...reopened.revision, content: { ...savedContent, bookmarks } } } }));
    await deliver(() => app.imports.populations[1].reply({ ok: true, answer: populationAnswer(app.imports.populations[1].request) }));
    const selection = app.selecting.selections.at(-1)!;
    await deliver(() => selection.reply({ ok: true, answer: { ...selectionAnswer(selection.request, containingOpened), identity: containingOpenedIdentity } }));
    const graph = app.selecting.graphs.at(-1)!;
    await deliver(() => graph.reply({ ok: true, answer: graphAnswer(graph.request, ["A-1"]) }));
    const pins = app.investigation.getState().pins;
    expect(pins.map((pin) => [pin.role, pin.caseId, pin.side, pin.label, pin.observation])).toEqual([
      ["supporting", "A-1", "kept", "Witness", "Opened first"],
      ["contrary", "B-2", "removed", "Counter", ""],
    ]);
  });

  it("applies a saved question to another reading, says what changed and saves nothing until saved", async () => {
    const app = await opened_investigation();
    const other = `preparation.v1:sha256:${"9".repeat(64)}`;
    void app.coordinator.refresh(savedSummary, workspaceId, other);
    const call = app.saving.refreshes[0];
    expect(savingContract.refreshRequest(call.request)).toBe(true);
    const reopened = reopenAnswer({ schema_version: 1, message_type: "reopen_investigation_request", request_id: call.request.request_id, query_revision: call.request.query_revision,
      workspace_id: workspaceId, saved_revision_id: secondRevisionId });
    const refreshed = {
      schema_version: 1 as const, message_type: "refresh_investigation_answer" as const, request_id: call.request.request_id, query_revision: call.request.query_revision,
      workspace_id: workspaceId, revision: reopened.revision, preparation_id: other, parent_case_ids: null, restored_selection: reopened.restored_selection,
      review: [
        { aspect: "source" as const, status: "changed" as const, before: "a", after: "b" },
        { aspect: "clock" as const, status: "unchanged" as const, before: "x", after: "x" },
        { aspect: "comparison" as const, status: "to_review" as const, before: "saved comparison", after: null },
      ],
    };
    expect(savingContract.refreshAnswer(refreshed)).toBe(true);
    await deliver(() => call.reply({ ok: true, answer: refreshed }));
    expect(app.imports.populations.at(-1)!.request.preparation_id).toBe(other);
    expect(app.investigation.getState().replacement?.asked.restoration?.refreshed).toBe(true);
    await deliver(() => app.imports.populations.at(-1)!.reply({ ok: true, answer: populationAnswer(app.imports.populations.at(-1)!.request) }));
    const selection = app.selecting.selections.at(-1)!;
    await deliver(() => selection.reply({ ok: true, answer: { ...selectionAnswer(selection.request, containingOpened), identity: reopened.restored_selection.identity } }));
    const review = screen.getByRole("region", { name: "Applied to another reading, not saved yet" });
    expect(review.textContent).toContain("Saving it adds a new revision; the revision it comes from stays and reopens as it was.");
    expect(within(review).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Source: changed, a → b", "Clock and cutoff: unchanged", "Comparison: to make again on this reading"]);
    expect(app.saving.saves).toHaveLength(0);
    expect(app.investigation.getState().saved?.investigationId).toBe(investigationId);
  });
});
