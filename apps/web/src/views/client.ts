import {
  type OpeningContextAnswer,
  type OpeningContextRequest,
  type PopulationViewOperation,
  type PopulationViewRefusal,
  populationViewMessages,
  type VariantsAnswer,
  type VariantsRequest,
} from "./messages";

export const viewRoutes = {
  openingContext: "/api/investigations/opening-context",
  variants: "/api/investigations/variants",
} as const;

/**
 * Why a request for the opening context or the variants produced no answer: a typed refusal from
 * the local service, or a failure this screen detected. It is shown as a failure, never as an
 * empty answer.
 */
export type ViewProblem =
  | { kind: "refusal"; refusal: PopulationViewRefusal }
  | { kind: "unreachable" }
  | { kind: "http"; status: number }
  | { kind: "unsupported_reply"; detail: string };

export type ViewOutcome<T> = { ok: true; answer: T } | { ok: false; problem: ViewProblem };

export interface PopulationViewClient {
  openingContext(request: OpeningContextRequest, signal: AbortSignal): Promise<ViewOutcome<OpeningContextAnswer>>;
  variants(request: VariantsRequest, signal: AbortSignal): Promise<ViewOutcome<VariantsAnswer>>;
}

async function post<T>(
  route: string,
  body: unknown,
  operation: PopulationViewOperation,
  isAnswer: (value: unknown) => value is T,
  signal: AbortSignal,
): Promise<ViewOutcome<T>> {
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
  if (populationViewMessages.refusal(payload) && payload.operation === operation) {
    return { ok: false, problem: { kind: "refusal", refusal: payload } };
  }
  if (!response.ok) return { ok: false, problem: { kind: "http", status: response.status } };
  if (isAnswer(payload)) return { ok: true, answer: payload };
  return { ok: false, problem: { kind: "unsupported_reply", detail: "The reply does not have the form this screen reads." } };
}

export const httpPopulationViewClient: PopulationViewClient = {
  openingContext: (request, signal) =>
    post(viewRoutes.openingContext, request, "opening_context", populationViewMessages.openingContextAnswer, signal),
  variants: (request, signal) => post(viewRoutes.variants, request, "variants", populationViewMessages.variantsAnswer, signal),
};
