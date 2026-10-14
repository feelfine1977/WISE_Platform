import Ajv2020 from "ajv/dist/2020.js";
import populationViewsSchema from "../../../../contracts/population-views.schema.json";
import { uniqueItemsHold, withoutUniqueItems } from "../data/uniqueItems";
import type {
  OpeningContextAnswer,
  OpeningContextRequest,
  PopulationViewRefusal,
  VariantsAnswer,
  VariantsRequest,
} from "../generated/population-views";

/*
 * The messages of the opening-context and variants operations: the types generated from the
 * population-views contract, and checks compiled from the contract itself.
 */

export type {
  AnswerIdentity,
  CategoryShare,
  ContextCategory,
  ContextColumn,
  ContextRemainder,
  GroupCoverage,
  MissingContextCategory,
  OpeningContext,
  OpeningContextAnswer,
  OpeningContextRequest,
  PopulationViewMessage,
  PopulationViewOperation,
  PopulationViewRefusal,
  RefusalCode,
  UnevaluableSupport,
  ValueContextCategory,
  Variant,
  VariantId,
  VariantsAnswer,
  VariantsRequest,
  VariantSummary,
} from "../generated/population-views";

type ContractCheck<T> = (value: unknown) => value is T;

// Duplicate items are checked separately, in one pass, so that large populations stay quick.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(withoutUniqueItems(populationViewsSchema));

function validator<T>(definition: string): ContractCheck<T> {
  const validate = ajv.getSchema<T>(`${populationViewsSchema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`The population-views contract has no definition ${definition}.`);
  const reference = { $ref: `#/$defs/${definition}` };
  return (value: unknown): value is T => validate(value) && uniqueItemsHold(populationViewsSchema, reference, value);
}

/** Whether a value is exactly one message of these operations, as the contract allows it. */
export const populationViewMessages = {
  openingContextRequest: validator<OpeningContextRequest>("OpeningContextRequest"),
  variantsRequest: validator<VariantsRequest>("VariantsRequest"),
  openingContextAnswer: validator<OpeningContextAnswer>("OpeningContextAnswer"),
  variantsAnswer: validator<VariantsAnswer>("VariantsAnswer"),
  refusal: validator<PopulationViewRefusal>("PopulationViewRefusal"),
};
