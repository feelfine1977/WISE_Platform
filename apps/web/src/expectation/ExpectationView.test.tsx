import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import {
  blockedAnswer,
  readyAnswer,
  runAnswer,
  scoringGraphAnswer,
  scoringPopulationAnswer,
  scoringRefusal,
  scoringSelectionAnswer,
  scriptedScoringClient,
  witnessAnswer,
} from "../test/scoring";
import { scriptedSelectionClient } from "../test/selections";
import { scriptedViewClient } from "../test/views";
import { scoringContract } from "./client";
import { ExpectationCoordinator } from "./coordinator";
import { ExpectationView, scoringSubject } from "./ExpectationView";

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** The view over an investigation of five incidents whose population and map are answered. */
async function renderView() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const scoring = scriptedScoringClient();
  const investigation = new ImportedInvestigationCoordinator(imports.client, selecting.client, scriptedViewClient().client);
  const user = userEvent.setup();
  const coordinator = new ExpectationCoordinator(scoring.client, investigation);
  coordinator.start();
  const rendered = render(<ExpectationView investigation={investigation} coordinator={coordinator} onShowData={() => undefined} onShowInvestigation={() => undefined} />);
  expect(screen.getByText(/No cases are open at the moment: open the cases of a reading in the Data area/)).toBeTruthy();
  act(() => investigation.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: scoringPopulationAnswer(imports.populations[0].request) }));
  await deliver(() => selecting.selections[0].reply({ ok: true, answer: scoringSelectionAnswer(selecting.selections[0].request) }));
  await deliver(() => selecting.graphs[0].reply({ ok: true, answer: scoringGraphAnswer(selecting.graphs[0].request) }));
  return { ...scoring, investigation, coordinator, rendered, user };
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, { reviewed = false } = {}) {
  await user.selectOptions(screen.getByLabelText("Start activity"), "Eröffnet");
  await user.selectOptions(screen.getByLabelText("Response activity"), "Geschlossen");
  await user.type(screen.getByLabelText("Target (hours)"), "4");
  await user.clear(screen.getByLabelText("Width (hours partly met after the target)"));
  await user.type(screen.getByLabelText("Width (hours partly met after the target)"), "2");
  await user.type(screen.getByLabelText("Name"), "Closed within four hours");
  await user.type(screen.getByLabelText("Owner"), "Service desk");
  await user.type(screen.getByLabelText("Source (for example a service agreement)"), "Agreement 7");
  await user.type(screen.getByLabelText("Rationale"), "Customers wait.");
  if (reviewed) await user.click(screen.getByRole("checkbox", { name: /I have reviewed this definition/ }));
}

/** Fills the form as reviewed, checks it, scores it, and delivers the hand-written run. */
async function scored() {
  const view = await renderView();
  await fillForm(view.user, { reviewed: true });
  await view.user.click(screen.getByRole("button", { name: "Check the definition" }));
  await deliver(() => view.validations[0].reply({ ok: true, answer: readyAnswer(view.validations[0].request) }));
  await view.user.click(screen.getByRole("button", { name: "Score 5 cases" }));
  const answer = runAnswer(view.scores[0].request, view.validations[0].request.definition);
  await deliver(() => view.scores[0].reply({ ok: true, answer }));
  return { ...view, run: answer.run };
}

function tableIncidents(): string[] {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("rowheader").map((cell) => cell.textContent ?? "");
}

function stateButton(group: string, label: string): HTMLElement {
  return within(screen.getByRole("group", { name: group })).getByRole("button", { name: new RegExp(label) });
}

describe("the expectation form", () => {
  it("offers the activities of the population, repeats the definition as one sentence and checks it as the contract asks", async () => {
    const { user, validations } = await renderView();
    const options = within(screen.getByLabelText("Start activity")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Choose…", "Eröffnet", "Geschlossen", "Prüfung"]);
    expect(screen.getByText(/Scored for every case of Vorgänge.csv: 5 cases/)).toBeTruthy();
    const check = screen.getByRole("button", { name: "Check the definition" });
    expect(check).toHaveProperty("disabled", true);

    await fillForm(user);
    expect(screen.getByText(/After “Eröffnet”, “Geschlossen” is recorded within 4 hours; up to 2 hours later the expectation is partly met/)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Left without a value" }));
    expect(screen.getByText(/but no “Geschlossen” at or after it gets no value/)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Counted as not met" }));
    await user.click(check);

    expect(validations).toHaveLength(1);
    const request = validations[0].request;
    expect(scoringContract.validateRequest(request)).toBe(true);
    expect(request.definition).toMatchObject({
      review_state: "draft",
      target: 4,
      width: 2,
      unit: "hours",
      clock_kind: "utc_instant",
      missing_response: "violate",
      endpoints: { activation_activity: "Eröffnet", response_activity: "Geschlossen", response: "first_after" },
    });
    expect(request.named_population.identity).toEqual(request.base_identity);
  });

  it("keeps a draft from being scored and scores a checked, reviewed definition", async () => {
    const { user, validations, scores } = await renderView();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Check the definition" }));
    await deliver(() => validations[0].reply({ ok: true, answer: readyAnswer(validations[0].request) }));
    expect(screen.getByText(/It is a draft: it can be explored but not scored/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Score 5 cases" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("checkbox", { name: /I have reviewed this definition/ }));
    expect(screen.getByText(/The definition or the cases changed since this check/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Score 5 cases" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Check the definition" }));
    // The review mark changes the version, not the meaning: the revision number stays.
    expect(validations[1].request.definition.definition_revision).toBe(1);
    await deliver(() => validations[1].reply({ ok: true, answer: readyAnswer(validations[1].request) }));
    await user.click(screen.getByRole("button", { name: "Score 5 cases" }));
    expect(scores).toHaveLength(1);
    expect(scoringContract.scoreRequest(scores[0].request)).toBe(true);

    await user.clear(screen.getByLabelText("Target (hours)"));
    await user.type(screen.getByLabelText("Target (hours)"), "6");
    await user.click(screen.getByRole("button", { name: "Check the definition" }));
    expect(validations[2].request.definition.definition_revision).toBe(2);
  });

  it("shows each blocker at its place in the form", async () => {
    const { user, validations } = await renderView();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Check the definition" }));
    const blocker = {
      code: "invalid_parameter",
      field: "definition.target",
      message: "The target cannot be represented as a duration in this unit.",
      case_ids: [],
      case_count: 0,
      recovery_actions: ["edit_definition" as const],
    };
    await deliver(() => validations[0].reply({ ok: true, answer: blockedAnswer(validations[0].request, [blocker]) }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Not ready.");
    expect(alert.textContent).toContain("Target The target cannot be represented as a duration in this unit.");
  });
});

describe("the result of a run", () => {
  it("counts the cases in each state, lists them worst first and names the method library", async () => {
    await scored();
    expect(stateButton("Cases by how they meet the expectation", "Meet it").textContent).toBe("1Meet it");
    expect(stateButton("Cases by how they meet the expectation", "Partly meet it").textContent).toBe("1Partly meet it");
    expect(stateButton("Cases by how they meet the expectation", "Do not meet it").textContent).toBe("2Do not meet it");
    expect(stateButton("Cases by how they meet the expectation", "Out of scope").textContent).toBe("0Out of scope");
    expect(stateButton("Cases without an endpoint", "Without the start").textContent).toBe("1Without the start");
    expect(stateButton("Cases without an endpoint", "Without the response").textContent).toBe("1Without the response");
    expect(tableIncidents()).toEqual(["C-3", "D-4", "B-2", "A-1", "E-5"]);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["1", "Does not meet it", "8 hours"],
      ["1", "Does not meet it", "no response"],
      ["0.5", "Partly meets it", "5 hours"],
      ["0", "Meets it", "3 hours"],
      ["no value", "No value: no start", "no start"],
    ]);
    expect(screen.getByText("Scored by the method library wise-pm 0.2.0, built from source 6883db5: an untagged state, not a published release.")).toBeTruthy();
  });

  it("lists the cases of a chosen state until the choice is cleared, without asking anything", async () => {
    const { user, validations, scores, witnesses } = await scored();
    await user.click(stateButton("Cases by how they meet the expectation", "Do not meet it"));
    expect(tableIncidents()).toEqual(["C-3", "D-4"]);
    expect(screen.getByText(/The table lists the 2 cases that do not meet the expectation. This is a view of the run/)).toBeTruthy();
    expect(stateButton("Cases by how they meet the expectation", "Meet it").textContent).toBe("1Meet it");
    await user.click(stateButton("Cases without an endpoint", "Without the response"));
    expect(tableIncidents()).toEqual(["D-4"]);
    await user.click(screen.getByRole("button", { name: "Show every case" }));
    expect(tableIncidents()).toEqual(["C-3", "D-4", "B-2", "A-1", "E-5"]);
    expect([validations.length, scores.length, witnesses.length]).toEqual([1, 1, 0]);
  });

  it("shows a refusal with its cases and what to do", async () => {
    const view = await renderView();
    await fillForm(view.user, { reviewed: true });
    await view.user.click(screen.getByRole("button", { name: "Check the definition" }));
    await deliver(() => view.validations[0].reply({ ok: true, answer: readyAnswer(view.validations[0].request) }));
    await view.user.click(screen.getByRole("button", { name: "Score 5 cases" }));
    await deliver(() =>
      view.scores[0].reply(scoringRefusal(view.scores[0].request, "score_expectation", "unevaluable_sequence", "The order of 1 case cannot be evaluated.", ["E-5"])),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The cases could not be scored");
    expect(alert.textContent).toContain("(1 case: E-5)");
    expect(alert.textContent).toContain("choose a population without them");
  });
});

describe("the records of a scored case", () => {
  it("marks every record that can be the response and says when there are several", async () => {
    const { user, witnesses, run } = await scored();
    await user.click(screen.getByRole("button", { name: "B-2" }));
    expect(witnesses[0].request.case_id).toBe("B-2");
    expect(witnesses[0].request.run_id).toBe(run.identity.run_id);
    await deliver(() => witnesses[0].reply({ ok: true, answer: witnessAnswer(witnesses[0].request, run) }));
    const witness = screen.getByRole("region", { name: /Case B-2/ });
    expect(document.activeElement?.textContent).toBe("Case B-2");
    const records = within(witness).getByRole("list", { name: "Records of case B-2" });
    expect(within(records).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "EröffnetStart2026-10-09 00:00:00 UTC · source position 2",
      "GeschlossenResponse2026-10-09 05:00:00 UTC · source position 3",
      "GeschlossenResponse2026-10-09 05:00:00 UTC · source position 4",
    ]);
    expect(witness.textContent).toContain("2 records are marked as the response: they have the same activity and the same time, and each can be it.");
    expect(witness.textContent).toContain("Value0.5");
  });

  it("marks no response when the library found none, also when the case is valued as not met", async () => {
    const { user, witnesses, run } = await scored();
    await user.click(screen.getByRole("button", { name: "D-4" }));
    await deliver(() => witnesses[0].reply({ ok: true, answer: witnessAnswer(witnesses[0].request, run) }));
    const witness = screen.getByRole("region", { name: /Case D-4/ });
    expect(within(witness).getAllByText("Start")).toHaveLength(1);
    expect(within(witness).queryByText("Response")).toBeNull();
    expect(witness.textContent).toContain("No record is marked as the response: the library found no “Geschlossen” at or after the start.");
    expect(witness.textContent).toContain("Measured timeno response");
    expect(witness.textContent).toContain("The method library read the one record of this case.");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: /Case D-4/ })).toBeNull();
  });
});


describe("expectation continuity across areas", () => {
  it("preserves authored form and original run on unmount/remount, without another check or score", async () => {
    const view = await scored();
    const reference = view.coordinator.savedReference();
    expect(reference?.score_run_id).toBe(view.run.identity.run_id);
    view.rendered.unmount();
    render(<ExpectationView investigation={view.investigation} coordinator={view.coordinator} onShowData={() => undefined} onShowInvestigation={() => undefined} />);
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Closed within four hours");
    expect(screen.getByLabelText("Target (hours)")).toHaveProperty("value", "4");
    expect(tableIncidents()).toEqual(["C-3", "D-4", "B-2", "A-1", "E-5"]);
    expect(view.coordinator.savedReference()).toEqual(reference);
    await view.user.click(stateButton("Cases by how they meet the expectation", "Partly meet it"));
    expect(tableIncidents()).toEqual(["B-2"]);
    expect([view.validations.length, view.scores.length, view.witnesses.length]).toEqual([1, 1, 0]);
  });

  it("scores the actual frozen subset with no steps, rather than every source case", async () => {
    const view = await renderView();
    const state = view.investigation.getState();
    if (state.selection.phase !== "ready") throw new Error("The displayed selection is ready.");
    const subset = {
      ...state, selection: { ...state.selection, shown: { ...state.selection.shown, steps: [],
        answer: { ...state.selection.shown.answer, kept: { case_ids: ["A-1"], case_count: 1, record_count: 2 } } } },
    };
    const subject = scoringSubject(subset);
    expect(subject?.caseCount).toBe(1);
    expect(subject?.target.population.identity).toEqual(state.selection.shown.answer.identity);
    expect(subject?.target.population.identity).not.toEqual(state.population.phase === "ready" && state.population.answer.identity);
    expect(subject?.target.population.name).toContain("frozen parent");
  });
});


it("keeps an explicit keep-all recipe's selected population identity for a new run", async () => {
  const view = await renderView(); const state = view.investigation.getState();
  if (state.selection.phase !== "ready") throw new Error("The displayed selection is ready.");
  const explicit = { ...state, selection: { ...state.selection, shown: { ...state.selection.shown,
    steps: [{ kind: "contains_activity" as const, activity: "Never recorded", negate: true }] } } };
  const subject = scoringSubject(explicit);
  expect(subject?.caseCount).toBe(5);
  expect(subject?.target.population.identity).toEqual(state.selection.shown.answer.identity);
  expect(subject?.target.population.name).toContain("kept by 1 step");
});
