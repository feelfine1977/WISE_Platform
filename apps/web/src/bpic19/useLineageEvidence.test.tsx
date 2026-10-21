import {act,renderHook,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {useLineageEvidence} from './useLineageEvidence';
import {importContract,type ImportClient} from '../data/client';
import type {ImportedCaseEvidenceAnswer} from '../generated/imports';
import literal from './retained-cohort-h7-evidence.json';
if(!importContract.caseEvidenceAnswer(literal))throw new Error('Literal H7 history obeys the source-record contract');
const answer:ImportedCaseEvidenceAnswer=literal;
it('opens all three original parent A records, preserves the 1948 cell and rejects a current-selection substitute',async()=>{
 const client:Pick<ImportClient,'caseEvidence'>={caseEvidence:vi.fn(async request=>({ok:true as const,answer:{...answer,request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id,identity:request.identity}}))};
 const {result}=renderHook(()=>useLineageEvidence(answer.workspace_id,answer.identity,3,client));
 const intent={identity:answer.identity,caseId:'A',rowIds:[answer.records[0].row_id],reason:'B excluded by document-start witness A'};
 await act(async()=>{await result.current.open(intent);});
 expect(result.current.state.phase).toBe('ready');
 if(result.current.state.phase==='ready'){
  expect(result.current.state.answer.records).toHaveLength(3);
  expect(result.current.state.answer.records[0].original_cells[2]).toBe('1948-01-01T00:00:00');
 }
 expect(result.current.context?.rowIds).toEqual(intent.rowIds);
 const changed:Pick<ImportClient,'caseEvidence'>={caseEvidence:vi.fn(async request=>({ok:true as const,answer:{...answer,request_id:request.request_id,query_revision:request.query_revision,workspace_id:request.workspace_id,identity:{...request.identity,population_id:'population.v1:sha256:'+'f'.repeat(64)}}}))};
 const other=renderHook(()=>useLineageEvidence(answer.workspace_id,answer.identity,3,changed));
 await act(async()=>{await other.result.current.open(intent);});
 await waitFor(()=>expect(other.result.current.state.phase).toBe('failed'));
});
