import type { SaveInvestigationRequest, ScoreRunReference, FrozenSelectionRecipe } from '../../apps/web/src/generated/saving';

declare const save: SaveInvestigationRequest;
const frozen: FrozenSelectionRecipe = { parent_case_ids: ['A', 'B'], predicates: [] };
const unscored: SaveInvestigationRequest = { ...save, score_run_ref: null, selection_recipe: frozen };
// @ts-expect-error A saved parent is explicit, never live all-now.
const liveParent: FrozenSelectionRecipe = { parent_case_ids: null, predicates: [] };
// @ts-expect-error A score reference must carry calibration provenance.
const missingCalibration: ScoreRunReference = { score_run_id: 'score-run.v1:sha256:abc', scored_population_id: 'population.v1:sha256:abc' };
void frozen;
void unscored;
void liveParent;
void missingCalibration;
