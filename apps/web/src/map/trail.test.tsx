import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SelectionPredicate } from "../generated/selection";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { bothSteps, closed, contains, containingOpened, everyIncident, type Figures, follows, graphAnswer, opened, scriptedSelectionClient, selectionAnswer, suppliedGraph } from "../test/selections";
import { backTo, noSteps, trailOf, withStep } from "./steps";
import { shortStepWording } from "./wording";

// #93: the steps as a trail of short chips with the incidents kept after each, details on demand, and earlier states.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

async function start() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client);
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  const app = { selecting, coordinator, user: userEvent.setup() };
  await answer(app, everyIncident);
  return app;
}

async function answer(app: { selecting: ReturnType<typeof scriptedSelectionClient> }, figures: Figures) {
  const selection = app.selecting.selections.at(-1)!;
  await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) }));
  const graph = app.selecting.graphs.find((call) => call.request.query_revision === selection.request.query_revision)!;
  await deliver(() => graph.reply({ ok: true, answer: { ...graphAnswer(graph.request, figures.kept.case_ids), graph: suppliedGraph(figures.kept.case_ids) } }));
}

const applied = () => screen.getByRole("list", { name: "Steps of the selection" });
const summaries = (list: HTMLElement) => Array.from(list.querySelectorAll("summary"), (summary) => summary.textContent);

describe("the trail of steps", () => {
  it("shows each step as a short chip with the cases kept after it, the earliest first, its details on demand", async () => {
    const app = await start();
    act(() => app.coordinator.addStep(contains(opened)));
    await answer(app, containingOpened);
    act(() => app.coordinator.addStep(follows(opened, closed)));
    await answer(app, bothSteps);
    expect(summaries(applied())).toEqual(["1. With “Eröffnet”1 kept", "2. “Eröffnet” → “Geschlossen”1 kept"]);
    const chips = within(applied()).getAllByRole("listitem");
    expect(chips[1].getAttribute("aria-current")).toBe("step");
    const details = chips[0].querySelector("details")!;
    expect(details.open).toBe(false);
    await app.user.click(chips[0].querySelector("summary")!);
    expect(details.open).toBe(true);
    expect(within(chips[0]).getByText("Keep cases that contain “Eröffnet”")).toBeTruthy();
    expect(within(chips[0]).getByText("After this step: 1 case · 2 records kept")).toBeTruthy();
    expect(within(chips[0]).getByRole("button", { name: "Show the selection after this step" })).toBeTruthy();
    // The last step is the state shown: it offers no way to itself.
    expect(within(chips[1]).queryByRole("button", { name: "Show the selection after this step" })).toBeNull();
  });

  it("shows an earlier state without losing the later steps, goes forward again, and drops them only when a new step is taken", async () => {
    const app = await start();
    act(() => app.coordinator.addStep(contains(opened)));
    await answer(app, containingOpened);
    act(() => app.coordinator.addStep(follows(opened, closed)));
    await answer(app, bothSteps);
    await app.user.click(within(applied()).getAllByRole("button", { name: "Show the selection after this step" })[0]);
    expect(app.selecting.selections.at(-1)!.request.predicates).toEqual([contains(opened)]);
    await answer(app, containingOpened);
    expect(summaries(applied())).toEqual(["1. With “Eröffnet”1 kept"]);
    const later = screen.getByRole("list", { name: "Later steps, not applied now" });
    // The later step keeps the count it was answered with.
    expect(summaries(later)).toEqual(["2. “Eröffnet” → “Geschlossen”1 kept"]);
    await app.user.click(within(later).getByRole("button", { name: "Show the selection after this step" }));
    expect(app.selecting.selections.at(-1)!.request.predicates).toEqual([contains(opened), follows(opened, closed)]);
    await answer(app, bothSteps);
    expect(screen.queryByRole("list", { name: "Later steps, not applied now" })).toBeNull();
    // Back to the parent, then a new step: the later steps are gone.
    await app.user.click(screen.getByRole("button", { name: "Every case of the parent · 2" }));
    expect(app.selecting.selections.at(-1)!.request.predicates).toEqual([]);
    await answer(app, everyIncident);
    expect(summaries(screen.getByRole("list", { name: "Later steps, not applied now" }))).toHaveLength(2);
    act(() => app.coordinator.addStep(follows(opened, closed)));
    await answer(app, { ...containingOpened, population: "9" });
    expect(screen.queryByRole("list", { name: "Later steps, not applied now" })).toBeNull();
  });
});

describe("the steps of the trail", () => {
  const one = contains(opened);
  const two = follows(opened, closed);
  it("goes back to any earlier state and forward along the same trail; a new step leaves the trail", () => {
    const full = withStep(withStep(noSteps, one), two);
    const back = backTo(full, 1);
    expect(back.present).toEqual([one]);
    expect(trailOf(back)).toEqual([one, two]);
    expect(backTo(back, 2).present).toEqual([one, two]);
    expect(backTo(back, 2).future).toEqual(full.future);
    expect(trailOf(backTo(back, 0))).toEqual([one, two]);
    expect(trailOf(withStep(back, contains(closed)))).toEqual([one, contains(closed)]);
    expect(backTo(full, 2)).toBe(full);
    expect(backTo(full, 5)).toBe(full);
  });

  it("names a long list of case numbers by its count, and every step in a few words", () => {
    const steps: SelectionPredicate[] = [
      { kind: "case_id_in", case_ids: ["A-1", "B-2", "C-3"], negate: false },
      { kind: "case_id_in", case_ids: ["A-1"], negate: true },
      { kind: "measure_between", measure: "raw_record_count", minimum: 2, maximum: 4, negate: false },
      { kind: "path_lag_in_range", source_activity: "A", target_activity: "B", minimum_hours: 720, minimum_inclusive: false, maximum_hours: null, maximum_inclusive: false, passages: "every", negate: false },
      { kind: "observed_span_at_least", hours: 4, negate: true },
      { kind: "starts_with_activity", activity: "A", negate: true },
    ];
    expect(steps.map(shortStepWording)).toEqual([
      "3 case numbers",
      "Outside “A-1”",
      "Records 2–4",
      "“A” → “B” > 720 h, every passage",
      "Span < 4 h",
      "Does not begin “A”",
    ]);
  });
});
