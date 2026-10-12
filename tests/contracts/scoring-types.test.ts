import type { ValidateExpectationRequest, ScoreExpectationRequest, ScoreRun, RunIdentity } from '../../apps/web/src/generated/scoring';

declare const validate: ValidateExpectationRequest;
declare const score: ScoreExpectationRequest;
declare const run: ScoreRun;
const sameRun: RunIdentity = run.identity;
// @ts-expect-error Scoring requires an immutable validated definition version.
const arbitraryDraftScore: ScoreExpectationRequest = { ...score, definition: validate.definition };
// @ts-expect-error A named population cannot lose its full source interpretation binding.
const unboundPopulation: ValidateExpectationRequest = { ...validate, named_population: { name: 'All', identity: { population_id: 'population.v1:sha256:abc' } } };
// @ts-expect-error The first-response operation cannot imply final resolution.
const lastResolution: ValidateExpectationRequest = { ...validate, definition: { ...validate.definition, endpoints: { ...validate.definition.endpoints, response: 'last' } } };
void sameRun;
void arbitraryDraftScore;
void unboundPopulation;
void lastResolution;
