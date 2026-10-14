import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it} from 'vitest';
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
