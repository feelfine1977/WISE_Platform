import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19ProfileAnswer, Bpic19ProfileRequest } from "../generated/bpic19-profile";
import fixture from "./profile-test-answer.json";
import { Bpic19Profile } from "./Bpic19Profile";
import { bpic19ProfileContract, type Bpic19ProfileClient, type Bpic19ProfileOutcome } from "./profile-client";

if (!bpic19ProfileContract.answer(fixture)) throw new Error("Invalid literal profile fixture");
const answer: Bpic19ProfileAnswer = fixture;
function responding(request: Bpic19ProfileRequest): Bpic19ProfileOutcome {
  return { ok: true, answer: { ...answer, request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, query: request.query,
    binding_state: request.query.roles === null ? "needs_review" : "reviewed", profile: request.query.roles === null ? null : answer.profile } };
}
function setup(client: Bpic19ProfileClient = { profile: vi.fn(async request => responding(request)) }) {
  const onKeep = vi.fn(), onInspect = vi.fn(), onCompare = vi.fn(), onReviewed = vi.fn(), onValidityChange = vi.fn();
  const props = { workspaceId: answer.workspace_id, identity: answer.identity, revision: 2, client, onKeep, onInspect, onCompare, onReviewed, onValidityChange };
  const view = render(<Bpic19Profile {...props} />);
  return { ...view, props, client, onKeep, onInspect, onCompare, onReviewed, onValidityChange, user: userEvent.setup() };
}

describe("the beginning purchasing-flow journey", () => {
  it("requires review of suggested fields, distinguishes four families and keeps all supplied histories", async () => {
    const { user, onKeep, onInspect, onReviewed } = setup();
    const review = await screen.findByRole("button", { name: "Review these field roles" });
    expect(screen.queryByText("Purchasing flow at PO-item grain")).toBeNull();
    await user.click(review);
    const table = await screen.findByRole("table", { name: "Purchasing flow at PO-item grain" });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(screen.getByText("11 PO items")).toBeTruthy();
    expect(screen.getByText(/1 documents contain items in several flows/)).toBeTruthy();
    await user.click(within(table).getByRole("button", { name: "Keep Consignment" }));
    expect(onKeep).toHaveBeenLastCalledWith({ kind: "case_id_in", case_ids: ["D2_1"], negate: false }, expect.objectContaining({
      source_identity: answer.identity, group: { kind: "flow", flow_id: "consignment" }, case_ids: ["D2_1"],
      definition: expect.objectContaining({ category_assignment: "supplied_exact_invariant_category" }),
    }));
    await user.click(within(table).getAllByRole("button", { name: "Inspect an item" })[0]);
    expect(onInspect).toHaveBeenCalledWith("D1_1");
    expect(onReviewed).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/before-GR permits either observed receipt order/i)).toBeTruthy();
  });

  it("compares Standard and Service inside the same retained flow with both recipes", async () => {
    const { user, onCompare } = setup();
    await user.click(await screen.findByRole("button", { name: "Review these field roles" }));
    await screen.findByRole("table", { name: /Item Type subgroups/ });
    await user.selectOptions(screen.getByRole("combobox", { name: "Target subtype" }), "1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Comparator subtype" }), "0");
    await user.click(screen.getByRole("button", { name: "Compare these subgroups" }));
    expect(onCompare).toHaveBeenLastCalledWith(expect.objectContaining({ caseIds: ["D4_1"], recipe: expect.objectContaining({ group: { kind: "flow_item_type", flow_id: "after_gr", state: "invariant", item_type_value: "Standard" } }) }),
      expect.objectContaining({ caseIds: ["D1_1"], recipe: expect.objectContaining({ group: { kind: "flow_item_type", flow_id: "after_gr", state: "invariant", item_type_value: "Service" } }) }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Comparator subtype" }), "1");
    expect(screen.getByRole("button", { name: "Compare these subgroups" }).hasAttribute("disabled")).toBe(true);
  });

  it("pauses old membership actions while field roles are an unreviewed draft", async () => {
    const { user, onKeep, onValidityChange } = setup();
    await user.click(await screen.findByRole("button", { name: "Review these field roles" }));
    const keep = await screen.findByRole("button", { name: "Keep Consignment" });
    await user.click(screen.getByText("Reviewed source field roles"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Purchasing flow (Item Category)" }), "4");
    expect(screen.getByText(/Field choices have changed/)).toBeTruthy();
    expect(keep.hasAttribute("disabled")).toBe(true);
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    await user.click(keep);
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("surfaces missing/changing/unrecognized and flag-disagreement witnesses without reassigning them", async () => {
    const { user, onInspect } = setup();
    await user.click(await screen.findByRole("button", { name: "Review these field roles" }));
    await user.click(await screen.findByRole("button", { name: "Inspect conflicting" }));
    expect(onInspect).toHaveBeenLastCalledWith("C_1");
    await user.click(screen.getByRole("button", { name: "Inspect unrecognized" }));
    expect(onInspect).toHaveBeenLastCalledWith("U_1");
    await user.click(screen.getByRole("button", { name: "Inspect flag disagreement" }));
    expect(onInspect).toHaveBeenLastCalledWith("F_1");
    expect(screen.getByText(/each parent item appears exactly once/)).toBeTruthy();
  });

  it("does not publish a cancelled old review after a new revision opens", async () => {
    let resolveReview: ((outcome: Bpic19ProfileOutcome) => void) | undefined;
    const client: Bpic19ProfileClient = { profile: vi.fn((request: Bpic19ProfileRequest): Promise<Bpic19ProfileOutcome> => request.query.roles !== null
      ? new Promise<Bpic19ProfileOutcome>(resolve => { resolveReview = resolve; }) : Promise.resolve(responding(request))) };
    const { user, props, rerender, onReviewed } = setup(client);
    await user.click(await screen.findByRole("button", { name: "Review these field roles" }));
    const old = vi.mocked(client.profile).mock.calls[1][0];
    rerender(<Bpic19Profile {...props} revision={3} />);
    await screen.findByRole("button", { name: "Review these field roles" });
    resolveReview?.(responding(old));
    expect(onReviewed).not.toHaveBeenCalled();
    expect(screen.queryByRole("table", { name: "Purchasing flow at PO-item grain" })).toBeNull();
  });

  it("shows a service failure and lets the analyst retry without fabricating an empty profile", async () => {
    let failed = false;
    const client: Bpic19ProfileClient = { profile: vi.fn(async (request: Bpic19ProfileRequest): Promise<Bpic19ProfileOutcome> => {
      if (!failed) { failed = true; return { ok: false, problem: { kind: "unreachable" } }; }
      return responding(request);
    }) };
    const { user } = setup(client);
    expect((await screen.findByRole("alert")).textContent).toContain("local service could not be reached");
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry source profile" }));
    expect(await screen.findByRole("button", { name: "Review these field roles" })).toBeTruthy();
  });
});
