import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ImportedPopulationAnswer } from "../generated/imports";
import type { SelectionAnswer } from "../generated/selection";
import { evidenceAnswer, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { contains, containingOpened, everyIncident, type Figures, graphAnswer, opened, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { ImportedInvestigationCoordinator } from "./coordinator";
import { ImportedInvestigation } from "./ImportedInvestigation";

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/**
 * The investigation of the two incidents A-1 and B-2 on its table of incidents, with its population
 * answered and its selection not yet. One of its rows lies outside every incident and every record
 * has an activity label, unless the population is changed.
 */
async function renderInvestigation(change: (answer: ImportedPopulationAnswer) => ImportedPopulationAnswer = (answer) => answer) {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} initialView="incidents" onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: change(populationAnswer(imports.populations[0].request)) }));
  return { imports, selecting, coordinator, user };
}

type App = Awaited<ReturnType<typeof renderInvestigation>>;

/** Answers the selection at a place with its figures, as the local service counted them or as changed here. */
async function select(app: App, place: number, figures: Figures, change: (answer: SelectionAnswer) => SelectionAnswer = (answer) => answer) {
  const selection = app.selecting.selections[place];
  await deliver(() => selection.reply({ ok: true, answer: change(selectionAnswer(selection.request, figures)) }));
  const graph = app.selecting.graphs.find((call) => call.request.query_revision === selection.request.query_revision)!;
  await deliver(() => graph.reply({ ok: true, answer: graphAnswer(graph.request, figures.kept.case_ids) }));
}

const population = () => screen.getByLabelText("Population");
/** The figures of the data row as they read, one after the other. */
const figures = () => Array.from(population().querySelectorAll("dd"), (figure) => figure.textContent);
/** The full name each figure has for assistive technology. */
const names = () => Array.from(population().querySelectorAll("dt"), (name) => [name.textContent, name.className]);
const limit = (name: string) => within(population()).getByText(name).parentElement!;
const aboutButton = () => screen.getByRole("button", { name: "About this data" });
const about = () => screen.queryByRole("group", { name: "About this data" });

describe("the data row of an investigation", () => {
  it("says in one line how much of the parent is kept, the kept numbers strong and the rest quiet, and says so while that is being selected", async () => {
    const app = await renderInvestigation();
    // A list of names and figures in the toolbar, after the breadcrumb; the names are for assistive technology only.
    expect(population().tagName).toBe("DL");
    expect(population().closest(".toolbar")).not.toBeNull();
    expect(names()).toEqual([
      ["Kept of the parent", "visually-hidden"],
      ["Rows outside every incident", "visually-hidden"],
      ["Records without activity label", "visually-hidden"],
    ]);
    // Nothing is known yet of what the selection keeps: the parent is said as it is supplied.
    expect(figures()).toEqual(["being selected of 2 incidents · 3 records", "1 outside", "0 unlabelled"]);
    expect(population().querySelector("strong")).toBeNull();
    expect(population().querySelector(".kept-share")).toBeNull();

    await select(app, 0, everyIncident);
    expect(figures()).toEqual(["2 of 2 incidents", "3 of 3 records", "1 outside", "0 unlabelled"]);

    app.coordinator.addStep(contains(opened));
    await select(app, 1, containingOpened);
    expect(figures()).toEqual(["1 of 2 incidents", "2 of 3 records", "1 outside", "0 unlabelled"]);
    expect(Array.from(population().querySelectorAll("strong"), (kept) => kept.textContent)).toEqual(["1", "2"]);
    expect(Array.from(population().querySelectorAll(".population-kept .muted"), (rest) => rest.textContent)).toEqual([" of 2 incidents", " of 3 records"]);
    // The kept share of the incidents is drawn beside its two numbers, as a picture only: one of two is half of the bar.
    const share = population().querySelector(".kept-share")!;
    expect(share.getAttribute("aria-hidden")).toBe("true");
    expect(share.closest("dd")?.textContent).toBe("1 of 2 incidents");
    expect(Array.from(share.querySelectorAll("rect"), (bar) => [bar.getAttribute("class"), bar.getAttribute("width")])).toEqual([
      ["kept-share-track", "100"],
      ["kept-share-bar", "50"],
    ]);
  });

  it("writes large numbers as the rest of the application does", async () => {
    const app = await renderInvestigation();
    await select(app, 0, everyIncident, (answer) => ({
      ...answer,
      parent: { ...answer.parent, case_count: 12063, record_count: 74077 },
      kept: { ...answer.kept, case_count: 803, record_count: 4398 },
    }));
    expect(figures().slice(0, 2)).toEqual(["803 of 12,063 incidents", "4,398 of 74,077 records"]);
    expect(Array.from(population().querySelectorAll("strong"), (kept) => kept.textContent)).toEqual(["803", "4,398"]);
  });

  it("keeps what the numbers leave out quiet at zero and marks a count above zero as a limit, each with its full name as tooltip", async () => {
    const app = await renderInvestigation();
    await select(app, 0, everyIncident);
    // One row lies outside every incident; every record has an activity label.
    const outside = limit("Rows outside every incident");
    const unlabelled = limit("Records without activity label");
    expect([outside.className, outside.getAttribute("data-some"), outside.querySelector("dd")?.textContent]).toEqual(["population-limit", "true", "1 outside"]);
    expect([unlabelled.className, unlabelled.hasAttribute("data-some"), unlabelled.querySelector("dd")?.textContent]).toEqual(["population-limit", false, "0 unlabelled"]);
    expect(outside.querySelector("dd")?.getAttribute("title")).toBe("Rows outside every incident");
    expect(unlabelled.querySelector("dd")?.getAttribute("title")).toBe("Records without activity label");
    // The two stand together at the end of the list.
    expect(outside.nextElementSibling).toBe(unlabelled);
    expect(population().lastElementChild).toBe(unlabelled);
  });

  it("marks records without activity label as a limit and no rows outside as none, the other way round", async () => {
    await renderInvestigation((answer) => ({
      ...answer,
      unassigned_record_count: 0,
      coverage: { ...answer.coverage, mapped_record_count: 0, omitted_activity_record_count: 1234 },
    }));
    expect(figures().slice(1)).toEqual(["0 outside", "1,234 unlabelled"]);
    expect(limit("Rows outside every incident").hasAttribute("data-some")).toBe(false);
    expect(limit("Records without activity label").getAttribute("data-some")).toBe("true");
  });

  it("holds the revision and the details of the data behind its info button, and no longer under the table of incidents", async () => {
    const app = await renderInvestigation();
    await select(app, 0, everyIncident);
    // The button follows the figures in the row.
    expect(aboutButton().closest(".data-facts")).toBe(population().parentElement);
    expect(population().nextElementSibling?.contains(aboutButton())).toBe(true);
    expect(aboutButton().getAttribute("aria-expanded")).toBe("false");
    expect(about()).toBeNull();
    expect(screen.queryByText("Data details")).toBeNull();
    expect(document.querySelector(".table-pane details")).toBeNull();
    expect(population().textContent).not.toContain("Revision");

    await app.user.click(aboutButton());
    expect(aboutButton().getAttribute("aria-expanded")).toBe("true");
    expect(within(about()!).getByRole("heading", { name: "Data details" })).toBeTruthy();
    const rows = Array.from(about()!.querySelectorAll("dl > div"), (row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]);
    expect(rows).toHaveLength(21);
    // A log without a declared document reference says so.
    expect(Object.fromEntries(rows)["Document reference"]).toBe("none");
    expect(Object.fromEntries(rows)["Read as numbers"]).toBe("none");
    // #49: the cutoff of the reading is named on its clock.
    expect(Object.fromEntries(rows)["Export taken at"]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}( UTC|, as recorded)$/);
    // The revision of the selection shown, then how the source was read and the identities of what was made of it.
    expect(rows.slice(0, 4)).toEqual([
      ["Revision", "2"],
      ["Source file", "Vorgänge.csv"],
      ["Encoding", "Windows-1252 (Western European)"],
      ["Delimiter", "Semicolon ;"],
    ]);
    expect(Object.fromEntries(rows).Preparation).toBe(preparationId);
    expect(rows.map(([name]) => name).slice(-3)).toEqual(["Population", "Implementation version", "Request"]);

    // The revision follows the selection while the panel is open.
    app.coordinator.addStep(contains(opened));
    await select(app, 1, containingOpened);
    expect(within(about()!).getByText("Revision").nextElementSibling?.textContent).toBe("3");

    await app.user.keyboard("{Escape}");
    expect(about()).toBeNull();
    expect(document.activeElement).toBe(aboutButton());
  });

  it("closes at Escape before the history of an open incident does, and at a click outside it", async () => {
    const app = await renderInvestigation();
    await select(app, 0, everyIncident);
    await app.user.click(screen.getByRole("button", { name: "A-1" }));
    await deliver(() => app.imports.evidence[0].reply({ ok: true, answer: evidenceAnswer(app.imports.evidence[0].request) }));
    const history = () => screen.queryByRole("heading", { name: "Incident A-1" });
    expect(history()).not.toBeNull();

    await app.user.click(aboutButton());
    expect(about()).not.toBeNull();
    // The first Escape is the panel's: the history stays open behind it.
    await app.user.keyboard("{Escape}");
    expect(about()).toBeNull();
    expect(history()).not.toBeNull();
    expect(document.activeElement).toBe(aboutButton());
    // The next is the history's, as before.
    await app.user.keyboard("{Escape}");
    expect(history()).toBeNull();

    await app.user.click(aboutButton());
    expect(about()).not.toBeNull();
    await app.user.click(screen.getByRole("heading", { name: "Kept incidents" }));
    expect(about()).toBeNull();
  });
});
