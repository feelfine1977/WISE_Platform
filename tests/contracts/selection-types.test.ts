import type { EndsWithActivity, OpeningAttributeEquals, ProcessGraphRequest, SelectCasesRequest, SelectionAnswer, SelectionPredicate, StartsWithActivity } from '../../apps/web/src/generated/selection';

declare const request: SelectCasesRequest;
declare const answer: SelectionAnswer;
const graph: ProcessGraphRequest = { schema_version: 1, message_type: 'process_graph_request', request_id: 'graph-1', query_revision: 1, workspace_id: request.workspace_id, identity: answer.identity };
const missingOpening: OpeningAttributeEquals = { kind: 'opening_attribute_equals', column_index: 4, value: null, negate: false, anchor_policy: 'incident.context.first_record_in_declared_order.v1' };
// @ts-expect-error Negation is a typed Boolean and preserves unknown support.
const proseNegation: SelectCasesRequest = { ...request, predicates: [{ kind: 'contains_activity', activity: 'Recorded', negate: 'false' }] };
// @ts-expect-error Graph requests must bind the exact population identity.
const unboundGraph: ProcessGraphRequest = { schema_version: 1, message_type: 'process_graph_request', request_id: 'graph-1', query_revision: 1, workspace_id: request.workspace_id };
// @ts-expect-error Later nonmissing values do not replace opening missingness.
const unanchored: OpeningAttributeEquals = { ...missingOpening, anchor_policy: 'first_nonmissing' };
const beginning: StartsWithActivity = { kind: 'starts_with_activity', activity: 'Recorded', negate: false };
const ending: EndsWithActivity = { kind: 'ends_with_activity', activity: 'Recorded', negate: true };
const boundarySteps: SelectCasesRequest = { ...request, predicates: [beginning, ending] };
// @ts-expect-error A step on the beginning names one activity, not a path between two.
const beginningPath: SelectionPredicate = { kind: 'starts_with_activity', source_activity: 'Recorded', target_activity: 'Routed', negate: false };
// @ts-expect-error The end of an incident is its last record; the step carries no anchor of its own.
const anchoredEnding: EndsWithActivity = { ...ending, anchor_policy: 'incident.context.first_record_in_declared_order.v1' };
void graph;
void boundarySteps;
void beginningPath;
void anchoredEnding;
void missingOpening;
void proseNegation;
void unboundGraph;
void unanchored;
