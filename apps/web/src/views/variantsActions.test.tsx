import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SelectionPredicate } from "../generated/selection";
import type { StepPreview } from "../imported/coordinator";
import { stepWording, unevaluableReason } from "../map/wording";
import { identity, workspaceId } from "../test/imports";
import { variantIds, variantsAnswer } from "../test/views";
import { inventoryLine, Variants } from "./Variants";

const PROJECTION = "incident.activity.omit_missing_retain_raw_gaps.v1";
const answer = variantsAnswer({ schema_version: 1, message_type: "variants_request", request_id: "v", query_revision: 1, workspace_id: workspaceId, identity });

describe("#13 an actual variant inspected, previewed, applied or cancelled", () => {
  it("previews keeping a variant, cancels and applies by keyboard, and returns the focus to its button", async () => {
    const onStep = vi.fn<(step: SelectionPredicate) => void>();
    const previewer = vi.fn(async (): Promise<StepPreview> => ({ ok: true, parent: 5, kept: 2, removed: 2, unevaluable: 1, keptIds: ["K-1", "K-3"] }));
    render(<Variants state={{ phase: "ready", answer }} chosen={null} onChoose={() => undefined} onClear={() => undefined} onRetry={() => undefined} onStep={onStep} previewStep={previewer} />);
    const user = userEvent.setup();
    const preview = screen.getByRole("button", { name: "Preview keeping the 2 cases of variant 1" });
    preview.focus();
    await user.keyboard("{Enter}");
    const group = screen.getByRole("group", { name: "Variant 1 not yet applied" });
    expect((await within(group).findByText(/^Preview: would keep/)).textContent).toBe(
      "Preview: would keep 2 cases of 5 cases; 2 removed, 1 not evaluable. Nothing changes until the step is taken.");
    const step = { kind: "variant_is", variant: { id: variantIds[0], activities: ["Eröffnet", "Weitergeleitet", "Weitergeleitet", "Gelöst"], projection_policy: PROJECTION }, negate: false };
    expect(previewer).toHaveBeenCalledWith(step, expect.anything());
    await user.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Variant 1 not yet applied" })).toBeNull();
    expect(onStep).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Preview keeping the 2 cases of variant 1" })));
    await user.keyboard("{Enter}");
    within(screen.getByRole("group", { name: "Variant 1 not yet applied" })).getByRole("button", { name: "Apply" }).focus();
    await user.keyboard("{Enter}");
    expect(onStep).toHaveBeenCalledWith(step);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Preview keeping the 2 cases of variant 1" })));
    // Only a whole sequence is offered; the partial grammar is named as not available.
    expect(screen.getByText(/^Only a whole sequence can be kept here\./).textContent).toContain("wildcards, gaps and “not followed by” are not available");
  });

  it("keeps the empty sequence apart, and without a step to take only lists", () => {
    render(<Variants state={{ phase: "ready", answer }} chosen={null} onChoose={() => undefined} onClear={() => undefined} onRetry={() => undefined} />);
    expect(screen.queryByRole("button", { name: /^Preview keeping/ })).toBeNull();
    expect(screen.queryByText(/^Only a whole sequence/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^List the/ })).toHaveLength(3);
  });

  it("reconciles the variants shown, those not shown yet and the cases of unknown order", () => {
    const summary = answer.variants;
    expect(inventoryLine(summary, 3)).toBe("4 cases in 3 variants and 1 case with no known order: 5 cases counted exactly, none sampled.");
    expect(inventoryLine(summary, 1)).toBe("4 cases in 3 variants (2 variants with 2 cases not shown yet) and 1 case with no known order: 5 cases counted exactly, none sampled.");
  });

  it("names the exact sequence with its repeats, and why a case of unknown order is not evaluable for this step only", () => {
    const step = (activities: string[], negate = false): SelectionPredicate => ({ kind: "variant_is", variant: { id: variantIds[0], activities, projection_policy: PROJECTION }, negate });
    expect(stepWording(step(["Opened", "Assigned", "Assigned", "Resolved"]))).toBe("Keep cases whose complete sequence is exactly “Opened” → “Assigned” → “Assigned” → “Resolved”");
    expect(stepWording(step([], true))).toBe("Keep cases whose complete sequence is not exactly the empty sequence (no labelled record)");
    expect(unevaluableReason(step(["Opened"]))).toBe("the order of their records is not known, so they have no sequence; for other views and steps they stay evaluable");
  });
});
