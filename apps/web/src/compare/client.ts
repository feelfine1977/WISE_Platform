import Ajv2020 from "ajv/dist/2020.js";
import comparisonSchema from "../../../../contracts/comparison.schema.json";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type {
  ComparisonRefusal,
  GroupComparisonAnswer,
  GroupComparisonRequest,
  PeriodComparisonAnswer,
  PeriodComparisonRequest,
} from "../generated/comparison";

export const comparisonRoutes = {
  compareGroups: "/api/investigations/compare-groups",
  comparePeriods: "/api/investigations/compare-periods",
} as const;

/**
 * Why a comparison produced no answer: a typed refusal from the local service, or a failure this
 * screen detected. It is always shown as a failure, never as an empty answer.
 */
export type ComparisonProblem =
  | { kind: "refusal"; refusal: ComparisonRefusal }
  | { kind: "unreachable" }
  | { kind: "http"; status: number }
  | { kind: "unsupported_reply"; detail: string };

export type ComparisonOutcome<T> = { ok: true; answer: T } | { ok: false; problem: ComparisonProblem };

export interface ComparisonClient {
  compareGroups(request: GroupComparisonRequest, signal: AbortSignal): Promise<ComparisonOutcome<GroupComparisonAnswer>>;
  comparePeriods(request: PeriodComparisonRequest, signal: AbortSignal): Promise<ComparisonOutcome<PeriodComparisonAnswer>>;
}

type ContractCheck<T> = (value: unknown) => value is T;

// UTC instants are also constrained by a pattern, so the format keyword adds no check here.
// Duplicate items are checked separately, in one pass, so that large populations stay quick.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, formats: { "date-time": true } });
ajv.addSchema(withoutUniqueItems(comparisonSchema));

function validator<T>(definition: string): ContractCheck<T> {
  const validate = ajv.getSchema<T>(`${comparisonSchema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The comparison contract has no definition ${definition}.`);
  const reference = { $ref: `#/$defs/${definition}` };
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(comparisonSchema, reference, value);
}

export const comparisonContract = {
  groupRequest: validator<GroupComparisonRequest>("GroupComparisonRequest"),
  groupAnswer: validator<GroupComparisonAnswer>("GroupComparisonAnswer"),
  periodRequest: validator<PeriodComparisonRequest>("PeriodComparisonRequest"),
  periodAnswer: validator<PeriodComparisonAnswer>("PeriodComparisonAnswer"),
  refusal: validator<ComparisonRefusal>("ComparisonRefusal"),
};

async function postJson<T>(
  route: string,
  body: unknown,
  operation: ComparisonRefusal["operation"],
  validateAnswer: ContractCheck<T>,
  signal: AbortSignal,
): Promise<ComparisonOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch {
    return { ok: false, problem: { kind: "unreachable" } };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (comparisonContract.refusal(payload) && payload.operation === operation) {
    return { ok: false, problem: { kind: "refusal", refusal: payload } };
  }
  if (!response.ok) return { ok: false, problem: { kind: "http", status: response.status } };
  if (validateAnswer(payload)) return { ok: true, answer: payload };
  return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not match the comparison contract." } };
}

export const httpComparisonClient: ComparisonClient = {
  compareGroups: (request, signal) =>
    postJson(comparisonRoutes.compareGroups, request, "compare_groups", comparisonContract.groupAnswer, signal),
  comparePeriods: (request, signal) =>
    postJson(comparisonRoutes.comparePeriods, request, "compare_periods", comparisonContract.periodAnswer, signal),
};
