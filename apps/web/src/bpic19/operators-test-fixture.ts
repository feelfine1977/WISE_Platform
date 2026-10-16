/** Presentation-only receipts captured from the independent literal HTTP fixture, never real BPIC19 analyst results. */
import receipts from "./operators-test-answer.json";
import { bpic19OperatorContract } from "./operators-client";
import type { Bpic19OperatorAnswer, Bpic19OperatorRequest, OperatorRecipe } from "../generated/bpic19-operators";
const original: unknown = receipts.ordinal;
if (!bpic19OperatorContract.answer(original)) throw new Error("Literal HTTP operator receipt is invalid.");
export const operatorIdentity = original.identity;
export const operatorRoles = original.query.roles;
export const operatorColumns = original.catalogue.columns;
export const operatorOrdinal = original.query.recipe;
export function operatorRecipe(kind: OperatorRecipe["kind"]): OperatorRecipe {
  const value: unknown = receipts[kind];
  if (!bpic19OperatorContract.answer(value) || value.query.recipe === null) throw new Error("Literal operator recipe is invalid.");
  return value.query.recipe;
}
export function operatorAnswer(request: Bpic19OperatorRequest): Bpic19OperatorAnswer {
  const value: unknown = structuredClone(receipts[request.query.recipe?.kind ?? "catalogue"]);
  if (!bpic19OperatorContract.answer(value)) throw new Error("Literal HTTP operator receipt is invalid.");
  // UI contract/state tests echo presentation choices; mathematical oracle tests live at the real Python/HTTP seam.
  return { ...value, request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, query: request.query,
    operation: request.query.recipe ? `bpic19_${request.query.recipe.kind}` : "bpic19_catalogue", definition: { ...value.definition, roles: request.query.roles, recipe: request.query.recipe } };
}
