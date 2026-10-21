import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GroupRule, RuleGroup, RuleGroupsAnswer, RuleGroupsRequest } from "../generated/rule-groups";
import { kept, parent } from "../time/testFakes";
import type { RuleGroupsOutcome } from "./client";
import { GroupsPanel } from "./GroupsPanel";
import { groupRuleSentence, ruleSentence } from "./rules";

// #64: each rule and each group says what it holds; who the rule cannot evaluate, who it places nowhere and the missing
// values are disclosed apart, among the kept incidents and in the parent; and a group is said to be no class and no cause.
const support = (count: number, prefix = "C") => ({ case_ids: Array.from({ length: count }, (_, place) => `${prefix}-${place}`), case_count: count, record_count: count * 2, omitted_activity_record_count: 0 });
const columns = [{ index: 3, name: "Desk" }];
const named = (index: number) => columns.find((column) => column.index === index)?.name ?? "?";

function group(key: RuleGroup["key"], keptCount: number): RuleGroup {
  const distribution = { edges_hours: [0, 24], bins: [{ start_inclusive_hours: 0, end_exclusive_hours: null, parent_case_count: keptCount + 1, kept_case_count: keptCount }], unavailable: { kept_case_count: 0 } };
  return {
    id: `group-${JSON.stringify(key)}`, key, population: { cases: support(keptCount), share: keptCount / 6, denominator: 6 },
    parent: { cases: support(keptCount + 1), share: (keptCount + 1) / 10, denominator: 10 }, span_distribution: distribution, gap_distribution: distribution,
    exemplars: { status: "unavailable", reason: "no_evaluable_case", shortest: null, longest: null },
  } as unknown as RuleGroup;
}

/** Answers every rule with the same coverage: 8 kept of 12 in the parent, 6 and 10 eligible, 2 kept and 2 in the parent unevaluable or unassigned. */
function answering() {
  return {
    groups: vi.fn(async (request: RuleGroupsRequest): Promise<RuleGroupsOutcome> => {
      const rule = request.query.rule;
      const reference = rule.kind === "shared_reference";
      const ordered = rule.kind === "first_raw_activity";
      const coverage = (total: number, eligible: number, unplaced: number) => ({
        total: support(total), eligible: support(eligible), assigned: support(eligible - (reference ? unplaced : 0)),
        unevaluable: support(ordered ? unplaced : 0, "U"), unassigned: support(reference ? unplaced : 0, "N"), membership_incidence: support(eligible),
      });
      const groups = reference
        ? [group({ kind: "reference_value", column_index: 3, value: "East" }, 3), group({ kind: "missing_reference", column_index: 3, value: null }, 1)]
        : rule.kind === "raw_record_count_bands"
          ? [group({ kind: "raw_record_count_band", start_inclusive: 0, end_exclusive: 1 }, 0), group({ kind: "raw_record_count_band", start_inclusive: 1, end_exclusive: 2 }, 2),
             group({ kind: "raw_record_count_band", start_inclusive: 2, end_exclusive: null }, 4)]
          : [group({ kind: "activity", activity: "Opened" }, 5), group({ kind: "missing_activity", activity: null }, 1)];
      const answer = {
        request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, parent_identity: parent,
        query: request.query, group_membership_overlaps: reference, population_coverage: coverage(8, 6, 2), parent_coverage: coverage(12, 10, 2),
        shared_reference_coverage: reference ? { column_index: 3, parent_distinct_nonmissing_value_count: 5, parent_suppressed_nonmissing_value_count: 2,
          parent_missing_reference_record_count: 4, population_missing_reference_record_count: 1 } : null,
        group_count: groups.length, next_offset: null, groups,
      } as unknown as RuleGroupsAnswer;
      return { ok: true, answer };
    }),
  };
}

function setup(chosen: string | null = null) {
  render(<GroupsPanel workspaceId="workspace-1" revision={4} identity={kept} contextColumns={columns} activities={["Opened"]} chosen={chosen} onChoose={vi.fn()} client={answering()} />);
  return userEvent.setup();
}

describe("what a rule and its groups disclose", () => {
  it("says the rule, who is eligible among the kept and in the parent, and why the unevaluable cannot be evaluated", async () => {
    setup();
    await screen.findByText("Opened");
    expect(screen.getByText(/^Each incident is in the group of the activity of its first record in the declared order\./).textContent).toContain(
      "An incident whose order is not fully known cannot be evaluated; one whose first record has no activity label is in “No activity label”.",
    );
    expect(screen.getByText(/^Eligible for the rule:/).textContent).toBe("Eligible for the rule: 6 of 8 kept incidents, and 10 of 12 incidents in the parent.");
    expect(screen.getByText(/the rule cannot evaluate/).textContent).toBe("2 incidents the rule cannot evaluate (parent 2): the order of their records is not fully known");
    expect(screen.getByText("No activity label")).toBeTruthy();
    expect(screen.getByText("A group is what its stated rule puts together: it is not a business class, and a difference between groups is not a cause.")).toBeTruthy();
  });

  it("says apart the incidents in no group and the records without a value of a shared column, with the values that form no group", async () => {
    const user = setup();
    await screen.findByText("Opened");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grouped by" }), "Same Desk");
    await screen.findByText("East");
    expect(screen.getByText(/in no group/).textContent).toBe("2 incidents in no group (parent 2): each value of Desk they have is recorded in too few incidents of the parent");
    expect(screen.getByText(/without a value of Desk \(parent/).textContent).toBe("1 record of the kept incidents without a value of Desk (parent 4); 2 of the 5 values in the parent form no group.");
    expect(screen.getByText("Not recorded")).toBeTruthy();
    expect(screen.queryByText(/cannot evaluate/)).toBeNull();
  });

  it("asks for bands of numbers of records from zero, as the service takes them, and shows no band below one record", async () => {
    const client = answering();
    render(<GroupsPanel workspaceId="workspace-1" revision={4} identity={kept} contextColumns={columns} chosen={null} onChoose={vi.fn()} client={client} />);
    await screen.findByText("Opened");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Grouped by" }), "Number of records");
    await screen.findByText("1 record");
    expect(client.groups.mock.calls.at(-1)![0].query.rule).toEqual({ kind: "raw_record_count_bands", edges: [0, 1, 2, 5, 10, 20, 50] });
    expect(Array.from(document.querySelectorAll(".groups-name"), (name) => name.textContent)).toEqual(["1 record", "2 or more records"]);
    expect(screen.getByText(/^2 groups/)).toBeTruthy();
  });

  it("states the rule of a chosen group above what it rests on", async () => {
    setup(`group-${JSON.stringify({ kind: "missing_activity", activity: null })}`);
    const row = (await screen.findByRole("button", { name: /No activity label/ })).closest("li")!;
    expect(within(row).getByText("Incidents whose first record in the declared order has no activity label.")).toBeTruthy();
  });
});

describe("the words of each rule and group", () => {
  const rules: GroupRule[] = [
    { kind: "last_raw_activity" },
    { kind: "raw_record_count_bands", edges: [1, 2, 5] },
    { kind: "exact_mapped_sequence" },
    { kind: "activity_presence", activity: "Waiting" },
    { kind: "shared_reference", column_index: 3, minimum_parent_case_count: 2 },
  ];

  it("says for every rule what it reads and whom it cannot evaluate", () => {
    expect(rules.map((rule) => ruleSentence(rule, named))).toEqual([
      "Each incident is in the group of the activity of its last record in the declared order. An incident whose order is not fully known cannot be evaluated; one whose last record has no activity label is in “No activity label”.",
      "Each incident is in the band of its number of records, records without an activity label included. Every incident can be evaluated.",
      "Each incident is in the group of its exact sequence of labelled activities in the declared order; records without an activity label are left out of the sequence. An incident whose order is not fully known cannot be evaluated.",
      "Each incident is in “With Waiting” if at least one of its records has that activity, otherwise in “Without Waiting”. Every incident can be evaluated.",
      "Each incident is in the group of every value of Desk recorded in it, so an incident with several values is in several groups. A value recorded in fewer than 2 incidents of the parent forms no group. An incident with a record without a value of Desk is also in “Not recorded”.",
    ]);
  });

  it("says for every kind of group which incidents it holds", () => {
    expect([
      groupRuleSentence({ kind: "activity", activity: "Resolved" }, rules[0], named),
      groupRuleSentence({ kind: "raw_record_count_band", start_inclusive: 1, end_exclusive: 2 }, rules[1], named),
      groupRuleSentence({ kind: "raw_record_count_band", start_inclusive: 2, end_exclusive: 5 }, rules[1], named),
      groupRuleSentence({ kind: "raw_record_count_band", start_inclusive: 5, end_exclusive: null }, rules[1], named),
      groupRuleSentence({ kind: "exact_sequence", activities: ["Opened", "Resolved"], variant_id: "v" } as never, rules[2], named),
      groupRuleSentence({ kind: "exact_sequence", activities: [], variant_id: "v" } as never, rules[2], named),
      groupRuleSentence({ kind: "activity_presence", activity: "Waiting", present: false }, rules[3], named),
      groupRuleSentence({ kind: "reference_value", column_index: 3, value: "East" }, rules[4], named),
      groupRuleSentence({ kind: "missing_reference", column_index: 3, value: null }, rules[4], named),
    ]).toEqual([
      "Incidents whose last record in the declared order has the activity “Resolved”.",
      "Incidents with 1 record, records without an activity label included.",
      "Incidents with 2–4 records, records without an activity label included.",
      "Incidents with 5 or more records, records without an activity label included.",
      "Incidents whose labelled activities in the declared order are exactly “Opened”, then “Resolved”.",
      "Incidents without a labelled activity in the declared order.",
      "Incidents with no record of “Waiting”.",
      "Incidents with at least one record whose Desk is “East”.",
      "Incidents with at least one record without a value of Desk.",
    ]);
  });
});
