import Ajv2020 from "ajv/dist/2020.js";
import selectionSchema from "../../../../contracts/selection.schema.json";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type {
  ProcessGraphAnswer,
  ProcessGraphRequest,
  SelectCasesRequest,
  SelectionAnswer,
  SelectionRefusal,
} from "../generated/selection";

export const selectionRoutes = {
  selectCases: "/api/investigations/select-cases",
  processGraph: "/api/investigations/process-graph",
} as const;

/**
 * Why a selection or a map produced no answer: a typed refusal from the local service, or a
 * failure this screen detected. It is always shown as a failure, never as an empty answer.
 */
export type SelectionProblem =
  | { kind: "refusal"; refusal: SelectionRefusal }
  | { kind: "unreachable" }
  | { kind: "http"; status: number }
  | { kind: "unsupported_reply"; detail: string };

export type SelectionOutcome<T> = { ok: true; answer: T } | { ok: false; problem: SelectionProblem };

export interface SelectionClient {
  selectCases(request: SelectCasesRequest, signal: AbortSignal): Promise<SelectionOutcome<SelectionAnswer>>;
  processGraph(request: ProcessGraphRequest, signal: AbortSignal): Promise<SelectionOutcome<ProcessGraphAnswer>>;
}

type ContractCheck<T> = (value: unknown) => value is T;

// Duplicate items are checked separately, in one pass, so that large populations stay quick.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(withoutUniqueItems(selectionSchema));

function validator<T>(definition: string): ContractCheck<T> {
  const validate = ajv.getSchema<T>(`${selectionSchema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The selection contract has no definition ${definition}.`);
  const reference = { $ref: `#/$defs/${definition}` };
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(selectionSchema, reference, value);
}

export const selectionContract = {
  selectCasesRequest: validator<SelectCasesRequest>("SelectCasesRequest"),
  selectionAnswer: validator<SelectionAnswer>("SelectionAnswer"),
  processGraphRequest: validator<ProcessGraphRequest>("ProcessGraphRequest"),
  processGraphAnswer: validator<ProcessGraphAnswer>("ProcessGraphAnswer"),
  refusal: validator<SelectionRefusal>("SelectionRefusal"),
};

async function postJson<T>(
  route: string,
  body: unknown,
  operation: SelectionRefusal["operation"],
  validateAnswer: ContractCheck<T>,
  signal: AbortSignal,
): Promise<SelectionOutcome<T>> {
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
  if (selectionContract.refusal(payload) && payload.operation === operation) {
    return { ok: false, problem: { kind: "refusal", refusal: payload } };
  }
  if (!response.ok) return { ok: false, problem: { kind: "http", status: response.status } };
  if (validateAnswer(payload)) return { ok: true, answer: payload };
  return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not match the selection contract." } };
}

export const httpSelectionClient: SelectionClient = {
  selectCases: (request, signal) =>
    postJson(selectionRoutes.selectCases, request, "select_cases", selectionContract.selectionAnswer, signal),
  processGraph: (request, signal) =>
    postJson(selectionRoutes.processGraph, request, "process_graph", selectionContract.processGraphAnswer, signal),
};
