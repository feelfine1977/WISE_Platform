import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ImportedPopulationAnswer, OpenPopulationRequest } from "../generated/imports";
import { earlierPreparationId, evidenceAnswer, importRefusal, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { contains, containingOpened, everyIncident, graphAnswer, opened, scriptedSelectionClient, selectionAnswer, selectionRefusal } from "../test/selections";
import { containingOpenedIdentity, firstRevisionId, investigationId, savedContent } from "../test/saving";
import { scriptedViewClient } from "../test/views";
import { ImportedInvestigationCoordinator, shownSelection } from "./coordinator";
import { ImportedInvestigation } from "./ImportedInvestigation";

/*
 * The preparation shown is "Vorgänge.csv" with incidents A-1 and B-2 (preparation 666…). The one
 * asked for in its place is "Zweite.csv" with incident C-3 alone (preparation 888…), written here.
 */
const shownName = "Vorgänge.csv, preparation 66666666";
const askedName = "Zweite.csv, preparation 88888888";

function secondAnswer(request: OpenPopulationRequest): ImportedPopulationAnswer {
  const answer = populationAnswer(request);
  return {
    ...answer,
    source: { ...answer.source, filename: "Zweite.csv" },
    population: { case_ids: ["C-3"], case_count: 1, record_count: 4 },
    coverage: { raw_record_count: 4, mapped_record_count: 4, omitted_activity_record_count: 0 },
    unassigned_record_count: 0,
    cases: [{ case_id: "C-3", record_count: 4, mapped_record_count: 4, omitted_activity_record_count: 0, sequence_evaluable: true }],
  };
}

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** Opens the first preparation with its selection of every incident, and the history of A-1. */
async function showFirst() {
  const scripted = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const viewing = scriptedViewClient();
  const coordinator = new ImportedInvestigationCoordinator(scripted.client, selecting.client, viewing.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} initialView="incidents" onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId, sourceName: "Vorgänge.csv" }));
  await deliver(() => scripted.populations[0].reply({ ok: true, answer: populationAnswer(scripted.populations[0].request) }));
  const selection = selecting.selections[0];
  await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, everyIncident) }));
  await deliver(() => selecting.graphs[0].reply({ ok: true, answer: graphAnswer(selecting.graphs[0].request, ["A-1", "B-2"]) }));
  await user.click(screen.getByRole("button", { name: "A-1" }));
  await deliver(() => scripted.evidence[0].reply({ ok: true, answer: evidenceAnswer(scripted.evidence[0].request) }));
  expect(history()).not.toBeNull();
  return { ...scripted, selecting, viewing, coordinator, user };
}

type Shown = Awaited<ReturnType<typeof showFirst>>;

function askSecond(app: Shown) {
  act(() => app.coordinator.open({ workspaceId, preparationId: earlierPreparationId, sourceName: "Zweite.csv" }));
  return app.populations[app.populations.length - 1];
}

function shownIncidents(): string[] {
  const table = screen.getByRole("table", { name: "Kept incidents" });
  return within(table).getAllByRole("rowheader").map((cell) => cell.textContent ?? "");
}

function history() {
  return screen.queryByRole("list", { name: "Records of incident A-1 in the declared order" });
}

/** Everything that says the question shown is the first preparation's. */
function expectFirstShown() {
  expect(screen.getByRole("heading", { name: "Vorgänge.csv" })).toBeTruthy();
  expect(shownIncidents()).toEqual(["A-1", "B-2"]);
  expect(screen.getByLabelText("Population").textContent).toContain("Parent2 incidents · 3 records");
  expect(screen.getByLabelText("Population").textContent).toContain("Revision2");
  const details = screen.getByText("Data details").closest("details")?.textContent ?? "";
  expect(details).toContain(preparationId);
  expect(details).not.toContain(earlierPreparationId);
}

describe("keeping the investigation shown while another preparation is opened", () => {
  it("keeps the question shown in full while the other preparation opens, and says which is which", async () => {
    const app = await showFirst();
    const request = askSecond(app);
    expect(request.request).toMatchObject({ preparation_id: earlierPreparationId, query_revision: 3 });

    expectFirstShown();
    expect(history()).not.toBeNull();
    expect(screen.getByText(`Showing ${shownName}; opening ${askedName} …`)).toBeTruthy();
    const row = screen.getByRole("button", { name: "A-1" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(row.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(`Not available while ${askedName} is opening: what is shown belongs to ${shownName}.`);
    await app.user.click(screen.getByRole("button", { name: "B-2" }));
    expect(app.evidence).toHaveLength(1);

    // Steps on the question shown wait as well.
    act(() => app.coordinator.addStep(contains(opened)));
    expect(app.selecting.selections).toHaveLength(1);
  });

  it("keeps the question shown and its open history when the other preparation fails, and opens it on a retry", async () => {
    const app = await showFirst();
    const request = askSecond(app);
    await deliver(() => request.reply({ ok: false, problem: { kind: "unreachable" } }));

    expectFirstShown();
    expect(history()).not.toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(`Could not open ${askedName}; ${shownName} is still shown.`);
    expect(alert.textContent).toContain("The local service could not be reached.");
    expect(screen.getByRole("button", { name: "A-1" }).getAttribute("aria-disabled")).toBeNull();

    await app.user.click(within(alert).getByRole("button", { name: "Try again" }));
    const retried = app.populations[app.populations.length - 1];
    expect(retried.request).toMatchObject({ preparation_id: earlierPreparationId, query_revision: 4 });
    expect(screen.queryByRole("alert")).toBeNull();
    expectFirstShown();

    await deliver(() => retried.reply({ ok: true, answer: secondAnswer(retried.request) }));
    expect(screen.getByRole("heading", { name: "Zweite.csv" })).toBeTruthy();
    expect(shownIncidents()).toEqual(["C-3"]);
    expect(history()).toBeNull();
    expect(screen.queryByText(/^Showing /)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // The selection of the new population is asked for on its own identity.
    const selection = app.selecting.selections[app.selecting.selections.length - 1];
    expect(selection.request).toMatchObject({ query_revision: 5, identity: { preparation_id: earlierPreparationId } });
  });

  it("stays with the question shown, which can then be worked on again", async () => {
    const app = await showFirst();
    const request = askSecond(app);
    await deliver(() =>
      request.reply(importRefusal(request.request, "open_population", "preparation_unavailable", "This preparation is not kept in the workspace.", "preparation_id")),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("What to do Read the source again with the same choices in the Data area.");
    await app.user.click(within(alert).getByRole("button", { name: `Stay with ${shownName}` }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(app.coordinator.getState().replacement).toBeNull();
    expectFirstShown();
    expect(history()).not.toBeNull();

    await app.user.click(screen.getByRole("button", { name: "B-2" }));
    expect(app.evidence).toHaveLength(2);
    expect(app.evidence[1].request).toMatchObject({ case_id: "B-2", query_revision: 2, identity: { preparation_id: preparationId } });
    act(() => app.coordinator.addStep(contains(opened)));
    expect(app.selecting.selections[1].request).toMatchObject({ query_revision: 4, identity: { preparation_id: preparationId } });
  });

  it("does not let a late failure or answer of an abandoned replacement disturb the question shown", async () => {
    const app = await showFirst();
    const abandoned = askSecond(app);
    const current = askSecond(app);
    expect(abandoned.signal.aborted).toBe(true);
    await deliver(() => abandoned.reply({ ok: false, problem: { kind: "http", status: 500 } }));
    await deliver(() => abandoned.reply({ ok: true, answer: secondAnswer(abandoned.request) }));

    expect(screen.queryByRole("alert")).toBeNull();
    expectFirstShown();
    expect(screen.getByText(`Showing ${shownName}; opening ${askedName} …`)).toBeTruthy();
    expect(app.coordinator.getState().replacement).toMatchObject({ phase: "running", revision: current.request.query_revision });
  });

  it("lets a selection asked for before the replacement finish under the question shown", async () => {
    const app = await showFirst();
    act(() => app.coordinator.addStep(contains(opened)));
    const selection = app.selecting.selections[1];
    askSecond(app);
    await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, containingOpened) }));
    const graph = app.selecting.graphs[1];
    await deliver(() => graph.reply({ ok: true, answer: graphAnswer(graph.request, ["A-1"]) }));

    expect(shownSelection(app.coordinator.getState().selection)?.answer.kept.case_ids).toEqual(["A-1"]);
    expect(shownIncidents()).toEqual(["A-1"]);
    expect(app.coordinator.getState().replacement?.phase).toBe("running");
  });

  it("offers to stay with the earlier selection when a new one fails", async () => {
    const app = await showFirst();
    act(() => app.coordinator.addStep(contains(opened)));
    const refused = app.selecting.selections[1];
    await deliver(() => refused.reply(selectionRefusal(refused.request, "select_cases", "computation_failed", "The answer could not be computed.")));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not open the new selection; the earlier selection is still shown.");
    expect(shownIncidents()).toEqual(["A-1", "B-2"]);

    await app.user.click(within(alert).getByRole("button", { name: "Stay with the earlier selection" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(app.coordinator.getState().selection).toMatchObject({ phase: "ready", history: { present: [] } });
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(shownIncidents()).toEqual(["A-1", "B-2"]);
  });

  it("says which selection is shown while new steps are selected", async () => {
    const app = await showFirst();
    act(() => app.coordinator.addStep(contains(opened)));
    expect(screen.getByText("Showing the earlier selection; opening the new selection …")).toBeTruthy();
    expect(shownIncidents()).toEqual(["A-1", "B-2"]);

    const selection = app.selecting.selections[1];
    await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, containingOpened) }));
    await deliver(() => app.selecting.graphs[1].reply({ ok: true, answer: graphAnswer(app.selecting.graphs[1].request, ["A-1"]) }));
    expect(screen.queryByText(/^Showing the earlier selection/)).toBeNull();
    expect(shownIncidents()).toEqual(["A-1"]);
  });

  it("lets a failed selection wait, with the reason, while another preparation opens", async () => {
    const app = await showFirst();
    act(() => app.coordinator.addStep(contains(opened)));
    const refused = app.selecting.selections[1];
    await deliver(() => refused.reply(selectionRefusal(refused.request, "select_cases", "computation_failed", "The answer could not be computed.")));
    const request = askSecond(app);

    const reason = `Not available while ${askedName} is opening: what is shown belongs to ${shownName}.`;
    for (const name of ["Try again", "Stay with the earlier selection"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe(reason);
    }

    await deliver(() => request.reply({ ok: false, problem: { kind: "unreachable" } }));
    const stay = screen.getByRole("button", { name: "Stay with the earlier selection" }) as HTMLButtonElement;
    expect(stay.disabled).toBe(false);
    await app.user.click(stay);
    expect(app.coordinator.getState().selection).toMatchObject({ phase: "ready", history: { present: [] } });
  });

  it("lets the retries of a history and of the views wait, with the reason, while another preparation opens", async () => {
    const app = await showFirst();
    await app.user.click(screen.getByRole("button", { name: "B-2" }));
    await deliver(() => app.evidence[1].reply({ ok: false, problem: { kind: "unreachable" } }));
    await deliver(() => app.viewing.openings.at(-1)!.reply({ ok: false, problem: { kind: "unreachable" } }));
    await deliver(() => app.viewing.variants.at(-1)!.reply({ ok: false, problem: { kind: "unreachable" } }));
    const retries = () => screen.getAllByRole("button", { name: "Try again" }) as HTMLButtonElement[];
    expect(retries()).toHaveLength(3);
    const request = askSecond(app);

    const reason = `Not available while ${askedName} is opening: what is shown belongs to ${shownName}.`;
    for (const button of retries()) {
      expect(button.disabled).toBe(true);
      expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe(reason);
    }

    await deliver(() => request.reply({ ok: false, problem: { kind: "unreachable" } }));
    // Three retries of the question shown and the retry of the failed replacement.
    expect(retries().map((button) => button.disabled)).toEqual([false, false, false, false]);
  });

  it("opens a saved investigation in place of the question shown, in the view it was saved in", async () => {
    const app = await showFirst();
    act(() =>
      app.coordinator.restore({
        target: { workspaceId, preparationId },
        steps: [contains(opened)],
        parentCaseIds: ["A-1", "B-2"],
        selectionIdentity: containingOpenedIdentity,
        binding: { investigationId, revisionId: firstRevisionId, content: savedContent },
        view: "map",
      }),
    );
    expect(screen.getByText(`Showing ${shownName}; opening the saved investigation “Eröffnungen” …`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Incidents" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("region", { name: "Saved investigation" })).toBeNull();

    const reopened = app.populations[app.populations.length - 1];
    await deliver(() => reopened.reply({ ok: true, answer: populationAnswer(reopened.request) }));
    expect(screen.getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
    expect(app.selecting.selections.at(-1)?.request).toMatchObject({ predicates: [contains(opened)], parent_case_ids: ["A-1", "B-2"] });
  });
});
