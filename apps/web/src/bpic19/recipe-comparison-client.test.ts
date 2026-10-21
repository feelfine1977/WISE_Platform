import { afterEach, describe, expect, it, vi } from 'vitest';
import fixtures from './recipe-comparison-test-answers.json';
import { bpic19RecipeComparisonContract, httpRecipeComparisonClient } from './recipe-comparison-client';

afterEach(()=>vi.unstubAllGlobals());
describe('explicit saved comparison boundary',()=>{
  for(const kind of ['operator','cohort'] as const)it(`accepts exactly the two reviewed ${kind} definitions`,async()=>{
    const answer=structuredClone(fixtures[kind]);
    if(!bpic19RecipeComparisonContract.answer(answer))throw new Error('Real synthetic API fixture is not a contract answer');
    const request={schema_version:1 as const,message_type:'bpic19_recipe_comparison_request' as const,request_id:answer.request_id,query_revision:answer.query_revision,workspace_id:answer.workspace_id,identity:answer.identity,query:answer.query};
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(answer),{status:200})));
    expect((await httpRecipeComparisonClient.compare(request,new AbortController().signal)).ok).toBe(true);
    const changed=structuredClone(answer);changed.comparison.second.definition_id='guessed';
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(changed),{status:200})));
    expect((await httpRecipeComparisonClient.compare(request,new AbortController().signal)).ok).toBe(false);
    const foreign=structuredClone(answer);foreign.comparison.first.identity.population_id='population.v1:sha256:'+'a'.repeat(64);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(foreign),{status:200})));
    expect((await httpRecipeComparisonClient.compare(request,new AbortController().signal)).ok).toBe(false);
  });
});
