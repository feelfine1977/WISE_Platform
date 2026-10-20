import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { scriptedSelectionClient } from "../test/selections";
import {
  openingContextAnswer,
  scriptedViewClient,
  selectionOpeningContextAnswer,
  variantIds,
  variantsAnswer,
  viewPopulationAnswer,
  viewRefusal,
} from "../test/views";
import { populationViewMessages, type Variant } from "./messages";
import { OpenedAs } from "./OpenedAs";

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** The investigation with its population open: five incidents, and the two views requested. */
async function openInvestigation() {
  const imports = scriptedImportClient();
  const views = scriptedViewClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, scriptedSelectionClient().client, views.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} initialView="incidents" onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  const population = viewPopulationAnswer(imports.populations[0].request);
  await deliver(() => imports.populations[0].reply({ ok: true, answer: population }));
  return { imports, views, coordinator, user, population };
}

function tableIncidents(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent ?? "");
}

/** In the investigation the side panel opens on request and shows one of the two views at a time: the one asked for is brought forward. */
function panel(name: string): HTMLElement {
  const toggle = screen.queryByRole("button", { name: "Filters and views" });
  if (toggle?.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  const tab = screen.queryByRole("button", { name: name === "Variants" ? /^Patterns/ : /^Context( ·|$)/ });
  if (tab) fireEvent.click(tab);
  return screen.getByRole("region", { name });
}

function values(list: HTMLElement): HTMLElement[] {
  return within(list).getAllByRole("listitem");
}

describe("the views of the population of an imported preparation", () => {
  it("asks for the opening context and the variants of the open population under its revision", async () => {
    const app = await openInvestigation();
    expect(app.views.openings).toHaveLength(1);
    expect(app.views.variants).toHaveLength(1);
    const opening = app.views.openings[0].request;
    const variants = app.views.variants[0].request;
    expect(populationViewMessages.openingContextRequest(opening)).toBe(true);
    expect(populationViewMessages.variantsRequest(variants)).toBe(true);
    for (const request of [opening, variants]) {
      expect(request.query_revision).toBe(app.population.query_revision);
      expect(request.workspace_id).toBe(workspaceId);
      expect(request.identity).toEqual(app.population.identity);
    }
    expect(within(panel("At the first recorded observation")).getByText("Reading the first record of every incident…")).toBeTruthy();
    expect(within(panel("Variants")).getByText("Reading the sequence of every incident…")).toBeTruthy();
    expect(populationViewMessages.openingContextAnswer(openingContextAnswer(opening))).toBe(true);
    expect(populationViewMessages.openingContextAnswer(selectionOpeningContextAnswer(opening))).toBe(true);
    expect(populationViewMessages.variantsAnswer(variantsAnswer(variants))).toBe(true);
  });

  it("shows how the incidents were opened, missing as not recorded and apart from the text Unknown", async () => {
    const app = await openInvestigation();
    await deliver(() => app.views.openings[0].reply({ ok: true, answer: openingContextAnswer(app.views.openings[0].request) }));
    const opened = panel("At the first recorded observation");
    expect(opened.textContent).toContain("These incidents are the whole parent population, so both bars are the same.");
    expect(opened.textContent).toContain("1 incident of the parent has no readable first record because its order is not known; it is in no share.");

    const group = within(opened).getByRole("list", { name: "Opening values of Gruppe, most frequent first" });
    const entries = values(group);
    expect(entries.map((entry) => entry.querySelector(".opening-label")?.textContent)).toEqual(["Büro", "Unknown", "not recorded"]);
    expect(entries[1].querySelector(".opening-label")?.className).not.toContain("missing-text");
    expect(entries[2].querySelector(".opening-label")?.className).toContain("missing-text");
    const described = "Büro. These incidents: 2 of 4 (50.0%). Parent population: 2 of 4 (50.0%). Difference ±0.0 percentage points.";
    expect(entries[0].getAttribute("title")).toBe(described);
    expect(entries[0].querySelector(".visually-hidden")?.textContent).toBe(described);
    expect(entries[0].querySelector(".opening-figures")?.textContent).toBe("2 (50.0%) · 2 (50.0%)");
    expect(entries[2].getAttribute("title")).toBe(
      "not recorded. These incidents: 1 of 4 (25.0%). Parent population: 1 of 4 (25.0%). Difference ±0.0 percentage points.",
    );

    const priority = values(within(opened).getByRole("list", { name: "Opening values of Priorität, most frequent first" }));
    expect(priority.map((entry) => entry.querySelector(".opening-label")?.textContent)).toEqual(["P1", "P2", "1 other value"]);
  });

  it("draws two thin bars per value for a selection and its parent, with the remainder and the differences", () => {
    const request = {
      schema_version: 1 as const,
      message_type: "opening_context_request" as const,
      request_id: "opening-1-1",
      query_revision: 1,
      workspace_id: workspaceId,
      identity: viewPopulationAnswer({
        schema_version: 1,
        message_type: "open_population_request",
        request_id: "population-1",
        query_revision: 1,
        workspace_id: workspaceId,
        preparation_id: preparationId,
      }).identity,
    };
    render(<OpenedAs state={{ phase: "ready", answer: selectionOpeningContextAnswer(request) }} onRetry={() => undefined} />);
    const opened = panel("At the first recorded observation");
    expect(opened.textContent).not.toContain("both bars are the same");
    expect(opened.textContent).toContain("These incidents: 2 incidents with a readable first record");
    expect(opened.textContent).toContain("Parent population: 4 incidents with a readable first record");

    const group = values(within(opened).getByRole("list", { name: "Opening values of Gruppe, most frequent first" }));
    const widths = (entry: HTMLElement) =>
      [".share-bar-population", ".share-bar-parent"].map((selector) => entry.querySelector(selector)?.getAttribute("width"));
    expect(widths(group[0])).toEqual(["50", "50"]);
    expect(widths(group[1])).toEqual(["50", "25"]);
    expect(widths(group[2])).toEqual(["0", "25"]);
    expect(group[1].getAttribute("title")).toBe(
      "Unknown. These incidents: 1 of 2 (50.0%). Parent population: 1 of 4 (25.0%). Difference +25.0 percentage points.",
    );
    expect(group[2].getAttribute("title")).toBe(
      "not recorded. These incidents: 0 of 2 (0.0%). Parent population: 1 of 4 (25.0%). Difference −25.0 percentage points.",
    );

    const priority = values(within(opened).getByRole("list", { name: "Opening values of Priorität, most frequent first" }));
    expect(priority.map((entry) => entry.querySelector(".opening-label")?.textContent)).toEqual(["P1", "P3", "1 other value"]);
    expect(priority[2].querySelector(".visually-hidden")?.textContent).toBe(
      "1 other value. These incidents: 0 of 2 (0.0%). Parent population: 1 of 4 (25.0%). Difference −25.0 percentage points.",
    );
  });

  it("ranks the variants as chains of steps with their counts and shares, and keeps the unordered incident apart", async () => {
    const app = await openInvestigation();
    await deliver(() => app.views.variants[0].reply({ ok: true, answer: variantsAnswer(app.views.variants[0].request) }));
    const list = within(panel("Variants")).getByRole("list", { name: "Variants, most incidents first" });
    const items = within(list)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === list);
    expect(items.map((item) => item.querySelector(".variant-rank")?.textContent)).toEqual(["Variant 1", "Variant 2", "Variant 3"]);
    const chain = within(items[0]).getByRole("list", { name: "Sequence of variant 1, 4 steps" });
    expect(within(chain).getAllByRole("listitem").map((step) => step.querySelector(".variant-step")?.textContent)).toEqual([
      "Eröffnet",
      "Weitergeleitet",
      "Weitergeleitet",
      "Gelöst",
    ]);
    const figures = items[0].querySelector(".variant-figures")!;
    expect(figures.querySelector("[aria-hidden='true']")?.textContent).toBe("2 incidents · 50.0%");
    expect(figures.getAttribute("title")).toBe("2 of 4 incidents whose order is known (50.0%)");
    expect(figures.querySelector(".visually-hidden")?.textContent).toBe("2 of 4 incidents whose order is known (50.0%)");
    expect(items[1].textContent).toContain("No labelled activity");
    const text = panel("Variants").textContent;
    expect(text).toContain("Shares are of the 4 incidents whose order is known, among the incidents opened, whatever steps the selection takes.");
    expect(text).toContain("4 incidents in 3 variants and 1 incident with no known order: 5 incidents counted exactly, none sampled.");
    expect(text).toContain("1 incident has no known order and is in no variant.");
    expect(text).toContain("1 record without an activity label is left out of the sequences.");
  });

  it("lists the incidents of a chosen variant in the table until the choice is cleared, without a new request", async () => {
    const app = await openInvestigation();
    await deliver(() => app.views.variants[0].reply({ ok: true, answer: variantsAnswer(app.views.variants[0].request) }));
    expect(tableIncidents()).toEqual(["K-1", "K-2", "K-3", "K-4", "K-5"]);
    const facts = screen.getByLabelText("Population").textContent;

    panel("Variants");
    const choose = screen.getByRole("button", { name: "List the 2 incidents of variant 1 in the table" });
    expect(choose.getAttribute("aria-pressed")).toBe("false");
    await app.user.click(choose);
    expect(tableIncidents()).toEqual(["K-1", "K-3"]);
    expect(screen.getByRole("heading", { name: "Kept incidents of variant 1" })).toBeTruthy();
    expect(screen.getByText("The table lists the 2 incidents of variant 1.", { selector: "[role='status']" })).toBeTruthy();
    expect(choose.getAttribute("aria-pressed")).toBe("true");
    // A view, not a selection step: the population, its facts and its views are not asked again.
    expect(screen.getByLabelText("Population").textContent).toBe(facts);
    expect(app.imports.populations).toHaveLength(1);
    expect(app.views.variants).toHaveLength(1);
    expect(app.views.openings).toHaveLength(1);

    await app.user.click(screen.getByRole("button", { name: "List the 1 incident of variant 2 in the table" }));
    expect(tableIncidents()).toEqual(["K-4"]);
    await app.user.click(screen.getByRole("button", { name: "Show every incident" }));
    expect(tableIncidents()).toEqual(["K-1", "K-2", "K-3", "K-4", "K-5"]);
    // The button that cleared the choice is gone; the focus moves to the heading of the table.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Kept incidents" }));
    expect(app.coordinator.getState().chosenVariant).toBeNull();

    // Pressing the chosen variant again clears the choice as well.
    await app.user.click(screen.getByRole("button", { name: "List the 1 incident of variant 3 in the table" }));
    expect(tableIncidents()).toEqual(["K-2"]);
    await app.user.click(screen.getByRole("button", { name: "List the 1 incident of variant 3 in the table" }));
    expect(tableIncidents()).toEqual(["K-1", "K-2", "K-3", "K-4", "K-5"]);
  });

  it("opens every record of an incident listed by a variant", async () => {
    const app = await openInvestigation();
    await deliver(() => app.views.variants[0].reply({ ok: true, answer: variantsAnswer(app.views.variants[0].request) }));
    panel("Variants");
    await app.user.click(screen.getByRole("button", { name: "List the 2 incidents of variant 1 in the table" }));
    await app.user.click(screen.getByRole("button", { name: "K-3" }));
    expect(app.imports.evidence[0].request.case_id).toBe("K-3");
    expect(app.imports.evidence[0].request.identity).toEqual(app.population.identity);
    await app.user.keyboard("{Escape}");
    expect(document.activeElement?.textContent).toBe("K-3");
    // Showing every incident again moves the focus to the table's heading, not back to the row last returned to.
    await app.user.click(screen.getByRole("button", { name: "Show every incident" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Kept incidents" }));
    // Choosing another variant keeps the focus on its button.
    const choose = screen.getByRole("button", { name: "List the 1 incident of variant 3 in the table" });
    await app.user.click(choose);
    expect(document.activeElement).toBe(choose);
  });

  it("forgets the chosen variant when the population is opened again", async () => {
    const app = await openInvestigation();
    await deliver(() => app.views.variants[0].reply({ ok: true, answer: variantsAnswer(app.views.variants[0].request) }));
    act(() => app.coordinator.chooseVariant(variantIds[0]));
    expect(tableIncidents()).toEqual(["K-1", "K-3"]);

    act(() => app.coordinator.open({ workspaceId, preparationId }));
    // The answer shown, with its chosen variant, stays until the population opened again arrives.
    expect(app.coordinator.getState().chosenVariant).toBe(variantIds[0]);
    await deliver(() => app.imports.populations[1].reply({ ok: true, answer: viewPopulationAnswer(app.imports.populations[1].request) }));
    expect(app.coordinator.getState().chosenVariant).toBeNull();
    expect(tableIncidents()).toEqual(["K-1", "K-2", "K-3", "K-4", "K-5"]);
    // A choice of a variant the current answer does not hold yet is not taken.
    act(() => app.coordinator.chooseVariant(variantIds[0]));
    expect(app.coordinator.getState().chosenVariant).toBeNull();
  });

  it("drops the replies of an earlier revision that arrive after the population was opened again", async () => {
    const app = await openInvestigation();
    const [firstOpening] = app.views.openings;
    const [firstVariants] = app.views.variants;
    act(() => app.coordinator.open({ workspaceId, preparationId }));
    await deliver(() => app.imports.populations[1].reply({ ok: true, answer: viewPopulationAnswer(app.imports.populations[1].request) }));
    // The views of the answer shown are abandoned once the population opened again replaces it.
    expect(firstOpening.signal.aborted).toBe(true);
    expect(firstVariants.signal.aborted).toBe(true);
    expect(app.views.variants[1].request.query_revision).toBe(app.imports.populations[1].request.query_revision);

    await deliver(() => firstOpening.reply({ ok: true, answer: openingContextAnswer(firstOpening.request) }));
    await deliver(() => firstVariants.reply(viewRefusal(firstVariants.request, "variants", "computation_failed", "Late.")));
    expect(app.coordinator.getState().openingContext.phase).toBe("loading");
    expect(app.coordinator.getState().variants.phase).toBe("loading");
    expect(within(panel("Variants")).queryByRole("alert")).toBeNull();

    await deliver(() => app.views.variants[1].reply({ ok: true, answer: variantsAnswer(app.views.variants[1].request) }));
    expect(app.coordinator.getState().variants.phase).toBe("ready");
  });

  it("shows a refusal with what to do, and retries only what can succeed on a retry", async () => {
    const app = await openInvestigation();
    const opening = app.views.openings[0].request;
    await deliver(() =>
      app.views.openings[0].reply(
        viewRefusal(opening, "opening_context", "no_context_columns", "No context column is mapped in this preparation.", "mapping.context_columns"),
      ),
    );
    const refused = within(panel("At the first recorded observation")).getByRole("alert");
    expect(refused.textContent).toContain("The first recorded observations cannot be shown");
    expect(refused.textContent).toContain("What to do Choose one or more context columns when you read the source in the Data area.");
    expect(within(refused).queryByRole("button", { name: "Try again" })).toBeNull();

    const variants = app.views.variants[0].request;
    await deliver(() => app.views.variants[0].reply(viewRefusal(variants, "variants", "computation_failed", "The answer could not be computed.")));
    const failed = within(panel("Variants")).getByRole("alert");
    await app.user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(app.views.variants).toHaveLength(2);
    expect(app.views.variants[1].request.query_revision).toBe(variants.query_revision);
    expect(app.views.variants[1].request.request_id).not.toBe(variants.request_id);
    expect(within(panel("Variants")).getByText("Reading the sequence of every incident…")).toBeTruthy();
    await deliver(() => app.views.variants[1].reply({ ok: true, answer: variantsAnswer(app.views.variants[1].request) }));
    expect(within(panel("Variants")).getAllByText(/^Variant \d$/)).toHaveLength(3);
  });

  it("refuses an answer about another population rather than showing it", async () => {
    const app = await openInvestigation();
    const request = app.views.variants[0].request;
    const other = { ...variantsAnswer(request), identity: { ...request.identity, population_id: `population.v1:sha256:${"f".repeat(64)}` } };
    await deliver(() => app.views.variants[0].reply({ ok: true, answer: other }));
    const failed = within(panel("Variants")).getByRole("alert");
    expect(failed.textContent).toContain("The reply belongs to a different population identity.");
    expect(within(panel("Variants")).queryByRole("list")).toBeNull();
  });

  it("lists the first variants and shows more on request", async () => {
    const app = await openInvestigation();
    const request = app.views.variants[0].request;
    const extra: Variant[] = Array.from({ length: 27 }, (_, index) => ({
      id: `variant.v1:sha256:${index.toString(16).padStart(64, "0")}`,
      activities: ["Eröffnet", `Schritt ${index}`],
      case_count: 1,
      share: 0.25,
      denominator: 4,
      case_ids: ["K-2"],
      record_count: 2,
      omitted_activity_record_count: 0,
    }));
    await deliver(() => app.views.variants[0].reply({ ok: true, answer: variantsAnswer(request, extra) }));
    const variants = panel("Variants");
    expect(variants.textContent).toContain("Showing 25 of 30 variants.");
    await app.user.click(within(variants).getByRole("button", { name: "Show 5 more of 5 variants not shown" }));
    expect(variants.textContent).toContain("30 variants.");
    expect(within(variants).queryByRole("button", { name: /^Show \d+ more/ })).toBeNull();
  });
});
