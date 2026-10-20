import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SelectionPredicate } from "../generated/selection";
import { lagStep, PathLagControl } from "./PathLagControl";
import { stepWording, unevaluableReason } from "./wording";

// #90: keep the incidents that pass a path with a lag in a range, from the card of the selected path.
function start(previewed = true) {
  const onStep = vi.fn<(step: SelectionPredicate) => void>();
  const previewStep = vi.fn(async () => ({ ok: true as const, kept: 3, removed: 4, unevaluable: 1, parent: 8 }));
  render(<PathLagControl source="A" target="B" medianLagHours={720} onStep={onStep} previewStep={previewed ? (previewStep as never) : undefined} />);
  return { onStep, previewStep, user: userEvent.setup() };
}

const entered = { low: "", lowIncluded: false, high: "", highIncluded: true, unit: "hours" as const, every: false };

describe("a step on the lag of a path", () => {
  it("takes a bound from the path's median lag, previews the step in words with its counts, and takes it on request", async () => {
    const { onStep, user } = start();
    expect(screen.getByText(/the path's median lag is 720 hours \(30 days\)/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Slower than the median lag" }));
    expect((screen.getByLabelText("Lower bound (hours; empty for none)") as HTMLInputElement).value).toBe("720");
    await user.click(screen.getByRole("button", { name: "Keep by this lag" }));
    const pending = screen.getByRole("group", { name: "Lag step not yet taken" });
    expect(within(pending).getByText("Keep incidents with at least one passage from “A” to “B” taking more than 720 hours (30 days)")).toBeTruthy();
    expect((await within(pending).findByText(/^Preview: would keep 3 incidents of 8 incidents; 4 removed, 1 not evaluable\./))).toBeTruthy();
    expect(onStep).not.toHaveBeenCalled();
    await user.click(within(pending).getByRole("button", { name: "Take this step" }));
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "path_lag_in_range", source_activity: "A", target_activity: "B", minimum_hours: 720, minimum_inclusive: false,
      maximum_hours: null, maximum_inclusive: false, passages: "at_least_one", negate: false });
  });

  it("takes typed bounds in days, each included as stated, for every passage, and removes by them", async () => {
    const { onStep, user } = start(false);
    await user.selectOptions(screen.getByLabelText("Unit"), "days");
    await user.type(screen.getByLabelText("Lower bound (days; empty for none)"), "1");
    await user.click(screen.getByLabelText("Lower bound included"));
    await user.type(screen.getByLabelText("Upper bound (days; empty for none)"), "30");
    await user.click(screen.getByLabelText("Upper bound included"));
    await user.click(screen.getByLabelText(/^Every passage of an incident in the range/));
    await user.click(screen.getByRole("button", { name: "Remove by this lag" }));
    expect(onStep).toHaveBeenCalledExactlyOnceWith({ kind: "path_lag_in_range", source_activity: "A", target_activity: "B", minimum_hours: 24, minimum_inclusive: true,
      maximum_hours: 720, maximum_inclusive: false, passages: "every", negate: true });
  });

  it("refuses bounds that are no range, applying nothing", async () => {
    const { onStep, user } = start(false);
    await user.click(screen.getByRole("button", { name: "Keep by this lag" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter at least one bound of the lag. Nothing was applied.");
    expect(lagStep("A", "B", { ...entered, low: "5", high: "5", highIncluded: false }, false)).toBe(
      "The range is empty: the upper bound is below the lower bound, or equal to it and not included. Nothing was applied.");
    expect(lagStep("A", "B", { ...entered, low: "-2" }, false)).toBe("Enter each bound as a finite number of hours, zero or more. Nothing was applied.");
    expect(onStep).not.toHaveBeenCalled();
  });

  it("reads every form of the step in words, with its pair and its bounds", () => {
    const step = (changes: Partial<Extract<SelectionPredicate, { kind: "path_lag_in_range" }>>) => ({
      kind: "path_lag_in_range", source_activity: "A", target_activity: "B", minimum_hours: null, minimum_inclusive: false, maximum_hours: null,
      maximum_inclusive: false, passages: "at_least_one", negate: false, ...changes }) as SelectionPredicate;
    expect([
      stepWording(step({ minimum_hours: 720, minimum_inclusive: true })),
      stepWording(step({ maximum_hours: 10, maximum_inclusive: true })),
      stepWording(step({ minimum_hours: 0, maximum_hours: 1, maximum_inclusive: false })),
      stepWording(step({ minimum_hours: 720, passages: "every" })),
      stepWording(step({ minimum_hours: 720, negate: true })),
      stepWording(step({ minimum_hours: 720, minimum_inclusive: true, passages: "every", negate: true })),
    ]).toEqual([
      "Keep incidents with at least one passage from “A” to “B” taking at least 720 hours (30 days)",
      "Keep incidents with at least one passage from “A” to “B” taking at most 10 hours",
      "Keep incidents with at least one passage from “A” to “B” taking more than 0 hours and less than 1 hour",
      "Keep incidents that pass from “A” to “B” with every passage taking more than 720 hours (30 days)",
      "Keep incidents with no passage from “A” to “B” taking more than 720 hours (30 days)",
      "Keep incidents that never pass from “A” to “B”, or have a passage of it that does not take at least 720 hours (30 days)",
    ]);
    expect(unevaluableReason(step({ minimum_hours: 1 }))).toBe("the order of their records is not known, so their passages and their lags are not known");
  });
});
