import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Bpic19RecipeComparison } from './Bpic19RecipeComparison';
import { bpic19RecipeComparisonContract, type Bpic19RecipeComparisonOutcome } from './recipe-comparison-client';
import fixtures from './recipe-comparison-test-answers.json';

function answer(kind:'operator'|'cohort'){
  const value=structuredClone(fixtures[kind]);
  if(!bpic19RecipeComparisonContract.answer(value))throw new Error('Invalid real synthetic comparison');
  return value;
}
describe('canonical saved pair receipt',()=>{
  it('renders original completion transitions and reports only a verified pair current',async()=>{
    const value=answer('cohort'),reviewed=vi.fn(),valid=vi.fn();
    render(<Bpic19RecipeComparison workspaceId={value.workspace_id} identity={value.identity} revision={1} query={value.query} client={{compare:async()=>({ok:true,answer:value})}} onReviewed={reviewed} onValidityChange={valid} onInspect={()=>{}}/>);
    expect(await screen.findByRole('table',{name:'Completion outcomes on the same parent'})).not.toBeNull();
    expect(screen.getByText('Recorded closed/open/unknown and outside-inclusion states stay separate.',{exact:false})).not.toBeNull();
    expect(reviewed).toHaveBeenCalledWith(value);expect(valid.mock.calls.map(call=>call[0])).toEqual([false,true]);
  });
  it('keeps saving invalid after a canonical refusal and does not publish old pending source replies',async()=>{
    const value=answer('operator'),reviewed=vi.fn(),valid=vi.fn();let complete:(value:Bpic19RecipeComparisonOutcome)=>void=()=>{};
    const client={compare:vi.fn(()=>new Promise<Bpic19RecipeComparisonOutcome>(resolve=>{complete=resolve;}))};
    const {rerender}=render(<Bpic19RecipeComparison workspaceId={value.workspace_id} identity={value.identity} revision={1} query={value.query} client={client} onReviewed={reviewed} onValidityChange={valid} onInspect={()=>{}}/>);
    const earlier=complete;
    rerender(<Bpic19RecipeComparison workspaceId={value.workspace_id} identity={value.identity} revision={2} query={value.query} client={client} onReviewed={reviewed} onValidityChange={valid} onInspect={()=>{}}/>);
    await act(async()=>{earlier({ok:true,answer:value});complete({ok:false,problem:{kind:'unsupported_reply',detail:'Pair definitions differ'}});});
    expect((await screen.findByRole('alert')).textContent).toContain('Pair definitions differ');expect(reviewed).not.toHaveBeenCalled();expect(valid.mock.calls.every(call=>call[0]===false)).toBe(true);
  });
});
