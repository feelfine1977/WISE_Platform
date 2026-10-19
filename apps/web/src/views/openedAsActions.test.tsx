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
  it("keeps the incidents first recorded with chosen values, missing apart from the text Unknown, by keyboard", async () => {
    const onStep = vi.fn<(step: SelectionPredicate) => void>();
    render(<OpenedAs state={{ phase: "ready", answer: answer() }} onRetry={() => undefined} onStep={onStep} />);
    const user = userEvent.setup();
    const missing = screen.getByRole("checkbox", { name: "Choose not recorded" });
    missing.focus();
    await user.keyboard(" ");
    await user.click(screen.getByRole("button", { name: "Keep incidents first recorded with these values" }));
    expect(onStep).toHaveBeenLastCalledWith({ kind: "opening_attribute_in", column_index: 3, values: [null], negate: false, anchor_policy: ANCHOR });
    // Two values chosen together are alternatives: the text Unknown and a missing value are both named, apart.
    await user.click(screen.getByRole("checkbox", { name: "Choose Unknown" }));
    await user.click(screen.getByRole("checkbox", { name: "Choose not recorded" }));
    expect(screen.getByText(/^Chosen: Unknown or not recorded\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep incidents first recorded with these values" }));
    expect(onStep).toHaveBeenLastCalledWith({ kind: "opening_attribute_in", column_index: 3, values: ["Unknown", null], negate: false, anchor_policy: ANCHOR });
    // The remainder stands for several values: nothing can be chosen from it.
    const priority = screen.getByRole("list", { name: "Opening values of Priorität, most frequent first" });
    expect(within(priority).getAllByRole("checkbox").map((box) => box.parentElement?.textContent)).toEqual(["Choose P1", "Choose P2"]);
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
    expect(screen.queryByRole("checkbox", { name: /^Choose / })).toBeNull();
  });

  it("says nothing of ties when no first record shares its time", () => {
    render(<OpenedAs state={{ phase: "ready", answer: answer(0) }} onRetry={() => undefined} />);
    expect(screen.queryByText(/shares its time with the next record/)).toBeNull();
  });
});

describe("#8 a value of the chart inspected, previewed, applied or cancelled, as bars or as a table", () => {
  const preview = (keptIds: string[]) => vi.fn(async () => ({ ok: true as const, parent: 5, kept: keptIds.length, removed: 5 - keptIds.length - 1, unevaluable: 1, keptIds }));

  it("inspects the incidents of a value without changing the selection, and opens one", async () => {
    const onStep = vi.fn(), onOpenCase = vi.fn(), previewStep = preview(["K-1", "K-2"]);
    render(<OpenedAs state={{ phase: "ready", answer: answer() }} onRetry={() => undefined} onStep={onStep} previewStep={previewStep} onOpenCase={onOpenCase} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Inspect Büro" }));
    expect(previewStep).toHaveBeenCalledWith({ kind: "opening_attribute_in", column_index: 3, values: ["Büro"], negate: false, anchor_policy: ANCHOR }, expect.any(AbortSignal));
    const found = await screen.findByRole("list", { name: "Incidents first recorded with Gruppe Büro" });
    expect(within(found).getAllByRole("button").map((button) => button.textContent)).toEqual(["K-1", "K-2"]);
    expect(screen.getByText("Inspecting changes nothing: the selection and its steps stay as they are.")).toBeTruthy();
    await user.click(within(found).getByRole("button", { name: "K-1" }));
    expect(onOpenCase).toHaveBeenCalledWith("K-1");
    expect(onStep).not.toHaveBeenCalled();
  });

  it("previews the chosen values before applying them, and cancels without a step", async () => {
    const onStep = vi.fn(), previewStep = preview(["K-1", "K-2"]);
    render(<OpenedAs state={{ phase: "ready", answer: answer() }} onRetry={() => undefined} onStep={onStep} previewStep={previewStep} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Choose Büro" }));
    await user.click(screen.getByRole("button", { name: "Preview keeping incidents first recorded with these values" }));
    const pending = screen.getByRole("group", { name: "Values of Gruppe not yet applied" });
    expect(await within(pending).findByText(/^Preview: would keep 2 incidents of 5 incidents/)).toBeTruthy();
    await user.click(within(pending).getByRole("button", { name: "Cancel" }));
    expect(onStep).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Preview keeping incidents first recorded with these values" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onStep).toHaveBeenCalledWith({ kind: "opening_attribute_in", column_index: 3, values: ["Büro"], negate: false, anchor_policy: ANCHOR });
  });

  it("shows the same values as a table whose rows choose the same step, with the remainder not choosable", async () => {
    const onStep = vi.fn();
    render(<OpenedAs state={{ phase: "ready", answer: answer() }} onRetry={() => undefined} onStep={onStep} />);
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("group", { name: "View of Gruppe" })).getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Opening values of Gruppe, as a table" });
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["Büro", "Unknown", "not recorded"]);
    expect(within(table).getAllByRole("row")[1].textContent).toContain("2 of 4 (50.0%)");
    await user.click(within(table).getByRole("checkbox", { name: "Choose Unknown" }));
    await user.click(screen.getByRole("button", { name: "Keep incidents first recorded with these values" }));
    expect(onStep).toHaveBeenCalledWith({ kind: "opening_attribute_in", column_index: 3, values: ["Unknown"], negate: false, anchor_policy: ANCHOR });
    await user.click(within(screen.getByRole("group", { name: "View of Priorität" })).getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table", { name: "Opening values of Priorität, as a table" }).textContent).toContain("several values: none can be chosen");
  });

  it("labels a column fixed in the parent", () => {
    const base = answer();
    const fixed = { ...base, opening_context: { ...base.opening_context, columns: [{ column_index: 5, column_name: "Mandant", distinct_value_count: 1,
      categories: [{ kind: "value" as const, value: "Nord", population: { count: 4, share: 1, denominator: 4 }, parent: { count: 4, share: 1, denominator: 4 }, difference_percentage_points: 0 }],
      remainder: null }] } };
    render(<OpenedAs state={{ phase: "ready", answer: fixed }} onRetry={() => undefined} />);
    expect(screen.getByText(/^Fixed in the parent: every incident with a readable first record has Nord here/)).toBeTruthy();
  });
});
