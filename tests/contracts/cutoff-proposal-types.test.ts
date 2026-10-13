import type { CutoffProposalAnswer } from '../../apps/web/src/generated/imports';

declare const proposal: CutoffProposalAnswer;
const explicitClock: 'utc_instant' | 'wall_clock' = proposal.timestamp_kind;
const optionalProposal: string | null = proposal.proposed_cutoff;
// @ts-expect-error An unavailable last time cannot carry a known proposed cutoff.
const inventedProposal: CutoffProposalAnswer = { ...proposal, last_usable_time: null, proposed_cutoff: '2026-10-09T10:00:00Z' };
// @ts-expect-error The source must remain bound to the proposal.
const unboundProposal: CutoffProposalAnswer = { schema_version: 1, message_type: 'cutoff_proposal_answer', request_id: 'cutoff', query_revision: 1, workspace_id: 'workspace.v1:example123', timestamp_kind: 'utc_instant', last_usable_time: null, proposed_cutoff: null };
void explicitClock;
void optionalProposal;
void inventedProposal;
void unboundProposal;
