import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {Bpic19Admission} from './Bpic19Admission';
import {Bpic19Session} from './session';
import {identity,workspaceId} from '../test/imports';

it('requires an explicit partial admission choice and keeps the source formula omission when saved and restored',async()=>{
  const session=new Bpic19Session();session.basis(workspaceId,identity,[],identity);
  session.reviewed({operation:'bpic19_measures',identity,query:{policy_id:'literal'},definition_id:'counts'});
  let view:ReturnType<typeof render>;
  const props={session,identity,onChange:()=>view.rerender(<Bpic19Admission {...props}/>)};
  view=render(<Bpic19Admission {...props}/>);const user=userEvent.setup();
  await user.click(screen.getByText('Review retained pipeline and source-method admission'));
  await user.click(screen.getByLabelText('Include the unresolved R13 weighted many-to-many source step'));
  expect(session.readyForSave()).toBe(false);expect(session.savedPipeline()).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('formula gate');
  await user.selectOptions(screen.getByLabelText('Replay admission'),'partial');
  expect(session.readyForSave()).toBe(true);const saved=session.savedPipeline()!;
  expect(saved.replay_mode).toBe('partial');
  expect(saved.actions.some(a=>a.operation==='bpic19_method_gate' && a.query.method_id==='R13.weighted_many_to_many')).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('cannot claim full R13 reproduction');
  const fresh=new Bpic19Session();fresh.restore(workspaceId,identity,[],saved.actions,identity,saved.replay_mode);
  expect(fresh.savedPipeline()).toEqual(saved);
  await user.selectOptions(screen.getByLabelText('Replay admission'),'require_all');
  expect(session.readyForSave()).toBe(false);
});


it('preserves separate retained rows for same-population recipes and origins across rerenders',()=>{
  const parent={...identity,population_id:"population.v1:sha256:"+"1".repeat(64)};
  const path=[{kind:"contains_activity",activity:"Create",negate:false},{kind:"contains_activity",activity:"Finish",negate:false}];
  const profile={operation:"bpic19_profile" as const,identity:parent,query:{policy_id:"literal"},definition_id:"same-profile"};
  const typed={...profile,selection_prefix_length:1,selection_keep:{policy_id:"bpic19.profile_group_keep.v1" as const,step_index:1,group:{kind:"flow" as const,flow_id:"before_gr" as const}}};
  const current={...profile,selection_prefix_length:2};
  const session=new Bpic19Session();
  expect(session.restore(workspaceId,parent,path,[typed,current],identity)).toBe(true);
  const errors=vi.spyOn(console,"error").mockImplementation(()=>{});
  try {
    const props={session,identity:parent,onChange:()=>{}};
    const view=render(<Bpic19Admission {...props}/>);
    const list=screen.getByRole("list",{name:"Retained purchasing pipeline",hidden:true});
    expect(within(list).getAllByRole("listitem",{hidden:true})).toHaveLength(2);
    session.retain({...current,definition_id:"other-profile",query:{policy_id:"other"}});
    view.rerender(<Bpic19Admission {...props}/>);
    expect(within(list).getAllByRole("listitem",{hidden:true})).toHaveLength(3);
    session.reviewed(current);
    view.rerender(<Bpic19Admission {...props}/>);
    const rows=within(list).getAllByRole("listitem",{hidden:true});
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("same-profile");
    expect(rows[2].textContent).toContain("same-profile");
    expect(errors.mock.calls.filter(call=>call.some(value=>String(value).includes("same key")))).toEqual([]);
  } finally { errors.mockRestore(); }
});
