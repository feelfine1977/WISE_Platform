import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { healthy, scriptedClient } from "../test/answers";
import {
  comparedGraph,
  comparedPopulationAnswer,
  comparedSelection,
  comparisonRefusal,
  groupAnswer,
  periodAnswer,
  scriptedComparisonClient,
  teamColumn,
} from "../test/comparisons";
import { preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { contains, scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { comparisonContract } from "./client";
import { CompareCoordinator } from "./coordinator";
import { CompareView } from "./CompareView";

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** The Compare view beside an investigation whose population of four incidents is open, without steps. */
async function openCompare() {
  const imports = scriptedImportClient();
  const selections = scriptedSelectionClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selections.client, scriptedViewClient().client);
  const comparisons = scriptedComparisonClient();
  const coordinator = new CompareCoordinator(comparisons.client);
  const onShowData = vi.fn();
  const onShowInvestigation = vi.fn();
  const user = userEvent.setup();
  render(<CompareView coordinator={coordinator} investigation={investigation} onShowData={onShowData} onShowInvestigation={onShowInvestigation} />);
  act(() => investigation.open({ workspaceId, preparationId }));
  const population = comparedPopulationAnswer(imports.populations[0].request);
  await deliver(() => imports.populations[0].reply({ ok: true, answer: population }));
  const app = { imports, selections, investigation, comparisons, coordinator, user, population, onShowInvestigation };
  await answerSelection(app, 0);
  return app;
}

type Opened = Awaited<ReturnType<typeof openCompare>>;

/** Answers the selection asked for with the given index, and the map of its kept incidents. */
async function answerSelection(app: Pick<Opened, "selections">, index: number) {
  const call = app.selections.selections[index];
  const answer = comparedSelection(call.request);
  await deliver(() => call.reply({ ok: true, answer }));
  const graph = app.selections.graphs[index];
  await deliver(() => graph.reply({ ok: true, answer: comparedGraph(graph.request, answer.kept.case_ids) }));
}

/** Keeps the incidents that contain "Assigned" in the investigation: C-2 and C-4. */
async function selectAssigned(app: Opened) {
  act(() => app.investigation.addStep(contains("Assigned")));
  await answerSelection(app, 1);
}

async function rename(app: Opened, label: string, name: string) {
  const input = screen.getByLabelText(label);
  await app.user.clear(input);
  await app.user.type(input, name);
}

function rowsOf(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent ?? ""));
}

function row(table: HTMLElement, measure: string): string[] {
  const found = rowsOf(table).find((cells) => cells[0].startsWith(measure));
  if (!found) throw new Error(`No row ${measure}`);
  return found;
}

describe("the Compare view", () => {
  it("asks the analyst to open incidents in the Data area while none are open", async () => {
    const investigation = new ImportedInvestigationCoordinator(scriptedImportClient().client, scriptedSelectionClient().client, scriptedViewClient().client);
    const onShowData = vi.fn();
    const user = userEvent.setup();
    render(
      <CompareView
        coordinator={new CompareCoordinator(scriptedComparisonClient().client)}
        investigation={investigation}
        onShowData={onShowData}
        onShowInvestigation={() => undefined}
      />,
    );
    expect(screen.getByText(/Comparisons are made in the incidents of a source read in the Data area/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Go to the Data area" }));
    expect(onShowData).toHaveBeenCalledOnce();
  });

  it("compares two named groups and shows every figure with its denominator and the overlap", async () => {
    const app = await openCompare();
    await selectAssigned(app);
    expect(screen.getByRole("button", { name: "Compare" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Choose group A and group B.")).toBeTruthy();

    await app.user.click(screen.getByRole("button", { name: "Take the current selection as A" }));
    await rename(app, "Name of group A", "With assignment");
    await app.user.click(screen.getByText("List incident ids for B"));
    await app.user.type(screen.getAllByLabelText("Incident ids, separated by spaces, commas or new lines")[1], "C-1, C-2{Enter}C-3");
    await app.user.click(screen.getByRole("button", { name: "Use these ids as B" }));
    await rename(app, "Name of group B", "Listed");
    const groupB = screen.getByRole("group", { name: "Group B" });
    expect(groupB.textContent).toContain("3 listed incident ids; the list says nothing about why these incidents belong together");

    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    expect(app.comparisons.groups).toHaveLength(1);
    const request = app.comparisons.groups[0].request;
    expect(comparisonContract.groupRequest(request)).toBe(true);
    expect(request).toMatchObject({
      workspace_id: workspaceId,
      identity: app.population.identity,
      parent_case_ids: null,
      context_column_index: teamColumn,
      context_policy: "incident.context.first_record_in_declared_order.v1",
    });
    expect(request.definition).toEqual({
      mode: "two_named_groups",
      target: { name: "With assignment", definition: { kind: "predicates", predicates: [contains("Assigned")] } },
      reference: { name: "Listed", definition: { kind: "explicit_case_ids", case_ids: ["C-1", "C-2", "C-3"] } },
    });
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("Comparing…");

    const answer = groupAnswer(request);
    expect(comparisonContract.groupAnswer(answer)).toBe(true);
    await deliver(() => app.comparisons.groups[0].reply({ ok: true, answer }));

    const table = screen.getByRole("table", { name: /With assignment \(A\) and Listed \(B\), each figure with what it is a share of/ });
    const head = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(head).toEqual(["Measure", "A: With assignment", "B: Listed", "Difference A − B", "Selection step"]);
    expect(row(table, "Incidents in the group")).toEqual([
      "Incidents in the groupof the 4 incidents of the parent",
      "2 of 4 incidents of the parent · 5 records",
      "3 of 4 incidents of the parent · 7 records",
      "—",
      "",
    ]);
    expect(row(table, "First record readable").slice(1, 3)).toEqual(["2 of 2 incidents in the group", "3 of 3 incidents in the group"]);
    expect(row(table, "Opened with column 3 not recorded")).toEqual([
      "Opened with column 3 not recordedparent: 1 of 4 (25.0%)",
      "1 of 2 (50.0%)",
      "1 of 3 (33.3%)",
      "+16.7 pp · ratio 1.50",
      "Keep incidents opened with column 3 not recorded",
    ]);
    expect(row(table, "Opened with column 3 East").slice(1, 4)).toEqual([
      "1 of 2 (50.0%)",
      "0 of 3 (0.0%)",
      "+50.0 pp · ratio not available: the share in Listed is 0",
    ]);
    expect(row(table, "Opened with column 3 North").slice(1, 4)).toEqual(["0 of 2 (0.0%)", "1 of 3 (33.3%)", "−33.3 pp · ratio 0.00"]);

    const overlap = screen.getByRole("note", { name: "Overlap" });
    expect(overlap.textContent).toContain(
      "1 incident with 3 records is in both With assignment and Listed. They are counted in each group, so the counts and records of the two groups overlap and cannot be added.",
    );
    const view = screen.getByRole("main");
    expect(view.textContent).toContain("These figures say how With assignment and Listed differ. They do not say why they differ.");
    expect(view.textContent).not.toMatch(/because/i);
    expect(screen.getByText(`Comparison shown · revision ${request.query_revision}`)).toBeTruthy();
  });

  it("compares the kept and the removed side of the selection in one step, and in the other direction", async () => {
    const app = await openCompare();
    const split = screen.getByRole("button", { name: "Kept against removed" });
    expect(split.hasAttribute("disabled")).toBe(true);
    await selectAssigned(app);
    await app.user.click(screen.getByRole("button", { name: "Kept against removed" }));
    expect((screen.getByLabelText("Name of group A") as HTMLInputElement).value).toBe("Kept");
    expect((screen.getByLabelText("Name of group B") as HTMLInputElement).value).toBe("Removed");
    expect(screen.getByRole("group", { name: "Group B" }).textContent).toContain("The removed incidents of the selection");
    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    const request = app.comparisons.groups[0].request;
    expect(comparisonContract.groupRequest(request)).toBe(true);
    expect(request.definition).toEqual({
      mode: "selection_partition",
      target_name: "Kept",
      reference_name: "Removed",
      predicates: [contains("Assigned")],
      target_side: "kept",
    });

    await app.user.click(screen.getByRole("button", { name: "Exchange A and B" }));
    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    expect(app.comparisons.groups[1].request.definition).toEqual({
      mode: "selection_partition",
      target_name: "Removed",
      reference_name: "Kept",
      predicates: [contains("Assigned")],
      target_side: "removed",
    });
  });

  it("compares two periods of incident starts and notes their follow-up to the stored cutoff", async () => {
    const app = await openCompare();
    await app.user.click(screen.getByRole("button", { name: "Two periods" }));
    expect(screen.getByText("Pick the first and the last day of both periods.")).toBeTruthy();
    await app.user.type(screen.getByLabelText("First day of A"), "2026-10-01");
    await app.user.type(screen.getByLabelText("Last day of A"), "2026-10-02");
    await app.user.type(screen.getByLabelText("First day of B"), "2026-10-09");
    await app.user.type(screen.getByLabelText("Last day of B"), "2026-10-10");
    await rename(app, "Minimum follow-up in hours", "4");
    const endpoints = screen.getByLabelText("Recorded activity to look for");
    expect(within(endpoints).getAllByRole("option").map((option) => option.textContent)).toEqual(["None", "Opened", "Assigned", "Resolved"]);
    await app.user.selectOptions(endpoints, "Resolved");
    await app.user.click(screen.getByRole("button", { name: "Compare" }));

    const request = app.comparisons.periods[0].request;
    expect(comparisonContract.periodRequest(request)).toBe(true);
    expect(request.definition).toEqual({
      target: { name: "Period A", window: { timestamp_kind: "utc_instant", start_inclusive: "2026-10-01T00:00:00Z", end_exclusive: "2026-10-03T00:00:00Z" } },
      reference: { name: "Period B", window: { timestamp_kind: "utc_instant", start_inclusive: "2026-10-09T00:00:00Z", end_exclusive: "2026-10-11T00:00:00Z" } },
      minimum_followup_hours: 4,
      endpoint_activity: "Resolved",
    });
    const answer = periodAnswer(request);
    expect(comparisonContract.periodAnswer(answer)).toBe(true);
    await deliver(() => app.comparisons.periods[0].reply({ ok: true, answer }));

    const table = screen.getByRole("table", { name: /Period A \(A\) and Period B \(B\)/ });
    expect(row(table, "Incidents started in the period").slice(1, 3)).toEqual([
      "2 of 4 incidents of the parent · 5 records",
      "2 of 4 incidents of the parent · 4 records",
    ]);
    expect(row(table, "Not evaluable for membership")[0]).toBe("Not evaluable for membershipincidents of the parent in neither the period nor outside it");
    expect(row(table, "Followed for at least 4 hours").slice(1, 4)).toEqual(["2 of 2 incidents in the period", "1 of 2 incidents in the period", "—"]);
    expect(row(table, "“Resolved” recorded")).toEqual([
      "“Resolved” recordedanywhere in the complete history; not a business outcome",
      "2 of 2 incidents in the period",
      "1 of 2 incidents in the period",
      "—",
      "Keep incidents that contain “Resolved”",
    ]);
    const exposure = screen.getByRole("note", { name: "Exposure" });
    expect(exposure.textContent).toBe(
      "Follow-up runs from each incident's start to the snapshot cutoff stored with this preparation, 2026-10-10 12:00 UTC, not to the last record in the source. " +
        "Period A: 0 of 2 incidents followed for less than 4 hours; Period B: 1 of 2 incidents followed for less than 4 hours. " +
        "An activity not yet recorded for an incident followed only briefly may still be recorded later.",
    );
    expect(screen.getByRole("note", { name: "Overlap" }).textContent).toContain("No incident is in both Period A and Period B.");
    expect(screen.getByRole("main").textContent).not.toMatch(/because/i);
  });

  it("turns a row of an activity or of an opening value into a step of the selection", async () => {
    const app = await openCompare();
    await app.user.click(screen.getByRole("button", { name: "Two periods" }));
    for (const [label, date] of [["First day of A", "2026-10-01"], ["Last day of A", "2026-10-02"], ["First day of B", "2026-10-09"], ["Last day of B", "2026-10-10"]]) {
      await app.user.type(screen.getByLabelText(label), date);
    }
    await app.user.selectOptions(screen.getByLabelText("Recorded activity to look for"), "Resolved");
    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    await deliver(() => app.comparisons.periods[0].reply({ ok: true, answer: periodAnswer(app.comparisons.periods[0].request) }));

    await app.user.click(screen.getByRole("button", { name: "Keep incidents that contain “Resolved”" }));
    expect(app.selections.selections).toHaveLength(2);
    expect(app.selections.selections[1].request.predicates).toEqual([contains("Resolved")]);
    expect(screen.getByText("Added to the selection in Investigations: Keep incidents that contain “Resolved”.")).toBeTruthy();
    await answerSelection(app, 1);

    await app.user.click(screen.getByRole("button", { name: "Keep incidents opened with column 3 East" }));
    expect(app.selections.selections[2].request.predicates).toEqual([
      contains("Resolved"),
      { kind: "opening_attribute_equals", column_index: teamColumn, value: "East", negate: false, anchor_policy: "incident.context.first_record_in_declared_order.v1" },
    ]);
    await app.user.click(screen.getByRole("button", { name: "Show the selection" }));
    expect(app.onShowInvestigation).toHaveBeenCalledOnce();
    // The comparison shown keeps its own groups; the selection changed only in Investigations.
    expect(app.comparisons.periods).toHaveLength(1);
  });

  it("drops a late reply of an earlier comparison and keeps the shown one when a comparison is refused", async () => {
    const app = await openCompare();
    await selectAssigned(app);
    await app.user.click(screen.getByRole("button", { name: "Kept against removed" }));
    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    const first = app.comparisons.groups[0];
    await deliver(() => first.reply({ ok: true, answer: groupAnswer(first.request) }));
    expect(screen.getByRole("table")).toBeTruthy();

    await rename(app, "Name of group A", "Assigned");
    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    await rename(app, "Name of group A", "Assigned once");
    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    const [, second, third] = app.comparisons.groups;
    expect(second.signal.aborted).toBe(true);
    await deliver(() => second.reply({ ok: true, answer: groupAnswer(second.request) }));
    expect(screen.getByRole("columnheader", { name: "A: Kept" })).toBeTruthy();
    expect(screen.getByText("Comparing…")).toBeTruthy();

    await deliver(() => third.reply(comparisonRefusal(third.request, "compare_groups", "invalid_predicate", "The step cannot be evaluated.")));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This comparison could not be made; the previous one is still shown");
    expect(alert.textContent).toContain("The step cannot be evaluated.");
    expect(alert.textContent).toContain("Take the group again from a selection in Investigations.");
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "A: Kept" })).toBeTruthy();
  });

  it("asks again when a retryable comparison failed, under a new revision", async () => {
    const app = await openCompare();
    await selectAssigned(app);
    await app.user.click(screen.getByRole("button", { name: "Kept against removed" }));
    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    const first = app.comparisons.groups[0];
    await deliver(() => first.reply({ ok: false, problem: { kind: "unreachable" } }));
    await app.user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));
    const again = app.comparisons.groups[1].request;
    expect(again.definition).toEqual(first.request.definition);
    expect(again.query_revision).toBeGreaterThan(first.request.query_revision);
  });

  it("refuses a reply about another pair of groups", async () => {
    const app = await openCompare();
    await selectAssigned(app);
    await app.user.click(screen.getByRole("button", { name: "Kept against removed" }));
    await app.user.click(screen.getByRole("button", { name: "Compare" }));
    const call = app.comparisons.groups[0];
    const answer = groupAnswer(call.request);
    await deliver(() => call.reply({ ok: true, answer: { ...answer, target: { ...answer.target, name: "Another" } } }));
    expect(screen.getByRole("alert").textContent).toContain("The reply compares differently named groups.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("the areas of the application", () => {
  it("list Compare as one area beside Data and Investigations, unavailable until incidents are open", async () => {
    const scripted = scriptedClient();
    const user = userEvent.setup();
    render(<App client={scripted.client} checkHealth={healthy} comparisonClient={scriptedComparisonClient().client} />);
    const areas = screen.getByRole("navigation", { name: "Areas" });
    expect(within(areas).getAllByRole("button").map((button) => button.textContent)).toEqual(["Data", "Investigations", "Compare", "Expectation", "Saved"]);
    const compare = within(areas).getByRole("button", { name: "Compare" });
    expect(compare.getAttribute("aria-disabled")).toBe("true");
    await user.click(compare);
    expect(compare.getAttribute("aria-current")).toBeNull();
    expect(within(areas).getByRole("button", { name: "Investigations" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("heading", { name: "Compare" })).toBeNull();
  });
});
