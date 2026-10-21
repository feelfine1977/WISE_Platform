import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { StageProposalAnswer, StageProposalRequest } from "../generated/stage-proposal";
import { identity, preparationId, workspaceId } from "../test/imports";
import { suppliedGraph } from "../test/selections";
import {
  fromPresentation,
  noStages,
  originOf,
  read,
  staleActivities,
  toPresentation,
  withActivity,
  withoutStage,
  withPhaseColumn,
  withProposed,
  withStage,
  written,
} from "./definitions";
import type { ProposalClient, ProposalOutcome } from "./proposalClient";
import { proposalContract } from "./proposalClient";
import { StagesEditor } from "./StagesEditor";
import { type StagedReading, type StageMemory, StageStore } from "./store";

const reading: StagedReading = { workspaceId, preparationId };
const PHASE = 4;

describe("stages taken from the values of a phase column", () => {
  it("puts an activity into the stage of a value, adding the stage once, and keeps where its stage came from", () => {
    const one = withProposed(noStages, "Open", PHASE, "Intake");
    expect(one.stages.map((stage) => stage.name)).toEqual(["Intake"]);
    expect(originOf(one, "Open")).toEqual({ kind: "proposed", column: PHASE, value: "Intake" });
    // The same value for another activity goes into the same stage, also written in other letters.
    const two = withProposed(one, "Assign", PHASE, "intake");
    expect(two.stages).toHaveLength(1);
    expect(two.assigned.get("Assign")).toBe(two.stages[0].id);
    // Changed by hand, the stage is the analyst's own: the override is said.
    const closure = withStage(two, "Closure");
    const byHand = withActivity(closure, "Assign", closure.stages[1].id);
    expect(originOf(byHand, "Assign")).toEqual({ kind: "manual" });
    expect(originOf(byHand, "Open")).toEqual({ kind: "proposed", column: PHASE, value: "Intake" });
    // A stage removed takes the origins of its activities with it.
    expect(withoutStage(byHand, byHand.stages[0].id).origins).toBeUndefined();
  });

  it("names the phase column and writes, reads and saves the origins and the column", () => {
    const definitions = withPhaseColumn(withActivity(withProposed(withStage(noStages, "Closure"), "Open", PHASE, "Intake"), "Close", "stage:1"), PHASE);
    expect(read(JSON.parse(JSON.stringify(written(definitions))))).toEqual(definitions);
    const saved = toPresentation(definitions, preparationId);
    expect(saved).toEqual({
      preparation_id: preparationId,
      phase_column_index: PHASE,
      stages: [{ id: "stage:1", name: "Closure" }, { id: "stage:2", name: "Intake" }],
      assignments: [
        { activity: "Open", stage_id: "stage:2", origin: { kind: "proposed", column_index: PHASE, value: "Intake" } },
        { activity: "Close", stage_id: "stage:1", origin: { kind: "manual" } },
      ],
    });
    expect(fromPresentation(saved)).toEqual(definitions);
  });

  it("finds the activities put into a stage that the log does not have", () => {
    const definitions = withActivity(withActivity(withStage(noStages, "Intake"), "Open", "stage:1"), "Gone", "stage:1");
    expect(staleActivities(definitions, new Set(["Open", "Close"]))).toEqual(["Gone"]);
  });
});

/** The answer of the hand-written oracle of tests/fixtures/stage-proposal for every incident. */
function oracle(request: StageProposalRequest): StageProposalAnswer {
  const item = (activity: string, records: number, incidents: number, missing: number, values: [string, number][], leading: [string, number] | null) => ({
    activity, record_count: records, incident_count: incidents, missing_record_count: missing, value_count: values.length,
    values: values.map(([value, count]) => ({ value, record_count: count })), values_truncated: false, other_record_count: 0, mixed: values.length > 1,
    leading: leading && { value: leading[0], record_count: leading[1] },
  });
  return {
    schema_version: 1, message_type: "stage_proposal_answer", request_id: request.request_id, query_revision: request.query_revision,
    workspace_id: request.workspace_id, identity: request.identity, policy: "incident.stage.proposal.every_record_value_counts.v1",
    column_index: request.column_index, column_name: "Phase",
    kept: { case_count: 5, record_count: 19, labelled_record_count: 18, unlabelled_record_count: 1 },
    activities: [
      item("Close", 5, 5, 1, [["Closure", 4]], ["Closure", 4]),
      item("Open", 5, 5, 1, [["Intake", 4]], ["Intake", 4]),
      item("Assign", 4, 4, 0, [["Handling", 2], ["Intake", 2]], null),
      item("Work", 4, 3, 0, [["Handling", 4]], ["Handling", 4]),
    ],
  };
}

function scripted() {
  const asked: StageProposalRequest[] = [];
  const replies: ((outcome: ProposalOutcome) => void)[] = [];
  const client: ProposalClient = { propose: (request) => new Promise((reply) => { asked.push(request); replies.push(reply); }) };
  return { client, asked, replies };
}

const memory: StageMemory = { recall: () => noStages, remember: () => true };
const graph = () => {
  const base = suppliedGraph(["A-1"]);
  const node = base.nodes[0];
  return { ...base, nodes: ["Open", "Assign", "Work", "Close"].map((label, index) => ({ ...node, id: `activity:${index}`, label })) };
};

describe("the proposal in the editor of the stages", () => {
  let store: StageStore;
  beforeEach(() => { store = new StageStore(memory); });

  async function open() {
    const proposals = scripted();
    const user = userEvent.setup();
    render(<StagesEditor reading={reading} parentGraph={graph()} store={store} proposalClient={proposals.client}
      proposal={{ workspaceId, identity, revision: 3, columns: [{ index: PHASE, name: "Phase" }, { index: 5, name: "Desk" }] }} />);
    await user.selectOptions(screen.getByLabelText("Phase column"), String(PHASE));
    await user.click(screen.getByRole("button", { name: "Count the values" }));
    expect(proposals.asked).toHaveLength(1);
    expect(proposalContract.request(proposals.asked[0])).toBe(true);
    expect(proposals.asked[0]).toMatchObject({ column_index: PHASE, identity, query_revision: 3, value_limit: 10 });
    const answer = oracle(proposals.asked[0]);
    expect(proposalContract.answer(answer)).toBe(true);
    await act(async () => proposals.replies[0]({ ok: true, answer }));
    return { user, proposals, table: screen.getByRole("table", { name: "Values of Phase by activity" }) };
  }

  it("lists every value of every activity's records, mixed values said in words, and puts nothing into a stage by itself", async () => {
    const { table } = await open();
    const rows = within(table).getAllByRole("row").slice(1).map((row) => Array.from(row.children).slice(0, 5).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["Close", "5", "“Closure” 4", "1", "“Closure”, 4 records of 5"],
      ["Open", "5", "“Intake” 4", "1", "“Intake”, 4 records of 5"],
      ["Assign", "4", "Mixed: “Handling” 2 · “Intake” 2", "0", "None: values tie"],
      ["Work", "4", "“Handling” 4", "0", "“Handling”, 4 records of 4"],
    ]);
    expect(screen.getByText(/^Phase: counted on 18 records with an activity label of the 5 kept cases; 1 record without an activity label is in no activity\.$/)).toBeTruthy();
    // Counting is not taking: no stage, and the phase column named.
    expect(store.stateOf(reading).definitions.stages).toEqual([]);
    expect(store.stateOf(reading).definitions.phaseColumn).toBe(PHASE);
    expect(screen.getByText("Phase column: Phase.")).toBeTruthy();
  });

  it("takes a value for one activity at a time, or the one value of every unmixed activity at once, and shows where each stage came from", async () => {
    const { user, table } = await open();
    await user.click(within(table).getByRole("button", { name: "Put “Assign” in the stage “Handling”" }));
    let definitions = store.stateOf(reading).definitions;
    expect(definitions.stages.map((stage) => stage.name)).toEqual(["Handling"]);
    expect(originOf(definitions, "Assign")).toEqual({ kind: "proposed", column: PHASE, value: "Handling" });
    expect(within(table).getByRole("button", { name: "Put “Assign” in the stage “Handling”" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Take the proposal for 3 activities whose records hold one value" }));
    definitions = store.stateOf(reading).definitions;
    expect(Object.fromEntries([...definitions.assigned].map(([activity, stageId]) => [activity, definitions.stages.find((stage) => stage.id === stageId)?.name])))
      .toEqual({ Assign: "Handling", Close: "Closure", Open: "Intake", Work: "Handling" });
    // The activities table says where each stage came from, and an override by hand.
    const activities = screen.getByRole("table", { name: "Activities and their stage" });
    await user.selectOptions(within(activities).getByRole("combobox", { name: "Stage of “Work”" }), definitions.stages.find((stage) => stage.name === "Closure")!.id);
    const from = Object.fromEntries(within(activities).getAllByRole("row").slice(1).map((row) => [row.querySelector("th")?.textContent, row.querySelector(".stages-origin")?.textContent]));
    expect(from).toEqual({ Open: "Phase “Intake”", Assign: "Phase “Handling”", Work: "Set by hand", Close: "Phase “Closure”" });
    // The bulk button has nothing left to take: Assign is mixed, the rest are taken or overridden by hand.
    expect(screen.getByRole("button", { name: "Take the proposal for 1 activity whose records hold one value" })).toBeTruthy();
  });

  it("says which activities in stages the log does not have, draws them in no stage, and takes them out on request", async () => {
    store.change(reading, () => withActivity(withActivity(withStage(noStages, "Intake"), "Open", "stage:1"), "Gone", "stage:1"));
    const user = userEvent.setup();
    render(<StagesEditor reading={reading} parentGraph={graph()} store={store} />);
    expect(screen.getByRole("note").textContent).toContain("1 activity put into a stage is not in this log, so it is drawn in no stage: “Gone”.");
    await user.click(screen.getByRole("button", { name: "Take it out of its stage" }));
    expect([...store.stateOf(reading).definitions.assigned.keys()]).toEqual(["Open"]);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says where restored stages came from, and why stages were not applied", () => {
    store.restore(reading, withStage(noStages, "Intake"), { kind: "restored", investigation: "Invented stages" });
    const { unmount } = render(<StagesEditor reading={reading} parentGraph={graph()} store={store} />);
    expect(screen.getByText("The stages saved with the investigation “Invented stages”.")).toBeTruthy();
    unmount();
    store.restore(reading, null, { kind: "not_applied", investigation: "Other", message: "The stages saved with this investigation were not applied." });
    render(<StagesEditor reading={reading} parentGraph={graph()} store={store} />);
    expect(screen.getByRole("note").textContent).toBe("The stages saved with this investigation were not applied.");
    // The stages shown stay as they were.
    expect(store.stateOf(reading).definitions.stages.map((stage) => stage.name)).toEqual(["Intake"]);
  });
});
