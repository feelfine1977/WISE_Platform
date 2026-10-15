import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { sameJson } from "../data/coordinator";
import type { Bpic19ProfileAnswer, Bpic19ProfileQuery } from "../generated/bpic19-profile";
import type { Bpic19MeasuresAnswer, MeasureQuery, MeasureRoles } from "../generated/bpic19-measures";
import type { Bpic19CohortsAnswer, CohortQuery } from "../generated/bpic19-cohorts";
import type { Bpic19OperatorAnswer, OperatorQuery } from "../generated/bpic19-operators";
import type { CompareCoordinator } from "../compare/coordinator";
import { type ImportedInvestigationCoordinator, shownSelection } from "../imported/coordinator";
import { ImportedInspector } from "../imported/ImportedInspector";
import { SelectionSteps } from "../map/SelectionSteps";
import { SaveButton, SaveForm } from "../saved/SaveControl";
import type { SavingCoordinator } from "../saved/coordinator";
import { Bpic19Profile } from "./Bpic19Profile";
import { Bpic19Measures } from "./Bpic19Measures";
import { Bpic19Cohorts, type Bpic19CohortComparison } from "./Bpic19Cohorts";
import { Bpic19SavedScore } from "./Bpic19SavedScore";
import { Bpic19RetainedAssessments } from "./Bpic19RetainedAssessments";
import type { Bpic19ScoreAnswer, ExposureReview } from "./scoring-types";
import { bpic19Contract } from "./scoring-client";
import { Bpic19Operators, type Bpic19OperatorComparison } from "./Bpic19Operators";
import { Bpic19Admission } from "./Bpic19Admission";
import { Bpic19FlowComparison, flowComparisonQuery } from "./Bpic19FlowComparison";
import type { Bpic19FlowComparisonAnswer, FlowComparisonQuery } from "../generated/bpic19-flow-comparison";
import type { AnswerIdentity } from "../generated/saving";
import { Bpic19RetainedCohorts } from "./Bpic19RetainedCohorts";
import { useLineageEvidence } from "./useLineageEvidence";
import { Bpic19RecordFilter } from "./Bpic19RecordFilter";
import type { RecordAttributesAll } from "../generated/selection";
import { Bpic19IntervalComparison, intervalComparisonQuery } from "./Bpic19IntervalComparison";
import type { Bpic19IntervalComparisonAnswer, IntervalComparisonQuery, IntervalSide } from "../generated/bpic19-interval-comparison";
import type { Bpic19Session } from "./session";
import { Bpic19RecipeComparison } from "./Bpic19RecipeComparison";
import type { Bpic19RecipeComparisonAnswer, RecipeComparisonQuery } from "../generated/bpic19-recipe-comparison";
import { Bpic19LiteratureClaims } from "./Bpic19LiteratureClaims";
import { purchasingReportMarkdown } from "./purchasing-report";
import type { Bpic19LiteratureClaim } from "../generated/saving";
import "./workspace.css";

interface Props {
  investigation: ImportedInvestigationCoordinator;
  comparison: CompareCoordinator;
  saving: SavingCoordinator;
  session: Bpic19Session;
  active: boolean;
  onShowData: () => void;
  onShowComparison: () => void;
}

function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "purchasing-investigation.json";
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
function downloadReport(text:string){
  const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='purchasing-analysis-report.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
}

/** The purchasing entry point uses the same population, evidence and saved revisions as the map. */
export function Bpic19Workspace({ investigation, saving, session, active, onShowData }: Props) {
  const state = useSyncExternalStore(investigation.subscribe, investigation.getState);
  useSyncExternalStore(saving.subscribe, saving.getState);
  const [profile, setProfile] = useState<Bpic19ProfileAnswer | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [rows, setRows] = useState<string[]>([]);
  const [layout, setLayout] = useState<"side" | "full" | "collapsed">("side");
  const [cohortEnabled, setCohortEnabled] = useState(false);
  const [scoreEnabled, setScoreEnabled] = useState(false);
  const [operatorsEnabled, setOperatorsEnabled] = useState(false);
  const [flowComparison, setFlowComparison] = useState<{ identity: AnswerIdentity; query: FlowComparisonQuery } | null>(null);
  const [intervalComparison, setIntervalComparison] = useState<{ identity: AnswerIdentity; query: IntervalComparisonQuery } | null>(null);
  const [recipeComparisons,setRecipeComparisons]=useState<Partial<Record<'bpic19_operator_comparison'|'bpic19_cohort_comparison',{identity:AnswerIdentity;query:RecipeComparisonQuery;review?:number}>>>({});
  const flowIntervalSides = useRef<{identity:AnswerIdentity;target:IntervalSide;reference:IntervalSide}|undefined>(undefined);
  const recordPredicate = useRef<RecordAttributesAll | undefined>(undefined);
  const operatorName = useRef<"bpic19_ordinal" | "bpic19_fifo" | "bpic19_cancellation" | "bpic19_rule" | "bpic19_waiting">("bpic19_ordinal");
  const heading = useRef<HTMLHeadingElement>(null);
  const activated = useRef("");
  const restoredRevision = useRef<string | undefined>(undefined);
  const queries = useRef<{ preparation: string; revision: string | undefined; profile?: Bpic19ProfileQuery; measures?: MeasureQuery; cohorts?: CohortQuery; operators?: OperatorQuery; scoreRunId?: string; scorePopulationId?: string }>({ preparation: "", revision: undefined });
  const [, refresh] = useState(0);
  const shown = shownSelection(state.selection);
  const population = state.population.phase === "ready" ? state.population.answer : null;
  const identity = shown?.answer.identity ?? population?.identity;
  const revision = shown?.revision ?? (state.population.phase === "ready" ? state.population.revision : 0);
  const key = JSON.stringify([population?.workspace_id, identity]);
  const preparation = JSON.stringify([population?.workspace_id, identity?.preparation_id]);
  const lineage = useLineageEvidence(population?.workspace_id,population?.identity,revision);
  if (active) activated.current = preparation;
  const engaged = active || activated.current === preparation;
  const savedRevision = state.saved?.revisionId;
  if (queries.current.preparation !== preparation || queries.current.revision !== savedRevision) {
    const allActions = state.saved?.content.bpic19_pipeline?.actions ?? [];
    const actions = allActions.filter(action => sameJson(action.identity, identity));
    const scoredAction = actions.find(action => action.operation === "bpic19_score");
    if (queries.current.preparation !== preparation) recordPredicate.current = undefined;
    const savedRecordPredicate = state.saved?.content.selection_recipe.predicates.filter(predicate=>predicate.kind==='record_attributes_all').at(-1);
    if(savedRecordPredicate?.kind==='record_attributes_all') recordPredicate.current = savedRecordPredicate;
    queries.current = { preparation, revision: savedRevision,
      profile: actions.find(action => action.operation === "bpic19_profile")?.query as Bpic19ProfileQuery | undefined,
      measures: actions.find(action => action.operation === "bpic19_measures")?.query as MeasureQuery | undefined,
      cohorts: actions.find(action => action.operation === "bpic19_cohorts")?.query as unknown as CohortQuery | undefined,
      operators: actions.filter(action => ["bpic19_ordinal", "bpic19_fifo", "bpic19_cancellation", "bpic19_rule", "bpic19_waiting"].includes(action.operation)).at(-1)?.query as unknown as OperatorQuery | undefined,
      scoreRunId: typeof scoredAction?.query.run_id === "string" ? scoredAction.query.run_id : undefined,
      scorePopulationId: scoredAction?.identity.population_id };
  }

  useLayoutEffect(() => {
    setProfile(null); setRows([]); setFlowComparison(null);setIntervalComparison(null);setRecipeComparisons({});flowIntervalSides.current=undefined;
    if (population && identity) session.basis(population.workspace_id, identity, shown?.steps ?? [], population.identity);
  }, [key, session]);

  useLayoutEffect(() => {
    if (!population || !identity || !state.saved || restoredRevision.current === savedRevision ||
        !sameJson(state.saved.content.selection_identity, identity)) return;
    session.restore(population.workspace_id, identity, shown?.steps ?? [],
      state.saved.content.bpic19_pipeline?.actions ?? [], population.identity, state.saved.content.bpic19_pipeline?.replay_mode,state.saved.content.bpic19_pipeline?.literature_claims);
    restoredRevision.current = savedRevision;
    const comparisonAction = state.saved.content.bpic19_pipeline?.actions.find(action=>action.operation==='bpic19_flow_comparison' && sameJson(action.identity,identity));
    if(comparisonAction) setFlowComparison({identity:comparisonAction.identity, query:comparisonAction.query as unknown as FlowComparisonQuery});
    const intervalAction=state.saved.content.bpic19_pipeline?.actions.find(action=>action.operation==='bpic19_interval_comparison' && sameJson(action.identity,identity));
    if(intervalAction)setIntervalComparison({identity:intervalAction.identity,query:intervalAction.query as unknown as IntervalComparisonQuery});
    const pairs:typeof recipeComparisons={};
    for(const operation of ['bpic19_operator_comparison','bpic19_cohort_comparison'] as const){
      const action=state.saved.content.bpic19_pipeline?.actions.filter(action=>action.operation===operation && sameJson(action.identity,identity)).at(-1);
      if(action)pairs[operation]={identity:action.identity,query:action.query as unknown as RecipeComparisonQuery};
    }
    setRecipeComparisons(pairs);
    refresh(value => value + 1);
  }, [key, savedRevision, session]);

  const reviewedProfile = useCallback((answer: Bpic19ProfileAnswer) => {
    setProfile(answer);
    queries.current.profile = answer.query;
    if (answer.profile) session.reviewed({ operation: "bpic19_profile", identity: answer.identity,
      query: { ...answer.query }, definition_id: answer.profile.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const availableColumns = useCallback((answer: Bpic19ProfileAnswer) => { setProfile(answer); }, []);
  const reviewedMeasures = useCallback((answer: Bpic19MeasuresAnswer) => {
    queries.current.measures = answer.query;
    session.reviewed({ operation: "bpic19_measures", identity: answer.identity, query: { ...answer.query }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const retainMeasures = useCallback((answer:Bpic19MeasuresAnswer)=>{
    session.retain({operation:'bpic19_measures',identity:answer.identity,query:{...answer.query},definition_id:answer.definition_id});
    refresh(value=>value+1);
  },[session]);
  const profileValid = useCallback((current: boolean) => {
    // Counts can be reviewed before a purchasing partition is declared.
    // An accepted partition still fences its later edits and replacement.
    if (!current && queries.current.profile?.roles == null) return;
    session.valid("bpic19_profile", current, key); refresh(value => value + 1);
  }, [session, key]);
  const measuresValid = useCallback((current: boolean) => { session.valid("bpic19_measures", current, key); refresh(value => value + 1); }, [session, key]);
  const cohortsValid = useCallback((current: boolean) => { session.valid("bpic19_cohorts", current, key); refresh(value => value + 1); }, [session, key]);
  const reviewedCohorts = useCallback((answer: Bpic19CohortsAnswer) => {
    queries.current.cohorts = answer.query;
    session.reviewed({ operation: "bpic19_cohorts", identity: answer.identity, query: { ...answer.query }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const retainCohorts=useCallback((answer:Bpic19CohortsAnswer)=>{
    session.retain({operation:'bpic19_cohorts',identity:answer.identity,query:{...answer.query},definition_id:answer.definition_id});refresh(value=>value+1);
  },[session]);
  const comparedOperators=useCallback((pair:Bpic19OperatorComparison)=>{
    session.valid('bpic19_operator_comparison',false,key);
    setRecipeComparisons(current=>({...current,bpic19_operator_comparison:{review:(current.bpic19_operator_comparison?.review??0)+1,identity:pair.identity,query:{policy_id:pair.policy_id,ordinal:{...pair.ordinal,query:{...pair.ordinal.query}},fifo:{...pair.fifo,query:{...pair.fifo.query}}}}}));
  },[session,key]);
  const comparedCohorts=useCallback((pair:Bpic19CohortComparison)=>{
    session.valid('bpic19_cohort_comparison',false,key);
    setRecipeComparisons(current=>({...current,bpic19_cohort_comparison:{review:(current.bpic19_cohort_comparison?.review??0)+1,identity:pair.identity,query:{policy_id:pair.policy_id,target:{...pair.target,query:{...pair.target.query}},reference:{...pair.reference,query:{...pair.reference.query}}}}}));
  },[session,key]);
  const reviewedRecipeComparison=useCallback((answer:Bpic19RecipeComparisonAnswer)=>{
    session.retain({operation:answer.operation,identity:answer.identity,query:{...answer.query},definition_id:answer.definition_id});refresh(value=>value+1);
  },[session]);
  const operatorComparisonValid=useCallback((valid:boolean)=>{session.valid('bpic19_operator_comparison',valid,key);refresh(value=>value+1);},[session,key]);
  const cohortComparisonValid=useCallback((valid:boolean)=>{session.valid('bpic19_cohort_comparison',valid,key);refresh(value=>value+1);},[session,key]);
  const operatorComparisonDraftValid=useCallback((valid:boolean)=>{if(!valid)operatorComparisonValid(false);},[operatorComparisonValid]);
  const cohortComparisonDraftValid=useCallback((valid:boolean)=>{if(!valid)cohortComparisonValid(false);},[cohortComparisonValid]);
  const changedLiteratureClaims=useCallback((claims:Bpic19LiteratureClaim[])=>{session.setClaims(claims);refresh(value=>value+1);},[session]);
  const literatureClaimsValid=useCallback((valid:boolean)=>{if(session.validClaims(valid))refresh(value=>value+1);},[session]);
  const scoreValid = useCallback((current: boolean) => { session.valid("bpic19_score", current, key); refresh(value => value + 1); }, [session, key]);
  const reviewedScore = useCallback((answer: Bpic19ScoreAnswer) => {
    if (typeof answer.definition_id !== "string") {
      session.valid("bpic19_score", false);
      refresh(value => value + 1);
      return;
    }
    session.reviewed({ operation: "bpic19_score", identity: answer.named_population.identity,
      query: { run_id: answer.run_id, case_offset: 0, case_limit: 50, group_offset: 0, group_limit: 50 }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const operatorsValid = useCallback((current: boolean) => { session.valid(operatorName.current, current, key); refresh(value => value + 1); }, [session, key]);
  const reviewedOperators = useCallback((answer: Bpic19OperatorAnswer) => {
    if (answer.operation === "bpic19_catalogue") return;
    if (operatorName.current !== answer.operation) session.valid(operatorName.current, true, key);
    operatorName.current = answer.operation;
    queries.current.operators = answer.query;
    session.reviewed({ operation: answer.operation, identity: answer.identity, query: { ...answer.query }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session, key]);
  const retainOperator = useCallback((answer: Bpic19OperatorAnswer) => {
    if (answer.operation === "bpic19_catalogue") return;
    session.retain({ operation: answer.operation, identity: answer.identity, query: { ...answer.query }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const reviewedFlowComparison = useCallback((answer: Bpic19FlowComparisonAnswer) => {
    session.reviewed({operation:'bpic19_flow_comparison',identity:answer.identity,query:{...answer.query},definition_id:answer.definition_id});
    flowIntervalSides.current={identity:answer.identity,
      target:{label:`${answer.query.target.flow_id} × ${answer.query.target.item_type_value ?? answer.query.target.item_type_state}`,recipe:{kind:'complete_case_ids',case_ids:[...answer.comparison.target.case_ids]}},
      reference:{label:`${answer.query.reference.flow_id} × ${answer.query.reference.item_type_value ?? answer.query.reference.item_type_state}`,recipe:{kind:'complete_case_ids',case_ids:[...answer.comparison.reference.case_ids]}}};
    refresh(value=>value+1);
  },[session]);
  const flowComparisonValid = useCallback((valid:boolean)=>{
    session.valid('bpic19_flow_comparison',valid,key);refresh(value=>value+1);
  },[session,key]);
  const reviewedIntervalComparison = useCallback((answer:Bpic19IntervalComparisonAnswer)=>{
    session.reviewed({operation:'bpic19_interval_comparison',identity:answer.identity,query:{...answer.query},definition_id:answer.definition_id});
    refresh(value=>value+1);
  },[session]);
  const intervalComparisonValid=useCallback((valid:boolean)=>{session.valid('bpic19_interval_comparison',valid,key);refresh(value=>value+1);},[session,key]);
  const inspect = useCallback((caseId: string, rowIds: string[] = []) => {
    lineage.close();setRows(rowIds); setLayout("side"); investigation.openCase(caseId);
    setTimeout(() => heading.current?.focus(), 0);
  }, [investigation,lineage.close]);

  if (!engaged) return null;
  if (!population || !identity) return <main className="bpic19-workspace"><h1>Purchasing analysis</h1><p>Open a reviewed source to inspect its purchasing flows and recorded measures.</p><button onClick={onShowData}>Open Data</button></main>;
  const profileQuery = queries.current.profile;
  const measuresQuery = queries.current.measures;
  const currentSavedRunId = queries.current.scorePopulationId === identity.population_id ? queries.current.scoreRunId : undefined;
  const currentProfile = profile && JSON.stringify(profile.identity) === JSON.stringify(identity) ? profile : null;
  const exposureParent = shown?.answer.parent_identity ?? population.identity;
  const exposureReviews: ExposureReview[] = session.reviewedDeclarations().flatMap(action => {
    if (action.operation !== "bpic19_measures" ||
        !sameJson(action.identity, identity) && !sameJson(action.identity, exposureParent)) return [];
    const review = { definition_id: action.definition_id, identity: action.identity, query: action.query };
    return bpic19Contract.exposureReview(review) ? [review] : [];
  });
  const roles: MeasureRoles = { ...currentProfile?.query.roles };
  const headers: Record<string, string> = { company: "case Company", spend_area: "case Spend area text", resource: "event org:resource", value: "event Cumulative net worth (EUR)", net_worth: "event Cumulative net worth (EUR)" };
  for (const [role, name] of Object.entries(headers)) {
    const matches = currentProfile?.columns.filter(column => column.name === name || column.name === "source__" + name) ?? [];
    roles[role as keyof MeasureRoles] = matches.length === 1 ? matches[0].index : null;
  }
  const paused = state.selection.phase !== "ready" || state.replacement !== null;
  const saved = saving.verifiedExportReceipt();
  const inspectorOpen = state.inspected.phase !== "closed" || lineage.state.phase !== "closed";
  return <main className="bpic19-workspace">
    <div className="bpic19-toolbar"><h1>Purchasing analysis</h1><button onClick={onShowData}>Review source in Data</button><SaveButton saving={saving} open={saveOpen} onOpen={() => setSaveOpen(true)} waitingFor={paused || !session.readyForSave() ? "bpic19-save-wait" : undefined} /></div>
    <p>Source: {population.source.filename}. Selections keep complete PO-item histories across purchasing analysis, the process map and comparisons.</p>
    <Bpic19Admission session={session} identity={identity} onChange={() => refresh(value=>value+1)} />
    <details><summary>Reported literature claims and report provenance</summary><Bpic19LiteratureClaims key={preparation} claims={session.claims()} runIds={session.declarations().filter(action=>action.operation==='bpic19_score' && typeof action.query.run_id==='string').map(action=>String(action.query.run_id))} onChange={changedLiteratureClaims} onValidityChange={literatureClaimsValid} /></details>
    {(paused || !session.readyForSave()) && <p id="bpic19-save-wait" role="status">Review the current definitions and wait for the current population before saving or exporting.</p>}
    {state.selection.phase !== "idle" && <SelectionSteps selection={state.selection} onRemove={step => investigation.removeStep(step)} onClear={() => investigation.clearSteps()} onUndo={() => investigation.undo()} onRedo={() => investigation.redo()} onRetry={() => investigation.retrySelection()} onStay={() => investigation.staySelection()} waitingFor={state.replacement ? "bpic19-save-wait" : undefined} />}
    {saveOpen && <SaveForm saving={saving} investigation={state} view="incidents" onClose={() => setSaveOpen(false)} />}
    {saved?.bpic19_outputs && !paused && session.readyForSave() && saved.revision.saved_revision_id === state.saved?.revisionId && sameJson(session.savedPipeline(), saved.revision.content.bpic19_pipeline) && <button onClick={() => download({ format: "wise-purchasing-investigation", format_version: 1, revision: saved.revision, source: population.source, preparation: population.preparation, manifest: saved.bpic19_outputs })}>Export saved definitions, results and witnesses</button>}
    {saved?.bpic19_outputs && !paused && session.readyForSave() && saved.revision.saved_revision_id === state.saved?.revisionId && sameJson(session.savedPipeline(),saved.revision.content.bpic19_pipeline) && <button onClick={()=>downloadReport(purchasingReportMarkdown(saved.revision,saved.bpic19_outputs!))}>Export readable purchasing analysis report</button>}
    <div className="bpic19-content" data-inspector={inspectorOpen ? layout : "none"}>
      <div className="bpic19-main" hidden={inspectorOpen && layout === "full"} inert={paused || undefined}>
        <Bpic19Profile key={key} workspaceId={population.workspace_id} identity={identity} revision={revision} query={profileQuery} onReviewed={reviewedProfile} onColumns={availableColumns} onValidityChange={profileValid} onInspect={inspect}
          onKeep={predicate => investigation.addStep(predicate)}
          onKeepRecordPredicate={predicate => { recordPredicate.current = predicate; investigation.addStep(predicate); }}
          onCompare={(target, comparator) => {
            setFlowComparison({ identity: target.recipe.source_identity, query: flowComparisonQuery(target,comparator) });
          }} />
        {flowComparison && sameJson(flowComparison.identity,identity) && <Bpic19FlowComparison key={JSON.stringify(flowComparison)} workspaceId={population.workspace_id}
          identity={flowComparison.identity} revision={revision} query={flowComparison.query} onReviewed={reviewedFlowComparison} onValidityChange={flowComparisonValid}
          onInspect={inspect} onKeepCases={caseIds=>{if(caseIds.length) investigation.addStep({kind:'case_id_in',case_ids:[caseIds[0],...caseIds.slice(1)],negate:false});}} />}
        {currentProfile && <Bpic19Measures workspaceId={population.workspace_id} identity={identity} revision={revision} roles={roles} columns={currentProfile.columns} query={measuresQuery} onReviewed={reviewedMeasures} onValidityChange={measuresValid} onInspect={inspect}
          onRetain={retainMeasures} retainedQueries={session.retainedActions().filter(action=>action.operation==='bpic19_measures').map(action=>({definition_id:action.definition_id,label:`${String(action.query.measure_profile)} · ${action.definition_id}`,query:action.query as unknown as MeasureQuery}))}
          onKeepCases={(caseIds) => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
        {currentProfile && !intervalComparison && <button onClick={()=>{
          const sides=flowIntervalSides.current && sameJson(flowIntervalSides.current.identity,identity) ? flowIntervalSides.current :
            {target:{label:'Target complete PO items',recipe:{kind:'complete_case_ids' as const,case_ids:[]}},reference:{label:'Comparator complete PO items',recipe:{kind:'complete_case_ids' as const,case_ids:[]}}};
          setIntervalComparison({identity,query:intervalComparisonQuery(sides.target,sides.reference,measuresQuery?.interval_source,measuresQuery?.interval_target)});
        }}>Compare recorded intervals on two named item sides</button>}
        {intervalComparison && sameJson(intervalComparison.identity,identity) && <Bpic19IntervalComparison workspaceId={population.workspace_id} identity={intervalComparison.identity}
          revision={revision} query={intervalComparison.query} onReviewed={reviewedIntervalComparison} onValidityChange={intervalComparisonValid} onInspect={inspect}
          onKeepCases={caseIds=>{if(caseIds.length)investigation.addStep({kind:'case_id_in',case_ids:[caseIds[0],...caseIds.slice(1)],negate:false});}} />}
        {currentProfile?.profile && <>
          <Bpic19RecordFilter columns={currentProfile.columns} initialColumns={[currentProfile.profile.definition.roles.goods_receipt,currentProfile.profile.definition.roles.gr_based_iv]}
            initialPredicate={recordPredicate.current} disabled={paused}
            result={shown?.answer.predicate_results.filter(result=>result.predicate.kind==='record_attributes_all').at(-1)}
            onKeep={predicate=>{if(predicate.kind==='record_attributes_all')recordPredicate.current=predicate;investigation.addStep(predicate);}}
            onInspect={(caseId,rowIds=[])=>{investigation.closeCase();setLayout('side');void lineage.open({identity:shown?.answer.parent_identity ?? population.identity,caseId,rowIds,reason:'Same-original-record matches or structurally unavailable fields, before optional inversion'});}} />
          {!cohortEnabled && !queries.current.cohorts && <button onClick={() => setCohortEnabled(true)}>Review completion and inclusion cohorts</button>}
          {(cohortEnabled || queries.current.cohorts) && <Bpic19Cohorts key={key} workspaceId={population.workspace_id} identity={identity} revision={revision}
            roles={{ item_category: currentProfile.profile.definition.roles.item_category,
              purchasing_document: currentProfile.profile.definition.roles.purchasing_document }}
            timestampKind={population.preparation.policies.time.id === "incident.time.wall_clock_as_recorded.v1" ? "wall_clock" : "utc_instant"}
            query={queries.current.cohorts} onReviewed={reviewedCohorts} onValidityChange={cohortsValid} onInspect={inspect}
            onRetain={retainCohorts} retainedQueries={session.retainedActions().filter(action=>action.operation==='bpic19_cohorts').map(action=>({definition_id:action.definition_id,label:`${String((action.query.completion as {recipe?:unknown}|undefined)?.recipe)} · ${action.definition_id}`,query:action.query as unknown as CohortQuery}))}
            restoredComparison={recipeComparisons.bpic19_cohort_comparison?{...recipeComparisons.bpic19_cohort_comparison.query,identity:recipeComparisons.bpic19_cohort_comparison.identity} as unknown as Bpic19CohortComparison:undefined}
            onCompared={comparedCohorts} onComparisonValidityChange={cohortComparisonDraftValid}
            onKeepCases={caseIds => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
        </>}
        <Bpic19RetainedCohorts workspaceId={population.workspace_id} currentIdentity={identity} actions={session.declarations()} revision={revision}
          onInspect={(parentIdentity,caseId,rowIds,reason)=>{investigation.closeCase();setLayout('side');void lineage.open({identity:parentIdentity,caseId,rowIds,reason});}} />
        <Bpic19RetainedAssessments workspaceId={population.workspace_id} baseIdentity={population.identity} currentIdentity={identity}
          actions={session.declarations()} revision={revision} labels={saving.nativeRunLabels(savedRevision)}
          onInspect={(parentIdentity,caseId,rowIds,reason)=>{investigation.closeCase();setLayout('side');void lineage.open({identity:parentIdentity,caseId,rowIds,reason});}} />
        {currentProfile?.profile && <>
          {!operatorsEnabled && !queries.current.operators && <button onClick={() => setOperatorsEnabled(true)}>Review invoice matches, recorded rules and waiting intervals</button>}
          {(operatorsEnabled || queries.current.operators) && <Bpic19Operators key={key} workspaceId={population.workspace_id} identity={identity} revision={revision}
            roles={{ event_id: currentProfile.columns.filter(column => column.name === "eventID" || column.name === "source__eventID").length === 1
                ? currentProfile.columns.find(column => column.name === "eventID" || column.name === "source__eventID")!.index : null,
              item_category: currentProfile.profile.definition.roles.item_category, net_worth: roles.net_worth ?? null }}
            query={queries.current.operators} retainedQueries={session.retainedActions().filter(action=>["bpic19_ordinal", "bpic19_fifo", "bpic19_cancellation", "bpic19_rule", "bpic19_waiting"].includes(action.operation)).map(action=>action.query as unknown as OperatorQuery)}
            columns={currentProfile.columns} onReviewed={reviewedOperators} onRetain={retainOperator} onValidityChange={operatorsValid} onInspect={inspect}
            restoredComparison={recipeComparisons.bpic19_operator_comparison?{...recipeComparisons.bpic19_operator_comparison.query,identity:recipeComparisons.bpic19_operator_comparison.identity} as unknown as Bpic19OperatorComparison:undefined}
            onCompared={comparedOperators} onComparisonValidityChange={operatorComparisonDraftValid}
            onKeepCases={caseIds => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
        </>}
        {currentProfile?.profile && <>
          {!scoreEnabled && !currentSavedRunId && <button onClick={() => setScoreEnabled(true)}>Evaluate purchasing criteria and priorities</button>}
          {(scoreEnabled || currentSavedRunId && state.selection.phase === "ready") && <Bpic19SavedScore key={key} revision={revision} savedRunId={currentSavedRunId}
            exposureReviews={exposureReviews}
            subject={{ workspace_id: population.workspace_id, base_identity: population.identity,
              named_population: { name: "Current reviewed PO items", identity }, roles }}
            onReviewed={reviewedScore} onValidityChange={scoreValid} onInspect={inspect}
            onKeepCases={caseIds => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
        </>}
        {Object.entries(recipeComparisons).map(([operation,pair])=>pair && sameJson(pair.identity,identity) && <Bpic19RecipeComparison key={`${operation}:${pair.review??0}`} workspaceId={population.workspace_id} identity={pair.identity} revision={revision} query={pair.query}
          onReviewed={reviewedRecipeComparison} onValidityChange={operation==='bpic19_operator_comparison'?operatorComparisonValid:cohortComparisonValid} onInspect={inspect} />)}
      </div>
      {state.inspected.phase !== "closed" && <ImportedInspector inspected={state.inspected} summary={undefined} layout={layout} onLayout={setLayout} onReturn={() => investigation.closeCase()} onRetry={() => investigation.retryCase()} headingRef={heading} highlightedRowIds={rows} />}
      {lineage.state.phase !== 'closed' && <div><p>Retained parent evidence: {lineage.context?.reason}. Population: {lineage.context?.identity.population_id}. The current analysis selection remains fixed.</p>
        <ImportedInspector inspected={lineage.state} summary={undefined} layout={layout} onLayout={setLayout} onReturn={lineage.close} onRetry={lineage.retry} headingRef={heading} highlightedRowIds={lineage.context?.rowIds} /></div>}
    </div>
  </main>;
}
