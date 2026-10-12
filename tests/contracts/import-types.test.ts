import type { ConfirmMappingRequest, ImportedCaseEvidenceRequest, Mapping, WallTimePolicy } from '../../apps/web/src/generated/imports';

declare const request: ConfirmMappingRequest;
declare const evidence: ImportedCaseEvidenceRequest;
declare const mapping: Mapping;
declare const wall: WallTimePolicy;
const explicitMonthFirst: ConfirmMappingRequest = { ...request, policies: { ...request.policies, time: { id: 'incident.time.explicit_format_timezone_utc.v1', parameters: { format: 'mdy_dot_minute', timezone: { mode: 'fixed_offset', offset_minutes: 0 }, snapshot_cutoff_utc: '2027-01-01T00:00:00Z' } } } };
// @ts-expect-error Missing source interpretation cannot be silently inferred.
const incompleteMapping: Mapping = { case_column: 0, activity_column: 1 };
// @ts-expect-error A wall clock cannot silently become a UTC cutoff.
const mixedClock: WallTimePolicy = { ...wall, parameters: { ...wall.parameters, snapshot_cutoff_utc: '2027-01-01T00:00:00Z' } };
// @ts-expect-error Evidence retains complete identity and workspace binding.
const missingWorkspace: ImportedCaseEvidenceRequest = { schema_version: 1, message_type: 'imported_case_evidence_request', request_id: 'case-1', query_revision: 1, identity: evidence.identity, case_id: 'Q-01' };
// @ts-expect-error Mapping roles identify ordinal columns, preserving duplicate names.
const nameMapping: Mapping = { ...mapping, case_column: 'Ticket' };
void explicitMonthFirst;
void incompleteMapping;
void mixedClock;
void missingWorkspace;
void nameMapping;
