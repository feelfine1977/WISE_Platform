import type { ImportedPopulationAnswer, OpenPopulationRequest } from "../generated/imports";
import type { PopulationViewClient, ViewOutcome } from "../views/client";
import type {
  OpeningContextAnswer,
  OpeningContextRequest,
  PopulationViewRefusal,
  Variant,
  VariantsAnswer,
  VariantsRequest,
} from "../views/messages";
import { populationAnswer } from "./imports";

/*
 * Answers written by hand in the shape the local service sends. The numbers are worked out here
 * from the five incidents below; they are not taken from any implementation.
 *
 *   K-1  Eröffnet, Weitergeleitet, Weitergeleitet, Gelöst   Gruppe Büro     Priorität P1
 *   K-2  Eröffnet, Gelöst                                   Gruppe Büro     Priorität P1
 *   K-3  Eröffnet, Weitergeleitet, Weitergeleitet, Gelöst   Gruppe Unknown  Priorität P3
 *   K-4  one record without an activity label               Gruppe missing  Priorität P2
 *   K-5  three records, one without a readable time: its order is not known
 *
 * Parent: 5 incidents, 4 with a readable first record. Gruppe: Büro 2 of 4, Unknown 1 of 4,
 * missing 1 of 4. Priorität, at most 2 values listed: P1 2 of 4, P2 1 of 4 (P2 and P3 tie; P2 comes
 * first as text), then P3 1 of 4 as the remainder.
 * The selection {K-1, K-3}: Büro 1 of 2, Unknown 1 of 2, missing 0 of 2 (−25 points);
 * P1 1 of 2 (±0), P3 1 of 2 (+25), and P2 0 of 2 (−25) in the remainder.
 * Variants of the parent, over the 4 incidents in a known order: K-1 and K-3 (2, 50%), the empty
 * sequence of K-4 (1, 25%), K-2 (1, 25%); K-5 in no variant.
 */

const hex = (digit: string) => digit.repeat(64);

export function viewPopulationAnswer(request: OpenPopulationRequest): ImportedPopulationAnswer {
  const summary = (case_id: string, record_count: number, omitted: number, sequence_evaluable = true) => ({
    case_id,
    record_count,
    mapped_record_count: record_count - omitted,
    omitted_activity_record_count: omitted,
    sequence_evaluable,
  });
  const cases = [summary("K-1", 4, 0), summary("K-2", 2, 0), summary("K-3", 4, 0), summary("K-4", 1, 1), summary("K-5", 3, 0, false)];
  return {
    ...populationAnswer(request),
    population: { case_ids: cases.map((item) => item.case_id), case_count: 5, record_count: 14 },
    coverage: { raw_record_count: 14, mapped_record_count: 13, omitted_activity_record_count: 1 },
    unassigned_record_count: 0,
    cases,
  };
}

const share = (count: number, denominator: number) => ({ count, share: denominator === 0 ? null : count / denominator, denominator });

export function openingContextAnswer(request: OpeningContextRequest): OpeningContextAnswer {
  return {
    schema_version: 1,
    message_type: "opening_context_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: request.identity,
    parent_identity: request.identity,
    opening_context: {
      anchor_policy: "incident.context.first_record_in_declared_order.v1",
      category_limit: 2,
      population: { case_count: 5, evaluable_case_count: 4, unevaluable_case_count: 1, unevaluable_case_ids: ["K-5"], tied_first_record_case_count: 0 },
      parent: { case_count: 5, evaluable_case_count: 4, unevaluable_case_count: 1, unevaluable_case_ids: ["K-5"], tied_first_record_case_count: 0 },
      columns: [
        {
          column_index: 3,
          column_name: "Gruppe",
          distinct_value_count: 2,
          categories: [
            { kind: "value", value: "Büro", population: share(2, 4), parent: share(2, 4), difference_percentage_points: 0 },
            { kind: "value", value: "Unknown", population: share(1, 4), parent: share(1, 4), difference_percentage_points: 0 },
            { kind: "missing", value: null, population: share(1, 4), parent: share(1, 4), difference_percentage_points: 0 },
          ],
          remainder: null,
        },
        {
          column_index: 4,
          column_name: "Priorität",
          distinct_value_count: 3,
          categories: [
            { kind: "value", value: "P1", population: share(2, 4), parent: share(2, 4), difference_percentage_points: 0 },
            { kind: "value", value: "P2", population: share(1, 4), parent: share(1, 4), difference_percentage_points: 0 },
          ],
          remainder: { distinct_value_count: 1, population: share(1, 4), parent: share(1, 4), difference_percentage_points: 0 },
        },
      ],
    },
  };
}

/** The opening context of the selection {K-1, K-3} beside its parent. */
export function selectionOpeningContextAnswer(request: OpeningContextRequest): OpeningContextAnswer {
  const parent = openingContextAnswer(request);
  return {
    ...parent,
    identity: { ...request.identity, population_id: `population.v1:sha256:${hex("4")}` },
    opening_context: {
      ...parent.opening_context,
      population: { case_count: 2, evaluable_case_count: 2, unevaluable_case_count: 0, unevaluable_case_ids: [], tied_first_record_case_count: 0 },
      columns: [
        {
          column_index: 3,
          column_name: "Gruppe",
          distinct_value_count: 2,
          categories: [
            { kind: "value", value: "Büro", population: share(1, 2), parent: share(2, 4), difference_percentage_points: 0 },
            { kind: "value", value: "Unknown", population: share(1, 2), parent: share(1, 4), difference_percentage_points: 25 },
            { kind: "missing", value: null, population: share(0, 2), parent: share(1, 4), difference_percentage_points: -25 },
          ],
          remainder: null,
        },
        {
          column_index: 4,
          column_name: "Priorität",
          distinct_value_count: 3,
          categories: [
            { kind: "value", value: "P1", population: share(1, 2), parent: share(2, 4), difference_percentage_points: 0 },
            { kind: "value", value: "P3", population: share(1, 2), parent: share(1, 4), difference_percentage_points: 25 },
          ],
          remainder: { distinct_value_count: 1, population: share(0, 2), parent: share(1, 4), difference_percentage_points: -25 },
        },
      ],
    },
  };
}

export const variantIds = [`variant.v1:sha256:${hex("1")}`, `variant.v1:sha256:${hex("2")}`, `variant.v1:sha256:${hex("3")}`];

function variant(index: number, activities: string[], case_ids: string[], record_count: number, omitted: number): Variant {
  return {
    id: variantIds[index],
    activities,
    case_count: case_ids.length,
    share: case_ids.length / 4,
    denominator: 4,
    case_ids,
    record_count,
    omitted_activity_record_count: omitted,
  };
}

export function variantsAnswer(request: VariantsRequest, extra: Variant[] = []): VariantsAnswer {
  const variants = [
    variant(0, ["Eröffnet", "Weitergeleitet", "Weitergeleitet", "Gelöst"], ["K-1", "K-3"], 8, 0),
    variant(1, [], ["K-4"], 1, 1),
    variant(2, ["Eröffnet", "Gelöst"], ["K-2"], 2, 0),
    ...extra,
  ];
  return {
    schema_version: 1,
    message_type: "variants_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: request.identity,
    variants: {
      activity_projection_policy: "incident.activity.omit_missing_retain_raw_gaps.v1",
      case_count: 5,
      record_count: 14,
      omitted_activity_record_count: 1,
      sequence_evaluable_case_count: 4,
      variant_count: variants.length,
      variants,
      unevaluable: { case_ids: ["K-5"], case_count: 1, record_count: 3, omitted_activity_record_count: 0 },
    },
  };
}

export function viewRefusal(
  request: { request_id: string; query_revision: number; workspace_id: string },
  operation: PopulationViewRefusal["operation"],
  code: PopulationViewRefusal["code"],
  message: string,
  field: string | null = null,
): ViewOutcome<never> {
  return {
    ok: false,
    problem: {
      kind: "refusal",
      refusal: {
        schema_version: 1,
        message_type: "population_view_refusal",
        request_id: request.request_id,
        query_revision: request.query_revision,
        workspace_id: request.workspace_id,
        operation,
        code,
        message,
        field,
        retryable: ["workspace_unavailable", "workspace_not_writable", "source_unavailable", "preparation_unavailable", "computation_failed"].includes(code),
      },
    },
  };
}

interface Call<Request, Answer> {
  request: Request;
  signal: AbortSignal;
  reply: (outcome: ViewOutcome<Answer>) => void;
}

/** A client for the views of a population whose replies the test delivers. */
export function scriptedViewClient() {
  const openings: Call<OpeningContextRequest, OpeningContextAnswer>[] = [];
  const variants: Call<VariantsRequest, VariantsAnswer>[] = [];
  const client: PopulationViewClient = {
    openingContext: (request, signal) => new Promise((reply) => openings.push({ request, signal, reply })),
    variants: (request, signal) => new Promise((reply) => variants.push({ request, signal, reply })),
  };
  return { client, openings, variants };
}
