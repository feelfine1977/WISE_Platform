import type {
  AnswerIdentity,
  ListSavedAnswer,
  ListSavedRequest,
  PopulationSupport,
  ReopenInvestigationAnswer,
  ReopenInvestigationRequest,
  SaveInvestigationAnswer,
  SaveInvestigationRequest,
  SavedComparison,
  SavedInvestigationContent,
  SavedInvestigationSummary,
  SavingRefusal,
} from "../generated/saving";
import type { SavingClient, SavingOutcome } from "../saved/client";
import { identity, preparationId, sourceId } from "./imports";
import { contains, opened, parent, parentPopulation, support } from "./selections";

/*
 * Saving answers written by hand for the population of `populationAnswer` in ./imports.ts and the
 * selections of ./selections.ts: incidents A-1 (two records, "Eröffnet" then "Geschlossen") and
 * B-2 (one record "Prüfung" whose order is not known). The step "contains Eröffnet" keeps A-1 with
 * its 2 records and removes B-2 with its 1 record; its selection is named by the digit 5.
 */

const hex = (digit: string) => digit.repeat(64);

export const investigationId = "investigation.v1:0a1b2c3d-saved";
export const firstRevisionId = `saved-revision.v1:sha256:${hex("b")}`;
export const secondRevisionId = `saved-revision.v1:sha256:${hex("c")}`;

export const baseIdentity: AnswerIdentity = { ...identity, preparation_id: preparationId };
export const containingOpenedIdentity: AnswerIdentity = { ...baseIdentity, population_id: `population.v1:sha256:${hex("5")}` };

/** Group A-1 as the target against B-2 as the reference, of the parent of both. */
export const savedComparison: SavedComparison = {
  kind: "group",
  comparison_id: `comparison.v1:sha256:${hex("d")}`,
  parent_case_ids: ["A-1", "B-2"],
  context_column_index: 3,
  context_policy: "incident.context.first_record_in_declared_order.v1",
  definition: {
    mode: "two_named_groups",
    target: { name: "Geöffnet", definition: { kind: "explicit_case_ids", case_ids: ["A-1"] } },
    reference: { name: "Ungeordnet", definition: { kind: "explicit_case_ids", case_ids: ["B-2"] } },
  },
};

/** The saved question "contains Eröffnet" on the parent of both incidents, with the comparison above. */
export const savedContent: SavedInvestigationContent = {
  format_version: 1,
  name: "Eröffnungen",
  base_identity: baseIdentity,
  selection_identity: containingOpenedIdentity,
  selection_recipe: { parent_case_ids: ["A-1", "B-2"], predicates: [contains(opened)] },
  context_policy: "incident.context.first_record_in_declared_order.v1",
  comparison: savedComparison,
  notes: "Only A-1 was opened in a known order.",
  bookmarks: [],
  score_run_ref: null,
};

export const savedSummary: SavedInvestigationSummary = {
  investigation_id: investigationId,
  latest_revision_id: secondRevisionId,
  name: "Eröffnungen",
  source_id: sourceId,
  preparation_id: preparationId,
  selected_case_count: 1,
  selected_record_count: 2,
  comparison_kind: "group",
  has_score_run: false,
  source_validation: "not_checked",
};

/** The answer to a save: the content of the request, saved as the given revision. */
export function saveAnswer(request: SaveInvestigationRequest, revisionId: string, created: boolean, changed = true): SaveInvestigationAnswer {
  return {
    schema_version: 1,
    message_type: "save_investigation_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    revision: {
      investigation_id: request.investigation_id ?? investigationId,
      saved_revision_id: revisionId,
      content: {
        format_version: 1,
        name: request.name,
        base_identity: request.base_identity,
        selection_identity: request.selection_identity,
        selection_recipe: request.selection_recipe,
        context_policy: request.context_policy,
        comparison: request.comparison,
        notes: request.notes,
        bookmarks: request.bookmarks,
        score_run_ref: null,
      },
    },
    created_investigation: created,
    semantic_change: changed,
    recovery: { presentation_state: request.presentation_state ?? null, warnings: [] },
  };
}

export function listAnswer(request: ListSavedRequest, investigations: SavedInvestigationSummary[]): ListSavedAnswer {
  return {
    schema_version: 1,
    message_type: "list_saved_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    investigations,
  };
}

const none: PopulationSupport = support([], 0);

/** The answer to reopening `savedContent`, saved in the given view. */
export function reopenAnswer(request: ReopenInvestigationRequest, view: "incidents" | "process_map" = "incidents"): ReopenInvestigationAnswer {
  return {
    schema_version: 1,
    message_type: "reopen_investigation_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    revision: { investigation_id: investigationId, saved_revision_id: request.saved_revision_id, content: savedContent },
    restored_selection: {
      identity: containingOpenedIdentity,
      parent_identity: { ...baseIdentity, population_id: parentPopulation },
      parent,
      kept: support(["A-1"], 2),
      removed: support(["B-2"], 1),
      unevaluable: none,
      predicate_results: [{ predicate: contains(opened), kept: support(["A-1"], 2), removed: support(["B-2"], 1), unevaluable: none }],
    },
    restored_comparison_id: savedComparison.comparison_id,
    recovery: {
      presentation_state: { active_view: view, table_sorts: [], flow_artifact_sha256: null, graph_positions: null },
      warnings: [],
    },
  };
}

const retryable = new Set(["workspace_unavailable", "publication_failed", "computation_failed"]);

export function savingRefusal(
  request: { request_id: string; query_revision: number; workspace_id: string },
  operation: SavingRefusal["operation"],
  code: SavingRefusal["code"],
  message: string,
  conflict: Pick<SavingRefusal, "investigation_id" | "expected_revision_id" | "current_revision_id"> = {},
): SavingOutcome<never> {
  return {
    ok: false,
    problem: {
      kind: "refusal",
      refusal: {
        schema_version: 1,
        message_type: "saving_refusal",
        request_id: request.request_id,
        query_revision: request.query_revision,
        workspace_id: request.workspace_id,
        operation,
        code,
        message,
        field: null,
        retryable: retryable.has(code),
        ...conflict,
      },
    },
  };
}

interface Call<Request, Answer> {
  request: Request;
  signal: AbortSignal;
  reply: (outcome: SavingOutcome<Answer>) => void;
}

/** A saving client whose replies the test delivers. */
export function scriptedSavingClient() {
  const saves: Call<SaveInvestigationRequest, SaveInvestigationAnswer>[] = [];
  const lists: Call<ListSavedRequest, ListSavedAnswer>[] = [];
  const reopens: Call<ReopenInvestigationRequest, ReopenInvestigationAnswer>[] = [];
  const client: SavingClient = {
    save: (request, signal) => new Promise((reply) => saves.push({ request, signal, reply })),
    listSaved: (request, signal) => new Promise((reply) => lists.push({ request, signal, reply })),
    reopen: (request, signal) => new Promise((reply) => reopens.push({ request, signal, reply })),
  };
  return { client, saves, lists, reopens };
}
