import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PredicateResult, RecordAttributesAll } from "../generated/selection";
import { Bpic19RecordFilter } from "./Bpic19RecordFilter";
import { selectionContract } from "../map/client";
import { stepWording } from "../map/wording";
import { operatorIdentity } from "./operators-test-fixture";

const columns = [{ index: 3, name: "Goods Receipt", values: ["true", "false", null] }, { index: 4, name: "GR-Based Invoice Verification", values: ["true", "false", "Unknown", null] }];
const predicate: RecordAttributesAll = { kind: "record_attributes_all", policy_id: "incident.raw.same_record_all.v1", conditions: [{ column_index: 3, values: ["true"] }, { column_index: 4, values: ["true"] }], negate: false };
const result: PredicateResult = { predicate, kept: { case_ids: ["P"], case_count: 1, record_count: 2 }, removed: { case_ids: ["K"], case_count: 1, record_count: 2 }, unevaluable: { case_ids: ["U"], case_count: 1, record_count: 1 }, record_evidence: { policy_id: "incident.raw.same_record_all.v1", cases: [{ case_id: "P", matching_row_ids: ["row.v1:sha256:" + "a".repeat(64)], unevaluable_row_ids: [] }, { case_id: "U", matching_row_ids: [], unevaluable_row_ids: ["row.v1:sha256:" + "b".repeat(64)] }] } };
function setup(reviewed?: PredicateResult, disabled = false) {
  const props = { columns, initialColumns: [3, 4], result: reviewed, disabled, onKeep: vi.fn(), onInspect: vi.fn() };
  return { ...render(<Bpic19RecordFilter {...props} />), props, user: userEvent.setup() };
}
async function exact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Exact value 1.1" }), "true");
  await user.type(screen.getByRole("textbox", { name: "Exact value 2.1" }), "true");
}

describe("same original record complete-item filter", () => {
  it("emits one typed conjunction, with values OR and fields AND, rather than separate any-row chips", async () => {
    const { user, props } = setup();
    expect(screen.getByRole("button", { name: "Keep complete items by this record filter" }).hasAttribute("disabled")).toBe(true);
    await exact(user); await user.click(screen.getByRole("button", { name: "Keep complete items by this record filter" }));
    expect(props.onKeep).toHaveBeenCalledExactlyOnceWith(predicate);
    expect(stepWording(predicate)).toContain("same record");
    expect(stepWording(predicate)).toContain(" AND ");
  });
  it("preserves literal Unknown, exact whitespace, explicit blank alternatives and negation", async () => {
    const { user, props } = setup();
    await user.type(screen.getByRole("textbox", { name: "Exact value 1.1" }), " true");
    await user.type(screen.getByRole("textbox", { name: "Exact value 2.1" }), "Unknown");
    await user.click(screen.getByRole("checkbox", { name: "Include a blank cell for field 2" }));
    await user.click(screen.getByRole("button", { name: "Add alternative for field 2" }));
    await user.type(screen.getByRole("textbox", { name: "Exact value 2.2" }), "false");
    await user.click(screen.getByRole("checkbox", { name: "Keep items where no original record satisfies all conditions" }));
    await user.click(screen.getByRole("button", { name: "Keep complete items by this record filter" }));
    expect(props.onKeep).toHaveBeenCalledExactlyOnceWith({ ...predicate, conditions: [{ column_index: 3, values: [" true"] }, { column_index: 4, values: ["Unknown", "false", null] }], negate: true });
  });
  it("lets a keyboard user select recorded alternatives, rejects duplicate fields/values, and recovers", async () => {
    const { user, props } = setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded value for condition 1" }), "0");
    await user.selectOptions(screen.getByRole("combobox", { name: "Recorded value for condition 2" }), "3");
    expect(screen.getByRole("button", { name: "Keep complete items by this record filter" }).hasAttribute("disabled")).toBe(false);
    await user.selectOptions(screen.getByRole("combobox", { name: "Original field 2" }), "3");
    expect(screen.getByRole("button", { name: "Keep complete items by this record filter" }).hasAttribute("disabled")).toBe(true);
    await user.selectOptions(screen.getByRole("combobox", { name: "Original field 2" }), "4");
    await user.click(screen.getByRole("button", { name: "Add alternative for field 1" }));
    await user.type(screen.getByRole("textbox", { name: "Exact value 1.2" }), "true");
    expect(screen.getByRole("button", { name: "Keep complete items by this record filter" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Remove alternative 1.2" }));
    await user.click(screen.getByRole("button", { name: "Keep complete items by this record filter" }));
    expect(props.onKeep).toHaveBeenLastCalledWith({ ...predicate, conditions: [{ column_index: 3, values: ["true"] }, { column_index: 4, values: [null] }] });
  });
  it("shows current supplied complete-item supports and original witnesses, then hides stale evidence for draft changes", async () => {
    const { user, props } = setup(result); await exact(user);
    const support = screen.getByLabelText("Reviewed same-record support");
    expect(support.textContent).toContain("Kept: 1 items / 2 original records");
    await user.click(within(support).getByText("Original witnesses for item P"));
    await user.click(screen.getByRole("button", { name: "Inspect complete item P" }));
    expect(props.onInspect).toHaveBeenCalledExactlyOnceWith("P", result.record_evidence?.cases[0].matching_row_ids);
    await user.type(screen.getByRole("textbox", { name: "Exact value 2.1" }), "false");
    expect(screen.queryByLabelText("Reviewed same-record support")).toBeNull();
  });
  it("does not publish selection changes while the parent revision is disabled", async () => {
    const { user, props } = setup(undefined, true);
    await user.type(screen.getByRole("textbox", { name: "Exact value 1.1" }), "true");
    await user.click(screen.getByRole("button", { name: "Keep complete items by this record filter" }));
    expect(props.onKeep).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Exact value 1.1" }).hasAttribute("disabled")).toBe(false); // disabled by its containing fieldset
    expect(screen.getByRole("group", { name: "All conditions on the same record" }).hasAttribute("disabled")).toBe(true);
  });
  it("validates the exact request and witnessed answer through the public closed selection contract", () => {
    const request = { schema_version: 1, message_type: "select_cases_request", request_id: "record-filter-1", query_revision: 2,
      workspace_id: "workspace.v1:literal-fixture", identity: operatorIdentity, parent_case_ids: null, predicates: [predicate] };
    expect(selectionContract.selectCasesRequest(request)).toBe(true);
    expect(selectionContract.selectCasesRequest({ ...request, predicates: [{ ...predicate, conditions: [{ column_index: 3, values: ["true", "true"] }] }] })).toBe(false);
    expect(selectionContract.selectCasesRequest({ ...request, predicates: [{ ...predicate, conditions: [{ column_index: true, values: ["true"] }] }] })).toBe(false);
    expect(selectionContract.selectionAnswer({ schema_version: 1, message_type: "selection_answer", request_id: "record-filter-1", query_revision: 2, workspace_id: request.workspace_id,
      identity: operatorIdentity, parent_identity: operatorIdentity, parent: { case_ids: ["K", "P", "U"], case_count: 3, record_count: 5 }, ...result, predicate: undefined, predicate_results: [result] })).toBe(false); // unknown top-level fields are rejected
    const answer = { schema_version: 1, message_type: "selection_answer", request_id: "record-filter-1", query_revision: 2, workspace_id: request.workspace_id,
      identity: operatorIdentity, parent_identity: operatorIdentity, parent: { case_ids: ["K", "P", "U"], case_count: 3, record_count: 5 }, kept: result.kept, removed: result.removed, unevaluable: result.unevaluable, predicate_results: [result] };
    expect(selectionContract.selectionAnswer(answer)).toBe(true);
  });
});
