import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Bpic19PreparedAssessment, BPIC19_PREPARED_ATTRIBUTES,
  type Bpic19PreparedAssessmentProps, type Bpic19PreparedAttribute, type Bpic19PreparedContext,
  type Bpic19PreparedDraft, type Bpic19PreparedDraftCell, type Bpic19PreparedNativeRun,
  type Bpic19PreparedOutcome, type Bpic19PreparedReviewIntent, type Bpic19PreparedReviewReceipt,
  type Bpic19PreparedRunIntent,
} from "./Bpic19PreparedAssessment";

// SYNTHETIC PRESENTATION FIXTURES ONLY. These literal values are not a native
// scoring oracle and make no claim about BPIC19 data, arithmetic or raw history.
const expectedAttributes = [
  "c_l1_invoice_present", "c_l1_clear_invoice_present", "c_l1_goods_or_ses_present",
  "c_l2_df1_invoice_after_goods", "c_l2_df2_release_after_goods", "c_l2_2way_no_goods_expected",
  "c_l2_consignment_no_clear_invoice", "c_l3_df1_goods_to_invoice_days", "c_l3_invoice_to_clear_days",
  "c_l3_df2_goods_to_rpb_days", "c_l3_df2_rpb_to_clear_days", "c_l4_goods_fragmentation",
  "c_l4_change_approval_repeats", "c_l4_repeated_invoice_receipt", "c_l4_change_payment_terms_repeats",
  "c_l5_cancel_invoice_receipt", "c_l5_cancel_goods_receipt", "c_l5_delete_item", "c_l5_debit_memo",
  "c_l5_credit_memo", "c_l6_change_price", "c_l6_change_quantity", "c_l6_high_exposure_memo",
  "c_l6_high_exposure_price_change", "c_l7_manual_touches", "c_l7_distinct_human_resources",
  "c_l7_total_events", "c_l7_manual_share", "c_l6_bal_networth_volatility",
] as const;
const labels = Object.fromEntries(expectedAttributes.map(attribute => [attribute, `Synthetic exact criterion: ${attribute}`])) as Record<Bpic19PreparedAttribute, string>;
const fixtureContext: Bpic19PreparedContext = { workspace_id: "fixture-workspace-A", source_context_id: "fixture-source-context-A", revision: 7 };
const originalSource = `source.v1:sha256:${"a".repeat(64)}`;
const originalRow = `row.v1:sha256:${"b".repeat(64)}`;
const firstAttribute = "c_l1_invoice_present";
const intervalAttribute = "c_l3_invoice_to_clear_days";
function available(value: string, unit = "event_occurrences"): Bpic19PreparedDraftCell {
  return { state: "available", value, reason: null, unit,
    provenance: { kind: "declared_prepared_measurement", declaration_ref: "fixture-declaration-A",
      assessment_row_refs: ["fixture-assessment-row-A"], original_row_refs: [{ source_id: originalSource, row_id: originalRow }] } };
}
function fixtureDraft(): Bpic19PreparedDraft {
  const measurements: Record<Bpic19PreparedAttribute, Bpic19PreparedDraftCell> = {
    c_l1_invoice_present: available("0"), c_l1_clear_invoice_present: available("1"), c_l1_goods_or_ses_present: available("2"),
    c_l2_df1_invoice_after_goods: available("1", "boolean_observation"), c_l2_df2_release_after_goods: available("0", "boolean_observation"),
    c_l2_2way_no_goods_expected: available("0"), c_l2_consignment_no_clear_invoice: available("0"),
    c_l3_df1_goods_to_invoice_days: available("2.5", "days"),
    c_l3_invoice_to_clear_days: { ...available("0", "days"), state: "unavailable", value: null, reason: "No declared invoice-to-clearing interval" },
    c_l3_df2_goods_to_rpb_days: available("1.25", "days"), c_l3_df2_rpb_to_clear_days: available("0", "days"),
    c_l4_goods_fragmentation: available("3"), c_l4_change_approval_repeats: available("1"), c_l4_repeated_invoice_receipt: available("2"),
    c_l4_change_payment_terms_repeats: available("0"), c_l5_cancel_invoice_receipt: available("0"), c_l5_cancel_goods_receipt: available("0"),
    c_l5_delete_item: available("0"), c_l5_debit_memo: available("0"), c_l5_credit_memo: available("0"),
    c_l6_change_price: available("1"), c_l6_change_quantity: available("0"), c_l6_high_exposure_memo: available("0.4", "normalized_proxy"),
    c_l6_high_exposure_price_change: available("0.3", "normalized_proxy"), c_l7_manual_touches: available("4", "resource_proxy_events"),
    c_l7_distinct_human_resources: available("2", "resource_proxy_identities"), c_l7_total_events: available("8"),
    c_l7_manual_share: available("0.5", "share_of_original_events"), c_l6_bal_networth_volatility: available("0.125", "coefficient_of_variation"),
  };
  const secondMeasurements = { ...measurements };
  for (const attribute of expectedAttributes) {
    const cell = measurements[attribute];
    secondMeasurements[attribute] = { ...cell, provenance: { ...cell.provenance,
      declaration_ref: "fixture-declaration-B", assessment_row_refs: ["fixture-assessment-row-B"], original_row_refs: [] } };
  }
  return { rows: [
    { assessment_item_id: "fixture-item-A", assessment_row_ref: "fixture-assessment-row-A", flow: "DF1", measurements },
    { assessment_item_id: "fixture-item-B", assessment_row_ref: "fixture-assessment-row-B", flow: "two_way",
      measurements: secondMeasurements },
  ] };
}
function receipt(intent: Bpic19PreparedReviewIntent, version: "A" | "B" = "A"): Bpic19PreparedReviewReceipt {
  return { context: intent.context, draft: intent.draft, review_id: `fixture-review-${version}`, input_id: `fixture-authoritative-input-${version}` };
}
function nativeRun(intent: Bpic19PreparedRunIntent): Bpic19PreparedNativeRun {
  return { context: intent.context, review_id: intent.review_id, input_id: intent.input_id, view: intent.view,
    run_id: "fixture-native-run-A", definition_id: "fixture-native-definition-A",
    scope: { state: "in_scope", label: "Synthetic declared assessment scope", reason: null },
    totals: [
      { label: "Synthetic supplied total", state: "available", value: 37.125, reason: null, unit: "fixture_native_points", provenance: "fixture-native-total-provenance", references: ["fixture-native-total-ref"] },
      { label: "Synthetic zero support", state: "available", value: 0, reason: null, unit: "declared_items", provenance: "fixture-native-support", references: [] },
      { label: "Synthetic unavailable total", state: "unavailable", value: null, reason: "Native total unavailable in fixture", unit: "fixture_native_points", provenance: "fixture-native-unavailability", references: [] },
    ],
    contributions: [
      { assessment_item_id: "fixture-item-A", attribute: firstAttribute, scope: { state: "in_scope", label: "Synthetic criterion scope", reason: null },
        measurement: { label: "Synthetic measurement", state: "available", value: 0, reason: null, unit: "event_occurrences", provenance: "fixture-native-cell-provenance", references: ["fixture-assessment-row-A"] },
        contribution: { label: "Synthetic contribution", state: "available", value: -9.75, reason: null, unit: "fixture_native_points", provenance: "fixture-native-contribution", references: ["fixture-native-contribution-ref"] } },
      { assessment_item_id: "fixture-item-A", attribute: intervalAttribute, scope: { state: "out_of_scope", label: "Synthetic excluded criterion", reason: "Native scope reason from fixture" },
        measurement: { label: "Synthetic missing interval", state: "unavailable", value: null, reason: "Native interval unavailable", unit: "days", provenance: "fixture-native-interval", references: [] },
        contribution: { label: "Synthetic excluded contribution", state: "unavailable", value: null, reason: "Native contribution out of scope", unit: "fixture_native_points", provenance: "fixture-native-scope", references: [] } },
    ],
  };
}
const success = <T,>(value: T): Bpic19PreparedOutcome<T> => ({ status: "success", value });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<Bpic19PreparedAssessmentProps> = {}) {
  const props: Bpic19PreparedAssessmentProps = {
    context: fixtureContext, input: { status: "ready", draft: fixtureDraft() }, criterionLabels: labels,
    onReview: vi.fn<Bpic19PreparedAssessmentProps["onReview"]>(async intent => success(receipt(intent))),
    onRun: vi.fn<Bpic19PreparedAssessmentProps["onRun"]>(async intent => success(nativeRun(intent))),
    onDraftChange: vi.fn(), onRetain: vi.fn(), ...overrides,
  };
  return { ...render(<Bpic19PreparedAssessment {...props} />), props, user: userEvent.setup() };
}
const reviewButton = () => screen.getByRole("button", { name: "Review declared measurements" });
const runButton = () => screen.getByRole("button", { name: /^Run .* assessment$/ });
const retainButton = () => screen.getByRole("button", { name: "Request retain of fixture-native-run-A" });
const valueInput = () => screen.getByRole("textbox", { name: `Value for ${firstAttribute}` });
const grid = () => screen.getByRole("table", { name: /^Declared prepared attributes for/ });
async function reviewNow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(reviewButton());
  await screen.findByText("Authoritative review received. Choose a view and request Run.");
}
function detailsFor(attribute: Bpic19PreparedAttribute) {
  return screen.getByText(`Declared measurement evidence details for ${attribute}`);
}

describe("Declared measurement assessment presentation", () => {
  it("shows all 29 exact supplied criteria and attributes for each selected declared item, without raw actions", async () => {
    const { props, user } = setup();
    expect(BPIC19_PREPARED_ATTRIBUTES).toEqual(expectedAttributes);
    expect(screen.getByRole("heading", { name: "Declared measurement assessment" })).toBeTruthy();
    expect(screen.getByText(/These rows are not raw records or event histories/)).toBeTruthy();
    expect(within(grid()).getAllByRole("row")).toHaveLength(30);
    for (const attribute of expectedAttributes) {
      expect(within(grid()).getByRole("rowheader", { name: `${labels[attribute]} ${attribute}` })).toBeTruthy();
    }
    expect(runButton().hasAttribute("disabled")).toBe(true);
    expect(props.onReview).not.toHaveBeenCalled(); expect(props.onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Keep|Inspect/ })).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Declared assessment item" }), "fixture-item-B");
    expect(screen.getByRole("table", { name: "Declared prepared attributes for fixture-item-B" })).toBeTruthy();
    expect(within(grid()).getAllByRole("row")).toHaveLength(30);
    expect((screen.getByRole("combobox", { name: "Declared flow" }) as HTMLSelectElement).value).toBe("two_way");
    expect(props.onDraftChange).not.toHaveBeenCalled();
  });

  it("keeps numeric known zero distinct from unavailable and displays supplied units and declared provenance", () => {
    setup();
    const zero = within(grid()).getByRole("row", { name: new RegExp(`^${labels[firstAttribute]}`) });
    expect(within(zero).getByText("Declared value: 0")).toBeTruthy();
    expect((within(zero).getByRole("textbox", { name: `Value for ${firstAttribute}` }) as HTMLInputElement).value).toBe("0");
    expect(within(zero).getByRole("cell", { name: "event_occurrences" })).toBeTruthy();
    const missing = within(grid()).getByRole("row", { name: new RegExp(`^${labels[intervalAttribute]}`) });
    expect(within(missing).getByText("Unavailable: No declared invoice-to-clearing interval")).toBeTruthy();
    expect(within(missing).queryByRole("textbox", { name: `Value for ${intervalAttribute}` })).toBeNull();
    expect(within(missing).getByRole("cell", { name: "days" })).toBeTruthy();
    expect(within(zero).getByText("fixture-declaration-A")).toBeTruthy();
    expect(within(zero).getByText("Assessment references: fixture-assessment-row-A")).toBeTruthy();
    expect(within(zero).getByText("Unverified original-reference declarations: 1")).toBeTruthy();
    for (const unit of ["boolean_observation", "normalized_proxy", "resource_proxy_events", "resource_proxy_identities", "share_of_original_events", "coefficient_of_variation"]) {
      expect(within(grid()).getAllByRole("cell", { name: unit }).length).toBeGreaterThan(0);
    }
  });

  it("opens keyboard-operable evidence details with assessment and unverified original references kept separate", async () => {
    const { user } = setup();
    const summary = detailsFor(firstAttribute);
    summary.focus(); expect(document.activeElement).toBe(summary);
    await user.keyboard("{Enter}");
    const disclosure = summary.closest("details")!;
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByText(/Declarations do not establish raw history qualification/)).toBeTruthy();
    expect((within(disclosure).getByRole("textbox", { name: `Assessment row references for ${firstAttribute}` }) as HTMLTextAreaElement).value).toBe("fixture-assessment-row-A");
    const original = within(disclosure).getByRole("group", { name: "Unverified original-reference declarations" });
    expect(within(original).getByText(/assert neither source presence nor a verified raw witness/)).toBeTruthy();
    expect((within(original).getByRole("textbox", { name: `Unverified source 1 for ${firstAttribute}` }) as HTMLInputElement).value).toBe(originalSource);
    expect((within(original).getByRole("textbox", { name: `Unverified original row 1 for ${firstAttribute}` }) as HTMLInputElement).value).toBe(originalRow);
    expect(within(original).queryByRole("textbox", { name: `Assessment row references for ${firstAttribute}` })).toBeNull();
    await user.keyboard(" "); expect(disclosure.open).toBe(false);
  });

  it("emits the edited draft for explicit Review, then uses only the exact authoritative identity in a typed Run", async () => {
    const { props, user } = setup();
    fireEvent.change(valueInput(), { target: { value: "12.75" } });
    await user.selectOptions(screen.getByRole("combobox", { name: "Declared flow" }), "DF2");
    await user.click(detailsFor(firstAttribute));
    fireEvent.change(screen.getByRole("textbox", { name: `Declaration reference for ${firstAttribute}` }), { target: { value: "edited-fixture-declaration" } });
    expect(props.onReview).not.toHaveBeenCalled(); expect(runButton().hasAttribute("disabled")).toBe(true);
    await reviewNow(user);
    const [intent, signal] = vi.mocked(props.onReview).mock.calls[0];
    expect(intent.kind).toBe("review_declared_measurements"); expect(intent.context).toEqual(fixtureContext);
    expect(intent.draft.rows[0].flow).toBe("DF2");
    expect(intent.draft.rows[0].measurements[firstAttribute]).toMatchObject({ value: "12.75", provenance: { declaration_ref: "edited-fixture-declaration" } });
    expect(signal.aborted).toBe(false); expect(props.onDraftChange).toHaveBeenLastCalledWith(intent.draft);
    await user.click(runButton());
    expect(props.onRun).toHaveBeenCalledWith({ kind: "run_declared_measurements", context: fixtureContext,
      review_id: "fixture-review-A", input_id: "fixture-authoritative-input-A", view: "Finance" }, expect.any(AbortSignal));
    expect(screen.getByRole("heading", { name: "Current supplied native result · Finance" })).toBeTruthy();
  });

  it.each(["Finance", "Logistics", "Compliance", "Automation"] as const)("selects and explicitly runs %s with one exact reviewed input", async view => {
    const { props, user } = setup();
    await reviewNow(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Assessment view" }), view);
    expect(props.onRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: `Run ${view} assessment` }));
    expect(vi.mocked(props.onRun).mock.calls[0][0]).toEqual({ kind: "run_declared_measurements", context: fixtureContext,
      review_id: "fixture-review-A", input_id: "fixture-authoritative-input-A", view });
    expect(props.onReview).toHaveBeenCalledTimes(1);
  });

  it("never turns a blank numeric draft or a switch from unavailable into known zero or local review success", async () => {
    const onReview = vi.fn<Bpic19PreparedAssessmentProps["onReview"]>(async () => ({ status: "error", message: "Fixture authority rejected incomplete numeric draft" }));
    const { user } = setup({ onReview });
    fireEvent.change(valueInput(), { target: { value: "" } });
    expect((valueInput() as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Numeric draft incomplete — Review required")).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: `Availability for ${intervalAttribute}` }), "available");
    expect((screen.getByRole("textbox", { name: `Value for ${intervalAttribute}` }) as HTMLInputElement).value).toBe("");
    await user.click(reviewButton());
    expect(screen.getByRole("alert").textContent).toBe("Fixture authority rejected incomplete numeric draft");
    expect(runButton().hasAttribute("disabled")).toBe(true);
    expect(onReview.mock.calls[0][0].draft.rows[0].measurements[firstAttribute].value).toBe("");
  });

  it.each(["value", "flow", "availability", "reason", "declaration", "assessment references", "original source", "original row"] as const)("revokes authority on a meaning-bearing %s edit", async field => {
    const { user } = setup();
    await reviewNow(user); await user.click(runButton());
    expect(retainButton().hasAttribute("disabled")).toBe(false);
    if (["declaration", "assessment references", "original source", "original row"].includes(field)) await user.click(detailsFor(firstAttribute));
    switch (field) {
      case "value": fireEvent.change(valueInput(), { target: { value: "9" } }); break;
      case "flow": await user.selectOptions(screen.getByRole("combobox", { name: "Declared flow" }), "Consignment"); break;
      case "availability": await user.selectOptions(screen.getByRole("combobox", { name: `Availability for ${firstAttribute}` }), "unavailable"); break;
      case "reason": fireEvent.change(screen.getByRole("textbox", { name: `Unavailable reason for ${intervalAttribute}` }), { target: { value: "Edited declared reason" } }); break;
      case "declaration": fireEvent.change(screen.getByRole("textbox", { name: `Declaration reference for ${firstAttribute}` }), { target: { value: "changed-declaration" } }); break;
      case "assessment references": fireEvent.change(screen.getByRole("textbox", { name: `Assessment row references for ${firstAttribute}` }), { target: { value: "fixture-assessment-row-A\nfixture-assessment-row-B" } }); break;
      case "original source": fireEvent.change(screen.getByRole("textbox", { name: `Unverified source 1 for ${firstAttribute}` }), { target: { value: "edited-unverified-source" } }); break;
      case "original row": fireEvent.change(screen.getByRole("textbox", { name: `Unverified original row 1 for ${firstAttribute}` }), { target: { value: "edited-unverified-row" } }); break;
    }
    expect(runButton().hasAttribute("disabled")).toBe(true); expect(retainButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("heading", { name: "Retained/stale supplied native result · Finance" })).toBeTruthy();
  });

  it("does not revive authority when text is reverted or a superseding Review fails", async () => {
    const { props, user } = setup();
    await reviewNow(user); await user.click(runButton());
    fireEvent.change(valueInput(), { target: { value: "8" } }); fireEvent.change(valueInput(), { target: { value: "0" } });
    expect(screen.getByText(/Draft matches the supplied input/)).toBeTruthy();
    expect(runButton().hasAttribute("disabled")).toBe(true); expect(retainButton().hasAttribute("disabled")).toBe(true);
    await reviewNow(user);
    vi.mocked(props.onReview).mockResolvedValueOnce({ status: "error", message: "Superseding fixture review refused" });
    await user.click(reviewButton());
    expect(screen.getByRole("alert").textContent).toContain("Superseding fixture review refused");
    expect(runButton().hasAttribute("disabled")).toBe(true); expect(retainButton().hasAttribute("disabled")).toBe(true);
  });

  it("cancels a superseding review, aborts its signal, and suppresses its later authoritative receipt", async () => {
    const pending = deferred<Bpic19PreparedOutcome<Bpic19PreparedReviewReceipt>>();
    const { props, user } = setup();
    await reviewNow(user); await user.click(runButton());
    vi.mocked(props.onReview).mockImplementationOnce(() => pending.promise);
    await user.click(reviewButton());
    const [oldIntent, oldSignal] = vi.mocked(props.onReview).mock.calls[1];
    expect(runButton().hasAttribute("disabled")).toBe(true); expect(retainButton().hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel review" }));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { pending.resolve(success(receipt(oldIntent, "B"))); });
    expect(screen.getByRole("status").textContent).toContain("Request cancelled");
    expect(runButton().hasAttribute("disabled")).toBe(true); expect(retainButton().hasAttribute("disabled")).toBe(true);
  });

  it.each(["cancelled", "rejected"] as const)("keeps Run disabled after an authoritative review is %s", async outcome => {
    const { props, user } = setup();
    if (outcome === "cancelled") vi.mocked(props.onReview).mockResolvedValueOnce({ status: "cancelled" });
    else vi.mocked(props.onReview).mockRejectedValueOnce(new Error("fixture callback failure"));
    await user.click(reviewButton());
    expect(runButton().hasAttribute("disabled")).toBe(true);
    if (outcome === "cancelled") expect(screen.getByRole("status").textContent).toContain("Review cancelled");
    else expect(screen.getByRole("alert").textContent).toContain("Review failed");
  });

  it.each(["draft", "source", "workspace"] as const)("does not adopt a supplied authoritative review for another %s", async mismatch => {
    const { props, user } = setup();
    vi.mocked(props.onReview).mockImplementationOnce(async intent => {
      const supplied = receipt(intent);
      return success(mismatch === "draft" ? { ...supplied, draft: { rows: [] } } : {
        ...supplied, context: { ...intent.context, [mismatch === "source" ? "source_context_id" : "workspace_id"]: "fixture-other-context" },
      });
    });
    await user.click(reviewButton());
    expect(screen.getByRole("alert").textContent).toContain("does not match this draft and context");
    expect(runButton().hasAttribute("disabled")).toBe(true);
  });

  it.each(["source", "workspace", "revision", "input"] as const)("invalidates a current review/run immediately after a supplied %s change, including change back", async field => {
    const { props, user, rerender } = setup();
    await reviewNow(user); await user.click(runButton());
    const result = nativeRun(vi.mocked(props.onRun).mock.calls[0][0]);
    const nextContext = { ...props.context, ...(field === "source" ? { source_context_id: "fixture-source-B" } :
      field === "workspace" ? { workspace_id: "fixture-workspace-B" } : field === "revision" ? { revision: 8 } : {}) };
    const nextDraft = fixtureDraft();
    const changedInput: Bpic19PreparedDraft = { rows: nextDraft.rows.map(row => ({ ...row, flow: "DF2" })) };
    rerender(<Bpic19PreparedAssessment {...props} context={nextContext} nativeRun={result}
      input={field === "input" ? { status: "ready", draft: changedInput } : props.input} />);
    expect(runButton().hasAttribute("disabled")).toBe(true); expect(retainButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("heading", { name: "Retained/stale supplied native result · Finance" })).toBeTruthy();
    rerender(<Bpic19PreparedAssessment {...props} nativeRun={result} />);
    expect(runButton().hasAttribute("disabled")).toBe(true); expect(retainButton().hasAttribute("disabled")).toBe(true);
  });

  it.each([
    ["review", "resolve", "draft"], ["review", "reject", "draft"],
    ["review", "resolve", "source"], ["review", "reject", "workspace"],
    ["run", "resolve", "draft"], ["run", "reject", "draft"],
    ["run", "resolve", "source"], ["run", "reject", "workspace"],
  ] as const)("fences an actual old %s callback that later %ss after a newer %s and successful review", async (operation, delivery, change) => {
    const { props, user, rerender } = setup();
    const oldReview = deferred<Bpic19PreparedOutcome<Bpic19PreparedReviewReceipt>>();
    const oldRun = deferred<Bpic19PreparedOutcome<Bpic19PreparedNativeRun>>();
    if (operation === "review") vi.mocked(props.onReview).mockImplementationOnce(() => oldReview.promise);
    else { await reviewNow(user); vi.mocked(props.onRun).mockImplementationOnce(() => oldRun.promise); }
    await user.click(operation === "review" ? reviewButton() : runButton());
    const oldReviewCall = vi.mocked(props.onReview).mock.calls[0];
    const oldRunCall = vi.mocked(props.onRun).mock.calls[0];
    const oldSignal = operation === "review" ? oldReviewCall[1] : oldRunCall[1];
    if (change === "draft") fireEvent.change(valueInput(), { target: { value: "21" } });
    else rerender(<Bpic19PreparedAssessment {...props} context={{ ...props.context,
      ...(change === "source" ? { source_context_id: "fixture-source-new" } : { workspace_id: "fixture-workspace-new" }) }} />);
    expect(oldSignal.aborted).toBe(true); expect(runButton().hasAttribute("disabled")).toBe(true);
    vi.mocked(props.onReview).mockImplementationOnce(async intent => success(receipt(intent, "B")));
    await reviewNow(user);
    await act(async () => {
      if (operation === "review") {
        if (delivery === "resolve") oldReview.resolve(success(receipt(oldReviewCall[0])));
        else oldReview.reject(new Error("old review rejected after newer context"));
      } else {
        if (delivery === "resolve") oldRun.resolve(success(nativeRun(oldRunCall[0])));
        else oldRun.reject(new Error("old native run rejected after newer context"));
      }
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Authoritative review received");
    expect(screen.getByText("fixture-authoritative-input-B")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /supplied native result/ })).toBeNull();
    expect(runButton().hasAttribute("disabled")).toBe(false);
    await user.click(runButton());
    expect(vi.mocked(props.onRun).mock.lastCall?.[0].input_id).toBe("fixture-authoritative-input-B");
  });

  it.each([["review", "resolve"], ["review", "reject"], ["run", "resolve"], ["run", "reject"]] as const)(
    "cannot publish an old %s callback that later %ss while the newer draft remains unreviewed", async (operation, delivery) => {
      const { props, user } = setup();
      const oldReview = deferred<Bpic19PreparedOutcome<Bpic19PreparedReviewReceipt>>();
      const oldRun = deferred<Bpic19PreparedOutcome<Bpic19PreparedNativeRun>>();
      if (operation === "review") vi.mocked(props.onReview).mockImplementationOnce(() => oldReview.promise);
      else { await reviewNow(user); vi.mocked(props.onRun).mockImplementationOnce(() => oldRun.promise); }
      await user.click(operation === "review" ? reviewButton() : runButton());
      const reviewIntent = vi.mocked(props.onReview).mock.calls[0][0];
      const runIntent = vi.mocked(props.onRun).mock.calls[0]?.[0];
      fireEvent.change(valueInput(), { target: { value: "6" } });
      await act(async () => {
        if (operation === "review") {
          if (delivery === "resolve") oldReview.resolve(success(receipt(reviewIntent)));
          else oldReview.reject(new Error("old review rejected after unreviewed edit"));
        } else {
          if (delivery === "resolve") oldRun.resolve(success(nativeRun(runIntent!)));
          else oldRun.reject(new Error("old run rejected after unreviewed edit"));
        }
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("status").textContent).toContain("Draft changed. Review required");
      expect(screen.queryByRole("heading", { name: /supplied native result/ })).toBeNull();
      expect(runButton().hasAttribute("disabled")).toBe(true);
      expect(screen.queryByText("fixture-authoritative-input-A")).toBeNull();
    },
  );

  it("keeps a previous run stale after a successful superseding review of the same draft", async () => {
    const { props, user } = setup();
    await reviewNow(user); await user.click(runButton());
    vi.mocked(props.onReview).mockImplementationOnce(async intent => success(receipt(intent, "B")));
    await reviewNow(user);
    expect(screen.getByRole("heading", { name: "Retained/stale supplied native result · Finance" })).toBeTruthy();
    expect(retainButton().hasAttribute("disabled")).toBe(true);
    expect(runButton().hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("fixture-authoritative-input-B")).toBeTruthy();
  });

  it("shows supplied native totals, scope, identities, units, provenance and signed contributions without recomputation", async () => {
    const { props, user } = setup();
    await reviewNow(user); await user.click(runButton());
    const section = screen.getByRole("region", { name: "Supplied native run fixture-native-run-A" });
    for (const identity of ["fixture-native-run-A", "fixture-native-definition-A", "fixture-authoritative-input-A", "fixture-review-A"]) {
      expect(within(section).getByText(identity)).toBeTruthy();
    }
    expect(within(section).getByText("37.125 fixture_native_points")).toBeTruthy();
    expect(within(section).getByText("0 declared_items")).toBeTruthy();
    expect(within(section).getByText("Unavailable: Native total unavailable in fixture")).toBeTruthy();
    expect(within(section).getByText("Supplied provenance: fixture-native-total-provenance")).toBeTruthy();
    expect(within(section).getByText("Supplied references: fixture-native-total-ref")).toBeTruthy();
    const table = within(section).getByRole("table", { name: "Supplied native contributions · fixture-native-run-A" });
    expect(within(table).getByText("-9.75 fixture_native_points")).toBeTruthy();
    expect(within(table).getByText("Synthetic excluded criterion · out of scope")).toBeTruthy();
    expect(within(table).getByText("Native scope reason from fixture")).toBeTruthy();
    expect(within(table).getByText("Unavailable: Native interval unavailable")).toBeTruthy();
    await user.click(retainButton());
    expect(props.onRetain).toHaveBeenCalledWith({ kind: "retain_declared_measurements", context: fixtureContext,
      review_id: "fixture-review-A", input_id: "fixture-authoritative-input-A", run_id: "fixture-native-run-A",
      definition_id: "fixture-native-definition-A", view: "Finance" });
    expect(screen.getByRole("status").textContent).toContain("Retain intent emitted");
  });

  it.each(["input", "review", "source", "workspace", "view"] as const)("displays a supplied run with a mismatched %s as stale and blocks retain", async mismatch => {
    const { props, user, rerender } = setup();
    await reviewNow(user);
    const result = nativeRun({ kind: "run_declared_measurements", context: fixtureContext,
      review_id: "fixture-review-A", input_id: "fixture-authoritative-input-A", view: "Finance" });
    const stale = { ...result, ...(mismatch === "input" ? { input_id: "other-input" } :
      mismatch === "review" ? { review_id: "older-review" } : mismatch === "view" ? { view: "Automation" as const } :
        { context: { ...result.context, [mismatch === "source" ? "source_context_id" : "workspace_id"]: "other-context" } }) };
    rerender(<Bpic19PreparedAssessment {...props} nativeRun={stale} />);
    expect(screen.getByRole("heading", { name: /^Retained\/stale supplied native result/ })).toBeTruthy();
    expect(retainButton().hasAttribute("disabled")).toBe(true);
    await user.click(retainButton()); expect(props.onRetain).not.toHaveBeenCalled();
  });

  it("enables retain for an exact current supplied run and pauses it during a superseding review", async () => {
    const { props, user, rerender } = setup();
    const supplied = nativeRun({ kind: "run_declared_measurements", context: fixtureContext,
      review_id: "fixture-review-A", input_id: "fixture-authoritative-input-A", view: "Finance" });
    rerender(<Bpic19PreparedAssessment {...props} nativeRun={supplied} />);
    expect(retainButton().hasAttribute("disabled")).toBe(true);
    await reviewNow(user); expect(retainButton().hasAttribute("disabled")).toBe(false);
    await user.selectOptions(screen.getByRole("combobox", { name: "Assessment view" }), "Logistics");
    expect(retainButton().hasAttribute("disabled")).toBe(true);
    await user.selectOptions(screen.getByRole("combobox", { name: "Assessment view" }), "Finance");
    expect(retainButton().hasAttribute("disabled")).toBe(false);
    const newer = deferred<Bpic19PreparedOutcome<Bpic19PreparedReviewReceipt>>();
    vi.mocked(props.onReview).mockImplementationOnce(() => newer.promise);
    await user.click(reviewButton()); expect(retainButton().hasAttribute("disabled")).toBe(true);
    newer.resolve({ status: "cancelled" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Review cancelled"));
    expect(retainButton().hasAttribute("disabled")).toBe(true);
  });

  it("refuses a mismatched callback result and reports native failure without manufacturing a result", async () => {
    const { props, user } = setup();
    await reviewNow(user);
    vi.mocked(props.onRun).mockImplementationOnce(async intent => success({ ...nativeRun(intent), input_id: "wrong-input" }));
    await user.click(runButton());
    expect(screen.getByRole("alert").textContent).toContain("another review, input, context or view");
    expect(screen.queryByRole("heading", { name: /supplied native result/ })).toBeNull();
    vi.mocked(props.onRun).mockRejectedValueOnce(new Error("fixture native failure"));
    await user.click(runButton());
    expect(screen.getByRole("alert").textContent).toContain("Native assessment failed");
    expect(screen.queryByRole("heading", { name: /supplied native result/ })).toBeNull();
  });

  it("cancels a pending native run when switching view and ignores its eventual success", async () => {
    const { props, user } = setup();
    await reviewNow(user);
    const pending = deferred<Bpic19PreparedOutcome<Bpic19PreparedNativeRun>>();
    vi.mocked(props.onRun).mockImplementationOnce(() => pending.promise);
    await user.click(runButton());
    const [oldIntent, oldSignal] = vi.mocked(props.onRun).mock.calls[0];
    expect(screen.getByRole("status").textContent).toContain("Native Finance assessment pending");
    await user.selectOptions(screen.getByRole("combobox", { name: "Assessment view" }), "Automation");
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { pending.resolve(success(nativeRun(oldIntent))); });
    expect(screen.queryByRole("heading", { name: /supplied native result/ })).toBeNull();
    expect(runButton().hasAttribute("disabled")).toBe(false);
    await user.click(runButton());
    expect(screen.getByRole("heading", { name: "Current supplied native result · Automation" })).toBeTruthy();
  });

  it("provides explicit loading, error, empty-input and empty-output states without actions claiming success", async () => {
    const { props, user, rerender } = setup({ input: { status: "loading" } });
    expect(screen.getByRole("status").textContent).toContain("Loading declared measurement draft");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Bpic19PreparedAssessment {...props} input={{ status: "error", message: "Fixture draft load failed" }} />);
    expect(screen.getByRole("alert").textContent).toContain("Fixture draft load failed");
    rerender(<Bpic19PreparedAssessment {...props} input={{ status: "ready", draft: { rows: [] } }} />);
    expect(screen.getByText(/No declared assessment items supplied/)).toBeTruthy();
    expect(reviewButton().hasAttribute("disabled")).toBe(true); expect(runButton().hasAttribute("disabled")).toBe(true);
    rerender(<Bpic19PreparedAssessment {...props} input={{ status: "ready", draft: fixtureDraft() }} onRetain={undefined} />);
    await reviewNow(user);
    vi.mocked(props.onRun).mockImplementationOnce(async intent => success({ ...nativeRun(intent), totals: [], contributions: [] }));
    await user.click(runButton());
    expect(screen.getByText("No native totals supplied.")).toBeTruthy();
    expect(screen.getByText("No native contributions supplied.")).toBeTruthy();
    expect(screen.getByText("Retain action unavailable: no retain handler supplied.")).toBeTruthy();
  });
});
