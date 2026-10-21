import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SelectionPredicate } from "../generated/selection";
import type { TransitionMatrixAnswer, TransitionMatrixRequest } from "../generated/transition-matrix";
import type { StepPreview } from "../imported/coordinator";
import { identity, workspaceId } from "../test/imports";
import { type MatrixClient, type MatrixOutcome, matrixContract } from "./client";
import { cellDescription, cellValue, measureKey, TransitionMatrix } from "./TransitionMatrix";

const row = (n: string) => `row.v1:sha256:${n.repeat(64)}`;

function answerFor(request: TransitionMatrixRequest, empty = false): TransitionMatrixAnswer {
  return {
    schema_version: 1, message_type: "transition_matrix_answer", request_id: request.request_id, query_revision: request.query_revision,
    workspace_id: request.workspace_id, identity: request.identity, representation: "activity",
    relation: { policy: "incident.relation.direct_succession_in_activity_sequence.v1", activity_projection_policy: "incident.activity.omit_missing_retain_raw_gaps.v1",
      adjacency: "mapped_sequence_with_disclosed_raw_gaps", order_policy: "incident.order.declared_time_optional_sequence_source_position.v1", case_basis: "sequence_evaluable_cases" },
    clock: { unit: "hours", timestamp_kind: "utc_instant", lag_clock: "elapsed_utc_hours" },
    case_count: empty ? 1 : 7, case_denominator: empty ? 0 : 6, unevaluable_case_count: 1,
    activities: empty ? [] : ["Opened", "Resolved", "Assigned", "Closed"],
    rows: empty ? [] : [{ activity: "Opened", outgoing_passage_count: 6 }, { activity: "Resolved", outgoing_passage_count: 0 }, { activity: "Assigned", outgoing_passage_count: 4 }, { activity: "Closed", outgoing_passage_count: 0 }],
    cells: empty ? [] : [
      { source_activity: "Opened", target_activity: "Assigned", case_count: 3, case_ids: ["M-L1", "M-S1", "M-T1"], case_share: 0.5, passage_count: 4, outgoing_share: 4 / 6,
        lag: { usable_count: 4, mean_hours: 1.5, median_hours: 1.5, zero_count: 0 }, bridged_passage_count: 0, bridged_case_count: 0, tied_passage_count: 0,
        witnesses: [{ case_id: "M-L1", source_row_id: row("a"), target_row_id: row("b"), omitted_row_ids: [], hours: 1, tied: false }], witnesses_truncated: true },
      { source_activity: "Assigned", target_activity: "Resolved", case_count: 3, case_ids: ["M-L1", "M-S1", "M-T1"], case_share: 0.5, passage_count: 3, outgoing_share: 0.75,
        lag: { usable_count: 3, mean_hours: 2 / 3, median_hours: 1, zero_count: 1 }, bridged_passage_count: 0, bridged_case_count: 0, tied_passage_count: 1,
        witnesses: [{ case_id: "M-T1", source_row_id: row("c"), target_row_id: row("d"), omitted_row_ids: [row("e")], hours: 0, tied: true }], witnesses_truncated: false },
    ],
  };
}

function scripted() {
  const calls: { request: TransitionMatrixRequest; reply: (outcome: MatrixOutcome) => void }[] = [];
  const client: MatrixClient = { matrix: (request) => new Promise((reply) => calls.push({ request, reply })) };
  return { client, calls };
}

const otherIdentity = { ...identity, population_id: `population.v1:sha256:${"9".repeat(64)}` };

describe("#12 the measures of a cell, each with its unit and denominator", () => {
  it("names cases, passages, the outgoing share and the lags apart", () => {
    const answer = answerFor({ schema_version: 1, message_type: "transition_matrix_request", request_id: "m", query_revision: 1, workspace_id: workspaceId, identity, witness_limit: 50 });
    expect(matrixContract.answer(answer)).toBe(true);
    const [first, tie] = answer.cells;
    expect(["incidents", "passages", "outgoing", "median", "mean"].map((measure) => cellValue(first, measure as never))).toEqual(["3", "4", "66.7 %", "1.5", "1.5"]);
    expect(cellValue(tie, "median")).toBe("1.0");
    expect(measureKey("incidents", answer)).toBe("Cases: the distinct cases with the pair, of the 6 cases whose order is known; a repeat adds no case.");
    expect(measureKey("outgoing", answer)).toContain("a row no pair leaves has no denominator");
    expect(measureKey("median", answer)).toContain("elapsed hours (UTC)");
    expect(cellDescription(first, answer)).toBe(
      "From Opened to Assigned: 3 cases of 6 (50.0 %), 4 passages, 66.7 % of the 6 passages leaving Opened, median lag 1.5 h over 4 usable lags");
  });
});

describe("#12 the matrix of the kept cases", () => {
  it("shows no reply for an earlier selection, and a refusal with a way to try again", async () => {
    const { client, calls } = scripted();
    const props = { workspaceId, revision: 1, onStep: () => undefined, onOpenCase: () => undefined, client };
    const { rerender } = render(<TransitionMatrix {...props} identity={identity} />);
    rerender(<TransitionMatrix {...props} revision={2} identity={otherIdentity} />);
    expect(calls).toHaveLength(2);
    // The reply for the earlier selection arrives last and is not shown.
    await act(async () => calls[1].reply({ ok: false, problem: { kind: "refusal", refusal: { schema_version: 1, message_type: "transition_matrix_refusal", request_id: calls[1].request.request_id,
      query_revision: 2, workspace_id: workspaceId, operation: "transition_matrix", code: "population_unavailable", message: "This population is not held.", field: "identity.population_id", retryable: true } } }));
    await act(async () => calls[0].reply({ ok: true, answer: answerFor(calls[0].request) }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("This population is not held.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(calls).toHaveLength(3);
    expect(calls[2].request.identity).toEqual(otherIdentity);
  });

  it("says when there is no denominator", async () => {
    const { client, calls } = scripted();
    render(<TransitionMatrix workspaceId={workspaceId} revision={1} identity={identity} onStep={() => undefined} onOpenCase={() => undefined} client={client} />);
    await act(async () => calls[0].reply({ ok: true, answer: answerFor(calls[0].request, true) }));
    expect(screen.getByText("No kept case has a known order, so there is no pair and no denominator.")).toBeTruthy();
  });

  it("selects a cell, previews, cancels and applies its step with the focus back on the cell, and opens a passage with its rows", async () => {
    const { client, calls } = scripted();
    const onStep = vi.fn<(step: SelectionPredicate) => void>();
    const onOpenCase = vi.fn();
    const preview = vi.fn(async (): Promise<StepPreview> => ({ ok: true, parent: 7, kept: 3, removed: 3, unevaluable: 1, keptIds: ["M-L1", "M-S1", "M-T1"] }));
    const { rerender } = render(<TransitionMatrix workspaceId={workspaceId} revision={1} identity={identity} onStep={onStep} previewStep={preview} onOpenCase={onOpenCase} client={client} />);
    await act(async () => calls[0].reply({ ok: true, answer: answerFor(calls[0].request) }));
    const user = userEvent.setup();
    const grid = screen.getByRole("table", { name: /^Transition matrix/ });
    // A row no pair leaves says so; an absent pair is named, not a zero.
    expect(within(grid).getByRole("rowheader", { name: /^Resolved/ }).textContent).toContain("no pair leaves it");
    expect(within(grid).getByText("No pair from Opened to Closed")).toBeTruthy();
    const cell = within(grid).getByRole("button", { name: /^From Assigned to Resolved/ });
    cell.focus();
    await user.keyboard("{Enter}");
    const panel = screen.getByRole("region", { name: "From Assigned to Resolved" });
    expect(panel.textContent).toContain("1 passage between two records with the same time, ordered by the declared rule");
    expect(panel.textContent).toContain("median 1.0 h, mean 0.7 h over 3 usable lags; 1 measured zero");
    await user.click(within(panel).getByRole("button", { name: "Preview removing these cases" }));
    expect(await within(panel).findByText(/^Preview: would keep 3 cases of 7 cases/)).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(onStep).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(within(grid).getByRole("button", { name: /^From Assigned to Resolved/ })));
    await user.click(within(panel).getByRole("button", { name: "Preview keeping these cases" }));
    await user.click(within(panel).getByRole("button", { name: "Apply" }));
    expect(onStep).toHaveBeenCalledWith({ kind: "directly_follows", source_activity: "Assigned", target_activity: "Resolved", negate: false });
    await waitFor(() => expect(document.activeElement).toBe(within(grid).getByRole("button", { name: /^From Assigned to Resolved/ })));
    // A passage opens its incident with the rows of both records and the record without a label between them.
    await user.click(within(panel).getByRole("button", { name: "Open case M-T1" }));
    expect(onOpenCase).toHaveBeenCalledWith("M-T1", [row("c"), row("e"), row("d")]);
    rerender(<TransitionMatrix workspaceId={workspaceId} revision={1} identity={identity} onStep={onStep} previewStep={preview} onOpenCase={onOpenCase} client={client} openCaseId="M-T1" />);
    (document.activeElement as HTMLElement).blur();
    rerender(<TransitionMatrix workspaceId={workspaceId} revision={1} identity={identity} onStep={onStep} previewStep={preview} onOpenCase={onOpenCase} client={client} openCaseId={null} />);
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Open case M-T1" }));
    // The same pairs in the table, with every measure in a column.
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(within(screen.getByRole("table", { name: "Pairs of the transition matrix" })).getAllByRole("row")).toHaveLength(3);
  });
});
