import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { importContract } from "../data/client";
import { caseSummaries, evidenceAnswer, importRefusal, populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { ImportedInvestigationCoordinator } from "./coordinator";
import { ImportedInvestigation } from "./ImportedInvestigation";

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

function renderInvestigation() {
  const scripted = scriptedImportClient();
  const coordinator = new ImportedInvestigationCoordinator(scripted.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  return { ...scripted, coordinator, user };
}

function shownIncidents(): string[] {
  const table = screen.getByRole("table", { name: "Incidents of this preparation" });
  return within(table).getAllByRole("rowheader").map((cell) => cell.textContent ?? "");
}

function focusedText(): string {
  return document.activeElement?.textContent ?? "";
}

describe("the investigation of an imported preparation", () => {
  it("renders only the rows in view of 40,000 incidents and keeps keyboard operation and focus restoration", async () => {
    const app = renderInvestigation();
    const request = app.populations[0].request;
    expect(importContract.openPopulationRequest(request)).toBe(true);
    expect(screen.getByText("Opening the incidents of this preparation…")).toBeTruthy();
    const answer = populationAnswer(request, caseSummaries(40000));
    expect(importContract.populationAnswer(answer)).toBe(true);
    await deliver(() => app.populations[0].reply({ ok: true, answer }));

    const table = screen.getByRole("table", { name: "Incidents of this preparation" });
    expect(table.getAttribute("aria-rowcount")).toBe("40001");
    const first = shownIncidents();
    expect(first[0]).toBe("INC-00000");
    // A 480 px view with 32 px rows shows 15 rows; 8 more are kept ready below them.
    expect(first.length).toBe(23);
    expect(screen.getByLabelText("Population").textContent).toContain("Incidents40,000 incidents");

    await app.user.tab();
    expect(focusedText()).toBe("Data");
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
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Incident INC-39984" }));

    await app.user.keyboard("{Home}");
    await app.user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "Incident INC-39984" })).toBeNull();
    expect(focusedText()).toBe("INC-39984");
    expect(shownIncidents()).toContain("INC-39984");

    await app.user.keyboard("{Home}");
    expect(focusedText()).toBe("INC-00000");
    await app.user.keyboard("{Enter}");
    await app.user.click(screen.getByRole("button", { name: "Return to incidents" }));
    expect(focusedText()).toBe("INC-00000");
  });

  it("follows scrolling by rendering the rows that come into view", async () => {
    const app = renderInvestigation();
    await deliver(() => app.populations[0].reply({ ok: true, answer: populationAnswer(app.populations[0].request, caseSummaries(40000)) }));
    const scroller = screen.getByRole("table", { name: "Incidents of this preparation" }).parentElement!;

    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 32 * 20000 });
    fireEvent.scroll(scroller);

    const shown = shownIncidents();
    expect(shown[0]).toBe("INC-19992");
    expect(shown).toContain("INC-20014");
    expect(shown).not.toContain("INC-00000");
  });

  it("shows every record of an incident: missing cells as missing, distinct from the text Unknown", async () => {
    const app = renderInvestigation();
    await deliver(() => app.populations[0].reply({ ok: true, answer: populationAnswer(app.populations[0].request) }));
    await app.user.click(screen.getByRole("button", { name: "A-1" }));
    const answer = evidenceAnswer(app.evidence[0].request);
    expect(importContract.caseEvidenceAnswer(answer)).toBe(true);
    await deliver(() => app.evidence[0].reply({ ok: true, answer }));

    expect(screen.getByText("The order of this incident is not fully known", { exact: false })).toBeTruthy();
    const history = screen.getByRole("list", { name: "Records of incident A-1 in the declared order" });
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
    expect(alert.textContent).toContain("The incidents could not be opened");
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
