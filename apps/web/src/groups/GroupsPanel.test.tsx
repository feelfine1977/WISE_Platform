import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RuleGroup, RuleGroupsAnswer, RuleGroupsRequest } from "../generated/rule-groups";
import { kept, parent } from "../time/testFakes";
import type { RuleGroupsOutcome } from "./client";
import { GROUP_PAGE, GroupsPanel } from "./GroupsPanel";
import { groupLabel } from "./rules";

const support = (ids: string[]) => ({ case_ids: ids, case_count: ids.length, record_count: ids.length * 3, omitted_activity_record_count: 0 });

/** Groups by first activity: "Eröffnet" with three incidents, "Rückfrage" with one; 60 groups in all where asked for the sequence. */
function grouping(unassigned = 0, failAtOffsetOnce: number | null = null) {
  let failed = false;
  return {
    groups: vi.fn(async (request: RuleGroupsRequest): Promise<RuleGroupsOutcome> => {
      if (request.query.offset === failAtOffsetOnce && !failed) {
        failed = true;
        return { ok: false, problem: { kind: "unreachable" } };
      }
      const many = request.query.rule.kind === "exact_mapped_sequence";
      const names = many ? Array.from({ length: 60 }, (_, place) => `A${place}`) : ["Eröffnet", "Rückfrage", "Leer"];
      const all: RuleGroup[] = names.map((name, place) => ({
        id: `group-${name}`,
        key: many ? { kind: "exact_sequence", activities: [name, "Ende"], variant_id: `v${place}` } : { kind: "activity", activity: name },
        population: { cases: support(place === 0 ? ["A-1", "A-2", "A-3"] : name === "Leer" ? [] : [`B-${place}`]), share: place === 0 ? 0.75 : name === "Leer" ? 0 : 0.25, denominator: 4 },
        parent: { cases: support(["A-1", "A-2", "A-3", "A-4", "A-5", "A-6"]), share: 0.5, denominator: 12 },
        span_distribution: {
          edges_hours: [0, 24],
          bins: [
            { start_inclusive_hours: 0, end_exclusive_hours: 24, parent_case_count: 4, kept_case_count: 2 },
            { start_inclusive_hours: 24, end_exclusive_hours: null, parent_case_count: 2, kept_case_count: 1 },
          ],
          unavailable: { kept_case_count: 0 },
        },
        gap_distribution: {
          edges_hours: [0, 24],
          bins: [
            { start_inclusive_hours: 0, end_exclusive_hours: 24, parent_case_count: 5, kept_case_count: 2 },
            { start_inclusive_hours: 24, end_exclusive_hours: null, parent_case_count: 1, kept_case_count: 0 },
          ],
          unavailable: { kept_case_count: 1 },
        },
        exemplars:
          name === "Leer"
            ? { status: "unavailable", reason: "empty_current_group", shortest: null, longest: null }
            : { status: "available", shortest: { case_id: "A-2", record_count: 2, observed_span_hours: 3 }, longest: { case_id: "A-3", record_count: 5, observed_span_hours: 50 } },
      }) as unknown as RuleGroup);
      const page = all.slice(request.query.offset, request.query.offset + request.query.limit);
      const next = request.query.offset + page.length;
      const coverage = { total: support([]), eligible: support([]), unevaluable: support([]), assigned: support([]), unassigned: support(Array.from({ length: unassigned }, (_, place) => `U-${place}`)), membership_incidence: support([]) };
      const parentCoverage = { ...coverage, unevaluable: support(["P-1", "P-2"]), unassigned: support(Array.from({ length: unassigned * 2 }, (_, place) => `PU-${place}`)) };
      const answer = {
        request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, parent_identity: parent,
        query: request.query, group_membership_overlaps: false, population_coverage: coverage, parent_coverage: parentCoverage, group_count: all.length,
        next_offset: next < all.length ? next : null, groups: page,
      } as unknown as RuleGroupsAnswer;
      return { ok: true, answer };
    }),
  };
}

function setup(unassigned = 0, chosen: string | null = null) {
  const client = grouping(unassigned);
  const onChoose = vi.fn();
  const onOpen = vi.fn();
  const view = render(
    <GroupsPanel
      workspaceId="workspace-1"
      revision={4}
      identity={kept}
      contextColumns={[{ index: 2, name: "Kanal" }]}
      activities={["Eröffnet", "Erinnerung"]}
      onOpen={onOpen}
      chosen={chosen}
      onChoose={onChoose}
      client={client}
    />,
  );
  return { client, onChoose, onOpen, view, user: userEvent.setup() };
}

describe("the groups of the kept incidents", () => {
  it("offer the stated rules, the shared value of each context column among them, and group by the first activity at first", async () => {
    const { client } = setup();
    const rule = screen.getByRole("combobox", { name: "Grouped by" });
    expect(within(rule).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "First activity",
      "Last activity",
      "Number of records",
      "Exact sequence of activities",
      "Same Kanal",
      "With or without Eröffnet",
      "With or without Erinnerung",
    ]);
    await screen.findByText("Eröffnet");
    expect(client.groups.mock.calls[0][0].query).toMatchObject({ rule: { kind: "first_raw_activity" }, offset: 0, limit: GROUP_PAGE });
    expect(client.groups.mock.calls[0][0].identity).toEqual(kept);
  });

  it("rank the groups with their incidents, and say how much the largest hold where groups do not overlap", async () => {
    setup();
    const first = await screen.findByRole("button", { name: /Eröffnet/ });
    expect(first.textContent).toContain("3");
    expect(screen.getByText("3 groups · the parent's largest 3 hold 100% of the eligible kept incidents")).toBeTruthy();
  });

  it("hand the incidents of a chosen group to the table, and let it go when another rule is chosen", async () => {
    const { user, onChoose } = setup();
    await user.click(await screen.findByRole("button", { name: /Eröffnet/ }));
    expect(onChoose).toHaveBeenLastCalledWith({ id: "group-Eröffnet", label: "Eröffnet", caseIds: ["A-1", "A-2", "A-3"] });
    await user.selectOptions(screen.getByRole("combobox", { name: "Grouped by" }), "Same Kanal");
    expect(onChoose).toHaveBeenLastCalledWith(null);
  });

  it("load more groups a page at a time, and say in the amber of a limit how many incidents are in no group", async () => {
    const { client, user } = setup(5);
    // Who the rule cannot place is said apart, among the kept incidents and in the parent.
    expect(await screen.findByText("5 incidents in no group (parent 10)")).toBeTruthy();
    expect(screen.getByText("0 incidents the rule cannot evaluate (parent 2)")).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Grouped by" }), "Exact sequence of activities");
    await screen.findByText("A0 → Ende");
    await user.click(screen.getByRole("button", { name: "Show more groups" }));
    expect(client.groups.mock.calls.at(-1)?.[0].query).toMatchObject({ rule: { kind: "exact_mapped_sequence" }, offset: 50 });
    expect(await screen.findByText("A59 → Ende")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more groups" })).toBeNull();
  });
});

describe("a failed page of groups", () => {
  it("is asked again from the first page, so that no page of the catalogue goes missing", async () => {
    const client = grouping(0, 50);
    const user = userEvent.setup();
    render(<GroupsPanel workspaceId="workspace-1" revision={4} identity={kept} contextColumns={[]} chosen={null} onChoose={vi.fn()} client={client} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Grouped by" }), "Exact sequence of activities");
    await screen.findByText("A0 → Ende");
    await user.click(screen.getByRole("button", { name: "Show more groups" }));
    await user.click(await screen.findByRole("button", { name: "Ask again" }));
    expect(client.groups.mock.calls.map(([request]) => request.query.offset).slice(-3)).toEqual([0, 50, 0]);
    expect(await screen.findByText("A0 → Ende")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show more groups" }));
    expect(await screen.findByText("A59 → Ende")).toBeTruthy();
    expect(screen.getByText("A0 → Ende")).toBeTruthy();
  });
});

describe("a chosen group", () => {
  it("is grouped with or without an activity by the sixth rule", async () => {
    const { client, user } = setup();
    await screen.findByText("Eröffnet");
    await user.selectOptions(screen.getByRole("combobox", { name: "Grouped by" }), "With or without Erinnerung");
    expect(client.groups.mock.calls.at(-1)?.[0].query.rule).toEqual({ kind: "activity_presence", activity: "Erinnerung" });
  });

  it("shows under its row what it rests on: its incidents in the parent and kept, their spans, and its shortest and longest incident to open", async () => {
    const { user, onOpen } = setup(0, "group-Eröffnet");
    const row = (await screen.findByRole("button", { name: /Eröffnet/ })).closest("li")!;
    const figures = Array.from(row.querySelectorAll(".groups-figures > div"), (pair) => pair.textContent);
    expect(figures).toEqual(["In the parent6 of 12 eligible · 50%", "Kept3 of 4 eligible · 75%"]);
    // The charts of a group are only to read: their description says no step.
    expect(row.textContent).not.toContain("Enter takes the step");
    expect(within(row).getByRole("group", { name: "Recorded spans of the group, parent and kept" })).toBeTruthy();
    expect(within(row).getByRole("group", { name: "Longest gaps of the group, parent and kept" })).toBeTruthy();
    expect(within(row).getByText("1 incident without a gap")).toBeTruthy();
    await user.click(within(row).getByRole("button", { name: "Longest: A-3, 2.1 d" }));
    expect(onOpen).toHaveBeenCalledWith("A-3");
    expect(within(row).getByRole("button", { name: "Shortest: A-2, 3 h" })).toBeTruthy();
  });
});

describe("the words of a group", () => {
  it("name bands of records, a missing value and a sequence plainly", () => {
    expect(groupLabel({ kind: "raw_record_count_band", start_inclusive: 1, end_exclusive: 2 })).toBe("1 record");
    expect(groupLabel({ kind: "raw_record_count_band", start_inclusive: 2, end_exclusive: 5 })).toBe("2–4 records");
    expect(groupLabel({ kind: "raw_record_count_band", start_inclusive: 50, end_exclusive: null })).toBe("50 or more records");
    expect(groupLabel({ kind: "missing_reference", column_index: 2, value: null })).toBe("Not recorded");
    expect(groupLabel({ kind: "activity_presence", activity: "Erinnerung", present: false })).toBe("Without Erinnerung");
  });
});

describe("a group that keeps no incident", () => {
  it("can still be chosen, to read what it rests on in the parent and why it has no exemplars", async () => {
    const { user, onChoose } = setup(0, "group-Leer");
    const empty = await screen.findByRole("button", { name: /Leer/ });
    expect(empty.hasAttribute("disabled")).toBe(false);
    await user.click(empty);
    expect(onChoose).toHaveBeenLastCalledWith(null);
    const row = empty.closest("li")!;
    expect(Array.from(row.querySelectorAll(".groups-figures > div"), (pair) => pair.textContent)).toEqual(["In the parent6 of 12 eligible · 50%", "Kept0 of 4 eligible · 0%"]);
    expect(within(row).getByText("No kept incident is in this group.")).toBeTruthy();
  });
});
