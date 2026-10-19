import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SelectionPredicate } from "../generated/selection";
import { identity, workspaceId } from "../test/imports";
import { openingContextAnswer } from "../test/views";
import type { OpeningContextAnswer } from "./messages";
import { OpenedAs } from "./OpenedAs";

const ANCHOR = "incident.context.first_record_in_declared_order.v1";

function answer(tied = 0): OpeningContextAnswer {
  const base = openingContextAnswer({ schema_version: 1, message_type: "opening_context_request", request_id: "c", query_revision: 1, workspace_id: workspaceId, identity });
  const coverage = (group: OpeningContextAnswer["opening_context"]["parent"]) => ({ ...group, tied_first_record_case_count: tied });
  return { ...base, opening_context: { ...base.opening_context, parent: coverage(base.opening_context.parent), population: coverage(base.opening_context.population) } };
}

describe("#7 the first recorded observation, kept from its value and explained", () => {
  it("keeps the incidents first recorded with a value, missing apart from the text Unknown, by keyboard", async () => {
    const onStep = vi.fn<(step: SelectionPredicate) => void>();
    render(<OpenedAs state={{ phase: "ready", answer: answer() }} onRetry={() => undefined} onStep={onStep} />);
    const user = userEvent.setup();
    const missing = screen.getByRole("button", { name: "Keep incidents first recorded with Gruppe not recorded" });
    missing.focus();
    await user.keyboard("{Enter}");
    expect(onStep).toHaveBeenLastCalledWith({ kind: "opening_attribute_equals", column_index: 3, value: null, negate: false, anchor_policy: ANCHOR });
    await user.click(screen.getByRole("button", { name: "Keep incidents first recorded with Gruppe Unknown" }));
    expect(onStep).toHaveBeenLastCalledWith({ kind: "opening_attribute_equals", column_index: 3, value: "Unknown", negate: false, anchor_policy: ANCHOR });
    // The remainder stands for several values: no step is offered from it.
    const priority = screen.getByRole("list", { name: "Opening values of Priorität, most frequent first" });
    expect(within(priority).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Keep incidents first recorded with Priorität P1", "Keep incidents first recorded with Priorität P2"]);
  });

  it("reconciles each column with the incidents counted, says that latest and ever are not offered, and names ties at the first record", () => {
    render(<OpenedAs state={{ phase: "ready", answer: answer(1) }} onRetry={() => undefined} />);
    const lines = screen.getAllByText(/^Each incident with a readable first record has exactly one value here/).map((line) => line.textContent);
    expect(lines).toEqual([
      "Each incident with a readable first record has exactly one value here: the values listed add up to 4 incidents of 4 incidents.",
      "Each incident with a readable first record has exactly one value here: the values listed and the other values add up to 4 incidents of 4 incidents.",
    ]);
    expect(screen.getByText(/^Only the value at the first recorded observation is shown\./).textContent).toContain("their shares would overlap");
    expect(screen.getByText(/shares its time with the next record/).textContent).toMatch(
      /^1 incident of the parent has a first record that shares its time with the next record.*the declared order decides which is first, by the sequence number, then by the place in the file\./s,
    );
    // Without a step to take, the values are only shown.
    expect(screen.queryByRole("button", { name: /^Keep incidents first recorded/ })).toBeNull();
  });

  it("says nothing of ties when no first record shares its time", () => {
    render(<OpenedAs state={{ phase: "ready", answer: answer(0) }} onRetry={() => undefined} />);
    expect(screen.queryByText(/shares its time with the next record/)).toBeNull();
  });
});
