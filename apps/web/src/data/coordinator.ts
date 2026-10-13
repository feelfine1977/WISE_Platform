import type {
  ConfirmMappingRequest,
  CsvInspectionAnswer,
  Dialect,
  DialectHints,
  InspectCsvRequest,
  InterpretationAnswer,
  OpenDefaultWorkspaceRequest,
  OpenWorkspaceRequest,
  SourceAnswer,
  StoredPreparation,
  StoredSource,
  UploadSourceMetadata,
  WorkspaceAnswer,
} from "../generated/imports";
import type { CutoffProposal, ImportClient, ImportOutcome, ImportProblem } from "./client";
import { type WorkspaceExample, exampleColumns, exampleReading } from "./examples";
import {
  type Draft,
  confirmationOf,
  cutoffFieldValue,
  draftAfterInspection,
  emptyDraft,
  formatEvidence,
  proposalRequestOf,
} from "./interpretation";

/**
 * The workspace in use. A path of null stands for the application's own folder, which the local
 * service names and creates; `own` says that the open workspace is that folder.
 */
export type WorkspaceState =
  | { phase: "none" }
  | { phase: "opening"; path: string | null; startedAt: number }
  | { phase: "open"; answer: WorkspaceAnswer; own: boolean }
  | { phase: "failed"; path: string | null; problem: ImportProblem };

export type SourceState =
  | { phase: "none" }
  | { phase: "fetching"; filename: string; startedAt: number }
  | { phase: "uploading"; filename: string; byteCount: number; startedAt: number }
  | { phase: "stored"; source: StoredSource }
  | { phase: "failed"; filename: string; problem: ImportProblem };

export type InspectionState =
  | { phase: "none" }
  | { phase: "inspecting"; hints: DialectHints | null; startedAt: number }
  | { phase: "ready"; hints: DialectHints | null; answer: CsvInspectionAnswer }
  | { phase: "failed"; hints: DialectHints | null; problem: ImportProblem };

export type InterpretationState =
  | { phase: "none" }
  | { phase: "preparing"; request: ConfirmMappingRequest; startedAt: number }
  | { phase: "answered"; request: ConfirmMappingRequest; answer: InterpretationAnswer }
  | { phase: "failed"; request: ConfirmMappingRequest; problem: ImportProblem };

/** The cutoff proposed from the data for the current reading, while every choice but the cutoff is made. */
export type ProposalState =
  | { phase: "none" }
  | { phase: "proposing"; request: ConfirmMappingRequest }
  | { phase: "ready"; request: ConfirmMappingRequest; answer: CutoffProposal }
  | { phase: "failed"; request: ConfirmMappingRequest; problem: ImportProblem };

export interface DataState {
  revision: number;
  workspace: WorkspaceState;
  /** What the workspace holds: as listed when it was opened, and what was added since. */
  sources: StoredSource[];
  preparations: StoredPreparation[];
  source: SourceState;
  inspection: InspectionState;
  /** How the inspection without hints read the current source; a reading asked for is not a detection. */
  detected: Dialect | null;
  draft: Draft;
  proposal: ProposalState;
  interpretation: InterpretationState;
  /** The packaged example the current source was loaded from; it is first read with the example's fixed reading. */
  example: WorkspaceExample | null;
}

type Stage = "workspace" | "source" | "inspection" | "proposal" | "interpretation";

const initialState: DataState = {
  revision: 0,
  workspace: { phase: "none" },
  sources: [],
  preparations: [],
  source: { phase: "none" },
  inspection: { phase: "none" },
  detected: null,
  draft: emptyDraft,
  proposal: { phase: "none" },
  interpretation: { phase: "none" },
  example: null,
};

const unreachable: ImportOutcome<never> = { ok: false, problem: { kind: "unreachable" } };

function mismatch(detail: string): ImportOutcome<never> {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

/**
 * Holds the choices of the Data area and is the only place where replies to them are published.
 * Every request carries a new query revision; a reply is published only while its request is the
 * current one of its stage, and a later step is cleared whenever an earlier one changes: a new
 * workspace clears the source, a new source or reading clears the inspection, and any changed
 * choice clears the interpretation report.
 *
 * Once every choice but the cutoff is made, the cutoff is proposed from the data and fills the
 * cutoff field unless the analyst set it; a change of a choice the proposal depends on asks again.
 */
export class DataCoordinator {
  private state: DataState = initialState;
  private revision = 0;
  /** The column names of the last inspection of the current source, to keep choices that still apply. */
  private columns: string[] | null = null;
  /** The reading the current proposal was asked for, without its envelope; null when none was. */
  private proposalKey: string | null = null;
  private readonly current = new Map<Stage, { requestId: string; controller: AbortController }>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly client: ImportClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): DataState => this.state;

  openWorkspace(path: string): void {
    const { requestId, revision, signal } = this.issue("workspace", ["source", "inspection", "proposal", "interpretation"]);
    const request: OpenWorkspaceRequest = {
      schema_version: 1,
      message_type: "open_workspace_request",
      request_id: requestId,
      query_revision: revision,
      path,
    };
    this.columns = null;
    this.proposalKey = null;
    this.publish({
      ...initialState,
      revision,
      workspace: { phase: "opening", path, startedAt: this.now().getTime() },
    });
    this.client.openWorkspace(request, signal).then(
      (outcome) => this.receiveWorkspace(request, path, outcome),
      () => this.receiveWorkspace(request, path, unreachable),
    );
  }

  /** Opens the application's own workspace folder; the local service creates it when it is not there yet. */
  openDefaultWorkspace(): void {
    const { requestId, revision, signal } = this.issue("workspace", ["source", "inspection", "proposal", "interpretation"]);
    const request: OpenDefaultWorkspaceRequest = {
      schema_version: 1,
      message_type: "open_default_workspace_request",
      request_id: requestId,
      query_revision: revision,
    };
    this.columns = null;
    this.proposalKey = null;
    this.publish({
      ...initialState,
      revision,
      workspace: { phase: "opening", path: null, startedAt: this.now().getTime() },
    });
    this.client.openDefaultWorkspace(request, signal).then(
      (outcome) => this.receiveWorkspace(request, null, outcome),
      () => this.receiveWorkspace(request, null, unreachable),
    );
  }

  /** Sends a file's bytes to the workspace and inspects them once they are stored. */
  addSource(file: File): void {
    if (this.state.workspace.phase !== "open") return;
    this.upload(file, file.name || "source.csv", null, this.issue("source", ["inspection", "proposal", "interpretation"]));
  }

  /**
   * Stores the bytes of a packaged example in the workspace like any source, inspects them, and
   * reads them with the example's fixed reading; rows with issues still wait for the analyst.
   */
  loadExample(example: WorkspaceExample): void {
    if (this.state.workspace.phase !== "open") return;
    const issued = this.issue("source", ["inspection", "proposal", "interpretation"]);
    this.columns = null;
    this.proposalKey = null;
    this.publish({
      ...this.state,
      revision: issued.revision,
      source: { phase: "fetching", filename: example.filename, startedAt: this.now().getTime() },
      inspection: { phase: "none" },
      detected: null,
      proposal: { phase: "none" },
      interpretation: { phase: "none" },
      draft: emptyDraft,
      example: null,
    });
    const receive = (outcome: ImportOutcome<Blob>) => {
      if (this.current.get("source")?.requestId !== issued.requestId) return;
      if (outcome.ok) {
        this.upload(outcome.answer, example.filename, example, this.issue("source", ["inspection", "proposal", "interpretation"]));
      } else {
        this.current.delete("source");
        this.publish({ ...this.state, source: { phase: "failed", filename: example.filename, problem: outcome.problem } });
      }
    };
    this.client.exampleSource(example.id, issued.signal).then(receive, () => receive(unreachable));
  }

  private upload(
    bytes: Blob,
    filename: string,
    example: WorkspaceExample | null,
    { requestId, revision, signal }: { requestId: string; revision: number; signal: AbortSignal },
  ): void {
    const workspace = this.state.workspace;
    if (workspace.phase !== "open") return;
    const metadata: UploadSourceMetadata = {
      schema_version: 1,
      message_type: "upload_source_metadata",
      request_id: requestId,
      query_revision: revision,
      workspace_id: workspace.answer.workspace_id,
      filename,
    };
    this.columns = null;
    this.proposalKey = null;
    this.publish({
      ...this.state,
      revision,
      source: { phase: "uploading", filename, byteCount: bytes.size, startedAt: this.now().getTime() },
      inspection: { phase: "none" },
      detected: null,
      proposal: { phase: "none" },
      interpretation: { phase: "none" },
      draft: emptyDraft,
      example: null,
    });
    this.client.uploadSource(metadata, bytes, signal).then(
      (outcome) => this.receiveSource(metadata, example, outcome),
      () => this.receiveSource(metadata, example, unreachable),
    );
  }

  /** Continues with a source the workspace already holds. */
  useSource(source: StoredSource): void {
    if (this.state.workspace.phase !== "open") return;
    this.abort(["source", "inspection", "proposal", "interpretation"]);
    this.columns = null;
    this.proposalKey = null;
    this.publish({
      ...this.state,
      source: { phase: "stored", source },
      detected: null,
      draft: emptyDraft,
      proposal: { phase: "none" },
      interpretation: { phase: "none" },
      example: null,
    });
    this.inspect(null);
  }

  /** Inspects the current source, with the encoding or delimiter the analyst asked for. */
  inspect(hints: DialectHints | null): void {
    const { workspace, source } = this.state;
    if (workspace.phase !== "open" || source.phase !== "stored") return;
    const { requestId, revision, signal } = this.issue("inspection", ["proposal", "interpretation"]);
    this.proposalKey = null;
    const request: InspectCsvRequest = {
      schema_version: 1,
      message_type: "inspect_csv_request",
      request_id: requestId,
      query_revision: revision,
      workspace_id: workspace.answer.workspace_id,
      source_id: source.source.source_id,
      ...(hints === null ? {} : { hints }),
    };
    const draft = { ...this.state.draft, encoding: hints?.encoding ?? this.state.draft.encoding, delimiter: hints?.delimiter ?? this.state.draft.delimiter };
    this.publish({
      ...this.state,
      revision,
      draft,
      inspection: { phase: "inspecting", hints, startedAt: this.now().getTime() },
      proposal: { phase: "none" },
      interpretation: { phase: "none" },
    });
    this.client.inspect(request, signal).then(
      (outcome) => this.receiveInspection(request, hints, outcome),
      () => this.receiveInspection(request, hints, unreachable),
    );
  }

  /** Changes the analyst's choices; a report of earlier choices no longer applies and is cleared. */
  choose(change: Partial<Draft>): void {
    const previous = this.state.draft;
    let draft: Draft = { ...previous, ...change };
    if ("timestampColumn" in change && change.timestampColumn !== previous.timestampColumn) {
      const inspection = this.state.inspection;
      const suggestion =
        inspection.phase === "ready" ? inspection.answer.role_suggestions.find((item) => item.column_index === change.timestampColumn) : undefined;
      draft = { ...draft, timeFormat: change.timeFormat ?? formatEvidence(suggestion).proposed };
    }
    if ("cutoff" in change) draft = { ...draft, cutoffEdited: true };
    this.abort(["interpretation"]);
    const settled = this.settleProposal(draft);
    this.publish({ ...this.state, draft: settled.draft, proposal: settled.proposal, interpretation: { phase: "none" } });
    settled.send?.();
  }

  /** Puts the proposed cutoff into the cutoff field; later proposals follow again. */
  useProposal(): void {
    const proposal = this.state.proposal;
    if (proposal.phase !== "ready" || proposal.answer.proposed_cutoff === null) return;
    this.abort(["interpretation"]);
    this.publish({
      ...this.state,
      draft: { ...this.state.draft, cutoff: cutoffFieldValue(proposal.answer.proposed_cutoff), cutoffEdited: false },
      interpretation: { phase: "none" },
    });
  }

  /** Asks the local service to read the source with the current choices. */
  confirm(acceptReportIssues: boolean): void {
    const { workspace, source } = this.state;
    if (workspace.phase !== "open" || source.phase !== "stored") return;
    const ids = { workspaceId: workspace.answer.workspace_id, sourceId: source.source.source_id };
    if (confirmationOf(this.state.draft, ids, { requestId: "check", revision: 1 }, acceptReportIssues) === null) return;
    const { requestId, revision, signal } = this.issue("interpretation", []);
    const request = confirmationOf(this.state.draft, ids, { requestId, revision }, acceptReportIssues);
    if (request === null) return;
    this.publish({ ...this.state, revision, interpretation: { phase: "preparing", request, startedAt: this.now().getTime() } });
    this.client.confirmMapping(request, signal).then(
      (outcome) => this.receiveInterpretation(request, outcome),
      () => this.receiveInterpretation(request, unreachable),
    );
  }

  /** Stops waiting for the current work; its reply is dropped when it arrives. */
  stopWaiting(): void {
    const { workspace, source, inspection, interpretation } = this.state;
    if (interpretation.phase === "preparing") {
      this.abort(["interpretation"]);
      this.publish({ ...this.state, interpretation: { phase: "none" } });
    } else if (inspection.phase === "inspecting") {
      this.abort(["inspection"]);
      this.publish({ ...this.state, inspection: { phase: "none" } });
    } else if (source.phase === "uploading" || source.phase === "fetching") {
      this.abort(["source"]);
      this.publish({ ...this.state, source: { phase: "none" } });
    } else if (workspace.phase === "opening") {
      this.abort(["workspace"]);
      this.publish({ ...this.state, workspace: { phase: "none" } });
    }
  }

  /** Abandons every outstanding request without publishing. */
  stop(): void {
    this.abort(["workspace", "source", "inspection", "proposal", "interpretation"]);
  }

  /**
   * The draft and proposal after a change of the draft. When the reading the proposal depends on
   * changed, the earlier proposal no longer applies: a cutoff it filled is cleared, and a new
   * proposal is asked for once every choice but the cutoff is made.
   */
  private settleProposal(draft: Draft): { draft: Draft; proposal: ProposalState; send: (() => void) | null } {
    const { workspace, source } = this.state;
    const ids =
      workspace.phase === "open" && source.phase === "stored"
        ? { workspaceId: workspace.answer.workspace_id, sourceId: source.source.source_id }
        : null;
    const unsent = ids === null ? null : proposalRequestOf(draft, ids, { requestId: "proposal", revision: 1 });
    const key = unsent === null ? null : JSON.stringify(unsent);
    if (key === this.proposalKey) return { draft, proposal: this.state.proposal, send: null };
    this.abort(["proposal"]);
    this.proposalKey = key;
    const cleared = draft.cutoffEdited ? draft : { ...draft, cutoff: "" };
    if (ids === null || unsent === null) return { draft: cleared, proposal: { phase: "none" }, send: null };
    const { requestId, revision, signal } = this.issue("proposal", []);
    const request = proposalRequestOf(draft, ids, { requestId, revision })!;
    const send = () =>
      this.client.proposeCutoff(request, signal).then(
        (outcome) => this.receiveProposal(request, outcome),
        () => this.receiveProposal(request, unreachable),
      );
    return { draft: cleared, proposal: { phase: "proposing", request }, send };
  }

  private issue(stage: Stage, later: Stage[]): { requestId: string; revision: number; signal: AbortSignal } {
    this.abort([stage, ...later]);
    this.revision += 1;
    const requestId = `${stage}-${this.revision}`;
    const controller = new AbortController();
    this.current.set(stage, { requestId, controller });
    return { requestId, revision: this.revision, signal: controller.signal };
  }

  private abort(stages: Stage[]): void {
    for (const stage of stages) {
      this.current.get(stage)?.controller.abort();
      this.current.delete(stage);
    }
  }

  /** Whether a reply answers the current request of its stage; ends that request if so. */
  private isCurrent(stage: Stage, requestId: string): boolean {
    if (this.current.get(stage)?.requestId !== requestId) return false;
    this.current.delete(stage);
    return true;
  }

  private receiveWorkspace(
    request: OpenWorkspaceRequest | OpenDefaultWorkspaceRequest,
    path: string | null,
    outcome: ImportOutcome<WorkspaceAnswer>,
  ): void {
    if (!this.isCurrent("workspace", request.request_id)) return;
    const checked = outcome.ok ? checkEcho(request, outcome.answer) : checkProblem(request, outcome.problem);
    this.publish(
      checked.ok
        ? {
            ...this.state,
            workspace: { phase: "open", answer: checked.answer, own: path === null },
            sources: checked.answer.sources,
            preparations: checked.answer.preparations,
          }
        : { ...this.state, workspace: { phase: "failed", path, problem: checked.problem } },
    );
  }

  private receiveSource(metadata: UploadSourceMetadata, example: WorkspaceExample | null, outcome: ImportOutcome<SourceAnswer>): void {
    if (!this.isCurrent("source", metadata.request_id)) return;
    const checked = outcome.ok ? checkEcho(metadata, outcome.answer) : checkProblem(metadata, outcome.problem);
    if (!checked.ok) {
      this.publish({ ...this.state, source: { phase: "failed", filename: metadata.filename, problem: checked.problem } });
      return;
    }
    const source = checked.answer.source;
    const sources = this.state.sources.some((item) => item.source_id === source.source_id)
      ? this.state.sources
      : [...this.state.sources, source];
    this.publish({ ...this.state, sources, source: { phase: "stored", source }, example });
    this.inspect(null);
  }

  private receiveInspection(
    request: InspectCsvRequest,
    hints: DialectHints | null,
    outcome: ImportOutcome<CsvInspectionAnswer>,
  ): void {
    if (!this.isCurrent("inspection", request.request_id)) return;
    let checked = outcome.ok ? checkEcho(request, outcome.answer) : checkProblem(request, outcome.problem);
    if (checked.ok && checked.answer.source_id !== request.source_id) checked = mismatch("The reply describes another source.");
    if (!checked.ok) {
      this.publish({ ...this.state, inspection: { phase: "failed", hints, problem: checked.problem } });
      return;
    }
    const columns = checked.answer.columns.map((column) => column.name);
    // The first inspection of an example's bytes takes the example's fixed reading, if the columns are the example's.
    const fixed =
      this.state.example !== null &&
      hints === null &&
      this.columns === null &&
      columns.length === exampleColumns.length &&
      columns.every((name, index) => name === exampleColumns[index]);
    const draft = fixed ? exampleReading : draftAfterInspection(this.state.draft, this.columns, checked.answer);
    this.columns = columns;
    const detected = hints === null ? (checked.answer.dialect_candidates[0] ?? null) : this.state.detected;
    const settled = this.settleProposal(draft);
    this.publish({
      ...this.state,
      inspection: { phase: "ready", hints, answer: checked.answer },
      detected,
      draft: settled.draft,
      proposal: settled.proposal,
    });
    settled.send?.();
    if (fixed) this.confirm(false);
  }

  private receiveProposal(request: ConfirmMappingRequest, outcome: ImportOutcome<CutoffProposal>): void {
    if (!this.isCurrent("proposal", request.request_id)) return;
    let checked = outcome.ok ? checkEcho(request, outcome.answer) : checkProblem(request, outcome.problem);
    if (checked.ok && checked.answer.source_id !== request.source_id) checked = mismatch("The reply describes another source.");
    const wall = request.policies.time.id === "incident.time.wall_clock_as_recorded.v1";
    if (checked.ok && (checked.answer.timestamp_kind === "wall_clock") !== wall) checked = mismatch("The proposal is on another clock than the one chosen.");
    if (!checked.ok) {
      this.publish({ ...this.state, proposal: { phase: "failed", request, problem: checked.problem } });
      return;
    }
    const proposed = checked.answer.proposed_cutoff;
    const fill = proposed !== null && !this.state.draft.cutoffEdited;
    this.publish({
      ...this.state,
      proposal: { phase: "ready", request, answer: checked.answer },
      draft: fill ? { ...this.state.draft, cutoff: cutoffFieldValue(proposed) } : this.state.draft,
    });
  }

  private receiveInterpretation(request: ConfirmMappingRequest, outcome: ImportOutcome<InterpretationAnswer>): void {
    if (!this.isCurrent("interpretation", request.request_id)) return;
    let checked = outcome.ok ? checkEcho(request, outcome.answer) : checkProblem(request, outcome.problem);
    if (checked.ok) checked = checkInterpretation(request, checked.answer);
    if (!checked.ok) {
      this.publish({ ...this.state, interpretation: { phase: "failed", request, problem: checked.problem } });
      return;
    }
    const preparation = checked.answer.preparation;
    const preparations =
      preparation === null || this.state.preparations.some((item) => item.preparation_id === preparation.preparation_id)
        ? this.state.preparations
        : [...this.state.preparations, { preparation_id: preparation.preparation_id, source_id: preparation.source_id }];
    this.publish({ ...this.state, preparations, interpretation: { phase: "answered", request, answer: checked.answer } });
  }

  private publish(state: DataState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

interface Envelope {
  request_id: string;
  query_revision: number;
  workspace_id?: string;
}

/** A refusal that names another request, revision or workspace does not answer this one. */
function checkProblem(request: Envelope, problem: ImportProblem): ImportOutcome<never> {
  if (problem.kind === "refusal") {
    const { request_id, query_revision, workspace_id } = problem.refusal;
    if (
      (request_id !== null && request_id !== request.request_id) ||
      (query_revision !== null && query_revision !== request.query_revision) ||
      (workspace_id !== null && request.workspace_id !== undefined && workspace_id !== request.workspace_id)
    ) {
      return mismatch("The refusal names a different request, query revision or workspace.");
    }
  }
  return { ok: false, problem };
}

function checkEcho<T extends Envelope>(request: Envelope, answer: T): ImportOutcome<T> {
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision) {
    return mismatch("The reply names a different request or query revision.");
  }
  if (request.workspace_id !== undefined && answer.workspace_id !== request.workspace_id) {
    return mismatch("The reply belongs to a different workspace.");
  }
  return { ok: true, answer };
}

function checkInterpretation(request: ConfirmMappingRequest, answer: InterpretationAnswer): ImportOutcome<InterpretationAnswer> {
  if (answer.source_id !== request.source_id) return mismatch("The reply describes another source.");
  const preparation = answer.preparation;
  if (preparation !== null) {
    if (
      preparation.source_id !== request.source_id ||
      !sameJson(preparation.dialect, request.dialect) ||
      !sameJson(preparation.mapping, request.mapping) ||
      !sameJson(preparation.policies, request.policies)
    ) {
      return mismatch("The preparation was made from other choices than the ones confirmed.");
    }
  }
  return { ok: true, answer };
}

export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && sameJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}
