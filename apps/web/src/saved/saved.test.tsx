import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../App";
import { importContract } from "../data/client";
import type { OpenWorkspaceRequest, WorkspaceAnswer } from "../generated/imports";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { selectionContract } from "../map/client";
import { healthy } from "../test/answers";
import { leaveStartToAnalyst, populationAnswer, preparationId, scriptedImportClient, sourceId, workspaceId } from "../test/imports";
import {
  firstRevisionId,
  investigationId,
  listAnswer,
  reopenAnswer,
  saveAnswer,
  savedSummary,
  savingRefusal,
  scriptedSavingClient,
  secondRevisionId,
} from "../test/saving";
import {
  containingOpened,
  contains,
  everyIncident,
  graphAnswer,
  opened,
  scriptedSelectionClient,
  selectionAnswer,
  withoutOpened,
} from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { savingContract } from "./client";
import { SavingCoordinator } from "./coordinator";

const FOLDER = "C:\\Users\\Analyst\\Investigations";

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** The investigation of the imported preparation with "Save" in its toolbar, its incidents open. */
async function renderInvestigation() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const saving = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const coordinator = new SavingCoordinator(saving.client, investigation);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={investigation} saving={coordinator} initialView="incidents" onShowData={() => undefined} />);
  act(() => investigation.open({ workspaceId, preparationId }));
  const population = imports.populations[0];
  await deliver(() => population.reply({ ok: true, answer: populationAnswer(population.request) }));
  const app = { imports, selecting, saving, investigation, user };
  await answerSelection(app, 0, everyIncident, ["A-1", "B-2"]);
  return app;
}

type Investigation = Awaited<ReturnType<typeof renderInvestigation>>;

async function answerSelection(app: Pick<Investigation, "selecting">, index: number, figures: typeof everyIncident, kept: string[]) {
  const selection = app.selecting.selections[index];
  await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) }));
  const graph = app.selecting.graphs[index];
  await deliver(() => graph.reply({ ok: true, answer: graphAnswer(graph.request, kept) }));
}

function keptIncidents(): string[] {
  const table = screen.getByRole("table", { name: "Kept incidents" });
  return within(table).getAllByRole("rowheader").map((cell) => cell.textContent ?? "");
}

describe("saving the investigation shown", () => {
  it("saves a new investigation with its steps and parent, then a second save adds a revision", async () => {
    const app = await renderInvestigation();
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    const form = screen.getByRole("region", { name: "Save this investigation" });
    // Before saving, the form says what the save holds; the notes are fields, none required.
    const summary = within(form).getByLabelText("What this save holds");
    expect(summary.textContent).toContain("Pinned witnessesnone");
    expect(summary.textContent).toContain("Scoringnone: an unscored question is saved as it is");
    expect((within(form).getByLabelText("Name") as HTMLInputElement).value).toBe("Vorgänge.csv");
    await app.user.clear(within(form).getByLabelText("Name"));
    await app.user.type(within(form).getByLabelText("Name"), "Alle Vorgänge");
    await app.user.type(within(form).getByLabelText("Other notes"), "Both incidents, before any step.");
    await app.user.click(within(form).getByRole("button", { name: "Save" }));

    const first = app.saving.saves[0];
    expect(savingContract.saveRequest(first.request)).toBe(true);
    expect(first.request.investigation_id).toBeNull();
    expect(first.request.expected_revision_id).toBeNull();
    expect(first.request.name).toBe("Alle Vorgänge");
    expect(first.request.notes).toBe("Both incidents, before any step.");
    expect(first.request.workspace_id).toBe(workspaceId);
    expect(first.request.base_identity.preparation_id).toBe(preparationId);
    expect(first.request.selection_identity.population_id).toBe(`population.v1:sha256:${"f".repeat(64)}`);
    expect(first.request.selection_recipe).toEqual({ parent_case_ids: ["A-1", "B-2"], predicates: [] });
    expect(first.request.comparison).toBeNull();
    expect(first.request.bookmarks).toEqual([]);
    expect("score_run_ref" in first.request).toBe(false);
    expect(first.request.presentation_state?.active_view).toBe("incidents");

    const created = saveAnswer(first.request, firstRevisionId, true);
    expect(savingContract.saveAnswer(created)).toBe(true);
    await deliver(() => first.reply({ ok: true, answer: created }));
    expect(within(form).getByRole("status").textContent).toBe("Saved as the new investigation “Alle Vorgänge”.");
    const line = screen.getByRole("region", { name: "Saved investigation" });
    expect(line.textContent).toContain("Alle Vorgänge");
    expect(line.textContent).toContain("Both incidents, before any step.");

    // A step taken after saving, then a second save: it names the investigation and the revision it replaces.
    act(() => app.investigation.addStep(contains(opened)));
    await answerSelection(app, 1, containingOpened, ["A-1"]);
    await app.user.click(within(form).getByRole("button", { name: "Close" }));
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    const again = screen.getByRole("region", { name: "Save a new revision" });
    expect(within(again).getByText("Saving adds a new revision to “Alle Vorgänge”. The earlier revisions stay in the workspace as they were saved.")).toBeTruthy();
    expect((within(again).getByLabelText("Other notes") as HTMLTextAreaElement).value).toBe("Both incidents, before any step.");
    await app.user.click(within(again).getByRole("button", { name: "Save revision" }));

    const second = app.saving.saves[1];
    expect(savingContract.saveRequest(second.request)).toBe(true);
    expect(second.request.investigation_id).toBe(investigationId);
    expect(second.request.expected_revision_id).toBe(firstRevisionId);
    expect(second.request.selection_recipe).toEqual({ parent_case_ids: ["A-1", "B-2"], predicates: [contains(opened)] });
    expect(second.request.selection_identity.population_id).toBe(`population.v1:sha256:${"5".repeat(64)}`);
    await deliver(() => second.reply({ ok: true, answer: saveAnswer(second.request, secondRevisionId, false) }));
    expect(within(again).getByRole("status").textContent).toBe("Saved as a new revision of “Alle Vorgänge”.");
    expect(app.investigation.getState().saved?.revisionId).toBe(secondRevisionId);
  });

  it("does not mark another question as saved when the answer of an earlier save arrives late", async () => {
    const app = await renderInvestigation();
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    const form = screen.getByRole("region", { name: "Save this investigation" });
    await app.user.click(within(form).getByRole("button", { name: "Save" }));
    const first = app.saving.saves[0];

    // Before the answer arrives, the question shown becomes another one.
    act(() => app.investigation.addStep(contains(opened)));
    await answerSelection(app, 1, containingOpened, ["A-1"]);
    await deliver(() => first.reply({ ok: true, answer: saveAnswer(first.request, firstRevisionId, true) }));

    expect(app.investigation.getState().saved).toBeNull();
    expect(screen.queryByRole("region", { name: "Saved investigation" })).toBeNull();
    expect(keptIncidents()).toEqual(["A-1"]);
  });

  it("keeps the score run a saved investigation refers to when it is saved again", async () => {
    const app = await renderInvestigation();
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    const form = screen.getByRole("region", { name: "Save this investigation" });
    await app.user.click(within(form).getByRole("button", { name: "Save" }));
    const first = app.saving.saves[0];
    await deliver(() => first.reply({ ok: true, answer: saveAnswer(first.request, firstRevisionId, true) }));
    const reference = {
      score_run_id: `score-run.v1:sha256:${"1".repeat(64)}`,
      scored_population_id: first.request.selection_identity.population_id,
      calibration_id: `calibration.v1:sha256:${"2".repeat(64)}`,
    };
    const binding = app.investigation.getState().saved!;
    act(() => app.investigation.markSaved({ ...binding, content: { ...binding.content, score_run_ref: reference } }));

    await app.user.click(within(form).getByRole("button", { name: "Close" }));
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    await app.user.click(within(screen.getByRole("region", { name: "Save a new revision" })).getByRole("button", { name: "Save revision" }));

    const second = app.saving.saves[1];
    expect(savingContract.saveRequest(second.request)).toBe(true);
    expect(second.request.score_run_ref).toEqual(reference);
  });

  it("shows a save against a revision that is no longer the latest as a conflict with what to do", async () => {
    const app = await renderInvestigation();
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    await app.user.click(within(screen.getByRole("region", { name: "Save this investigation" })).getByRole("button", { name: "Save" }));
    await deliver(() => app.saving.saves[0].reply({ ok: true, answer: saveAnswer(app.saving.saves[0].request, firstRevisionId, true) }));
    await app.user.click(screen.getByRole("button", { name: "Close" }));
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    await app.user.click(screen.getByRole("button", { name: "Save revision" }));
    const stale = app.saving.saves[1];
    const conflict = savingRefusal(stale.request, "save_investigation", "revision_conflict", "This investigation was saved again since you opened it. Nothing was saved.", {
      investigation_id: investigationId,
      expected_revision_id: firstRevisionId,
      current_revision_id: secondRevisionId,
    });
    if (conflict.ok || conflict.problem.kind !== "refusal") throw new Error("A conflict is a refusal.");
    expect(savingContract.refusal(conflict.problem.refusal)).toBe(true);
    await deliver(() => stale.reply(conflict));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The investigation was not saved");
    expect(alert.textContent).toContain("This investigation was saved again since you opened it. Nothing was saved.");
    expect(alert.textContent).toContain("What to do Reopen the latest revision from the saved investigations, then save your changes again.");
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(app.investigation.getState().saved?.revisionId).toBe(firstRevisionId);
  });

  it("offers saving only once the incidents of the current steps are selected", async () => {
    const app = await renderInvestigation();
    act(() => app.investigation.addStep(contains(opened)));
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    const form = screen.getByRole("region", { name: "Save this investigation" });
    expect(within(form).getByText("Saving is possible once the incidents of the current steps are selected.")).toBeTruthy();
    expect((within(form).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(app.saving.saves).toHaveLength(0);
  });
});

/** The application with every client scripted, its workspace opened in the Data area and the Saved area shown. */
async function renderSavedArea() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const saving = scriptedSavingClient();
  const user = userEvent.setup();
  render(
    <App
      importClient={imports.client}
      selectionClient={selecting.client}
      viewClient={scriptedViewClient().client}
      savingClient={saving.client}
      checkHealth={healthy}
    />,
  );
  await deliver(() => leaveStartToAnalyst(imports));
  await user.click(screen.getByRole("button", { name: "Saved" }));
  expect(screen.getByText("Open a workspace in the Data area to see the investigations saved in it.")).toBeTruthy();
  await user.click(within(screen.getByRole("main")).getByRole("button", { name: "Data" }));
  await user.type(screen.getByLabelText("Folder path"), FOLDER);
  await user.click(screen.getByRole("button", { name: "Open workspace" }));
  const call = imports.workspaces[0];
  await deliver(() => call.reply({ ok: true, answer: workspaceWithSource(call.request) }));
  await user.click(screen.getByRole("button", { name: "Saved" }));
  return { imports, selecting, saving, user };
}

function workspaceWithSource(request: OpenWorkspaceRequest): WorkspaceAnswer {
  return {
    schema_version: 1,
    message_type: "workspace_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: workspaceId,
    path: request.path,
    writable: true,
    sources: [{ source_id: sourceId, filename: "Vorgänge.csv", byte_count: 120 }],
    preparations: [{ preparation_id: preparationId, source_id: sourceId }],
  };
}

describe("the saved investigations", () => {
  it("lists the saved investigations of the open workspace with their source and counts", async () => {
    const app = await renderSavedArea();
    const list = app.saving.lists[0];
    expect(savingContract.listRequest(list.request)).toBe(true);
    expect(list.request.workspace_id).toBe(workspaceId);
    expect(screen.getByText("Reading the saved investigations…")).toBeTruthy();
    const answer = listAnswer(list.request, [savedSummary]);
    expect(savingContract.listAnswer(answer)).toBe(true);
    await deliver(() => list.reply({ ok: true, answer }));

    const table = screen.getByRole("table");
    const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell").map((cell) => cell.textContent);
    expect(within(table).getByRole("rowheader").textContent).toBe("Eröffnungen");
    expect(cells[0]).toMatch(/^Vorgänge\.csvPreparation /);
    expect(cells[0]).toContain("Listed as saved, not checked yet: the source and the identities are checked when it is reopened.");
    expect(cells.slice(1, 3)).toEqual(["1 incident · 2 records", "two groups"]);
    expect(screen.getByRole("button", { name: "Reopen Eröffnungen" })).toBeTruthy();
  });

  it("says when nothing is saved, and shows a list that cannot be read as a refusal", async () => {
    const app = await renderSavedArea();
    await deliver(() => app.saving.lists[0].reply({ ok: true, answer: listAnswer(app.saving.lists[0].request, []) }));
    expect(screen.getByText(/No investigation is saved in this workspace yet\./)).toBeTruthy();
    await app.user.click(screen.getByRole("button", { name: "Data" }));
    await app.user.click(screen.getByRole("button", { name: "Saved" }));
    const listing = app.saving.lists[1];
    await deliver(() =>
      listing.reply(
        savingRefusal(listing.request, "list_saved", "malformed_saved_revision", "The file investigations/heads/0a1b.json in the workspace was changed or damaged outside the application."),
      ),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The saved investigations could not be listed");
    expect(alert.textContent).toContain("investigations/heads/0a1b.json");
    expect(alert.textContent).toContain("What to do Restore the named file from a backup, or move it out of the workspace folder.");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("reopens an investigation with its steps, kept incidents, view and comparison roles, and a fresh undo history", async () => {
    const app = await renderSavedArea();
    await deliver(() => app.saving.lists[0].reply({ ok: true, answer: listAnswer(app.saving.lists[0].request, [savedSummary]) }));
    await app.user.click(screen.getByRole("button", { name: "Reopen Eröffnungen" }));
    const reopen = app.saving.reopens[0];
    expect(savingContract.reopenRequest(reopen.request)).toBe(true);
    expect(reopen.request.saved_revision_id).toBe(secondRevisionId);
    expect(screen.getByText("Reopening “Eröffnungen”: computing it again from the stored source…").getAttribute("role")).toBe("status");
    const answer = reopenAnswer(reopen.request, "process_map");
    expect(savingContract.reopenAnswer(answer)).toBe(true);
    await deliver(() => reopen.reply({ ok: true, answer }));

    // The investigation of the saved preparation opens, and its population is asked for again.
    const population = app.imports.populations[0];
    expect(importContract.openPopulationRequest(population.request)).toBe(true);
    expect(population.request.preparation_id).toBe(preparationId);
    await deliver(() => population.reply({ ok: true, answer: populationAnswer(population.request) }));
    const selection = app.selecting.selections[0];
    expect(selectionContract.selectCasesRequest(selection.request)).toBe(true);
    expect(selection.request.parent_case_ids).toEqual(["A-1", "B-2"]);
    expect(selection.request.predicates).toEqual([contains(opened)]);
    await answerSelection(app, 0, containingOpened, ["A-1"]);

    expect(screen.getByRole("list", { name: "Steps of the selection" }).textContent).toContain("Keep incidents that contain “Eröffnet”");
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "Map of the kept incidents" })).toBeTruthy();
    await app.user.click(screen.getByRole("button", { name: "Incidents" }));
    expect(keptIncidents()).toEqual(["A-1"]);
    const line = screen.getByRole("region", { name: "Saved investigation" });
    expect(line.textContent).toContain("Eröffnungen");
    expect(line.textContent).toContain("Only A-1 was opened in a known order.");
    expect(line.textContent).toContain(
      "Target “Geöffnet” (1 named incident) against reference “Ungeordnet” (1 named incident), within a parent of 2 incidents.",
    );

    // Removing the restored step is the first entry of the new history; undo brings the step back.
    await app.user.click(screen.getByRole("button", { name: "Remove the step: Keep incidents that contain “Eröffnet”" }));
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a refused reopening with what to do and opens nothing as the saved state", async () => {
    const app = await renderSavedArea();
    await deliver(() => app.saving.lists[0].reply({ ok: true, answer: listAnswer(app.saving.lists[0].request, [savedSummary]) }));
    await app.user.click(screen.getByRole("button", { name: "Reopen Eröffnungen" }));
    const reopen = app.saving.reopens[0];
    const refused = savingRefusal(
      reopen.request,
      "reopen_investigation",
      "source_unavailable",
      `The bytes of the file Vorgänge.csv (${sourceId}) are no longer stored in the workspace.`,
    );
    await deliver(() => reopen.reply(refused));

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("“Eröffnungen” could not be reopened");
    expect(alert.textContent).toContain("The bytes of the file Vorgänge.csv");
    expect(alert.textContent).toContain("What to do Add the same source file again in the Data area; it is recognised by its bytes. Then reopen.");
    expect(screen.getByRole("heading", { name: "Saved investigations" })).toBeTruthy();
    expect(app.imports.populations).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Saved" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows a selection that differs from the restored one as a failure, not as the saved state", async () => {
    const app = await renderSavedArea();
    await deliver(() => app.saving.lists[0].reply({ ok: true, answer: listAnswer(app.saving.lists[0].request, [savedSummary]) }));
    await app.user.click(screen.getByRole("button", { name: "Reopen Eröffnungen" }));
    await deliver(() => app.saving.reopens[0].reply({ ok: true, answer: reopenAnswer(app.saving.reopens[0].request) }));
    const population = app.imports.populations[0];
    await deliver(() => population.reply({ ok: true, answer: populationAnswer(population.request) }));
    const selection = app.selecting.selections[0];
    await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, withoutOpened) }));

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The incidents could not be selected");
    expect(alert.textContent).toContain("The incidents selected now are not those of the saved investigation.");
    expect(app.selecting.graphs).toHaveLength(0);
  });
});
