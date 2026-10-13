import type { AnswerIdentity, CaseId, QueryRevision, RequestId, WorkspaceId } from "../generated/selection";

/*
 * The messages of the opening-context and variants operations. The platform contracts do not
 * describe them yet; these types follow the models the local service writes beside its handlers,
 * in the envelope of the other operations, and the checks below hold every reply to them.
 */

export interface OpeningContextRequest {
  schema_version: 1;
  message_type: "opening_context_request";
  request_id: RequestId;
  query_revision: QueryRevision;
  workspace_id: WorkspaceId;
  identity: AnswerIdentity;
}

export interface VariantsRequest {
  schema_version: 1;
  message_type: "variants_request";
  request_id: RequestId;
  query_revision: QueryRevision;
  workspace_id: WorkspaceId;
  identity: AnswerIdentity;
}

/** Incidents of one group in a category, over the incidents of the group whose opening could be read. */
export interface CategoryShare {
  count: number;
  /** Null when the group has no incident whose opening could be read. */
  share: number | null;
  denominator: number;
}

export interface ContextCategory {
  kind: "value" | "missing";
  /** Null exactly for the missing category; any text, also "Unknown", is a recorded value. */
  value: string | null;
  population: CategoryShare;
  parent: CategoryShare;
  difference_percentage_points: number | null;
}

export interface ContextRemainder {
  distinct_value_count: number;
  population: CategoryShare;
  parent: CategoryShare;
  difference_percentage_points: number | null;
}

export interface ContextColumn {
  column_index: number;
  column_name: string;
  distinct_value_count: number;
  categories: ContextCategory[];
  remainder: ContextRemainder | null;
}

export interface GroupCoverage {
  case_count: number;
  evaluable_case_count: number;
  unevaluable_case_count: number;
  unevaluable_case_ids: CaseId[];
}

export interface OpeningContext {
  anchor_policy: "incident.context.first_record_in_declared_order.v1";
  category_limit: number;
  population: GroupCoverage;
  parent: GroupCoverage;
  columns: ContextColumn[];
}

export interface OpeningContextAnswer {
  schema_version: 1;
  message_type: "opening_context_answer";
  request_id: RequestId;
  query_revision: QueryRevision;
  workspace_id: WorkspaceId;
  identity: AnswerIdentity;
  parent_identity: AnswerIdentity;
  opening_context: OpeningContext;
}

export type VariantId = string;

export interface Variant {
  id: VariantId;
  activities: string[];
  case_count: number;
  share: number;
  denominator: number;
  case_ids: CaseId[];
  record_count: number;
  omitted_activity_record_count: number;
}

export interface UnevaluableSupport {
  case_ids: CaseId[];
  case_count: number;
  record_count: number;
  omitted_activity_record_count: number;
}

export interface VariantSummary {
  activity_projection_policy: "incident.activity.omit_missing_retain_raw_gaps.v1";
  case_count: number;
  record_count: number;
  omitted_activity_record_count: number;
  sequence_evaluable_case_count: number;
  variant_count: number;
  variants: Variant[];
  unevaluable: UnevaluableSupport;
}

export interface VariantsAnswer {
  schema_version: 1;
  message_type: "variants_answer";
  request_id: RequestId;
  query_revision: QueryRevision;
  workspace_id: WorkspaceId;
  identity: AnswerIdentity;
  variants: VariantSummary;
}

export const refusalCodes = [
  "invalid_request",
  "unsupported_schema",
  "workspace_unavailable",
  "workspace_not_writable",
  "workspace_incompatible",
  "source_unavailable",
  "preparation_unavailable",
  "identity_mismatch",
  "population_unavailable",
  "invalid_parent",
  "unknown_case",
  "no_context_columns",
  "computation_failed",
] as const;

export type PopulationViewOperation = "opening_context" | "variants";

export interface PopulationViewRefusal {
  schema_version: 1;
  message_type: "population_view_refusal";
  request_id: RequestId | null;
  query_revision: QueryRevision | null;
  workspace_id: WorkspaceId | null;
  operation: PopulationViewOperation;
  code: (typeof refusalCodes)[number];
  message: string;
  field: string | null;
  retryable: boolean;
}

// Checks ------------------------------------------------------------------------------------

type Check = (value: unknown) => boolean;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText: Check = (value) => typeof value === "string";
const isCount: Check = (value) => Number.isSafeInteger(value) && (value as number) >= 0;
const isPositive: Check = (value) => isCount(value) && (value as number) > 0;
const isShare: Check = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const isDifference: Check = (value) => typeof value === "number" && Number.isFinite(value) && value >= -100 && value <= 100;
const isCaseId: Check = (value) => typeof value === "string" && value.length >= 1 && value.length <= 256;
const isRequestId: Check = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const isRevision: Check = (value) => isPositive(value);
const isWorkspaceId: Check = (value) => typeof value === "string" && /^workspace\.v1:[A-Za-z0-9-]{8,64}$/.test(value);
const isVariantId: Check = (value) => typeof value === "string" && /^variant\.v1:sha256:[0-9a-f]{64}$/.test(value);
const nullable = (check: Check): Check => (value) => value === null || check(value);
const constant = (expected: unknown): Check => (value) => value === expected;
const listOf = (check: Check): Check => (value) => Array.isArray(value) && value.every(check);

/** An object with exactly these fields, each passing its check. */
function exactly(fields: Record<string, Check>): Check {
  const names = Object.keys(fields);
  return (value) =>
    isRecord(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name) && fields[name](value[name]));
}

const identityPatterns: Record<keyof AnswerIdentity, RegExp> = {
  source_id: /^source\.v1:sha256:[a-f0-9]{64}$/,
  preparation_id: /^preparation\.v1:sha256:[a-f0-9]{64}$/,
  representation_id: /^representation\.v1:sha256:[a-f0-9]{64}$/,
  case_dictionary_id: /^case-dictionary\.v1:sha256:[a-f0-9]{64}$/,
  population_id: /^population\.v1:sha256:[a-f0-9]{64}$/,
  implementation_version: /^\d+\.\d+\.\d+$/,
};
const isIdentity = exactly(
  Object.fromEntries(
    Object.entries(identityPatterns).map(([name, pattern]) => [name, (value: unknown) => typeof value === "string" && pattern.test(value)]),
  ),
);

const isCategoryShare = exactly({ count: isCount, share: nullable(isShare), denominator: isCount });
const isCategory: Check = (value) =>
  exactly({
    kind: (kind) => kind === "value" || kind === "missing",
    value: nullable(isText),
    population: isCategoryShare,
    parent: isCategoryShare,
    difference_percentage_points: nullable(isDifference),
  })(value) && ((value as ContextCategory).kind === "missing") === ((value as ContextCategory).value === null);
const isRemainder = exactly({
  distinct_value_count: isPositive,
  population: isCategoryShare,
  parent: isCategoryShare,
  difference_percentage_points: nullable(isDifference),
});
const isColumn = exactly({
  column_index: isCount,
  column_name: isText,
  distinct_value_count: isCount,
  categories: listOf(isCategory),
  remainder: nullable(isRemainder),
});
const isCoverage = exactly({
  case_count: isCount,
  evaluable_case_count: isCount,
  unevaluable_case_count: isCount,
  unevaluable_case_ids: listOf(isCaseId),
});
const isOpeningContext = exactly({
  anchor_policy: constant("incident.context.first_record_in_declared_order.v1"),
  category_limit: isPositive,
  population: isCoverage,
  parent: isCoverage,
  columns: (value) => listOf(isColumn)(value) && (value as unknown[]).length > 0,
});

const isVariant = exactly({
  id: isVariantId,
  activities: listOf((value) => isText(value) && (value as string).length > 0),
  case_count: isPositive,
  share: isShare,
  denominator: isPositive,
  case_ids: (value) => listOf(isCaseId)(value) && (value as unknown[]).length > 0,
  record_count: isPositive,
  omitted_activity_record_count: isCount,
});
const isUnevaluable = exactly({ case_ids: listOf(isCaseId), case_count: isCount, record_count: isCount, omitted_activity_record_count: isCount });
const isVariantSummary = exactly({
  activity_projection_policy: constant("incident.activity.omit_missing_retain_raw_gaps.v1"),
  case_count: isCount,
  record_count: isCount,
  omitted_activity_record_count: isCount,
  sequence_evaluable_case_count: isCount,
  variant_count: isCount,
  variants: listOf(isVariant),
  unevaluable: isUnevaluable,
});

const envelope = (messageType: string) => ({
  schema_version: constant(1),
  message_type: constant(messageType),
  request_id: isRequestId,
  query_revision: isRevision,
  workspace_id: isWorkspaceId,
  identity: isIdentity,
});

const checks = {
  openingContextRequest: exactly(envelope("opening_context_request")),
  variantsRequest: exactly(envelope("variants_request")),
  openingContextAnswer: exactly({ ...envelope("opening_context_answer"), parent_identity: isIdentity, opening_context: isOpeningContext }),
  variantsAnswer: exactly({ ...envelope("variants_answer"), variants: isVariantSummary }),
  refusal: exactly({
    schema_version: constant(1),
    message_type: constant("population_view_refusal"),
    request_id: nullable(isRequestId),
    query_revision: nullable(isRevision),
    workspace_id: nullable(isWorkspaceId),
    operation: (value) => value === "opening_context" || value === "variants",
    code: (value) => (refusalCodes as readonly unknown[]).includes(value),
    message: (value) => isText(value) && (value as string).length > 0,
    field: nullable(isText),
    retryable: (value) => typeof value === "boolean",
  }),
};

/** Whether a value is exactly one message of these operations. */
export const populationViewMessages = {
  openingContextRequest: (value: unknown): value is OpeningContextRequest => checks.openingContextRequest(value),
  variantsRequest: (value: unknown): value is VariantsRequest => checks.variantsRequest(value),
  openingContextAnswer: (value: unknown): value is OpeningContextAnswer => checks.openingContextAnswer(value),
  variantsAnswer: (value: unknown): value is VariantsAnswer => checks.variantsAnswer(value),
  refusal: (value: unknown): value is PopulationViewRefusal => checks.refusal(value),
};
