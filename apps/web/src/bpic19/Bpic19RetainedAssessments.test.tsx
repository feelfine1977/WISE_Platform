import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnswerIdentity, Bpic19PipelineAction } from "../generated/saving";
import { Bpic19RetainedAssessments, type Bpic19RetainedAssessmentsProps } from "./Bpic19RetainedAssessments";
import { bpic19Contract, type Bpic19Client, type Bpic19Outcome } from "./scoring-client";
import type { Bpic19ReadRequest, Bpic19ScoreAnswer, Roles } from "./scoring-types";
import fixture from "./scoring-fixtures/native-two-items.json";

function nativeFixture(): Bpic19ScoreAnswer {
  const value: unknown = structuredClone(fixture);
  if (!bpic19Contract.answer(value)) throw new Error("The two-item fixture must satisfy the native answer contract.");
  return value;
}
const original = nativeFixture(), baseIdentity = original.base_identity;
const currentIdentity: AnswerIdentity = { ...baseIdentity, population_id: `population.v1:sha256:${"c".repeat(64)}` };
// Authored fixture metadata: these are the frozen raw-column roles, never inferred from a current UI mapping.
const roles: Roles = { item_category: 9, item_type: 8, goods_receipt: 16, gr_based_iv: 13,
  purchasing_document: 5, item: 14, source_case: 15, company: 2, spend_area: 1, resource: 21, net_worth: 10, value: null };
const definitionId = `definition.v1:sha256:${"1".repeat(64)}`;
const parent: Bpic19PipelineAction = { operation: "bpic19_score", identity: baseIdentity, definition_id: definitionId,
  selection_prefix_length: null, query: { run_id: original.run_id } };
const child: Bpic19PipelineAction = { operation: "bpic19_score", identity: currentIdentity,
  definition_id: `definition.v1:sha256:${"2".repeat(64)}`, selection_prefix_length: 1, query: { run_id: "bpic19-run:child-fixture" } };
function readAnswer(request: Bpic19ReadRequest, action: Bpic19PipelineAction = parent): Bpic19ScoreAnswer {
  return { ...nativeFixture(), request_id: request.request_id, query_revision: request.query_revision,
    run_id: String(action.query.run_id), definition_id: action.definition_id, definition_version_id: action.definition_id,
    definition: { schema_version: 1, roles: structuredClone(roles) },
    named_population: { name: action === parent ? "Original parent assessment" : "Retained child assessment", identity: action.identity } };
}
function props(client: Bpic19Client, overrides: Partial<Bpic19RetainedAssessmentsProps> = {}): Bpic19RetainedAssessmentsProps {
  return { workspaceId: original.workspace_id, baseIdentity, currentIdentity, actions: [parent, child], revision: 19,
    client, onInspect: vi.fn(), ...overrides };
}
function clientFor(transform?: (answer: Bpic19ScoreAnswer) => Bpic19ScoreAnswer): Bpic19Client {
  return { score: vi.fn(), associate: vi.fn(), review: vi.fn(), read: vi.fn<Bpic19Client["read"]>(async request => {
    const answer = readAnswer(request, request.run_id === child.query.run_id ? child : parent);
    return { ok: true, answer: transform ? transform(answer) : answer };
  }) };
}
function choose(index = "0") { fireEvent.change(screen.getByLabelText("Retained assessment"), { target: { value: index } }); }

describe("explicit frozen native assessment viewer", () => {
  it("starts collapsed, lists every named declaration, and reads only the chosen parent without rescore or mutations", async () => {
    const client = clientFor(), inspect = vi.fn();
    render(<Bpic19RetainedAssessments {...props(client, { onInspect: inspect,
      labels: { [original.run_id]: "Paper · Balanced · original items", [String(child.query.run_id)]: "Paper · Operations · selected items" } })} />);
    const disclosure = screen.getByText("Retained native assessments (2)").closest("details");
    expect(disclosure?.open).toBe(false);
    expect(client.read).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "Paper · Balanced · original items" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Paper · Operations · selected items" })).toBeTruthy();
    choose();
    await screen.findByText(/2 of 2 items scored/);
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read).toHaveBeenCalledWith(expect.objectContaining({ run_id: original.run_id, query_revision: 19,
      case_offset: 0, case_limit: 50, group_offset: 0, group_limit: 50 }), expect.any(AbortSignal));
    expect(screen.getByText(/retained parent population, distinct/)).toBeTruthy();
    expect(screen.getByText(/Assess Original parent assessment/)).toBeTruthy();
    const roleDetail = screen.getByText("Frozen source column roles").closest("details");
    expect(roleDetail?.querySelector("pre")?.textContent).toBe(JSON.stringify(roles, null, 2));
    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull();
    expect(screen.queryByLabelText("Stakeholder view")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep these complete items" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getAllByRole("button", { name: "1 source records" })[0]);
    expect(inspect).toHaveBeenCalledWith(baseIdentity, "A", ["A:invoice_count"], expect.stringContaining(original.run_id));
    fireEvent.click(screen.getByRole("button", { name: "Inspect members of A · Parts" }));
    await waitFor(() => expect(client.read).toHaveBeenCalledTimes(2));
    expect(client.read).toHaveBeenLastCalledWith(expect.objectContaining({ run_id: original.run_id,
      case_filter: { group_values: { company: "A", spend_area: "Parts" } } }), expect.any(AbortSignal));
    expect(client.score).not.toHaveBeenCalled(); expect(client.associate).not.toHaveBeenCalled(); expect(client.review).not.toHaveBeenCalled();
  });

  it("reads a current-scoped declaration with its own identity rather than relabeling the parent", async () => {
    const client = clientFor(), inspect = vi.fn();
    render(<Bpic19RetainedAssessments {...props(client, { onInspect: inspect })} />);
    choose("1"); await screen.findByText(/2 of 2 items scored/);
    expect(screen.getByText("This assessment names the current selection.")).toBeTruthy();
    expect(screen.getByText(/Assess Retained child assessment/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Inspect records" })[0]);
    expect(inspect).toHaveBeenCalledWith(currentIdentity, "A", [], expect.stringContaining("bpic19-run:child-fixture"));
  });

  it.each([
    ["definition", (answer: Bpic19ScoreAnswer) => ({ ...answer, definition_id: child.definition_id })],
    ["definition version", (answer: Bpic19ScoreAnswer) => ({ ...answer, definition_version_id: child.definition_id })],
    ["run", (answer: Bpic19ScoreAnswer) => ({ ...answer, run_id: String(child.query.run_id) })],
    ["population", (answer: Bpic19ScoreAnswer) => ({ ...answer, named_population: { ...answer.named_population, identity: currentIdentity } })],
    ["base", (answer: Bpic19ScoreAnswer) => ({ ...answer, base_identity: currentIdentity })],
    ["workspace", (answer: Bpic19ScoreAnswer) => ({ ...answer, workspace_id: "workspace.v1:fedcba9876543210" })],
    ["request", (answer: Bpic19ScoreAnswer) => ({ ...answer, request_id: "another-request" })],
    ["revision", (answer: Bpic19ScoreAnswer) => ({ ...answer, query_revision: 20 })],
  ] as const)("refuses a mismatched %s without displaying frozen output", async (_, change) => {
    render(<Bpic19RetainedAssessments {...props(clientFor(change))} />); choose();
    await screen.findByRole("alert"); expect(screen.queryByText(/items scored/)).toBeNull();
  });

  it.each([
    ["missing", undefined], ["unknown role", { ...roles, automatic_guess: 3 }], ["string index", { ...roles, resource: "21" }],
    ["negative index", { ...roles, resource: -1 }], ["fractional index", { ...roles, resource: 1.5 }],
  ])("refuses %s frozen roles without using a current mapping", async (_, value) => {
    const client = clientFor(answer => ({ ...answer, definition: value === undefined ? {} : { roles: value } }));
    render(<Bpic19RetainedAssessments {...props(client)} />); choose();
    await screen.findByText(/missing or unsupported frozen source-role recipe/);
    expect(screen.queryByText(/items scored/)).toBeNull(); expect(client.score).not.toHaveBeenCalled();
  });

  it("accepts an explicitly declared empty no-context role recipe without inventing a mapping", async () => {
    render(<Bpic19RetainedAssessments {...props(clientFor(answer => ({ ...answer, definition: { roles: {} } })))} />);
    choose(); await screen.findByText(/2 of 2 items scored/);
    expect(screen.getByText("Frozen source column roles").closest("details")?.querySelector("pre")?.textContent).toBe("{}");
  });

  it.each([
    ["profile", (answer: Bpic19ScoreAnswer) => { answer.report.profile_id = "future-norm"; return answer; }],
    ["view", (answer: Bpic19ScoreAnswer) => { answer.report.settings.view = "Future view"; return answer; }],
    ["mode", (answer: Bpic19ScoreAnswer) => { answer.report.settings.mode = "implicit"; return answer; }],
    ["family mismatch", (answer: Bpic19ScoreAnswer) => { answer.report.settings.criteria_family = "completion"; return answer; }],
    ["historical flat mode", (answer: Bpic19ScoreAnswer) => {
      answer.report.profile_id = "bpic19.notebook.1.0-paper-aligned.v1"; answer.report.settings.view = "Finance"; return answer;
    }],
  ] as const)("refuses an unsupported stored %s without presentation fallback", async (_, change) => {
    render(<Bpic19RetainedAssessments {...props(clientFor(change))} />); choose();
    await screen.findByText(/unsupported profile or settings/);
    expect(screen.queryByText(/Frozen assessment:/)).toBeNull();
  });

  it("preserves a finite historical profile and its layer-balanced Finance view", async () => {
    const client = clientFor(answer => { answer.report.profile_id = "bpic19.notebook.1.0-paper-aligned.v1";
      answer.report.settings.mode = "layer_balanced"; answer.report.settings.view = "Finance"; answer.report.settings.gamma = 20; return answer; });
    render(<Bpic19RetainedAssessments {...props(client)} />); choose();
    await screen.findByText(/Frozen assessment: Finance · layer balanced · gamma 20/);
  });

  it.each(["source", "current selection", "revision", "declaration"])("drops a late read when the %s changes", async kind => {
    let resolve: ((outcome: Bpic19Outcome) => void) | undefined, sent: Bpic19ReadRequest | undefined, signal: AbortSignal | undefined;
    const client: Bpic19Client = { score: vi.fn(), read: vi.fn<Bpic19Client["read"]>((request, abort) => {
      sent = request; signal = abort; return new Promise(done => { resolve = done; });
    }) };
    const initial = props(client), { rerender } = render(<Bpic19RetainedAssessments {...initial} />); choose();
    if (!resolve || !sent) throw new Error("An explicit native read must be pending.");
    const late = readAnswer(sent), next = { ...initial };
    if (kind === "source") next.baseIdentity = { ...baseIdentity, source_id: `source.v1:sha256:${"7".repeat(64)}` };
    if (kind === "current selection") next.currentIdentity = baseIdentity;
    if (kind === "revision") next.revision = 20;
    if (kind === "declaration") next.actions = [child];
    rerender(<Bpic19RetainedAssessments {...next} />);
    await act(async () => resolve?.({ ok: true, answer: late }));
    expect(signal?.aborted).toBe(true); expect(screen.queryByText(/items scored/)).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Retained assessment")).toHaveProperty("value", "");
  });

  it("cancels a pending read and ignores its late error", async () => {
    let resolve: ((outcome: Bpic19Outcome) => void) | undefined;
    const client: Bpic19Client = { score: vi.fn(), read: vi.fn<Bpic19Client["read"]>(() => new Promise(done => { resolve = done; })) };
    render(<Bpic19RetainedAssessments {...props(client)} />); choose();
    fireEvent.click(screen.getByRole("button", { name: "Close retained assessment" }));
    await act(async () => resolve?.({ ok: false, message: "old unavailable artifact" }));
    expect(screen.queryByRole("alert")).toBeNull(); expect(screen.queryByText(/Reading the selected/)).toBeNull();
  });

  it("retries a service failure explicitly without substituting a new evaluation", async () => {
    const client = clientFor(); vi.mocked(client.read).mockRejectedValueOnce(new Error("offline"));
    render(<Bpic19RetainedAssessments {...props(client)} />); choose();
    await screen.findByText(/could not be read/);
    fireEvent.click(screen.getByRole("button", { name: "Retry retained assessment" }));
    await screen.findByText(/2 of 2 items scored/); expect(client.read).toHaveBeenCalledTimes(2); expect(client.score).not.toHaveBeenCalled();
  });

  it("refuses a changed role recipe or definition on subsequent frozen member reads", async () => {
    const client = clientFor();
    render(<Bpic19RetainedAssessments {...props(client)} />); choose(); await screen.findByText(/2 of 2 items scored/);
    vi.mocked(client.read).mockImplementationOnce(async request => ({ ok: true,
      answer: { ...readAnswer(request), definition: { roles: { ...roles, resource: 20 } } } }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect members of A · Parts" }));
    await screen.findByText(/source-role recipe changed during/);
    expect(client.score).not.toHaveBeenCalled();
  });

  it("exports only the selected stored native run", async () => {
    const client = clientFor(); client.export = vi.fn<NonNullable<Bpic19Client["export"]>>(async () => ({ ok: false, message: "artifact_unavailable: original ZIP missing" }));
    render(<Bpic19RetainedAssessments {...props(client)} />); choose(); await screen.findByText(/2 of 2 items scored/);
    fireEvent.click(screen.getByRole("button", { name: "Export complete native run" }));
    await screen.findByText(/original ZIP missing/);
    expect(client.export).toHaveBeenCalledWith(expect.objectContaining({ run_id: original.run_id, query_revision: 19 }), expect.any(AbortSignal));
    expect(client.score).not.toHaveBeenCalled();
  });

  it("keeps fallback labels meaningful and ignores non-native declarations", () => {
    const other: Bpic19PipelineAction = { ...parent, operation: "bpic19_profile", query: {} };
    render(<Bpic19RetainedAssessments {...props(clientFor(), { actions: [other, parent, child] })} />);
    const options = within(screen.getByLabelText("Retained assessment")).getAllByRole("option");
    expect(options.map(option => option.textContent)).toEqual(["Choose a retained assessment", "Retained assessment 1", "Retained assessment 2"]);
  });

  it("offers all twelve frozen declarations without a read fanout", async () => {
    const actions: Bpic19PipelineAction[] = Array.from({ length: 12 }, (_, index) => ({ ...parent,
      definition_id: `definition.v1:sha256:${String(index).padStart(64, "0")}`, query: { run_id: `bpic19-run:retained-${index}` } }));
    const client: Bpic19Client = { score: vi.fn(), read: vi.fn<Bpic19Client["read"]>(async request => {
      const declaration = actions.find(action => action.query.run_id === request.run_id);
      if (!declaration) throw new Error("Only a listed assessment may be read.");
      return { ok: true, answer: readAnswer(request, declaration) };
    }) };
    render(<Bpic19RetainedAssessments {...props(client, { actions })} />);
    expect(screen.getByText("Retained native assessments (12)")).toBeTruthy();
    expect(within(screen.getByLabelText("Retained assessment")).getAllByRole("option")).toHaveLength(13);
    expect(client.read).not.toHaveBeenCalled();
    choose("11"); await screen.findByText(/2 of 2 items scored/);
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read).toHaveBeenCalledWith(expect.objectContaining({ run_id: "bpic19-run:retained-11" }), expect.any(AbortSignal));
    expect(client.score).not.toHaveBeenCalled();
  });

  it("refuses a foreign-source declaration before contacting the native service", async () => {
    const client = clientFor(), foreign = { ...parent, identity: { ...baseIdentity, preparation_id: `preparation.v1:sha256:${"8".repeat(64)}` } };
    render(<Bpic19RetainedAssessments {...props(client, { actions: [foreign] })} />); choose();
    await screen.findByText(/another source preparation/);
    expect(client.read).not.toHaveBeenCalled(); expect(client.score).not.toHaveBeenCalled();
  });
});
