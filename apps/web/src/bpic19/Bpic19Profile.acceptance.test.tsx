import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19ProfileAnswer, Bpic19ProfileRequest } from "../generated/bpic19-profile";
import fixture from "./profile-test-answer.json";
import { Bpic19Profile } from "./Bpic19Profile";
import { bpic19ProfileContract, type Bpic19ProfileClient, type Bpic19ProfileOutcome } from "./profile-client";

// #104 E02, E03 and E06 on the literal profile fixture. The witness rows below are written here, not derived:
// C_1 changes Item Category (column 3) between two records; G_1 changes its purchasing document (column 7).
const base: Bpic19ProfileAnswer = structuredClone(fixture) as Bpic19ProfileAnswer;
const category = base.profile!.attributes.find(attribute => attribute.column_index === 3)!;
category.conflicting_witnesses = [{ case_id: "C_1", rows: [
  { row_id: "row-c1-a", source_position: 6, value: "3-way match, invoice before GR" },
  { row_id: "row-c1-b", source_position: 7, value: "3-way match, invoice after GR" }] }];
category.omitted_distinct_value_count = 1;
base.profile!.attributes.find(attribute => attribute.column_index === 7)!.conflicting_witnesses = [{ case_id: "G_1", rows: [
  { row_id: "row-g1-a", source_position: 12, value: "G" },
  { row_id: "row-g1-b", source_position: 13, value: "Other" }] }];
if (!bpic19ProfileContract.answer(base)) throw new Error("Invalid literal profile fixture");

function responding(request: Bpic19ProfileRequest, answer: Bpic19ProfileAnswer = base): Bpic19ProfileOutcome {
  return { ok: true, answer: { ...answer, request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id,
    identity: request.identity, query: request.query, binding_state: request.query.roles === null ? "needs_review" : "reviewed",
    profile: request.query.roles === null ? null : answer.profile } };
}
function refusing(request: Bpic19ProfileRequest, field: string, message: string): Bpic19ProfileOutcome {
  return { ok: false, problem: { kind: "refusal", refusal: { schema_version: 1, message_type: "bpic19_profile_refusal", request_id: request.request_id,
    query_revision: request.query_revision, workspace_id: request.workspace_id, operation: "bpic19_profile", code: "invalid_parameter", message, field, retryable: false } } };
}

/** A client whose answers the test releases one by one, in any order. */
function controlled() {
  const pending: { request: Bpic19ProfileRequest; resolve: (outcome: Bpic19ProfileOutcome) => void }[] = [];
  const client: Bpic19ProfileClient = { profile: vi.fn((request: Bpic19ProfileRequest) => request.query.roles === null
    ? Promise.resolve(responding(request)) : new Promise<Bpic19ProfileOutcome>(resolve => { pending.push({ request, resolve }); })) };
  return { client, pending };
}

function setup(client: Bpic19ProfileClient) {
  const onKeep = vi.fn(), onInspect = vi.fn(), onReviewed = vi.fn(), onValidityChange = vi.fn();
  const props = { workspaceId: base.workspace_id, identity: base.identity, revision: 2, client, onKeep, onInspect, onReviewed, onValidityChange };
  const view = render(<Bpic19Profile {...props} />);
  return { ...view, props, onInspect, onReviewed, onValidityChange, user: userEvent.setup() };
}

describe("#104 profile acceptance in the browser", () => {
  it("E02: a refused page names its field and keeps the earlier reviewed answer and its evidence visible", async () => {
    let refuse = true;
    const client: Bpic19ProfileClient = { profile: vi.fn(async (request: Bpic19ProfileRequest) => request.query.attribute_view && refuse
      ? refusing(request, "query.attribute_view.column_index", "Review an attribute column that this profile includes.") : responding(request)) };
    const { user } = setup(client);
    await user.click(await screen.findByRole("button", { name: "Review these field roles" }));
    await screen.findByRole("table", { name: "Purchasing flow at PO-item grain" });
    await user.click(screen.getByRole("button", { name: "Next values for column 3: case Item Category" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Review an attribute column that this profile includes.");
    expect(alert.textContent).toContain("Field: query.attribute_view.column_index.");
    // Unrelated evaluable evidence is not erased or replaced with zero.
    expect(screen.getByText("11 PO items")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Purchasing flow at PO-item grain" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inspect conflicting rows C_1" })).toBeTruthy();
    refuse = false;
    await user.click(within(alert).getByRole("button", { name: "Retry source profile" }));
    await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    const retried = vi.mocked(client.profile).mock.calls.at(-1)![0];
    expect(retried.query.attribute_view).toEqual({ column_index: 3, offset: 12, limit: 12, select_value: false, value: null });
    expect(screen.getByText("11 PO items")).toBeTruthy();
  });

  it("E03: a late success or error for an older population publishes nothing over the current answer", async () => {
    const { client, pending } = controlled();
    const { user, props, rerender, onReviewed } = setup(client);
    await user.click(await screen.findByRole("button", { name: "Review these field roles" }));
    const older = pending.shift()!;
    const parent = { ...base.identity, population_id: "population.v1:sha256:" + "b".repeat(64) };
    rerender(<Bpic19Profile {...props} identity={parent} query={older.request.query} />);
    const current = pending.shift()!;
    expect(current.request.identity).toEqual(parent);
    current.resolve(responding(current.request));
    await screen.findByRole("table", { name: "Purchasing flow at PO-item grain" });
    older.resolve(refusing(older.request, "query.roles.item_category", "The older population's category binding is unavailable."));
    older.resolve(responding(older.request));
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onReviewed).toHaveBeenCalledTimes(1);
    expect(onReviewed.mock.calls[0][0].identity).toEqual(parent);
  });

  it("E03: a late attribute page for the earlier definition does not replace a newly reviewed definition", async () => {
    const { client, pending } = controlled();
    const { user, onReviewed } = setup(client);
    await user.click(await screen.findByRole("button", { name: "Review these field roles" }));
    const first = pending.shift()!;
    first.resolve(responding(first.request));
    await user.click(await screen.findByRole("button", { name: "Next values for column 3: case Item Category" }));
    const page = pending.shift()!;
    // While the page is pending the analyst cancels; the old page must not publish when it arrives.
    await user.click(screen.getByRole("button", { name: "Cancel source review" }));
    page.resolve(responding(page.request));
    await Promise.resolve();
    expect(screen.queryByText(/Value page/)).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("The source review was cancelled");
    // A different definition is reviewed next; only its answer is published and offered for saving.
    await user.click(screen.getByText("Reviewed source field roles"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Purchasing flow (Item Category)" }), "4");
    expect(screen.getByText(/Field choices have changed/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Review these field roles" }));
    const edited = pending.shift()!;
    expect(edited.request.query.roles?.item_category).toBe(4);
    edited.resolve(responding(edited.request));
    await screen.findByRole("table", { name: "Purchasing flow at PO-item grain" });
    const published = onReviewed.mock.calls.map(call => call[0].query.roles.item_category);
    expect(published).toEqual([3, 4]);
    expect(onReviewed.mock.calls.every(call => call[0].query.attribute_view === undefined)).toBe(true);
  });

  it("E06: keyboard evidence actions open the complete item with exactly its contributing rows", async () => {
    const client: Bpic19ProfileClient = { profile: vi.fn(async (request: Bpic19ProfileRequest) => responding(request)) };
    const { user, onInspect } = setup(client);
    await user.click(await screen.findByRole("button", { name: "Review these field roles" }));
    await screen.findByRole("table", { name: "Purchasing flow at PO-item grain" });
    const press = async (name: string | RegExp) => {
      screen.getByRole("button", { name }).focus();
      await user.keyboard("{Enter}");
    };
    await press("Inspect conflicting rows C_1");
    expect(onInspect).toHaveBeenLastCalledWith("C_1", ["row-c1-a", "row-c1-b"]);
    // The category conflict and the document conflict open the rows that make them conflicts, and the
    // reason — the two original values — is shown beside them.
    await press("Inspect conflicting");
    expect(onInspect).toHaveBeenLastCalledWith("C_1", ["row-c1-a", "row-c1-b"]);
    await press("Inspect conflicting document or item");
    expect(onInspect).toHaveBeenLastCalledWith("G_1", ["row-g1-a", "row-g1-b"]);
    expect(screen.getByText("Conflicting original rows: G_1")).toBeTruthy();
    expect(screen.getAllByText("Other").length).toBeGreaterThan(0);
    await press("Inspect missing item M_1");
    expect(onInspect).toHaveBeenLastCalledWith("M_1");
  });
});
