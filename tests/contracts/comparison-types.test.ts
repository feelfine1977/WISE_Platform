import type { GroupComparisonRequest, PeriodComparisonRequest, UtcCaseStartWindow, ConcentrationRatio } from '../../apps/web/src/generated/comparison';

declare const group: GroupComparisonRequest;
declare const period: PeriodComparisonRequest;
const literalGroups: GroupComparisonRequest = { ...group, definition: { mode: 'two_named_groups', target: { name: 'A', definition: { kind: 'explicit_case_ids', case_ids: ['G01'] } }, reference: { name: 'B', definition: { kind: 'predicates', predicates: [] } } } };
const availableZero: ConcentrationRatio = { status: 'available', value: 0 };
const absentRatio: ConcentrationRatio = { status: 'unavailable', reason: 'zero_reference_share' };
// @ts-expect-error The reference role must be explicit.
const noReference: GroupComparisonRequest = { ...group, definition: { mode: 'two_named_groups', target: { name: 'A', definition: { kind: 'explicit_case_ids', case_ids: [] } } } };
// @ts-expect-error A UTC window cannot use the wall clock discriminator.
const changedClock: UtcCaseStartWindow = { timestamp_kind: 'wall_clock', start_inclusive: '2026-10-01T00:00:00', end_exclusive: '2026-10-02T00:00:00' };
// @ts-expect-error An unavailable ratio cannot masquerade as zero.
const unavailableZero: ConcentrationRatio = { status: 'unavailable', reason: 'zero_reference_share', value: 0 };
void literalGroups;
void availableZero;
void absentRatio;
void noReference;
void changedClock;
void unavailableZero;
void period;
