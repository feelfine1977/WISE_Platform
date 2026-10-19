import type {
  NodeMetrics,
  PopulationSupport,
  PredicateResult,
  ProcessGraphAnswer,
  ProcessGraphRequest,
  SelectCasesRequest,
  SelectionAnswer,
  SelectionPredicate,
  SelectionRefusal,
  SuppliedGraph,
} from "../generated/selection";
import type { SelectionClient, SelectionOutcome } from "../map/client";

/*
 * Selection answers and maps written by hand for the population of `populationAnswer` in
 * ./imports.ts: incident A-1 with two records, "Eröffnet" and then "Geschlossen" a day and a half
 * hour later, in a known order; incident B-2 with one record "Prüfung" whose time is not readable,
 * so its order is not known. The figures below are worked out from that description alone.
 *
 * The one passage is that of A-1 from "Eröffnet" to "Geschlossen", 25.5 hours long: it is the time
 * until the next event of "Eröffnet" and the time since the event before of "Geschlossen". No
 * passage leads into or out of "Prüfung".
 */

const hex = (digit: string) => digit.repeat(64);

export const opened = "Eröffnet";
export const closed = "Geschlossen";
export const checked = "Prüfung";

export const nodeIds = {
  [opened]: `activity.v1:sha256:${hex("1")}`,
  [closed]: `activity.v1:sha256:${hex("2")}`,
  [checked]: `activity.v1:sha256:${hex("3")}`,
};
export const pathId = `path.v1:sha256:${hex("4")}`;

export function support(caseIds: string[], records: number): PopulationSupport {
  return { case_ids: caseIds, case_count: caseIds.length, record_count: records };
}

export const contains = (activity: string, negate = false): SelectionPredicate => ({ kind: "contains_activity", activity, negate });
export const follows = (source: string, target: string, negate = false): SelectionPredicate => ({
  kind: "directly_follows",
  source_activity: source,
  target_activity: target,
  negate,
});
export const begins = (activity: string, negate = false): SelectionPredicate => ({ kind: "starts_with_activity", activity, negate });
export const ends = (activity: string, negate = false): SelectionPredicate => ({ kind: "ends_with_activity", activity, negate });

export interface Figures {
  /** The digit of the selected population's identity, so that every selection is named apart. */
  population: string;
  kept: PopulationSupport;
  removed: PopulationSupport;
  unevaluable: PopulationSupport;
  results: Omit<PredicateResult, "predicate">[];
}

/** The parent of every selection here: both incidents with their three records. */
export const parent = support(["A-1", "B-2"], 3);
export const parentPopulation = `population.v1:sha256:${hex("f")}`;

export function selectionAnswer(request: SelectCasesRequest, figures: Figures): SelectionAnswer {
  return {
    schema_version: 1,
    message_type: "selection_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: { ...request.identity, population_id: `population.v1:sha256:${hex(figures.population)}` },
    parent_identity: { ...request.identity, population_id: parentPopulation },
    parent,
    kept: figures.kept,
    removed: figures.removed,
    unevaluable: figures.unevaluable,
    predicate_results: request.predicates.map((predicate, index) => ({ predicate, ...figures.results[index] })),
  };
}

/** No step: every incident is kept. */
export const everyIncident: Figures = { population: "f", kept: parent, removed: support([], 0), unevaluable: support([], 0), results: [] };

/** Keep incidents that contain "Eröffnet": A-1 contains it, B-2 does not. */
export const containingOpened: Figures = {
  population: "5",
  kept: support(["A-1"], 2),
  removed: support(["B-2"], 1),
  unevaluable: support([], 0),
  results: [{ kept: support(["A-1"], 2), removed: support(["B-2"], 1), unevaluable: support([], 0) }],
};

/** Keep incidents where "Geschlossen" directly follows "Eröffnet": B-2's order is not known. */
export const followingOpened: Figures = {
  population: "6",
  kept: support(["A-1"], 2),
  removed: support([], 0),
  unevaluable: support(["B-2"], 1),
  results: [{ kept: support(["A-1"], 2), removed: support([], 0), unevaluable: support(["B-2"], 1) }],
};

/** Both steps: B-2 is removed by the first, which decides over its unknown order. */
export const bothSteps: Figures = {
  population: "7",
  kept: support(["A-1"], 2),
  removed: support(["B-2"], 1),
  unevaluable: support([], 0),
  results: [containingOpened.results[0], followingOpened.results[0]],
};

/** Keep incidents that do not contain "Eröffnet". */
export const withoutOpened: Figures = {
  population: "8",
  kept: support(["B-2"], 1),
  removed: support(["A-1"], 2),
  unevaluable: support([], 0),
  results: [{ kept: support(["B-2"], 1), removed: support(["A-1"], 2), unevaluable: support([], 0) }],
};

type Times = Pick<NodeMetrics, "medianPreviousHours" | "usablePreviousCount" | "medianNextHours" | "usableNextCount">;
const noPassage: Times = { usablePreviousCount: 0, usableNextCount: 0 };

const activity = (label: keyof typeof nodeIds, events: number, starts: number, ends: number, times: Times = noPassage) => ({
  id: nodeIds[label],
  kind: "activity" as const,
  label,
  metrics: { count: events, events, cases: events, starts, ends, ...times },
});

/** The map of the given incidents of the population: A-1, B-2 or both. */
export function suppliedGraph(caseIds: string[]): SuppliedGraph {
  const withA = caseIds.includes("A-1");
  const withB = caseIds.includes("B-2");
  return {
    nodes: [
      ...(withA
        ? [
            activity(opened, 1, 1, 0, { usablePreviousCount: 0, medianNextHours: 25.5, usableNextCount: 1 }),
            activity(closed, 1, 0, 1, { medianPreviousHours: 25.5, usablePreviousCount: 1, usableNextCount: 0 }),
          ]
        : []),
      ...(withB ? [activity(checked, 1, 0, 0)] : []),
    ],
    edges: withA
      ? [
          {
            id: pathId,
            kind: "follows",
            source: nodeIds[opened],
            target: nodeIds[closed],
            metrics: { count: 1, cases: 1, medianLagHours: 25.5, usableLagCount: 1 },
            payload: { source_activity: opened, target_activity: closed, case_ids: ["A-1"], gap_case_ids: [], omitted_row_ids: [], bridged_passage_count: 0 },
          },
        ]
      : [],
    meta: {
      representation_id: `representation.v1:sha256:${hex("9")}`,
      case_dictionary_id: `case-dictionary.v1:sha256:${hex("a")}`,
      selected_case_ids: caseIds,
      sequence_evaluable_case_ids: withA ? ["A-1"] : [],
      sequence_unevaluable_case_ids: withB ? ["B-2"] : [],
      selected_case_count: caseIds.length,
      cases: caseIds.length,
      events: (withA ? 2 : 0) + (withB ? 1 : 0),
      raw_record_count: (withA ? 2 : 0) + (withB ? 1 : 0),
      mapped_record_count: (withA ? 2 : 0) + (withB ? 1 : 0),
      omitted_activity_record_count: 0,
      sequence_evaluable_case_count: withA ? 1 : 0,
      sequence_unevaluable_case_count: withB ? 1 : 0,
      sequence_unevaluable_record_count: withB ? 1 : 0,
      node_case_denominator: caseIds.length,
      path_case_denominator: withA ? 1 : 0,
      node_support_basis: "all_selected_raw_histories",
      path_support_basis: "sequence_evaluable_cases",
      activity_projection_policy: "incident.activity.omit_missing_retain_raw_gaps.v1",
      path_adjacency: "mapped_sequence_with_disclosed_raw_gaps",
      boundary_support_basis: "sequence_evaluable_cases_with_labeled_raw_boundaries",
      lag_unit: "hours",
      boundary_policy: "incident.boundary.raw_labeled_start_end.v1",
      timestamp_kind: "utc_instant",
      lag_clock: "elapsed_utc_hours",
      clock_limitation: null,
    },
  };
}

export function graphAnswer(request: ProcessGraphRequest, caseIds: string[]): ProcessGraphAnswer {
  return {
    schema_version: 1,
    message_type: "process_graph_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: request.identity,
    graph: suppliedGraph(caseIds),
  };
}

export function selectionRefusal(
  request: { request_id: string; query_revision: number; workspace_id: string },
  operation: SelectionRefusal["operation"],
  code: SelectionRefusal["code"],
  message: string,
): SelectionOutcome<never> {
  return {
    ok: false,
    problem: {
      kind: "refusal",
      refusal: {
        schema_version: 1,
        message_type: "selection_refusal",
        request_id: request.request_id,
        query_revision: request.query_revision,
        workspace_id: request.workspace_id,
        operation,
        code,
        message,
        field: null,
        retryable: ["workspace_unavailable", "source_unavailable", "preparation_unavailable", "population_unavailable", "computation_failed"].includes(code),
      },
    },
  };
}

interface Call<Request, Answer> {
  request: Request;
  signal: AbortSignal;
  reply: (outcome: SelectionOutcome<Answer>) => void;
}

/** A selection client whose replies the test delivers. */
export function scriptedSelectionClient() {
  const selections: Call<SelectCasesRequest, SelectionAnswer>[] = [];
  // A preview counts a step before it is taken; it is kept apart from the selections taken.
  const previews: Call<SelectCasesRequest, SelectionAnswer>[] = [];
  const graphs: Call<ProcessGraphRequest, ProcessGraphAnswer>[] = [];
  const client: SelectionClient = {
    selectCases: (request, signal) =>
      new Promise((reply) => (request.request_id.startsWith("preview-") ? previews : selections).push({ request, signal, reply })),
    processGraph: (request, signal) => new Promise((reply) => graphs.push({ request, signal, reply })),
  };
  return { client, selections, previews, graphs };
}
