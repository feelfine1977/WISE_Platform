import type { AnswerIdentity } from '../generated/saving';
import type { Bpic19Session } from './session';
import gate from './source-method-gate.json';

export function Bpic19Admission({ session, identity, onChange }: { session: Bpic19Session; identity: AnswerIdentity; onChange: () => void }) {
  const actions=session.declarations();
  const hasGate=actions.some(action=>action.operation==='bpic19_method_gate');
  return <details className="bpic19-panel">
    <summary>Review retained pipeline and source-method admission</summary>
    <p>Each retained definition names its original population. A required source-method gate must be resolved before a complete replay can be saved.</p>
    <ol aria-label="Retained purchasing pipeline">{actions.map((action,index)=><li key={`${action.operation}:${action.definition_id}:${action.identity.population_id}`}>
      Step {index+1}: {action.operation.replaceAll('bpic19_','').replaceAll('_',' ')} · {action.definition_id}
      <small>Population {action.identity.population_id}</small>
    </li>)}</ol>
    <label><input type="checkbox" checked={hasGate} onChange={event=>{
      if(event.target.checked) session.retain({ operation:'bpic19_method_gate', identity, query:gate.query, definition_id:gate.definition_id });
      else session.removeMethodGate();
      onChange();
    }}/>Include the unresolved R13 weighted many-to-many source step</label>
    {hasGate && <p>{gate.query.source_locator}. {gate.query.gate_reason}</p>}
    <label>Replay admission<select value={session.replayModeForDisplay()} onChange={event=>{
      session.setReplayMode(event.target.value==='partial'?'partial':'require_all');onChange();
    }}><option value="require_all">Require every declared step</option><option value="partial">Save admitted steps as an explicitly partial analysis</option></select></label>
    {hasGate && <p role="status">{session.replayModeForDisplay()==='partial'
      ? 'The export will identify the omitted source step, its formula gate and the partial run. It cannot claim full R13 reproduction.'
      : 'The R13 source step is not admitted. A complete replay is unavailable until its formula gate is resolved.'}</p>}
  </details>;
}
