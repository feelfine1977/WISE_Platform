import {fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import {IncidentRangeFilter,PathLagRangeFilter} from './RangeConditions';
import {stepWording} from '../map/wording';
import {selectionContract} from '../map/client';
import {populationAnswer,preparationId,workspaceId} from '../test/imports';
const identity=populationAnswer({schema_version:1,message_type:'open_population_request',request_id:'fixture-open',query_revision:1,workspace_id:workspaceId,preparation_id:preparationId}).identity;
const accepts=(p:unknown)=>selectionContract.selectCasesRequest({schema_version:1,message_type:'select_cases_request',request_id:'range-typed',query_revision:2,workspace_id:workspaceId,identity,parent_case_ids:null,predicates:[p]});

describe('one-step whole incident range controls',()=>{
 it('offers span, longest gap then raw records and emits both inclusive bounds as one typed step',async()=>{
  const user=userEvent.setup(),onStep=vi.fn();render(<IncidentRangeFilter onStep={onStep}/>);
  expect(Array.from(screen.getByLabelText('Range measure').querySelectorAll('option'),o=>o.value)).toEqual(['observed_span_between','max_raw_gap_between','raw_record_count_between']);
  await user.type(screen.getByLabelText('Lower bound (included), hours'),'4');await user.type(screen.getByLabelText('Upper bound (included), hours'),'6');await user.click(screen.getByRole('button',{name:'Keep by this range'}));
  expect(onStep).toHaveBeenCalledExactlyOnceWith({kind:'observed_span_between',minimum_hours:4,maximum_hours:6,negate:false});expect(accepts(onStep.mock.calls[0][0])).toBe(true);expect(stepWording(onStep.mock.calls[0][0])).toContain('bounds included');
  expect(screen.getByText(/The range adds one step/)).toBeTruthy();
 });
 it('supports an unbounded upper and removing a raw count range, independent of chronology',async()=>{
  const user=userEvent.setup(),onStep=vi.fn();render(<IncidentRangeFilter onStep={onStep}/>);
  await user.selectOptions(screen.getByLabelText('Range measure'),'raw_record_count_between');await user.type(screen.getByLabelText('Lower bound (included), records'),'2');await user.selectOptions(screen.getByLabelText('Range action'),'remove');await user.click(screen.getByRole('button',{name:'Remove by this range'}));
  expect(onStep).toHaveBeenCalledExactlyOnceWith({kind:'raw_record_count_between',minimum_records:2,maximum_records:null,negate:true});expect(accepts(onStep.mock.calls[0][0])).toBe(true);expect(screen.getByText(/do not require known chronology/)).toBeTruthy();
 });
 it('requires a lower bound and refuses a reversed range without adding either bound',async()=>{
  const user=userEvent.setup(),onStep=vi.fn();render(<IncidentRangeFilter onStep={onStep}/>);await user.click(screen.getByRole('button',{name:'Keep by this range'}));expect(screen.getByRole('alert')).toBeTruthy();
  await user.type(screen.getByLabelText('Lower bound (included), hours'),'9');await user.type(screen.getByLabelText('Upper bound (included), hours'),'4');await user.click(screen.getByRole('button',{name:'Keep by this range'}));expect(onStep).not.toHaveBeenCalled();
 });
 it('raw counts reject fractions and unsafe integers at the form boundary',()=>{
  const onStep=vi.fn();render(<IncidentRangeFilter onStep={onStep}/>);fireEvent.change(screen.getByLabelText('Range measure'),{target:{value:'raw_record_count_between'}});
  for(const value of ['1.5','9007199254740992']){fireEvent.change(screen.getByLabelText('Lower bound (included), records'),{target:{value}});fireEvent.submit(screen.getByRole('button',{name:'Keep by this range'}).closest('form')!);}
  expect(onStep).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('whole raw-record');
 });
});

describe('typed path lag range seam for the path card and row',()=>{
 it('defaults any, offers every, uses exact pair and states absent/U/clock semantics',async()=>{
  const user=userEvent.setup(),onStep=vi.fn();render(<PathLagRangeFilter sourceActivity="Open" targetActivity="Close" timestampKind="wall_clock" onStep={onStep}/>);
  expect(screen.getByText(/recorded wall-clock hours/)).toBeTruthy();expect(screen.getByText(/Both choices require a passage/)).toBeTruthy();
  await user.type(screen.getByLabelText('Lower lag bound (included), hours'),'720');await user.click(screen.getByRole('button',{name:'Keep by path lag'}));
  const any={kind:'directly_follows_lag_between',source_activity:'Open',target_activity:'Close',minimum_hours:720,maximum_hours:null,quantifier:'any',negate:false} as const;expect(onStep).toHaveBeenCalledExactlyOnceWith(any);expect(accepts(any)).toBe(true);
  await user.selectOptions(screen.getByLabelText('Passages required'),'every');await user.selectOptions(screen.getByLabelText('Path range action'),'remove');await user.click(screen.getByRole('button',{name:'Remove by path lag'}));
  const every={...any,quantifier:'every',negate:true} as const;expect(onStep).toHaveBeenLastCalledWith(every);expect(onStep).toHaveBeenCalledTimes(2);expect(accepts(every)).toBe(true);expect(stepWording(every)).toContain('known incidents with no passage are included');
 });
 it('pending state disables the sole commit and retains its explanation',()=>{
  const onStep=vi.fn();render(<><p id="range-pending">Checking the selection</p><PathLagRangeFilter sourceActivity="A" targetActivity="B" timestampKind="utc_instant" onStep={onStep} waitingFor="range-pending"/></>);
  const button=screen.getByRole('button',{name:'Keep by path lag'}) as HTMLButtonElement;expect(button.disabled).toBe(true);expect(button.getAttribute('aria-describedby')).toBe('range-pending');
 });
});
