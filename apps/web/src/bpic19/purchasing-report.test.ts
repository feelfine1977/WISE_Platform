import { describe, expect, it } from "vitest";
import type { Bpic19PipelineManifest, SavedRevision } from "../generated/saving";
import { baseIdentity, containingOpenedIdentity, investigationId, firstRevisionId, savedContent } from "../test/saving";
import { purchasingReportMarkdown } from "./purchasing-report";

const runId="score-run.v1:sha256:"+"7".repeat(64),profileId="profile-definition-literal",scoreId="native-definition-literal";
const digest="a".repeat(64),filename=digest+".json.gz";
function literal():{revision:SavedRevision;manifest:Bpic19PipelineManifest}{
  const profileQuery={policy_id:"literal-source-profile"},scoreQuery={run_id:runId,case_offset:0,case_limit:50};
  const claims=[{claim_id:"paper-claim-1",report_id:"wise-paper" as const,source_locator:"WISE paper PDF26",claim:"Reported mean score0.8; not a new computation.",claim_level:"reported_not_rerun" as const,compared_run_id:runId}];
  const revision:SavedRevision={investigation_id:investigationId,saved_revision_id:firstRevisionId,content:{...structuredClone(savedContent),base_identity:baseIdentity,selection_identity:containingOpenedIdentity,
    selection_recipe:{parent_case_ids:["A","B"],predicates:[{kind:"case_id_in",case_ids:["A"],negate:false}]},notes:"Investigate the recorded delay; no adoption supplied",score_run_ref:null,
    bpic19_pipeline:{schema_version:1,actions:[{operation:"bpic19_profile",identity:baseIdentity,query:profileQuery,definition_id:profileId},
      {operation:"bpic19_score",identity:containingOpenedIdentity,query:scoreQuery,definition_id:scoreId}],literature_claims:claims}}};
  const manifest:Bpic19PipelineManifest={schema_version:1,claim_level:"complete_registered_pipeline",run_id:"pipeline-run-literal",literature_claims:structuredClone(claims),outputs:[
    {operation:"bpic19_profile",definition_id:profileId,sha256:"1".repeat(64),output:{identity:baseIdentity,query:profileQuery,
      profile:{definition:{policy_id:"literal-source-profile",roles:{item_category:9},category_labels:{before_gr:"3-way match, invoice before GR"},source_interpretation:{inclusion:{kind:"all_source"},horizon:{value:null,provenance:null}}},population:{case_count:2,record_count:3,document_count:2},flows:[],source_review:{source_id:baseIdentity.source_id,clock_kind:"wall_clock",parser_time_policy:"as_recorded",observed_raw_maximum:"2020-01-01T00:00:00",horizon_state:"unknown",interpretation:{inclusion:{kind:"all_source"},horizon:{value:null,provenance:null}},raw_support:{case_count:2,record_count:3,document_count:2}}}}},
    {operation:"bpic19_score",definition_id:scoreId,sha256:"2".repeat(64),output:{run_id:runId,named_population:{identity:containingOpenedIdentity},definition:{elapsed_unit:"days"},
      report:{profile_id:"paper",profile_complete:true,population_case_count:1,scored_case_count:1,unscored_case_count:0,mean_score:0.8,mean_coverage:1,
        method_artifact:{distribution:"wise-pm",version:"0.2.0",qualification:"candidate_component_checked_release_pending",eligible_release:false},settings:{view:"Balanced",mode:"flat",gamma:0},
        criterion_summary:[{criterion_id:"C04",evaluated_support:1,measurement_unavailable:0}],groups:[],case_page:{offset:0,total:1,cases:[{case_id:"A",record_row_ids:["original-row-A1","original-row-A2"]}]},
        analysis_review:{findings:[{title:"Consider a control change",observation:{status:"observed",note:"Current recorded signal",evidence:{case_ids:["A"],row_ids:["original-row-A1"]}},proposed_change:{status:"proposed",note:"Try a pilot",evidence:{}},adoption:{status:"unknown",note:"",evidence:{}},tested_outcome:{status:"untested",note:"",evidence:{}}}]}},
      snapshot:{artifacts:[{kind:"report",filename,sha256:digest,byte_count:40},{kind:"cases",filename:"b".repeat(64)+".json.gz",sha256:"b".repeat(64),byte_count:50}]},stale_directory_inventory:["z-old.png"]}},
  ]};return {revision,manifest};
}
describe("human-readable frozen purchasing report",()=>{
  it("names the verified selection-step association and exact category labels without retrofitting legacy origins",()=>{
    const {revision,manifest}=literal();
    revision.content.bpic19_pipeline!.actions[0].selection_keep={policy_id:"bpic19.profile_group_keep.v1",step_index:0,group:{kind:"flow",flow_id:"before_gr"}};
    const md=purchasingReportMarkdown(revision,manifest);
    expect(md).toContain("Verified purchasing selection lineage");expect(md).toContain(String.raw`"flow\_id":"before\_gr"`);
    expect(md).toContain("3-way match, invoice before GR");expect(md).toContain("Legacy ID-only selections are not retroactively assigned");
    delete revision.content.bpic19_pipeline!.actions[0].selection_keep;
    expect(purchasingReportMarkdown(revision,manifest)).not.toContain("Verified purchasing selection lineage");
  });
  it("renders one coherent revision, source/selected scopes, actual tools/numbers and separately reported literature claims",()=>{
    const {revision,manifest}=literal();const md=purchasingReportMarkdown(revision,manifest);
    expect(md).toContain(firstRevisionId);expect(md).toContain(baseIdentity.source_id);expect(md).toContain(baseIdentity.preparation_id);
    expect(md).toContain("| item\\_category | 9 |");expect(md).toContain("| clock\\_kind | wall\\_clock |");expect(md).toContain("| horizon\\_state | unknown |");
    expect(md).toContain(containingOpenedIdentity.population_id);expect(md).toContain("Bounded parent IDs: A, B");expect(md).toContain("explicit complete-item IDs: A");
    expect(md).toContain("Native wise-pm Method");expect(md).toContain("| mean\\_score | 0.8 |");expect(md).toContain("unavailable / not supplied");
    expect(md).toContain("WISE paper PDF26");expect(md).toContain("reported\\_not\\_rerun");expect(md).toContain(runId);
    expect(md).toContain("numeric similarity does not verify or promote the claim");expect(md).toContain("candidate\\_component\\_checked\\_release\\_pending");
    expect(md).toContain("| proposed\\_change | proposed |");expect(md).toContain("| adoption | unknown |");expect(md).toContain("| tested\\_outcome | untested |");
    expect(md).toContain("original-row-A1");expect(md).toContain("matching complete native-run ZIP must accompany");expect(md).toContain(`](artifacts/${filename})`);
    expect(md).not.toContain("z-old.png");expect(purchasingReportMarkdown(revision,manifest)).toBe(md);
  });
  it("accounts for explicit partial omissions and retains the source/formula gate without claiming reproduction",()=>{
    const {revision,manifest}=literal();revision.content.bpic19_pipeline!.replay_mode="partial";
    const query={method_id:"R13.weighted_many_to_many",source_locator:"Merged PDF300–303",gate_reason:"Source weights and formula are unavailable"};
    revision.content.bpic19_pipeline!.actions.push({operation:"bpic19_method_gate",identity:baseIdentity,query,definition_id:"unresolved-R13"});
    manifest.claim_level="partial";manifest.omissions=[{step:3,operation:"bpic19_method_gate",definition_id:"unresolved-R13",identity:baseIdentity,...query}];
    const md=purchasingReportMarkdown(revision,manifest);expect(md).toContain("Claim level: partial");expect(md).toContain("Merged PDF300–303");expect(md).toContain("Source weights and formula are unavailable");
    manifest.claim_level="complete_registered_pipeline";expect(()=>purchasingReportMarkdown(revision,manifest)).toThrow(/claim level/);
  });
  it("refuses old output definitions, foreign source/populations, unmatched native run refs and changed claim metadata",()=>{
    for(const mismatch of ["definition","identity","run","claims"]){const {revision,manifest}=literal();
      if(mismatch==="definition")manifest.outputs[1].definition_id="another-definition";
      if(mismatch==="identity")manifest.outputs[0].output.identity={...baseIdentity,source_id:"source.v1:sha256:"+"f".repeat(64)};
      if(mismatch==="run")manifest.outputs[1].output.run_id="score-run-old";
      if(mismatch==="claims")manifest.literature_claims=[];
      expect(()=>purchasingReportMarkdown(revision,manifest)).toThrow(/match/);
    }
    const {revision,manifest}=literal();revision.content.bpic19_pipeline!.literature_claims![0].compared_run_id="not-a-saved-run";manifest.literature_claims=structuredClone(revision.content.bpic19_pipeline!.literature_claims);
    expect(()=>purchasingReportMarkdown(revision,manifest)).toThrow(/outside this saved pipeline/);
  });
  it("bounds membership/row/file previews and escapes source text or unsafe filenames without altering machine data",()=>{
    const {revision,manifest}=literal();revision.content.selection_recipe.parent_case_ids=Array.from({length:5000},(_,i)=>`P${i}`);
    revision.content.notes="<script>do not execute</script>\n# Forged computed result";
    manifest.outputs[1].output.snapshot={artifacts:Array.from({length:25},(_,i)=>({kind:"cases",filename:i===0?"../../unsafe.json.gz":i.toString(16).padStart(64,"0")+".json.gz",sha256:i.toString(16).padStart(64,"0"),byte_count:10}))};
    const before=JSON.stringify({revision,manifest}),md=purchasingReportMarkdown(revision,manifest);
    expect(md).toContain("4990 further IDs");expect(md).not.toContain("P4999");expect(md).toContain("First 20 of 25 immutable files");
    expect(md).not.toContain("](artifacts/../../unsafe.json.gz)");expect(md).not.toContain("<script>");expect(md).toContain("&lt;script&gt;");
    expect(md).toContain("\\# Forged computed result");expect(md.length).toBeLessThan(30000);expect(JSON.stringify({revision,manifest})).toBe(before);
  });
  it("renders actual nested cohort comparisons and operator states without converting unknown or empty support into zero",()=>{
    const {revision,manifest}=literal();
    const first={definition_id:"presence-recipe",definition:{completion:{kind:"presence"}},cohorts:{original:{case_count:7,record_count:21,document_count:3},inclusion:{retained:{case_count:6},excluded:{case_count:1},unknown:{case_count:0}},
      completion_groups:[{state:"observed_closed",case_count:4},{state:"open_recorded",case_count:1},{state:"unknown",case_count:1}],retention:{retained:{case_count:4}},
      page:{items:[{case_id:"H7-unresolved",witness_row_ids:["row-missing-label"]}]},limitations:["No supplied payment terms; due assessment remains unavailable."]}};
    const second={definition_id:"ending-recipe",definition:{completion:{kind:"last_ending",tie_policy:"simultaneous_unordered"}},cohorts:{original:{case_count:7,record_count:21,document_count:3},
      inclusion:first.cohorts.inclusion,completion_groups:[{state:"observed_closed",case_count:3},{state:"open_recorded",case_count:2},{state:"unknown",case_count:1}],retention:{retained:{case_count:3}}}};
    const pairQuery={policy_id:"bpic19.same_parent_completion_comparison.v1"};
    const operatorQuery={recipe:{kind:"fifo"}};
    revision.content.bpic19_pipeline!.actions.push({operation:"bpic19_cohort_comparison",identity:baseIdentity,query:pairQuery,definition_id:"explicit-cohort-pair"},
      {operation:"bpic19_fifo",identity:baseIdentity,query:operatorQuery,definition_id:"fifo-recipe"});
    manifest.outputs.push({operation:"bpic19_cohort_comparison",definition_id:"explicit-cohort-pair",sha256:"3".repeat(64),output:{identity:baseIdentity,query:pairQuery,comparison:{first,second,
      completion_transitions:[{target_state:"observed_closed",reference_state:"open_recorded",case_count:1,case_ids:["A"]}],
      support_differences:[{support:"retained",both:["B","C"],target_only:["A","D"],reference_only:["E"]}]}}},
      {operation:"bpic19_fifo",definition_id:"fifo-recipe",sha256:"4".repeat(64),output:{identity:baseIdentity,query:operatorQuery,definition:{recipe:{kind:"fifo"}},
      summary:{activation_count:4,case_state_counts:{available:3,unavailable:1},observation_state_counts:{ordered:4,overlap:0},interval_distributions:{clearing_days:{per_episode:{available:0,minimum:null,reason:"empty_support"}}}}}});
    const md=purchasingReportMarkdown(revision,manifest);
    expect(md).toContain("| observed\\_closed | open\\_recorded | 1 |");expect(md).toContain("| retained | 2 | 2 | 1 |");
    expect(md).toContain("Reviewed first recipe: presence-recipe");expect(md).toContain("| tie\\_policy | simultaneous\\_unordered |");
    expect(md).toContain("| unavailable | 1 |");expect(md).toContain("| overlap | 0 |");expect(md).toContain("| minimum | unavailable / not supplied |");
    expect(md).toContain("row-missing-label");expect(md).toContain("No supplied payment terms");
  });
});
