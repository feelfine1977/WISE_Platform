import { describe, expect, it } from "vitest";
import { identity, workspaceId } from "../test/imports";
import { openingContextAnswer, variantsAnswer } from "../test/views";
import { populationViewMessages, type OpeningContextRequest, type VariantsRequest } from "./messages";

const openingRequest: OpeningContextRequest = {
  schema_version: 1,
  message_type: "opening_context_request",
  request_id: "view-1",
  query_revision: 2,
  workspace_id: workspaceId,
  identity,
};
const variantsRequest: VariantsRequest = { ...openingRequest, message_type: "variants_request" };

/** A copy of an answer in which the first category of a kind in the first column is changed. */
function withCategory(kind: "value" | "missing", change: Record<string, unknown>): unknown {
  const answer = structuredClone(openingContextAnswer(openingRequest));
  const categories = answer.opening_context.columns[0].categories;
  const index = categories.findIndex((category) => category.kind === kind);
  categories[index] = { ...categories[index], ...change } as (typeof categories)[number];
  return answer;
}

describe("the messages of the opening context and the variants", () => {
  it("accept the requests and answers the contract allows", () => {
    expect(populationViewMessages.openingContextRequest(openingRequest)).toBe(true);
    expect(populationViewMessages.variantsRequest(variantsRequest)).toBe(true);
    expect(populationViewMessages.openingContextAnswer(openingContextAnswer(openingRequest))).toBe(true);
    expect(populationViewMessages.variantsAnswer(variantsAnswer(variantsRequest))).toBe(true);
  });

  it("refuse a recorded value without text and a missing value with text, as the local service does", () => {
    expect(populationViewMessages.openingContextAnswer(withCategory("value", { value: null }))).toBe(false);
    expect(populationViewMessages.openingContextAnswer(withCategory("missing", { value: "Unknown" }))).toBe(false);
    expect(populationViewMessages.openingContextAnswer(withCategory("value", { value: "" }))).toBe(false);
    expect(populationViewMessages.openingContextAnswer(withCategory("value", { kind: "other" }))).toBe(false);
  });

  it("refuse an incident listed twice, an extra field and a count that is not a whole number", () => {
    const repeated = structuredClone(variantsAnswer(variantsRequest));
    repeated.variants.variants[0].case_ids = ["K-1", "K-3", "K-1"];
    expect(populationViewMessages.variantsAnswer(repeated)).toBe(false);
    const unevaluable = structuredClone(variantsAnswer(variantsRequest));
    unevaluable.variants.unevaluable.case_ids = ["K-5", "K-5"];
    expect(populationViewMessages.variantsAnswer(unevaluable)).toBe(false);
    const coverage = structuredClone(openingContextAnswer(openingRequest));
    coverage.opening_context.parent.unevaluable_case_ids = ["K-5", "K-5"];
    expect(populationViewMessages.openingContextAnswer(coverage)).toBe(false);

    expect(populationViewMessages.variantsRequest({ ...variantsRequest, note: "extra" })).toBe(false);
    expect(populationViewMessages.variantsRequest({ ...variantsRequest, query_revision: 1.5 })).toBe(false);
    expect(populationViewMessages.variantsRequest({ ...variantsRequest, message_type: "opening_context_request" })).toBe(false);
    // A version is three numbers in the ASCII digits 0 to 9, as the local service also requires.
    for (const version of ["\u0661.\u0660.\u0660", "1.0.\uff10"]) {
      expect(populationViewMessages.variantsRequest({ ...variantsRequest, identity: { ...identity, implementation_version: version } })).toBe(false);
    }
  });

  it("refuse a refusal of another operation or with a code the contract does not name", () => {
    const refusal = {
      schema_version: 1,
      message_type: "population_view_refusal",
      request_id: null,
      query_revision: null,
      workspace_id: null,
      operation: "variants",
      code: "invalid_request",
      message: "The request is not valid.",
      field: null,
      retryable: false,
    };
    expect(populationViewMessages.refusal(refusal)).toBe(true);
    expect(populationViewMessages.refusal({ ...refusal, operation: "scores" })).toBe(false);
    expect(populationViewMessages.refusal({ ...refusal, code: "guessed" })).toBe(false);
  });

  it("check a variant of many incidents at once", () => {
    const large = structuredClone(variantsAnswer(variantsRequest));
    const caseIds = Array.from({ length: 50_000 }, (_, index) => `K-${index + 10}`);
    large.variants.variants[0] = { ...large.variants.variants[0], case_ids: caseIds, case_count: caseIds.length };
    const started = performance.now();
    expect(populationViewMessages.variantsAnswer(large)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
    large.variants.variants[0].case_ids = [...caseIds, caseIds[0]];
    expect(populationViewMessages.variantsAnswer(large)).toBe(false);
  });
});
