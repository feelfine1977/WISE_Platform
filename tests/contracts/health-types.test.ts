import type { HealthResponse } from '../../apps/web/src/generated/health';

const healthy: HealthResponse = { status: 'ok', stage: 'foundation', version: '0.1.0' };
void healthy;

// @ts-expect-error Status cannot claim completed application readiness.
const invalidStatus: HealthResponse = { status: 'ready', stage: 'foundation', version: '0.1.0' };
// @ts-expect-error Stage is a fixed foundation contract.
const invalidStage: HealthResponse = { status: 'ok', stage: 'complete', version: '0.1.0' };
// @ts-expect-error Version is required even for a minimal foundation response.
const missingVersion: HealthResponse = { status: 'ok', stage: 'foundation' };
// @ts-expect-error Closed contracts do not accept arbitrary fields.
const extraField: HealthResponse = { status: 'ok', stage: 'foundation', version: '0.1.0', extra: true };
void invalidStatus;
void invalidStage;
void missingVersion;
void extraField;

// The string's version pattern is validated by JSON Schema and the Python model.
// TypeScript's generated string type cannot enforce that runtime regular expression.
