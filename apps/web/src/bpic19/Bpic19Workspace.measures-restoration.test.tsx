import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Bpic19ProfileProps } from "./Bpic19Profile";
import type { Bpic19MeasuresRequest } from "../generated/bpic19-measures";
import { CompareCoordinator } from "../compare/coordinator";
import { ImportedInvestigationCoordinator, shownSelection } from "../imported/coordinator";
import { SavingCoordinator } from "../saved/coordinator";
import { Bpic19Session } from "./session";
import { Bpic19Workspace } from "./Bpic19Workspace";
import { bpic19MeasuresContract } from "./measures-client";
import { bpic19ProfileContract } from "./profile-client";
import { savingContract } from "../saved/client";
import { importContract } from "../data/client";
import { selectionContract } from "../map/client";
import { scriptedComparisonClient } from "../test/comparisons";
import { scriptedImportClient } from "../test/imports";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedSavingClient } from "../test/saving";
import { scriptedViewClient } from "../test/views";
import frozen from "./measures-restoration-fixture.json";

// Only the unrelated profile/catalogue seams are scripted. Measures, its default
// HTTP client, validators, load/effects, Workspace and all owning coordinators are real.
vi.mock("./Bpic19Profile", () => ({ Bpic19Profile: function ProfileColumns(props: Bpic19ProfileProps) {
  const identity = JSON.stringify(props.identity);
  useEffect(() => {
    if (identity === JSON.stringify(frozen.profile.identity)) {
      const answer = { ...frozen.profile, query_revision: props.revision };
      if (!bpic19ProfileContract.answer(answer)) throw new Error("The frozen column catalogue must satisfy its contract");
      props.onColumns?.(answer);
    }
    props.onValidityChange?.(false);
    // This blank-role column catalogue does not review or replace a saved action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, props.revision]);
  return <section aria-label="Scripted source columns" />;
} }));

const active: { stop(): void }[] = [];
afterEach(() => { for (const coordinator of active.splice(0)) coordinator.stop(); vi.unstubAllGlobals(); });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

it("keeps both strict saved exports after real Measures automatically replays the frozen minimal T05 declaration", async () => {
  const imports = scriptedImportClient(), selections = scriptedSelectionClient(), saves = scriptedSavingClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selections.client, scriptedViewClient().client);
  const comparison = new CompareCoordinator(scriptedComparisonClient().client);
  const session = new Bpic19Session();
  const saving = new SavingCoordinator(saves.client, investigation, undefined, undefined, session);
  active.push(investigation, comparison, saving);
  const measures: Bpic19MeasuresRequest[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== "/api/investigations/bpic19-measures") throw new Error(`Unexpected transport route: ${url}`);
    const request = JSON.parse(String(init?.body)) as Bpic19MeasuresRequest;
    expect(bpic19MeasuresContract.request(request)).toBe(true);
    measures.push(structuredClone(request));
    // Production echoes the accepted wire query, including absence of optionals.
    // Source/population and definition identities remain the actual frozen ones.
    expect(request.identity).toEqual(frozen.reopen.revision.content.selection_identity);
    const answer = { ...frozen.reopen.bpic19_outputs.outputs[0].output, request_id: request.request_id, query_revision: request.query_revision,
      workspace_id: request.workspace_id, query: request.query };
    expect(bpic19MeasuresContract.answer(answer)).toBe(true);
    expect(answer.definition_id).toBe(frozen.reopen.revision.content.bpic19_pipeline.actions[0].definition_id);
    return new Response(JSON.stringify(answer), { status: 200 });
  }));
  render(<Bpic19Workspace investigation={investigation} comparison={comparison} saving={saving} session={session}
    active onShowData={vi.fn()} onShowComparison={vi.fn()} />);

  let reopening: Promise<boolean> | undefined;
  await act(async () => { reopening = saving.reopen({ ...frozen.summary, source_validation: "not_checked" }, frozen.reopen.workspace_id); await settle(); });
  const call = saves.reopens[0];
  await act(async () => {
    const answer = { ...structuredClone(frozen.reopen), request_id: call.request.request_id,
      query_revision: call.request.query_revision };
    if (!savingContract.reopenAnswer(answer)) throw new Error("The frozen reopen receipt must satisfy its contract");
    call.reply({ ok: true, answer });
    await settle();
  });
  expect(await reopening).toBe(true);
  await act(async () => {
    const population = imports.populations[0];
    const answer = { ...structuredClone(frozen.population), request_id: population.request.request_id,
      query_revision: population.request.query_revision };
    if (!importContract.populationAnswer(answer)) throw new Error("The frozen population must satisfy its contract");
    population.reply({ ok: true, answer });
    await settle();
  });
  expect(investigation.getState().saved?.content.bpic19_pipeline).toEqual(frozen.reopen.revision.content.bpic19_pipeline);
  expect(investigation.getState().selection.phase).toBe("loading");
  expect(saving.verifiedExportReceipt()).toBeNull();
  await act(async () => {
    const selection = selections.selections[0];
    const answer = { ...structuredClone(frozen.selection), request_id: selection.request.request_id,
      query_revision: selection.request.query_revision };
    if (!selectionContract.selectionAnswer(answer)) throw new Error("The frozen selection must satisfy its contract");
    selection.reply({ ok: true, answer });
    await settle();
    const graph = selections.graphs[0];
    const graphAnswer = { ...structuredClone(frozen.graph), request_id: graph.request.request_id,
      query_revision: graph.request.query_revision };
    if (!selectionContract.processGraphAnswer(graphAnswer)) throw new Error("The frozen graph must satisfy its contract");
    graph.reply({ ok: true, answer: graphAnswer });
    await settle();
  });
  await screen.findByRole("table", { name: "Raw-measure distributions over the complete named population" });
  await waitFor(() => expect(screen.queryByText(/Reading the measures/)).toBeNull());
  await waitFor(() => expect(session.readyForSave()).toBe(true));
  expect(shownSelection(investigation.getState().selection)?.answer.identity).toEqual(frozen.reopen.restored_selection.identity);
  expect(investigation.getState().saved?.revisionId).toBe(frozen.reopen.revision.saved_revision_id);
  expect(investigation.getState().saved?.content).toEqual(frozen.reopen.revision.content);
  expect(saves.saves).toHaveLength(0);
  expect(measures.length).toBeGreaterThan(0);
  expect({
    machine: screen.queryByRole("button", { name: "Export saved definitions, results and witnesses" }) !== null,
    readable: screen.queryByRole("button", { name: "Export readable purchasing analysis report" }) !== null,
    receipt: saving.verifiedExportReceipt(),
    pipeline: session.savedPipeline(),
  }).toEqual({
    machine: true, readable: true,
    receipt: { workspace_id: frozen.reopen.workspace_id, revision: frozen.reopen.revision, bpic19_outputs: frozen.reopen.bpic19_outputs },
    pipeline: frozen.reopen.revision.content.bpic19_pipeline,
  });

  const reads = measures.length;
  fireEvent.change(screen.getByRole("textbox", { name: "Declared source amount unit" }), { target: { value: "reviewed source units" } });
  expect(session.readyForSave()).toBe(false);
  expect(saving.verifiedExportReceipt()).toBeNull();
  expect(screen.queryByRole("button", { name: "Export saved definitions, results and witnesses" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Export readable purchasing analysis report" })).toBeNull();
  expect(investigation.getState().saved?.content).toEqual(frozen.reopen.revision.content);
  fireEvent.click(screen.getByRole("button", { name: "Restore reviewed definition" }));
  await waitFor(() => expect(saving.verifiedExportReceipt()).not.toBeNull());
  expect(session.savedPipeline()).toEqual(frozen.reopen.revision.content.bpic19_pipeline);
  expect(screen.getByRole("button", { name: "Export saved definitions, results and witnesses" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export readable purchasing analysis report" })).toBeTruthy();
  expect(measures).toHaveLength(reads);
  expect(saves.saves).toHaveLength(0);
});
