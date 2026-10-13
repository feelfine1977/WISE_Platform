import type {
  RuleGroupsRequest, RuleGroupsAnswer, RuleGroupsRefusal, GroupRule, RuleGroup,
  RuleGroupKey, FixedCaseSupport, GroupExemplars,
} from '../../apps/web/src/generated/rule-groups';

declare const request: RuleGroupsRequest;
declare const answer: RuleGroupsAnswer;
declare const refusal: RuleGroupsRefusal;
declare const group: RuleGroup;
declare const exemplar: GroupExemplars;
const rules: GroupRule[] = [
  { kind: 'first_raw_activity' },
  { kind: 'last_raw_activity' },
  { kind: 'raw_record_count_bands', edges: [0, 2, 3] },
  { kind: 'activity_presence', activity: 'Review' },
  { kind: 'shared_reference', column_index: 4, minimum_parent_case_count: 2 },
  { kind: 'exact_mapped_sequence' },
];
const cases: FixedCaseSupport = group.population.cases;
const applyIds: string[] = cases.case_ids;
const parentCount: number = group.parent.cases.case_count;
const exactParent: string = answer.parent_identity.population_id;
const queryEcho: GroupRule = answer.query.rule;
const span: number | null = exemplar.shortest?.observed_span_hours ?? null;
// @ts-expect-error Missing activity is distinct from a literal label.
const literalMissing: RuleGroupKey = { kind: 'missing_activity', activity: 'Unknown' };
// @ts-expect-error A present raw activity is a nonmissing label.
const nullLabel: RuleGroupKey = { kind: 'activity', activity: null };
// @ts-expect-error Reference values and missing reference cells have different keys.
const nullReference: RuleGroupKey = { kind: 'reference_value', column_index: 4, value: null };
// @ts-expect-error Group keys are stated, not fitted.
const fitted: GroupRule = { kind: 'fitted_cluster' };
// @ts-expect-error Applying a group uses supplied IDs, with no projected predicate.
const condition: RuleGroup = { ...group, condition: { kind: 'contains_activity', activity: 'Review' } };
// @ts-expect-error The request does not replace the resolver's exact parent.
const inventedParent: RuleGroupsRequest = { ...request, parent_case_ids: ['A'] };
// @ts-expect-error Rule answers have a closed boundary.
const extraAnswer: RuleGroupsAnswer = { ...answer, invented: true };
// @ts-expect-error Rule refusals belong to the stated-rule read operation.
const wrongOperation: RuleGroupsRefusal = { ...refusal, operation: 'scores' };
void [rules, applyIds, parentCount, exactParent, queryEcho, span, literalMissing, nullLabel,
  nullReference, fitted, condition, inventedParent, extraAnswer, wrongOperation];
