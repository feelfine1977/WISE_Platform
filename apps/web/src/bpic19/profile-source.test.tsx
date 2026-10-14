import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Bpic19SourceReview } from "../generated/bpic19-profile";
import { SourceDefinition, SourceReview } from "./profile-source";

// Independently authored H7 expected source answer. Counts and IDs are literal, not obtained from a production reducer.
const witnessRow = "row.v1:sha256:" + "a".repeat(64);
const review: Bpic19SourceReview = {
  interpretation: { profile_name: "H7 document-start review", policy_id: "bpic19.raw_source_interpretation.v1",
    inclusion: { kind: "document_start", timestamp_kind: "utc_instant", start_inclusive: "2018-01-01T00:00:00Z", end_exclusive: null },
    horizon: { timestamp_kind: "utc_instant", value: "2019-01-28T00:00:00Z", provenance: "Synthetic extraction contract" },
    discrepancies: [{ reference: "Synthetic report claims", reported_total: 251734, reported_subtotal: 251347 }] },
  source_id: "source.v1:sha256:" + "1".repeat(64), preparation_id: "preparation.v1:sha256:" + "2".repeat(64),
  parser_time_policy: "incident.time.explicit_format_timezone_utc.v1", parser_cutoff: "2027-01-01T00:00:00Z", clock_kind: "utc_instant",
  observed_raw_minimum: "1948-01-01T00:00:00Z", observed_raw_maximum: "2020-01-02T00:00:00Z", horizon_state: "reviewed",
  due_assessment: "unavailable", due_assessment_reason: "payment_terms_and_due_obligation_not_defined",
  raw_support: { case_ids: ["A", "B", "C"], case_count: 3, record_count: 7, document_count: 2, share: 1, example_case_ids: ["A", "B", "C"] },
  retained: { case_ids: ["C"], case_count: 1, record_count: 2, document_count: 1, share: 1 / 3, example_case_ids: ["C"] },
  excluded: { case_ids: ["A", "B"], case_count: 2, record_count: 5, document_count: 1, share: 2 / 3, example_case_ids: ["A", "B"] },
  unavailable: { case_ids: [], case_count: 0, record_count: 0, document_count: 0, share: 0, example_case_ids: [] },
  projection: null,
  inclusion_evidence: [{ case_id: "B", reason: "earliest_raw_event_before_start", row_ids: [witnessRow], witness_case_ids: ["A"] }],
  omitted_inclusion_evidence_count: 0,
  anomalies: [{ state: "before_reference_2017", record_count: 1, case_count: 1,
    witnesses: [{ case_id: "A", row_id: witnessRow, source_position: 0, raw_timestamp: "1948-01-01T00:00:00Z", interpreted_timestamp: "1948-01-01T00:00:00Z" }], omitted_witness_count: 0 }],
  discrepancies: [{ reference: "Synthetic report claims", reported_total: 251734, reported_subtotal: 251347, difference: 387, measured_parent_case_count: 3 }],
};

describe("source interpretation review", () => {
  it("shows whole-document exclusions, separate horizon and discrepancy and opens the original sibling witness by keyboard", async () => {
    const onInspect = vi.fn(), onKeep = vi.fn(), user = userEvent.setup();
    render(<SourceReview review={review} disabled={false} onInspect={onInspect} onKeep={onKeep} />);
    await user.click(screen.getByText(/Source scope and observation review/));
    expect(screen.getByText(/Retained: 1 items \/ 2 records \/ 1 known documents/)).toBeTruthy();
    expect(screen.getByText(/Excluded: 2 items \/ 5 records/)).toBeTruthy();
    expect(screen.getByText(/Raw parsed range: 1948.*2020/)).toBeTruthy();
    expect(screen.getByText(/Observation horizon: 2019-01-28/)).toBeTruthy();
    expect(screen.getByText("Source discrepancy: 387 items")).toBeTruthy();
    const witness = screen.getByRole("button", { name: "Inspect source inclusion A" }); witness.focus();
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenLastCalledWith("A", [witnessRow]);
    await user.click(screen.getByRole("button", { name: "Keep source inclusion" }));
    expect(onKeep).toHaveBeenLastCalledWith(["C"]);
  });

  it("labels an event projection as derived and keeps the raw parent counts visible", async () => {
    const user = userEvent.setup();
    const projected: Bpic19SourceReview = { ...review, projection: { row_ids: [witnessRow, ...["b", "c", "d", "e"].map(letter => "row.v1:sha256:" + letter.repeat(64))], record_count: 5, case_ids: ["A", "B", "C"], case_count: 3, document_count: 2, raw_histories_preserved: true } };
    render(<SourceReview review={projected} disabled={false} onInspect={vi.fn()} onKeep={vi.fn()} />);
    await user.click(screen.getByText(/Source scope and observation review/));
    expect(screen.getByText(/Derived record projection: 5 records across 3 items/)).toBeTruthy();
    expect(screen.getByText(/Raw parent: 3 items \/ 7 original records/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep source inclusion" })).toBeNull();
  });

  it("requires declared provenance after switching an unknown horizon on and stores explicit inclusion grain", async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    const definition = { ...review.interpretation, horizon: { timestamp_kind: "utc_instant" as const, value: null, provenance: null } };
    render(<SourceDefinition value={definition} disabled={false} onChange={onChange} />);
    await user.click(screen.getByText("Named source and observation policy"));
    await user.click(screen.getByRole("checkbox", { name: "Declare a reviewed observation horizon" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ horizon: { timestamp_kind: "utc_instant", value: "2019-01-28T00:00:00Z", provenance: "" } }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Source inclusion" }), "record_projection");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ inclusion: { kind: "record_projection", timestamp_kind: "utc_instant", start_inclusive: "2018-01-01T00:00:00Z", end_exclusive: "2019-01-01T00:00:00Z" } }));
  });
});
