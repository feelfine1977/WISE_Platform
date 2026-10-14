import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Bpic19Scoring, type Bpic19ScoringSubject } from "./Bpic19Scoring";
import { Bpic19RetainedAssessments } from "./Bpic19RetainedAssessments";
import { bpic19Contract, type Bpic19Client, type Bpic19Outcome } from "./scoring-client";
import type { Bpic19ReadRequest, Bpic19ScoreAnswer } from "./scoring-types";
import fixture from "./scoring-fixtures/native-two-items.json";

function frozen(): Bpic19ScoreAnswer {
  const value: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(value)) throw new Error("The actual two-item native fixture must satisfy its contract.");
  value.definition_id = `definition-version.v1:sha256:${"1".repeat(64)}`;
  value.definition_version_id = value.definition_id;
  value.definition = { roles: { item_category: 3, resource: 5, net_worth: 7 } };
  value.report.exemplars = [{ case_id: "B", criterion_id: "C04", measurement_days: 60, deviation: .5,
    reference_median_days: 30, evaluated_support: 2, positive_support: 1, row_ids: ["B:invoice_to_clearing_days"],
    selection_recipe: "positive_nearest_all_evaluable_median_then_case_id_ascending" }];
  value.native_exemplar_pages = [{ case_id: "B", full_population_case_offset: 1, unavailable_reason: null }];
  return value;
}
const full = frozen();
const subject: Bpic19ScoringSubject = { workspace_id: full.workspace_id, base_identity: full.base_identity,
  named_population: full.named_population, roles: { item_category: 3, resource: 5, net_worth: 7 } };
function initial() {
  const value = frozen(); value.report.case_page = { offset: 0, limit: 1, total: 2, cases: [value.report.case_page.cases[0]] }; return value;
}
function reply(request: Bpic19ReadRequest) {
  const value = frozen(), target = request.case_offset === 1 ? value.report.case_page.cases[1] : value.report.case_page.cases[0];
  value.request_id = request.request_id; value.query_revision = request.query_revision;
  value.report.case_page = { offset: request.case_offset, limit: request.case_limit, total: request.case_filter ? 1 : 2, cases: [target] };
  return value;
}
function clientFor(change?: (answer: Bpic19ScoreAnswer) => Bpic19ScoreAnswer): Bpic19Client {
  return { score: vi.fn(), associate: vi.fn(), review: vi.fn(), read: vi.fn<Bpic19Client["read"]>(async request => {
    const answer = reply(request); return { ok: true, answer: change ? change(answer) : answer };
  }) };
}
function open() { fireEvent.click(screen.getByRole("button", { name: "Read native exemplar verdicts" })); }

describe("direct native timing exemplar verdicts", () => {
  it("reads the same frozen run at its exact non-first position, opens ten actual native verdicts and focuses the table", async () => {
    const client = clientFor(), inspect = vi.fn(), reviewed = vi.fn(), keep = vi.fn();
    render(<Bpic19Scoring subject={subject} initialRun={initial()} client={client} readOnly revision={17}
      onInspect={inspect} onReviewed={reviewed} onKeepCases={keep} />);
    expect(screen.queryByRole("button", { name: "B" })).toBeNull();
    open();
    const table = await screen.findByRole("table", { name: "Criterion verdicts for B" });
    expect(document.activeElement?.textContent).toBe("Criterion verdicts for B");
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    for (let index = 1; index <= 10; index++) expect(within(table).getByText(`C${String(index).padStart(2, "0")}`)).toBeTruthy();
    const timing = within(table).getByText("C04").closest("tr");
    expect(timing?.textContent).toContain("60"); expect(timing?.textContent).toContain("0.5");
    expect(client.read).toHaveBeenCalledWith(expect.objectContaining({ run_id: full.run_id, case_offset: 1, case_limit: 50, query_revision: 17 }), expect.any(AbortSignal));
    expect(vi.mocked(client.read).mock.calls[0][0].case_filter).toBeUndefined();
    fireEvent.click(within(timing!).getByRole("button", { name: "1 source records" }));
    expect(inspect).toHaveBeenCalledWith("B", ["B:invoice_to_clearing_days"]);
    expect(client.score).not.toHaveBeenCalled(); expect(client.associate).not.toHaveBeenCalled(); expect(client.review).not.toHaveBeenCalled();
    expect(reviewed).not.toHaveBeenCalled(); expect(keep).not.toHaveBeenCalled();
  });

  it("resets a prior group filter instead of treating the full-population offset as a group offset", async () => {
    const client = clientFor();
    render(<Bpic19Scoring subject={subject} initialRun={initial()} client={client} readOnly revision={17} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect members of A · Parts" }));
    await screen.findByText(/Inspecting stored members/);
    expect(vi.mocked(client.read).mock.calls[0][0].case_filter).toEqual({ group_values: { company: "A", spend_area: "Parts" } });
    open(); await screen.findByRole("table", { name: "Criterion verdicts for B" });
    const request = vi.mocked(client.read).mock.calls[1][0];
    expect(request.case_filter).toBeUndefined(); expect(request.case_offset).toBe(1); expect(request.run_id).toBe(full.run_id);
    expect(screen.queryByText(/Inspecting stored members/)).toBeNull();
  });

  it("reads verdicts in the authoring view without reviewing a new run or changing the saved definition", async () => {
    const reviewed = vi.fn(), changedRun = vi.fn(), keep = vi.fn(), client = clientFor();
    render(<Bpic19Scoring subject={subject} initialRun={initial()} client={client} onReviewed={reviewed} onRun={changedRun} onKeepCases={keep} />);
    open(); await screen.findByRole("table", { name: "Criterion verdicts for B" });
    expect(reviewed).not.toHaveBeenCalled(); expect(changedRun).not.toHaveBeenCalled(); expect(keep).not.toHaveBeenCalled(); expect(client.score).not.toHaveBeenCalled();
  });

  it("preserves native unavailable and out-of-scope verdicts without replacing them with zero", async () => {
    const client = clientFor(answer => {
      const row = answer.report.case_page.cases[0];
      for (const id of ["C05", "C09", "C10"]) {
        const c = row.criteria.find(c => c.criterion_id === id)!;
        c.reason = id === "C05" ? "out_of_scope" : "missing_value"; c.measurement = null; c.deviation = null; c.penalty = null;
      }
      row.score = .9070453042328043; row.coverage = 7 / 9; row.evaluated_raw_weight = 7; row.in_scope_raw_weight = 9;
      return answer;
    });
    render(<Bpic19Scoring subject={subject} initialRun={initial()} client={client} readOnly />); open();
    const table = await screen.findByRole("table", { name: "Criterion verdicts for B" });
    expect(within(table).getByText("out_of_scope")).toBeTruthy(); expect(within(table).getAllByText("missing_value")).toHaveLength(2);
    expect(within(table).getAllByText("Unavailable").length).toBeGreaterThanOrEqual(9);
    expect(screen.getByText(/7 \/ 9 raw weight/)).toBeTruthy();
  });

  it.each(["legacy", "absent"])("keeps %s native position unavailable while preserving raw Inspector access", kind => {
    const value = initial(), inspect = vi.fn(), client = clientFor();
    if (kind === "legacy") delete value.native_exemplar_pages;
    else value.native_exemplar_pages = [{ case_id: "B", full_population_case_offset: null, unavailable_reason: "not_in_frozen_membership" }];
    expect(bpic19Contract.answer(value)).toBe(true);
    render(<Bpic19Scoring subject={subject} initialRun={value} client={client} readOnly onInspect={inspect} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Read native exemplar verdicts" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Inspect timing exemplar" }));
    expect(inspect).toHaveBeenCalledWith("B", ["B:invoice_to_clearing_days"]); expect(client.read).not.toHaveBeenCalled(); expect(client.score).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong first item", (answer: Bpic19ScoreAnswer) => { answer.report.case_page.cases = [full.report.case_page.cases[0]]; return answer; }],
    ["wrong offset", (answer: Bpic19ScoreAnswer) => { answer.report.case_page.offset = 0; return answer; }],
    ["wrong run", (answer: Bpic19ScoreAnswer) => ({ ...answer, run_id: "score-run:another" })],
    ["wrong definition", (answer: Bpic19ScoreAnswer) => ({ ...answer, definition_id: "another-definition" })],
    ["wrong population", (answer: Bpic19ScoreAnswer) => ({ ...answer, named_population: { ...answer.named_population,
      identity: { ...answer.named_population.identity, population_id: `population.v1:sha256:${"c".repeat(64)}` } } })],
    ["changed reference", (answer: Bpic19ScoreAnswer) => { answer.report.norm_fingerprint = "another-norm"; return answer; }],
  ] as const)("refuses %s before opening a verdict table", async (_, change) => {
    render(<Bpic19Scoring subject={subject} initialRun={initial()} client={clientFor(change)} readOnly />);
    open(); await screen.findByRole("alert");
    expect(screen.queryByRole("table", { name: "Criterion verdicts for B" })).toBeNull();
  });

  it.each(["source", "revision", "population"])("drops a late native page after a %s change", async kind => {
    let release: ((value: Bpic19Outcome) => void) | undefined, sent: Bpic19ReadRequest | undefined;
    const client: Bpic19Client = { score: vi.fn(), read: vi.fn<Bpic19Client["read"]>(request => {
      sent = request; return new Promise<Bpic19Outcome>(resolve => { release = resolve; });
    }) };
    const view = render(<Bpic19Scoring subject={subject} initialRun={initial()} client={client} readOnly revision={1} />); open();
    if (!sent || !release) throw new Error("The explicit exemplar request must be pending.");
    let next = subject;
    if (kind === "source") next = { ...subject, base_identity: { ...subject.base_identity, source_id: `source.v1:sha256:${"8".repeat(64)}` } };
    if (kind === "population") next = { ...subject, named_population: { ...subject.named_population,
      identity: { ...subject.named_population.identity, population_id: `population.v1:sha256:${"c".repeat(64)}` } } };
    view.rerender(<Bpic19Scoring subject={next} initialRun={initial()} client={client} readOnly revision={kind === "revision" ? 2 : 1} />);
    await act(async () => release?.({ ok: true, answer: reply(sent!) }));
    expect(screen.queryByRole("table", { name: "Criterion verdicts for B" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull(); expect(client.score).not.toHaveBeenCalled();
  });

  it("cancels the exemplar read and drops its late error", async () => {
    let release: ((value: Bpic19Outcome) => void) | undefined;
    const client: Bpic19Client = { score: vi.fn(), read: vi.fn<Bpic19Client["read"]>(() => new Promise<Bpic19Outcome>(resolve => { release = resolve; })) };
    render(<Bpic19Scoring subject={subject} initialRun={initial()} client={client} readOnly />); open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel native exemplar read" }));
    await act(async () => release?.({ ok: false, message: "old missing native chunk" }));
    expect(screen.queryByRole("alert")).toBeNull(); expect(screen.queryByText(/Reading stored native verdicts/)).toBeNull();
  });

  it("clears a pending exemplar read after a settings edit and immediately admits only the new reviewed settings", async () => {
    let release: ((value: Bpic19Outcome) => void) | undefined, sent: Bpic19ReadRequest | undefined;
    const client: Bpic19Client = { score: vi.fn<Bpic19Client["score"]>(async request => ({ ok: true, answer: {
      ...frozen(), request_id: request.request_id, query_revision: request.query_revision,
      run_id: "score-run:explicit-gamma20", definition_id: "definition:explicit-gamma20", definition_version_id: "definition:explicit-gamma20",
      report: { ...frozen().report, settings: { ...frozen().report.settings, ...request.settings } },
    } })), read: vi.fn<Bpic19Client["read"]>(request => {
      sent = request; return new Promise<Bpic19Outcome>(resolve => { release = resolve; });
    }) };
    const reviewed = vi.fn();
    render(<Bpic19Scoring subject={subject} initialRun={initial()} client={client} onReviewed={reviewed} />); open();
    fireEvent.change(screen.getByLabelText("Gamma"), { target: { value: "20" } });
    expect(screen.queryByRole("button", { name: "Cancel native exemplar read" })).toBeNull();
    expect(screen.queryByText(/Reading stored native verdicts/)).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run analysis" }).disabled).toBe(false);
    expect(reviewed).not.toHaveBeenCalled(); expect(client.score).not.toHaveBeenCalled();
    if (!release || !sent) throw new Error("The native exemplar read must be pending.");
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    await screen.findByText(/Balanced, flat, gamma 20/);
    expect(client.score).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ gamma: 20 }) }), expect.any(AbortSignal));
    expect(reviewed).toHaveBeenCalledTimes(1);
    await act(async () => release?.({ ok: true, answer: reply(sent!) }));
    expect(screen.queryByRole("table", { name: "Criterion verdicts for B" })).toBeNull();
    expect(screen.getByText(/Balanced, flat, gamma 20/)).toBeTruthy();
    expect(screen.queryByText(/Settings changed/)).toBeNull(); expect(reviewed).toHaveBeenCalledTimes(1); expect(client.score).toHaveBeenCalledTimes(1);
  });

  it("shows a failed native read explicitly and permits an exact same-run retry", async () => {
    const client = clientFor(); vi.mocked(client.read).mockResolvedValueOnce({ ok: false, message: "artifact_unavailable: later native chunk missing" });
    render(<Bpic19Scoring subject={subject} initialRun={initial()} client={client} readOnly />); open();
    await screen.findByText(/later native chunk missing/); expect(screen.queryByRole("table", { name: "Criterion verdicts for B" })).toBeNull();
    open(); await screen.findByRole("table", { name: "Criterion verdicts for B" });
    expect(client.read).toHaveBeenCalledTimes(2); expect(client.score).not.toHaveBeenCalled();
  });

  it("opens the retained parent verdicts and their source witnesses while the current child identity remains distinct", async () => {
    const inspect = vi.fn();
    const client: Bpic19Client = { score: vi.fn(), associate: vi.fn(), review: vi.fn(), read: vi.fn<Bpic19Client["read"]>(async request => {
      if (request.case_offset === 0) return { ok: true, answer: { ...initial(), request_id: request.request_id, query_revision: request.query_revision } };
      return { ok: true, answer: reply(request) };
    }) };
    render(<Bpic19RetainedAssessments workspaceId={full.workspace_id} baseIdentity={full.base_identity}
      currentIdentity={{ ...full.base_identity, population_id: `population.v1:sha256:${"c".repeat(64)}` }} revision={17}
      actions={[{ operation: "bpic19_score", identity: full.named_population.identity, definition_id: full.definition_id!, query: { run_id: full.run_id } }]}
      client={client} onInspect={inspect} />);
    fireEvent.change(screen.getByLabelText("Retained assessment"), { target: { value: "0" } });
    await screen.findByText(/retained parent population, distinct/); open();
    const table = await screen.findByRole("table", { name: "Criterion verdicts for B" });
    const timing = within(table).getByText("C04").closest("tr")!;
    fireEvent.click(within(timing).getByRole("button", { name: "1 source records" }));
    expect(inspect).toHaveBeenCalledWith(full.named_population.identity, "B", ["B:invoice_to_clearing_days"], expect.stringContaining(full.run_id));
    expect(client.score).not.toHaveBeenCalled(); expect(client.associate).not.toHaveBeenCalled(); expect(client.review).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Keep these complete items" })).toBeNull();
  });
});
