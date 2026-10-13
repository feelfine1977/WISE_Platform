import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { evidenceZero, healthy, identityOne, identityZero, populationOne, populationZero, refusalOf, scriptedClient } from "./test/answers";

/*
 * The screen keeps the last answer it had while another example is asked for, and after that
 * request failed. Example S0 has INC01, INC02 and INC03 in its parent (3 incidents, 7 records);
 * example S1 has INC05 alone (1 incident, 6 records); see the hand-made answers.
 */

function renderScreen() {
  const scripted = scriptedClient();
  const user = userEvent.setup();
  render(<App client={scripted.client} checkHealth={healthy} />);
  return { ...scripted, user };
}

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

function count(label: string): string {
  const strip = screen.getByRole("region", { name: "Source and population" });
  const term = within(strip).getAllByText(label, { selector: "dt" })[0];
  return term.nextElementSibling?.textContent ?? "";
}

function status(): string {
  return screen.getByText(/revision \d+/, { selector: "[role=status]" }).textContent ?? "";
}

function incidentIds(): string[] {
  const table = screen.getByRole("table", { name: "Incidents in the parent population" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector("th")?.textContent ?? "");
}

function source(): HTMLSelectElement {
  return screen.getByLabelText("Source") as HTMLSelectElement;
}

/** The identities listed in the data details of the answer shown. */
function detailsText(): string {
  return screen.getByRole("region", { name: "Data details of the current answer", hidden: true }).textContent ?? "";
}

/** Opens example S0 and then asks for example S1, whose request is left running. */
async function showZeroAskOne() {
  const scripted = renderScreen();
  await deliver(() => scripted.opens[0].reply({ ok: true, answer: populationZero(scripted.opens[0].request) }));
  await scripted.user.selectOptions(source(), "S1");
  expect(scripted.opens).toHaveLength(2);
  expect(scripted.opens[1].request).toMatchObject({ example_id: "S1", query_revision: 2 });
  return scripted;
}

/** Everything that says the answer shown is example S0's: its incidents, counts, identities and name. */
function expectZeroShown() {
  expect(incidentIds()).toEqual(["INC01", "INC02", "INC03"]);
  expect(count("Parent population")).toBe("3 incidents7 records");
  expect(count("Kept: Resolved recorded")).toBe("2 incidents5 records");
  expect(screen.getByText("Synthetic incidents, hand-made example zero")).toBeTruthy();
  expect(screen.queryByText("Synthetic incidents, hand-made example one")).toBeNull();
  const details = detailsText();
  expect(details).toContain(identityZero.source_id);
  expect(details).toContain(identityZero.population_id);
  expect(details).not.toContain(identityOne.source_id);
  expect(details).not.toContain(identityOne.population_id);
}

describe("keeping the last answer while another example is asked for", () => {
  it("keeps the first example in full while the second is opening, and says which is which", async () => {
    const scripted = await showZeroAskOne();

    expectZeroShown();
    expect(screen.getByText("Showing synthetic example S0; opening synthetic example S1 …")).toBeTruthy();
    expect(status()).toBe("Showing revision 1 · opening example S1 · revision 2");
    expect(source().value).toBe("S1");

    // Opening an incident of the example shown would act on it under the request for another one.
    const row = screen.getByRole("button", { name: "INC01" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(row.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe("Not available while synthetic example S1 is opening: what is shown belongs to synthetic example S0.");
    await scripted.user.click(row);
    expect(scripted.cases).toHaveLength(0);
  });

  it("keeps the first example when the second fails, then opens the second on a retry", async () => {
    const scripted = await showZeroAskOne();
    await deliver(() => scripted.opens[1].reply({ ok: false, problem: { kind: "unreachable" } }));

    expectZeroShown();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Could not open synthetic example S1; synthetic example S0 is still shown.");
    expect(alert.textContent).toContain("The local service could not be reached.");
    expect(status()).toBe("Showing revision 1 · example S1 not available · revision 2");
    expect(screen.queryByText(/opening synthetic example S1/)).toBeNull();

    await scripted.user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(scripted.opens).toHaveLength(3);
    expect(scripted.opens[2].request).toMatchObject({ example_id: "S1", query_revision: 3 });
    expect(screen.queryByRole("alert")).toBeNull();
    expectZeroShown();
    expect(screen.getByText("Showing synthetic example S0; opening synthetic example S1 …")).toBeTruthy();

    await deliver(() => scripted.opens[2].reply({ ok: true, answer: populationOne(scripted.opens[2].request) }));
    expect(incidentIds()).toEqual(["INC05"]);
    expect(count("Parent population")).toBe("1 incident6 records");
    expect(screen.getByText("Synthetic incidents, hand-made example one")).toBeTruthy();
    expect(screen.queryByText("Synthetic incidents, hand-made example zero")).toBeNull();
    expect(detailsText()).toContain(identityOne.population_id);
    expect(screen.queryByText(/^Showing synthetic example/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(status()).toBe("Current answer · revision 3");
    expect(source().value).toBe("S1");
  });

  it("stays with the first example, puts the choice back to it, and opens its incidents again", async () => {
    const scripted = await showZeroAskOne();
    await deliver(() =>
      scripted.opens[1].reply({
        ok: false,
        problem: { kind: "refusal", refusal: refusalOf(scripted.opens[1].request, "open_example", "source_unavailable", "The example S1 is not available.", false) },
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The example S1 is not available.");
    expect(source().value).toBe("S1");

    await scripted.user.click(within(alert).getByRole("button", { name: "Stay with synthetic example S0" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(source().value).toBe("S0");
    expectZeroShown();
    expect(status()).toBe("Current answer · revision 1");
    expect(scripted.opens).toHaveLength(2);

    const row = screen.getByRole("button", { name: "INC02" });
    expect(row.getAttribute("aria-disabled")).toBeNull();
    await scripted.user.click(row);
    expect(scripted.cases).toHaveLength(1);
    expect(scripted.cases[0].request).toMatchObject({ case_id: "INC02", query_revision: 1, identity: identityZero });
    await deliver(() => scripted.cases[0].reply({ ok: true, answer: evidenceZero(scripted.cases[0].request) }));
    expect(screen.getByRole("list", { name: /Every record of incident INC02/ })).toBeTruthy();
  });

  it("does not let a late failure of an abandoned replacement disturb the kept answer", async () => {
    const scripted = await showZeroAskOne();
    await scripted.user.selectOptions(source(), "S2");
    expect(scripted.opens[2].request).toMatchObject({ example_id: "S2", query_revision: 3 });
    expect(scripted.opens[1].signal.aborted).toBe(true);

    await deliver(() =>
      scripted.opens[1].reply({
        ok: false,
        problem: { kind: "refusal", refusal: refusalOf(scripted.opens[1].request, "open_example", "computation_failed", "Late failure.") },
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Late failure.")).toBeNull();
    expectZeroShown();
    expect(screen.getByText("Showing synthetic example S0; opening synthetic example S2 …")).toBeTruthy();
    expect(status()).toBe("Showing revision 1 · opening example S2 · revision 3");
    expect(source().value).toBe("S2");
  });

  it("keeps an open incident history through a failed replacement and closes it on a successful one", async () => {
    const scripted = renderScreen();
    const { user } = scripted;
    await deliver(() => scripted.opens[0].reply({ ok: true, answer: populationZero(scripted.opens[0].request) }));
    await user.click(screen.getByRole("button", { name: "INC01" }));
    await deliver(() => scripted.cases[0].reply({ ok: true, answer: evidenceZero(scripted.cases[0].request) }));
    const history = () => screen.queryByRole("list", { name: /Every record of incident INC01/ });
    expect(within(history()!).getAllByRole("listitem")).toHaveLength(3);

    await user.selectOptions(source(), "S1");
    expect(screen.getByRole("heading", { name: "Incident INC01" })).toBeTruthy();
    expect(within(history()!).getAllByRole("listitem")).toHaveLength(3);
    await deliver(() => scripted.opens[1].reply({ ok: false, problem: { kind: "http", status: 500 } }));
    expect(screen.getByRole("heading", { name: "Incident INC01" })).toBeTruthy();
    expect(within(history()!).getAllByRole("listitem")).toHaveLength(3);
    expectZeroShown();

    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("heading", { name: "Incident INC01" })).toBeTruthy();
    await deliver(() => scripted.opens[2].reply({ ok: true, answer: populationOne(scripted.opens[2].request) }));
    expect(screen.queryByRole("heading", { name: "Incident INC01" })).toBeNull();
    expect(history()).toBeNull();
    expect(incidentIds()).toEqual(["INC05"]);
  });
});
