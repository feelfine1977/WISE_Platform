import outputs from "./interval-comparison-test-answers.json";
import { bpic19IntervalComparisonContract } from "./interval-comparison-client";
import type { Bpic19IntervalComparisonAnswer, Bpic19IntervalComparisonRequest } from "../generated/bpic19-interval-comparison";
export function intervalAnswer(request?: Bpic19IntervalComparisonRequest): Bpic19IntervalComparisonAnswer {
  const supplied: unknown = structuredClone(request?.query.page.role === "reference" ? outputs.reference : outputs.target);
  if (!bpic19IntervalComparisonContract.answer(supplied)) throw new Error("Literal interval fixture violates its authority");
  return request ? { ...supplied, request_id: request.request_id, query_revision: request.query_revision,
    workspace_id: request.workspace_id, identity: request.identity, query: request.query } : supplied;
}
export function intervalRequest(): Bpic19IntervalComparisonRequest {
  const answer = intervalAnswer();
  return { schema_version: 1, message_type: "bpic19_interval_comparison_request", request_id: "literal-request-1",
    query_revision: 1, workspace_id: answer.workspace_id, identity: answer.identity, query: answer.query };
}
