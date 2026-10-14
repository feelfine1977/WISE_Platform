import type { AnswerIdentity, CaseEvidenceRequest, InputPolicies, OpenExampleRequest, OrderPolicy, Refusal } from '../../apps/web/src/generated/investigation';

declare const policies: InputPolicies;
declare const identity: AnswerIdentity;
const valid: OpenExampleRequest = { schema_version: 1, message_type: 'open_example_request', request_id: 'open-1', query_revision: 1, example_id: 'S1', policies };
const evidence: CaseEvidenceRequest = { schema_version: 1, message_type: 'case_evidence_request', request_id: 'case-1', query_revision: 1, identity, case_id: 'INC05' };
void valid;
void evidence;

// @ts-expect-error Unsupported schema versions cannot enter the current boundary.
const unsupportedVersion: OpenExampleRequest = { ...valid, schema_version: 2 };
// @ts-expect-error Unshipped examples are not valid synthetic inputs.
const unshippedExample: OpenExampleRequest = { ...valid, example_id: 'company-log' };
// @ts-expect-error Evidence must bind the complete population identity.
const incompleteEvidence: CaseEvidenceRequest = { schema_version: 1, message_type: 'case_evidence_request', request_id: 'case-1', query_revision: 1, case_id: 'INC05' };
// @ts-expect-error Closed requests cannot silently introduce a norm.
const unexpectedNorm: OpenExampleRequest = { ...valid, norm_id: 'unnecessary' };
// @ts-expect-error Policy text cannot replace its versioned registered ID.
const prosePolicy: OrderPolicy = { ...policies.order, id: 'sort by time' };
// @ts-expect-error Refusal codes name actual supported failure states.
const inventedRefusal: Refusal = { schema_version: 1, message_type: 'refusal', request_id: 'open-1', query_revision: 1, operation: 'open_example', code: 'empty-success', message: 'Unavailable', field: null, retryable: false };
void unsupportedVersion;
void unshippedExample;
void incompleteEvidence;
void unexpectedNorm;
void prosePolicy;
void inventedRefusal;
