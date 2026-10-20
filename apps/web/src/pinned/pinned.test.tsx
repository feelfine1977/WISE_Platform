import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ImportedCaseEvidenceAnswer } from "../generated/imports";
import { ImportedInvestigationCoordinator, type Pin, type PinEvidence } from "../imported/coordinator";
import { evidenceAnswer, identity, importRefusal, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { contains, containingOpened, everyIncident, graphAnswer, opened, parentPopulation, scriptedSelectionClient, selectionAnswer, type Figures } from "../test/selections";
import { PairedHistories } from "./PairedHistories";
import { PinControl } from "./PinControl";
import { PinnedIndex } from "./PinnedIndex";
import { contextAtFirst, historyMarks } from "./pins";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const words = { label: "", observation: "Seen twice", limitation: "", nextCheck: "Ask the desk" };

async function withStep() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client);
  coordinator.open({ workspaceId, preparationId });
  imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) });
  await settle();
  const reply = async (place: number, figures: Figures) => {
    const selection = selecting.selections[place];
    selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) });
    await settle();
    const graph = selecting.graphs.find((call) => call.request.query_revision === selection.request.query_revision);
    graph?.reply({ ok: true, answer: graphAnswer(graph.request, figures.kept.case_ids) });
    await settle();
  };
  await reply(0, everyIncident);
  coordinator.addStep(contains(opened));
  await reply(1, containingOpened);
  return { imports, coordinator };
}

describe("#19 histories opened through their exact handles and pinned", () => {
  it("reads a removed incident in the selection's parent, pins it as contrary and a kept one as supporting, each with its own handle", async () => {
    const { imports, coordinator } = await withStep();
    coordinator.openCase("B-2", "removed");
    const removed = imports.evidence.at(-1)!;
    expect(removed.request.identity.population_id).toBe(parentPopulation);
    removed.reply({ ok: true, answer: evidenceAnswer(removed.request) });
    await settle();
    expect(coordinator.getState().inspected).toMatchObject({ phase: "ready", caseId: "B-2", side: "removed" });
    const contrary = coordinator.pin("contrary", words)!;
    expect(contrary).toMatchObject({ role: "contrary", caseId: "B-2", side: "removed", label: "Incident B-2", observation: "Seen twice", nextCheck: "Ask the desk" });
    expect(contrary.identity.population_id).toBe(parentPopulation);
    expect(contrary.question).toMatchObject({ steps: [contains(opened)], kept: 1, removed: 1, parent: 2 });
    expect(contrary.rowIds).toHaveLength(3);

    coordinator.openCase("A-1");
    const kept = imports.evidence.at(-1)!;
    expect(kept.request.identity.population_id).toBe(`population.v1:sha256:${"5".repeat(64)}`);
    kept.reply({ ok: true, answer: evidenceAnswer(kept.request) });
    await settle();
    const supporting = coordinator.pin("supporting", { ...words, label: "  The witness  " })!;
    expect(supporting.label).toBe("The witness");
    expect(coordinator.getState().pins.map((pin) => pin.role)).toEqual(["contrary", "supporting"]);

    // A pinned history is asked in exactly the population it was pinned in.
    const asked = coordinator.pinEvidence(contrary.id, new AbortController().signal);
    const call = imports.evidence.at(-1)!;
    expect(call.request.identity).toEqual(contrary.identity);
    call.reply({ ok: true, answer: evidenceAnswer(call.request) });
    expect((await asked).ok).toBe(true);
  });

  it("keeps the history read before when a pinned one is refused, and says why", async () => {
    const { imports, coordinator } = await withStep();
    coordinator.openCase("B-2", "removed");
    imports.evidence.at(-1)!.reply({ ok: true, answer: evidenceAnswer(imports.evidence.at(-1)!.request) });
    await settle();
    const pin = coordinator.pin("contrary", words)!;
    coordinator.openCase("A-1");
    imports.evidence.at(-1)!.reply({ ok: true, answer: evidenceAnswer(imports.evidence.at(-1)!.request) });
    await settle();
    coordinator.openPin(pin.id);
    const call = imports.evidence.at(-1)!;
    expect(call.request.identity).toEqual(pin.identity);
    call.reply(importRefusal(call.request, "case_evidence", "case_not_found", "No incident B-2 in this population.", "case_id"));
    await settle();
    const inspected = coordinator.getState().inspected;
    expect(inspected).toMatchObject({ phase: "ready", caseId: "A-1", refusal: { caseId: "B-2" } });
    coordinator.unpin(pin.id);
    expect(coordinator.getState().pins).toEqual([]);
  });
});

function answerOf(caseId: string, populationId: string): ImportedCaseEvidenceAnswer {
  return evidenceAnswer({ schema_version: 1, message_type: "imported_case_evidence_request", request_id: "e", query_revision: 1, workspace_id: workspaceId,
    identity: { ...identity, population_id: populationId }, case_id: caseId });
}

function pinOf(id: number, role: Pin["role"], caseId: string, side: Pin["side"], label = `Incident ${caseId}`): Pin {
  return { id, role, caseId, side, identity: { ...identity, population_id: side === "kept" ? `population.v1:sha256:${"5".repeat(64)}` : parentPopulation },
    rowIds: [], question: { populationId: `population.v1:sha256:${"5".repeat(64)}`, steps: [contains(opened)], kept: 1, removed: 1, parent: 2 },
    label, observation: side === "kept" ? "Seen twice" : "", limitation: "", nextCheck: "" };
}

describe("#19 what to notice in a history, and the context of two read as recorded", () => {
  it("marks the record without a label, a missing time and a changed context value", () => {
    expect(historyMarks(answerOf("A-1", parentPopulation))).toEqual([
      [],
      ["no activity label: left out of the sequence", "Gruppe changed"],
      ["no usable time", "Gruppe changed"],
    ]);
  });

  it("reads the first records' context as the same, different or not recorded, matching nothing", () => {
    const left = answerOf("A-1", parentPopulation);
    const right = { ...answerOf("B-2", parentPopulation) };
    right.records = [{ ...right.records[0], context: [{ column_index: 3, value: null }] }, ...right.records.slice(1)];
    expect(contextAtFirst(left, left).map((row) => row.reading)).toEqual(["same value"]);
    expect(contextAtFirst(left, right)).toEqual([{ index: 3, name: "Gruppe", left: "Unknown", right: null, reading: "recorded on one side only" }]);
  });
});

describe("#19 two pinned histories beside each other", () => {
  it("shows every record of each with its row, keeps one side when the other is refused, and returns by Escape", async () => {
    const supporting = pinOf(1, "supporting", "A-1", "kept", "A".repeat(180));
    const contrary = pinOf(2, "contrary", "B-2", "removed");
    const evidence = vi.fn(async (pinId: number): Promise<PinEvidence> =>
      pinId === 1 ? { ok: true, answer: answerOf("A-1", supporting.identity.population_id) }
        : importRefusal({ request_id: "e", query_revision: 1 }, "case_evidence", "case_not_found", "No incident B-2 in this population.", "case_id") as PinEvidence);
    const onReturn = vi.fn();
    render(<PairedHistories pins={[supporting, contrary]} evidence={evidence} currentPopulationId={`population.v1:sha256:${"9".repeat(64)}`} onReturn={onReturn} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Two pinned histories" }));
    const left = screen.getByRole("region", { name: "Supporting · Incident A-1" });
    const table = await within(left).findByRole("table", { name: /^All 3 records of incident A-1 in the declared order/ });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText(answerOf("A-1", parentPopulation).records[1].row_id)).toBeTruthy();
    expect(within(left).getByText("A".repeat(180))).toBeTruthy();
    expect(within(left).getByText(/^Kept by the selection: one of 1 incident of 2 incidents, under 1 step: /)).toBeTruthy();
    expect(within(left).getByText("Seen twice")).toBeTruthy();
    // Pinned under other steps than those shown: said, and read in its own population all the same.
    expect(within(left).getByText(/^Pinned under other steps than those shown now/)).toBeTruthy();
    const right = screen.getByRole("region", { name: "Contrary · Incident B-2" });
    expect((await within(right).findByRole("alert")).textContent).toContain("No incident B-2 in this population.");
    expect(within(right).getByText(/^Removed by the selection: one of 1 incident it removes, read in its parent of 2 incidents/)).toBeTruthy();
    // Without both histories, no context is put beside each other.
    expect(screen.queryByRole("region", { name: "Context at the first record of each" })).toBeNull();
    fireEvent.keyDown(table, { key: "Escape" });
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("puts the context of both first records beside each other and says nothing is matched", async () => {
    const pins: [Pin, Pin] = [pinOf(1, "supporting", "A-1", "kept"), pinOf(2, "contrary", "B-2", "removed")];
    render(<PairedHistories pins={pins} evidence={async (pinId) => ({ ok: true, answer: answerOf(pinId === 1 ? "A-1" : "B-2", parentPopulation) })}
      currentPopulationId={pins[0].question.populationId} onReturn={() => undefined} />);
    const context = await screen.findByRole("region", { name: "Context at the first record of each" });
    expect(within(context).getByText(/no other incident is looked for to match either one/)).toBeTruthy();
    expect(within(context).getByRole("row", { name: /Gruppe/ }).textContent).toContain("same value");
    expect(screen.queryByText(/^Pinned under other steps/)).toBeNull();
  });
});

describe("#19 pinning and the index of pins", () => {
  it("pins with the analyst's role and words, none required", async () => {
    const onPin = vi.fn();
    render(<PinControl caseId="A-1" pinned={[]} onPin={onPin} onUnpin={() => undefined} />);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "Witness");
    await user.click(screen.getByRole("button", { name: "Pin as contrary" }));
    expect(onPin).toHaveBeenLastCalledWith("contrary", { label: "Witness", observation: "", limitation: "", nextCheck: "" });
    expect(screen.getByRole("status").textContent).toContain("Pinned as contrary.");
    expect(screen.getByText(/WISE does not decide them/)).toBeTruthy();
  });

  it("chooses two pins to read beside each other and returns the focus to a pin's Open button", async () => {
    const pins = [pinOf(1, "supporting", "A-1", "kept"), pinOf(2, "contrary", "B-2", "removed")];
    const onPair = vi.fn();
    const onOpen = vi.fn();
    const { rerender } = render(<PinnedIndex pins={pins} currentPopulationId={pins[0].question.populationId} onOpen={onOpen} onUnpin={() => undefined} onPair={onPair} openPinId={null} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Read the two chosen side by side" }));
    expect(onPair).toHaveBeenCalledWith([1, 2]);
    await user.click(screen.getByRole("checkbox", { name: "Read Incident B-2 beside another" }));
    expect((screen.getByRole("button", { name: "Read the two chosen side by side" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Open the history of Incident B-2" }));
    expect(onOpen).toHaveBeenCalledWith(2);
    rerender(<PinnedIndex pins={pins} currentPopulationId={pins[0].question.populationId} onOpen={onOpen} onUnpin={() => undefined} onPair={onPair} openPinId={2} />);
    (document.activeElement as HTMLElement).blur();
    rerender(<PinnedIndex pins={pins} currentPopulationId={pins[0].question.populationId} onOpen={onOpen} onUnpin={() => undefined} onPair={onPair} openPinId={null} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open the history of Incident B-2" }));
  });
});
