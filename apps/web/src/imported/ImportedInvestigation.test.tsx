import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { importContract } from "../data/client";
import { caseSummaries, evidenceAnswer, importRefusal, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { ImportedInvestigationCoordinator } from "./coordinator";
import { ImportedInvestigation } from "./ImportedInvestigation";

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

function renderInvestigation() {
  const scripted = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(scripted.client, selecting.client, scriptedViewClient().client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} initialView="incidents" onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  return { ...scripted, selecting, coordinator, user };
}

function shownIncidents(): string[] {
  const table = screen.getByRole("table", { name: "Kept cases" });
  return within(table).getAllByRole("rowheader").map((cell) => cell.textContent ?? "");
}

function focusedText(): string {
  return document.activeElement?.textContent ?? "";
}

describe("the investigation of an imported preparation", () => {
  it("renders only the rows in view of 40,000 cases and keeps keyboard operation and focus restoration", async () => {
    const app = renderInvestigation();
    const request = app.populations[0].request;
    expect(importContract.openPopulationRequest(request)).toBe(true);
    expect(screen.getByText("Opening the cases of this preparation…")).toBeTruthy();
    const answer = populationAnswer(request, caseSummaries(40000));
    expect(importContract.populationAnswer(answer)).toBe(true);
    await deliver(() => app.populations[0].reply({ ok: true, answer }));

    const table = screen.getByRole("table", { name: "Kept cases" });
    expect(table.getAttribute("aria-rowcount")).toBe("40001");
    const first = shownIncidents();
    expect(first[0]).toBe("INC-00000");
    // A 480 px view with 32 px rows shows 15 rows; 8 more are kept ready below them.
    expect(first.length).toBe(23);
    expect(screen.getByLabelText("Population").textContent).toContain("being selected of 40,000 cases · 240,000 records");

    await app.user.tab();
    expect(focusedText()).toBe("Data");
    // The data row ends with the button of what there is to know about the data.
    await app.user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "About this data" }));
    // Then the keys of every action, the guide of this build (#54).
    await app.user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keys" }));
    await app.user.tab();
    expect(focusedText()).toBe("Map");
    await app.user.tab();
    expect(focusedText()).toBe("Cases");
    await app.user.tab();
    expect(focusedText()).toBe("Variants");
    await app.user.tab();
    expect(focusedText()).toBe("Paths");
    await app.user.tab();
    expect(focusedText()).toBe("Matrix");
    // The bar of steps (one tab stop, even with nothing to undo), "+ Add step" and the switch of the side panel stand before the table.
    await app.user.tab();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Steps");
    await app.user.tab();
    expect(focusedText()).toBe("+ Add step");
    await app.user.tab();
    expect(focusedText()).toBe("Filters and views");
    await app.user.tab();
    expect(focusedText()).toBe("INC-00000");
    await app.user.keyboard("{ArrowDown}");
    expect(focusedText()).toBe("INC-00001");
    await app.user.keyboard("{End}");
    expect(focusedText()).toBe("INC-39999");
    expect(shownIncidents().length).toBeLessThan(40);
    expect(shownIncidents()).toContain("INC-39999");
    // Page Up moves by the 14 rows that fit below the header.
    await app.user.keyboard("{PageUp}");
    expect(focusedText()).toBe("INC-39985");
    await app.user.keyboard("{ArrowUp}");
    expect(focusedText()).toBe("INC-39984");
    // Only one row is a tab stop, so Tab leaves the table rather than walking 40,000 rows.
    const tabStops = within(table).getAllByRole("button").filter((button) => button.tabIndex === 0);
    expect(tabStops.map((button) => button.textContent)).toEqual(["INC-39984"]);

    await app.user.keyboard("{Enter}");
    const evidence = app.evidence[0];
    expect(importContract.caseEvidenceRequest(evidence.request)).toBe(true);
    expect(evidence.request.case_id).toBe("INC-39984");
    expect(evidence.request.identity).toEqual(answer.identity);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Case INC-39984" }));

    await app.user.keyboard("{Home}");
    await app.user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "Case INC-39984" })).toBeNull();
    expect(focusedText()).toBe("INC-39984");
    expect(shownIncidents()).toContain("INC-39984");

    await app.user.keyboard("{Home}");
    expect(focusedText()).toBe("INC-00000");
    await app.user.keyboard("{Enter}");
    await app.user.click(screen.getByRole("button", { name: "Return to cases" }));
    expect(focusedText()).toBe("INC-00000");
  });

  it("follows scrolling by rendering the rows that come into view, and keeps the focused row", async () => {
    const app = renderInvestigation();
    await deliver(() => app.populations[0].reply({ ok: true, answer: populationAnswer(app.populations[0].request, caseSummaries(40000)) }));
    const scroller = screen.getByRole("table", { name: "Kept cases" }).parentElement!;
    // Data, the button about the data and the keys, then the five views, the bar of steps, "+ Add step", the switch of the side panel, then the table.
    for (let stop = 0; stop < 12; stop += 1) await app.user.tab();
    await app.user.keyboard("{End}");
    expect(focusedText()).toBe("INC-39999");

    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 32 * 20000 });
    fireEvent.scroll(scroller);

    const shown = shownIncidents();
    // 8 rows above the view, the 15 in view and 8 below, and the focused row in its own place.
    expect(shown).toEqual([...caseSummaries(20023).slice(19992).map((item) => item.case_id), "INC-39999"]);
    expect(focusedText()).toBe("INC-39999");
    await app.user.keyboard("{Enter}");
    expect(app.evidence[0].request.case_id).toBe("INC-39999");
  });

  it("shows every record of a case: missing cells as missing, distinct from the text Unknown", async () => {
    const app = renderInvestigation();
    await deliver(() => app.populations[0].reply({ ok: true, answer: populationAnswer(app.populations[0].request) }));
    await app.user.click(screen.getByRole("button", { name: "A-1" }));
    const answer = evidenceAnswer(app.evidence[0].request);
    expect(importContract.caseEvidenceAnswer(answer)).toBe(true);
    await deliver(() => app.evidence[0].reply({ ok: true, answer }));

    expect(screen.getByText("The order of this case is not fully known", { exact: false })).toBeTruthy();
    const history = screen.getByRole("list", { name: "Records of case A-1 in the declared order" });
    const entries = within(history).getAllByRole("listitem");
    expect(entries.map((entry) => entry.querySelector(".history-activity")?.textContent)).toEqual(["Eröffnet", "no activity label", "Prüfung"]);
    expect(entries.map((entry) => entry.querySelector(".history-meta")?.textContent)).toEqual([
      "2026-04-03 06:00:00 UTC · source position 0",
      "2026-04-04 07:30:00 UTC · source position 1",
      "time not readable · source position 3",
    ]);
    expect(entries[1].className).toContain("no-label");
    const context = entries.map((entry) => entry.querySelector(".history-context dd"));
    expect(context[0]?.textContent).toBe("Unknown");
    expect(context[0]?.querySelector(".missing-text")).toBeNull();
    expect(context[1]?.textContent).toBe("missing");
    expect(context[1]?.querySelector(".missing-text")).not.toBeNull();
    const cells = within(entries[2]).getByText("Original cells").closest("details")!;
    expect(Array.from(cells.querySelectorAll("dd")).map((cell) => cell.textContent)).toEqual(["A-1", "Prüfung", "xx", "Größe & Maß"]);
  });

  it("shows a refused population with what to do and retries it", async () => {
    const app = renderInvestigation();
    const request = app.populations[0].request;
    await deliver(() =>
      app.populations[0].reply(
        importRefusal(request, "open_population", "preparation_unavailable", "This preparation is not kept in the workspace.", "preparation_id"),
      ),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The cases could not be opened");
    expect(alert.textContent).toContain("What to do Read the source again with the same choices in the Data area.");

    await app.user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(app.populations).toHaveLength(2);
    expect(app.populations[1].request.query_revision).toBe(2);
    // The first request's reply, delivered again late, is not shown over the current one.
    await deliver(() => app.populations[0].reply({ ok: true, answer: populationAnswer(request) }));
    expect(screen.queryByRole("table")).toBeNull();
    await deliver(() => app.populations[1].reply({ ok: true, answer: populationAnswer(app.populations[1].request) }));
    expect(shownIncidents()).toEqual(["A-1", "B-2"]);
  });
});

describe("#52 a reading whose every case has an unknown order", () => {
  it("says why there are no paths, variants or durations, and leads to the Data area to change how the times are read", async () => {
    const scripted = scriptedImportClient();
    const coordinator = new ImportedInvestigationCoordinator(scripted.client, scriptedSelectionClient().client, scriptedViewClient().client);
    const onShowData = vi.fn();
    render(<ImportedInvestigation coordinator={coordinator} initialView="incidents" onShowData={onShowData} />);
    act(() => coordinator.open({ workspaceId, preparationId }));
    const unordered = caseSummaries(3).map((summary) => ({ ...summary, sequence_evaluable: false }));
    await deliver(() => scripted.populations[0].reply({ ok: true, answer: populationAnswer(scripted.populations[0].request, unordered) }));
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("The order of no case is known");
    expect(note.textContent).toContain("no paths, no variants and no durations");
    await userEvent.setup().click(within(note).getByRole("button", { name: "Change how the times are read, in the Data area" }));
    expect(onShowData).toHaveBeenCalledTimes(1);
  });

  it("says nothing of it while some case has a known order", async () => {
    const scripted = scriptedImportClient();
    const coordinator = new ImportedInvestigationCoordinator(scripted.client, scriptedSelectionClient().client, scriptedViewClient().client);
    render(<ImportedInvestigation coordinator={coordinator} initialView="incidents" onShowData={() => undefined} />);
    act(() => coordinator.open({ workspaceId, preparationId }));
    await deliver(() => scripted.populations[0].reply({ ok: true, answer: populationAnswer(scripted.populations[0].request) }));
    expect(screen.queryByText(/The order of no case is known/)).toBeNull();
  });
});
