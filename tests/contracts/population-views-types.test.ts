import type { ContextCategory, OpeningContextAnswer, VariantsAnswer, PopulationViewRefusal } from '../../apps/web/src/generated/population-views';

declare const opening: OpeningContextAnswer;
declare const variants: VariantsAnswer;
declare const category: ContextCategory;
declare const refusal: PopulationViewRefusal;
const projectedActivities: string[] = variants.variants.variants[0].activities;
const explicitMembers: string[] = variants.variants.variants[0].case_ids;
const samePopulation = opening.identity.population_id;
// @ts-expect-error A literal context value cannot silently become missing.
const nullLiteral: ContextCategory = { ...category, kind: 'value', value: null };
// @ts-expect-error Missing context is distinct from the literal Unknown.
const literalMissing: ContextCategory = { ...category, kind: 'missing', value: 'Unknown' };
// @ts-expect-error A view cannot silently become a scoring operation.
const unrelatedRefusal: PopulationViewRefusal = { ...refusal, operation: 'scores' };
void projectedActivities;
void explicitMembers;
void samePopulation;
void nullLiteral;
void literalMissing;
void unrelatedRefusal;
