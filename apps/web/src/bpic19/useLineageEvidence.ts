import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerIdentity } from '../generated/saving';
import { httpImportClient, type ImportClient } from '../data/client';
import { sameJson } from '../data/coordinator';
import type { ImportedCaseState } from '../imported/coordinator';

export interface LineageRequest { identity: AnswerIdentity; caseId: string; rowIds: string[]; reason: string; witnessScope?: "source" }
/** Reads the declared ancestor directly, with source/revision/request fences and no selection fallback. */
export function useLineageEvidence(workspaceId: string | undefined, sourceIdentity: AnswerIdentity | undefined, revision: number,
  client: Pick<ImportClient,'caseEvidence'>=httpImportClient) {
  const [state,setState]=useState<ImportedCaseState>({phase:'closed'}),[context,setContext]=useState<LineageRequest|null>(null);
  const serial=useRef(0),abort=useRef<AbortController|null>(null),last=useRef<LineageRequest|null>(null);
  const sourceKey=JSON.stringify([workspaceId,sourceIdentity?.source_id,sourceIdentity?.preparation_id,sourceIdentity?.representation_id,sourceIdentity?.case_dictionary_id,sourceIdentity?.implementation_version]);
  const close=useCallback(()=>{++serial.current;abort.current?.abort();last.current=null;setContext(null);setState({phase:'closed'});},[]);
  useEffect(()=>{close();return()=>{++serial.current;abort.current?.abort();};},[sourceKey,close]);
  const open=useCallback(async (intent:LineageRequest)=>{
    if(!workspaceId || !sourceIdentity)return;
    const {population_id:_parent,...basis}=intent.identity;
    const {population_id:_base,...source}=sourceIdentity;
    if(!sameJson(basis,source))return;
    const mine=++serial.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
    last.current=structuredClone(intent);setContext(structuredClone(intent));setState({phase:'loading',caseId:intent.caseId});
    const request={schema_version:1 as const,message_type:'imported_case_evidence_request' as const,request_id:`lineage-evidence-${revision}-${mine}`,query_revision:revision,workspace_id:workspaceId,identity:intent.identity,case_id:intent.caseId};
    const reply=await client.caseEvidence(request,controller.signal);
    if(mine!==serial.current || controller.signal.aborted)return;
    if(!reply.ok){setState({phase:'failed',caseId:intent.caseId,problem:reply.problem});return;}
    const a=reply.answer;
    // Source inclusion receipts can name rows from several sibling histories.
    const rowIds = intent.witnessScope === "source" ? intent.rowIds.filter(row => a.records.some(record => record.row_id === row)) : intent.rowIds;
    if(a.request_id!==request.request_id || a.query_revision!==request.query_revision || a.workspace_id!==workspaceId || !sameJson(a.identity,intent.identity) || a.case_id!==intent.caseId || rowIds.some(row=>!a.records.some(record=>record.row_id===row)) || intent.rowIds.length > 0 && rowIds.length === 0){
      setState({phase:'failed',caseId:intent.caseId,problem:{kind:'unsupported_reply',detail:'The returned history differs from the retained population, item or contributing records. No current-selection history was substituted.'}});return;
    }
    setContext({ ...structuredClone(intent), rowIds });
    setState({phase:'ready',caseId:intent.caseId,answer:a});
  },[workspaceId,sourceKey,revision,client]);
  const retry=useCallback(()=>{if(last.current)void open(last.current);},[open]);
  return {state,context,open,close,retry};
}
