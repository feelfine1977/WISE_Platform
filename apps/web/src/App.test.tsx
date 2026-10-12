import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { contract } from "./investigation/client";
import { evidenceZero, healthy, identityZero, populationOne, populationZero, refusalOf, scriptedClient } from "./test/answers";

function renderScreen() {
  const scripted = scriptedClient();
  const user = userEvent.setup();
  render(<App client={scripted.client} checkHealth={healthy} />);
  return { ...scripted, user };
}

/** Delivers a reply and lets the screen publish it. */
async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** The supplied text next to a labelled count in the population strip. */
function count(label: string): string {
  const strip = screen.getByRole("region", { name: "Source and population" });
  const term = within(strip).getAllByText(label, { selector: "dt" })[0];
  return term.nextElementSibling?.textContent ?? "";
}

function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>("th, td"));
}

function status(): string {
  return screen.getByText(/revision \d+/, { selector: "[role=status]" }).textContent ?? "";
}

async function openPopulationZero(scripted: ReturnType<typeof scriptedClient>) {
  await deliver(() => scripted.opens[0].reply({ ok: true, answer: populationZero(scripted.opens[0].request) }));
}

describe("the investigation screen", () => {
  it("opens the example and shows the supplied counts, incidents and identities", async () => {
    const scripted = renderScreen();
    expect(scripted.opens).toHaveLength(1);
    const request = scripted.opens[0].request;
    expect(contract.openExampleRequest(request)).toBe(true);
    expect(request.example_id).toBe("S0");
    expect(request.query_revision).toBe(1);
    expect(screen.getByText(/Opening the synthetic example/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();

    const answer = populationZero(request);
    expect(contract.populationAnswer(answer)).toBe(true);
    await deliver(() => scripted.opens[0].reply({ ok: true, answer }));

    expect(screen.getByText("Synthetic incidents, hand-made example zero")).toBeTruthy();
    expect(count("Parent population")).toBe("3 incidents7 records");
    expect(count("Kept: Resolved recorded")).toBe("2 incidents5 records");
    expect(count("Removed: no Resolved recorded")).toBe("1 incident2 records");
    expect(count("Unevaluable")).toBe("0 incidents0 records");
    expect(count("Outside the parent")).toBe("1 incident1 record");
    expect(count("All incidents in the source")).toBe("4 incidents8 records");
    expect(count("Mapped sequence")).toBe("6 records of 7 records1 record left out: no activity");
    expect(status()).toBe("Current answer · revision 1");

    const table = screen.getByRole("table", { name: "Incidents in the parent population" });
    const rows = within(table).getAllByRole("row").slice(1).map((row) => cellsOf(row).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["INC01", "3", "3", "0", "Kept"],
      ["INC02", "2", "2", "0", "Kept"],
      ["INC03", "2", "1", "1", "Removed"],
    ]);
    expect(screen.getByText(/Kept incidents have Resolved recorded; removed incidents have no Resolved recorded\./)).toBeTruthy();

    const details = screen.getByText("Data details").closest("details");
    expect(details).not.toBeNull();
    const detailsText = details?.textContent ?? "";
    for (const value of Object.values(identityZero)) expect(detailsText).toContain(value);
    expect(detailsText).toContain("incident.order.timestamp_sequence_source_position.v1");
    expect(detailsText).toContain("Outside the parent: 1 incident, 1 record");
    expect(detailsText).toContain("INC04");
  });

  it("opens an incident from the keyboard and returns focus to its row", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    await openPopulationZero(scripted);

    for (let step = 0; step < 10 && document.activeElement?.textContent !== "INC01"; step += 1) await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "INC01" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "INC02" }));
    await user.keyboard("{Enter}");

    expect(scripted.cases).toHaveLength(1);
    const request = scripted.cases[0].request;
    expect(contract.caseEvidenceRequest(request)).toBe(true);
    expect(request.case_id).toBe("INC02");
    expect(request.query_revision).toBe(1);
    expect(request.identity).toEqual(identityZero);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Incident INC02" }));

    await deliver(() => scripted.cases[0].reply({ ok: true, answer: evidenceZero(request) }));
    const records = screen.getByRole("table", { name: /Every record of incident INC02/ });
    expect(within(records).getAllByRole("row")).toHaveLength(3);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "Incident INC02" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "INC02" }));

    await user.keyboard("{ArrowDown}{Enter}");
    expect(scripted.cases[1].request.case_id).toBe("INC03");
    await deliver(() => scripted.cases[1].reply({ ok: true, answer: evidenceZero(scripted.cases[1].request) }));
    screen.getByRole("button", { name: "Return to incidents" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("heading", { name: "Incident INC03" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "INC03" }));
  });

  it("shows a refused population as a readable message with a retry, never as an empty population", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    const refused = refusalOf(scripted.opens[0].request, "open_example", "source_unavailable", "The example S0 is not available.", false);
    expect(contract.refusal(refused)).toBe(true);
    await deliver(() => scripted.opens[0].reply({ ok: false, problem: { kind: "refusal", refusal: refused } }));

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The population could not be opened");
    expect(alert.textContent).toContain("The example S0 is not available.");
    expect(alert.textContent).toContain("The example source is not available on this computer.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Parent population", { selector: "dt" })).toBeNull();
    expect(status()).toBe("Not available · revision 1");

    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(scripted.opens).toHaveLength(2);
    expect(scripted.opens[1].request.query_revision).toBe(2);
    expect(scripted.opens[1].request.example_id).toBe("S0");
    await deliver(() => scripted.opens[1].reply({ ok: true, answer: populationZero(scripted.opens[1].request) }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("table", { name: "Incidents in the parent population" })).toBeTruthy();
  });

  it("shows a refused incident history as a readable message with a retry", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    await openPopulationZero(scripted);
    await user.click(screen.getByRole("button", { name: "INC01" }));
    const request = scripted.cases[0].request;
    await deliver(() =>
      scripted.cases[0].reply({
        ok: false,
        problem: { kind: "refusal", refusal: refusalOf(request, "case_evidence", "identity_mismatch", "The source changed since the population was opened.") },
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The records of INC01 could not be shown");
    expect(alert.textContent).toContain("The source changed since the population was opened.");
    expect(screen.queryByRole("table", { name: /Every record/ })).toBeNull();

    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(scripted.cases).toHaveLength(2);
    expect(scripted.cases[1].request.case_id).toBe("INC01");
    await deliver(() => scripted.cases[1].reply({ ok: true, answer: evidenceZero(scripted.cases[1].request) }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("table", { name: /Every record of incident INC01/ })).toBeTruthy();
  });

  it("does not let a late success of an older revision replace the current population", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    await user.selectOptions(screen.getByLabelText("Source"), "S1");
    expect(scripted.opens.map((call) => call.request.query_revision)).toEqual([1, 2]);
    expect(scripted.opens[0].signal.aborted).toBe(true);

    await deliver(() => scripted.opens[1].reply({ ok: true, answer: populationOne(scripted.opens[1].request) }));
    await deliver(() => scripted.opens[0].reply({ ok: true, answer: populationZero(scripted.opens[0].request) }));

    expect(screen.getByText("Synthetic incidents, hand-made example one")).toBeTruthy();
    expect(screen.queryByText("Synthetic incidents, hand-made example zero")).toBeNull();
    expect(count("Parent population")).toBe("1 incident6 records");
    expect(screen.getByRole("button", { name: "INC05" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "INC01" })).toBeNull();
    expect(status()).toBe("Current answer · revision 2");
  });

  it("does not let a late failure of an older revision replace the current population", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    await user.selectOptions(screen.getByLabelText("Source"), "S1");
    await deliver(() => scripted.opens[1].reply({ ok: true, answer: populationOne(scripted.opens[1].request) }));
    await deliver(() =>
      scripted.opens[0].reply({
        ok: false,
        problem: { kind: "refusal", refusal: refusalOf(scripted.opens[0].request, "open_example", "computation_failed", "Late failure.") },
      }),
    );
    await deliver(() => scripted.opens[0].reply({ ok: false, problem: { kind: "unreachable" } }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Late failure.")).toBeNull();
    expect(screen.getByRole("button", { name: "INC05" })).toBeTruthy();
    expect(status()).toBe("Current answer · revision 2");
  });

  it("does not let a late failure of an older revision replace a current request that is still pending", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    await user.selectOptions(screen.getByLabelText("Source"), "S1");
    await deliver(() => scripted.opens[0].reply({ ok: false, problem: { kind: "http", status: 500 } }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(status()).toBe("Opening example S1 · revision 2");
  });

  it("does not let a late incident history replace the current state", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    await openPopulationZero(scripted);

    // A history requested before a newer one of the same revision.
    await user.click(screen.getByRole("button", { name: "INC01" }));
    await user.click(screen.getByRole("button", { name: "INC02" }));
    expect(scripted.cases[0].signal.aborted).toBe(true);
    await deliver(() => scripted.cases[1].reply({ ok: true, answer: evidenceZero(scripted.cases[1].request) }));
    await deliver(() => scripted.cases[0].reply({ ok: true, answer: evidenceZero(scripted.cases[0].request) }));
    expect(screen.getByRole("heading", { name: "Incident INC02" })).toBeTruthy();
    expect(screen.getByRole("table", { name: /Every record of incident INC02/ })).toBeTruthy();

    // A history and a refusal requested under a revision that is no longer current.
    await user.click(screen.getByRole("button", { name: "INC03" }));
    await user.selectOptions(screen.getByLabelText("Source"), "S1");
    await deliver(() => scripted.opens[1].reply({ ok: true, answer: populationOne(scripted.opens[1].request) }));
    const stale = scripted.cases[2];
    expect(stale.request.query_revision).toBe(1);
    await deliver(() => stale.reply({ ok: true, answer: evidenceZero(stale.request) }));
    await deliver(() =>
      stale.reply({ ok: false, problem: { kind: "refusal", refusal: refusalOf(stale.request, "case_evidence", "case_not_found", "Late refusal.") } }),
    );
    expect(screen.queryByRole("heading", { name: /Incident INC0/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "INC05" })).toBeTruthy();
  });

  it("shows missing cells as missing, distinct from empty text and from the text Unknown", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    await openPopulationZero(scripted);
    await user.click(screen.getByRole("button", { name: "INC03" }));
    await deliver(() => scripted.cases[0].reply({ ok: true, answer: evidenceZero(scripted.cases[0].request) }));

    expect(document.querySelector(".coverage")?.textContent).toBe(
      "2 records of this incident · 1 record in the mapped sequence · 1 record left out: no activity",
    );
    const table = screen.getByRole("table", { name: /Every record of incident INC03/ });
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    const [first, second] = within(table).getAllByRole("row").slice(1);
    const cell = (row: HTMLElement, header: string) => cellsOf(row)[headers.indexOf(header)];

    expect(cell(first, "Source position").textContent).toBe("5");
    expect(cell(second, "Source position").textContent).toBe("6");
    expect(cell(first, "Event").textContent).toBe("e-INC03-01");

    const literal = cell(first, "Assignment group");
    expect(literal.textContent).toBe("Unknown");
    expect(literal.querySelector(".missing")).toBeNull();

    for (const header of ["Activity", "Assignment group"]) {
      const missing = cell(second, header);
      expect(missing.querySelector(".missing")).not.toBeNull();
      expect(missing.textContent).toContain("Missing");
      expect(missing.textContent).not.toContain("Unknown");
      expect(missing.textContent?.trim()).not.toBe("");
    }
    expect(cell(first, "Mapped sequence").textContent).toBe("Included");
    expect(cell(second, "Mapped sequence").textContent).toBe("Left out: no activity");
  });

  it("says investigations are not available when the local service does not offer them, and retries", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: "API route not found" }), { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<App checkHealth={healthy} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Investigations are not available from this local service (HTTP 404).");
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("alert");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(status()).toBe("Not available · revision 2");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
