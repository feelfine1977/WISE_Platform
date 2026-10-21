import { describe, expect, it } from "vitest";
import type { Bpic19PipelineManifest, SavedRevision } from "../generated/saving";
import { baseIdentity, containingOpenedIdentity, investigationId, firstRevisionId, savedContent } from "../test/saving";
import { frozenScope, purchasingReportMarkdown } from "./purchasing-report";

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
function expectSubtypeSection(md:string,step:number,definition:string,swapped:boolean){
  const sections=md.replaceAll("\\_","_").split(/(?=^#{2,3} )/m);
  const matches=sections.filter(section=>section.startsWith(`### Step ${step}: bpic19_flow_comparison\n`));
  expect(matches).toHaveLength(1);const section=matches[0];
  expect(section).toContain(`\nDefinition ${definition}. Output SHA-256 `);
  const block=(heading:string)=>{const parts=section.split(heading+"\n\n");expect(parts).toHaveLength(2);return parts[1].split(/\n(?:\*\*|[a-z_]+:)/)[0];};
  expect(block("**Target subgroup predicate**")).toContain(`| item_type_value | ${swapped?"Service":"Standard"} |`);
  expect(block("**Comparator subgroup predicate**")).toContain(`| item_type_value | ${swapped?"Standard":"Service"} |`);
  expect(block("**Original-column role bindings**")).toContain("| item_type | 5 |");
  for(const [role,ids,records] of [["target",swapped?"D1_1, X_2":"D4_1, X_1",swapped?4:2],["reference",swapped?"D4_1, X_1":"D1_1, X_2",swapped?2:4]] as const){
    expect(section.split("\n")).toContain(`${role} complete-item IDs: ${ids}.`);
    for(const [field,value] of [["case_count",2],["record_count",records],["document_count",2]])expect(block(role+":")).toContain(`| ${field} | ${value} |`);
  }
  expect(section.split("\n")).toContain("outside complete-item IDs: Y_1.");
  expect(section.split("\n")).toContain("unavailable complete-item IDs: Z_1.");
  expect(section.split("\n")).toContain("overlap_document_ids: X.");
  expect(block("**Recorded limitations**")).toContain("- Literal count comparison; document supports overlap, not a causal effect.");
}
describe("human-readable frozen purchasing report",()=>{
  it("exports the current source discrepancy, exact inclusion members and original-row references",()=>{
    const {revision,manifest}=literal();
    const profile=manifest.outputs[0].output.profile as Record<string,unknown>;
    profile.source_review={interpretation:{profile_name:"H7 document start",inclusion:{kind:"document_start"},horizon:{value:"2019-01-28T00:00:00Z",provenance:"Synthetic contract"}},
      retained:{case_ids:["C"],case_count:1,record_count:2},excluded:{case_ids:["A","B"],case_count:2,record_count:5},unavailable:{case_ids:[],case_count:0},
      discrepancies:[{reference:"Synthetic subtotal claim",reported_total:251734,reported_subtotal:251347,difference:387,measured_parent_case_count:3}],
      inclusion_evidence:[{case_id:"B",reason:"earliest_raw_event_before_start",witness_case_ids:["A"],row_ids:["original-h1"]}]};
    const md=purchasingReportMarkdown(revision,manifest).replaceAll("\\_","_");
    const section=md.split("### Step 1:")[1].split("### Step 2:")[0];
    expect(section).toContain("Source discrepancies");
    expect(section).toContain("| Synthetic subtotal claim | 251734 | 251347 | 387 | 3 |");
    expect(section).toContain("retained complete-item IDs: C.");
    expect(section).toContain("excluded complete-item IDs: A, B.");
    expect(section).toContain("unavailable complete-item IDs: none.");
    expect(section).toContain("| B | earliest_raw_event_before_start | A | original-h1 |");
    expect(section).toContain("Whole-document reasons describe the document's earliest raw event, not each sibling item's earliest event.");
    const source=profile.source_review as Record<string,unknown>;
    source.interpretation={profile_name:"H7 record projection",inclusion:{kind:"record_projection",timestamp_kind:"utc_instant",start_inclusive:"2018-01-01T00:00:00Z",end_exclusive:"2019-01-01T00:00:00Z"},horizon:{value:"2019-01-28T00:00:00Z",provenance:"Synthetic contract"}};
    source.retained={case_ids:[],case_count:0,record_count:0};source.excluded={case_ids:[],case_count:0,record_count:0};
    source.projection={case_ids:["A","B","C"],row_ids:["original-h2","original-h4","original-h5","original-h6","original-h7"],record_count:5};
    const projected=purchasingReportMarkdown(revision,manifest);
    expect(projected).not.toContain("projection complete-item IDs");
    expect(projected).not.toContain("retained complete-item IDs: none.");
    expect(projected).not.toContain("excluded complete-item IDs: none.");
    expect(projected).toContain("Whole-item inclusion supports are not applicable to this derived record projection");
    expect(projected.indexOf("Whole-item inclusion supports are not applicable")).toBeLessThan(projected.indexOf("retained:\n"));
    expect(projected).toContain("Items with projected records: A, B, C.");
    expect(projected).toContain("Derived projection original-row references: original-h2, original-h4, original-h5, original-h6, original-h7.");
    source.projection={};
    expect(purchasingReportMarkdown(revision,manifest)).toContain("Whole-item inclusion supports are not applicable");
    source.projection=null;
    expect(purchasingReportMarkdown(revision,manifest)).toContain("Whole-item inclusion supports are not applicable");
  });
  it("scopes A and current B predicates, supports and limitations to their own action/definition",()=>{
    const {revision,manifest}=literal();
    const query={policy_id:"bpic19.flow_item_type_comparison.v1"};
    for(const swapped of [false,true]){
      const definition_id=swapped?"subtype-B":"subtype-A";
      revision.content.bpic19_pipeline!.actions.push({operation:"bpic19_flow_comparison",identity:baseIdentity,query,definition_id});
      manifest.outputs.push({operation:"bpic19_flow_comparison",definition_id,sha256:(swapped?"4":"3").repeat(64),output:{identity:baseIdentity,query,
        definition:{target:{flow_id:"after_gr",item_type_state:"invariant",item_type_value:swapped?"Service":"Standard"},reference:{flow_id:"after_gr",item_type_state:"invariant",item_type_value:swapped?"Standard":"Service"},profile_query:{roles:{item_category:4,item_type:5},policy_id:"bpic19.all_raw_case_attributes.v1"}},
        comparison:{target:{case_ids:swapped?["D1_1","X_2"]:["D4_1","X_1"],case_count:2,record_count:swapped?4:2,document_count:2},
          reference:{case_ids:swapped?["D4_1","X_1"]:["D1_1","X_2"],case_count:2,record_count:swapped?2:4,document_count:2},outside:{case_ids:["Y_1"]},unavailable:{case_ids:["Z_1"]},documents:{overlap_document_ids:["X"]},
          limitations:["Literal count comparison; document supports overlap, not a causal effect."]}}});
    }
    const md=purchasingReportMarkdown(revision,manifest);
    expectSubtypeSection(md,3,"subtype-A",false);expectSubtypeSection(md,4,"subtype-B",true);
    const b=md.slice(md.indexOf("### Step 4:"),md.indexOf("\n## Reported literature"));
    expect(b.length).toBeGreaterThan(100);
    expect(()=>expectSubtypeSection(md.replace(b,""),4,"subtype-B",true)).toThrow();
    const stalePredicate=b.replace("| item\\_type\\_value | Service |","| item\\_type\\_value | Standard |");
    expect(stalePredicate).not.toBe(b);
    expect(()=>expectSubtypeSection(md.replace(b,stalePredicate),4,"subtype-B",true)).toThrow();
    const staleMembers=b.replace("target complete-item IDs: D1\\_1, X\\_2.","target complete-item IDs: D4\\_1, X\\_1.");
    expect(staleMembers).not.toBe(b);
    expect(()=>expectSubtypeSection(md.replace(b,staleMembers),4,"subtype-B",true)).toThrow();
  });
  it("reports only the current profile run B: its roles, totals and definition, never revision A's",()=>{
    const a=literal().manifest.outputs[0];
    const {revision,manifest}=literal();
    const action=revision.content.bpic19_pipeline!.actions[0],output=manifest.outputs[0];
    action.definition_id=output.definition_id="profile-definition-B";output.sha256="5".repeat(64);
    const profile=(output.output as {profile:{definition:{roles:Record<string,number>};population:Record<string,number>}}).profile;
    profile.definition.roles.item_category=16;profile.population.case_count=5;profile.population.record_count=8;
    const md=purchasingReportMarkdown(revision,manifest);
    expect(md).toContain("profile-definition-B");expect(md).not.toContain(profileId);
    expect(md).toContain("| item\\_category | 16 |");expect(md).not.toContain("| item\\_category | 9 |");
    expect(md).toContain("| case\\_count | 5 |");expect(md).toContain("| record\\_count | 8 |");
    // A's figures offered for B's definition are refused, not reported.
    manifest.outputs[0]={...structuredClone(a),definition_id:"profile-definition-A"};
    expect(()=>purchasingReportMarkdown(revision,manifest)).toThrow(/match/);
  });
  it("names the verified selection-step association and exact category labels without retrofitting legacy origins",()=>{
    const {revision,manifest}=literal();
    revision.content.bpic19_pipeline!.actions[0].selection_keep={policy_id:"bpic19.profile_group_keep.v1",step_index:0,group:{kind:"flow",flow_id:"before_gr"}};
    const md=purchasingReportMarkdown(revision,manifest);
    expect(md).toContain("Verified purchasing selection lineage");expect(md).toContain(String.raw`"flow\_id":"before\_gr"`);
    expect(md).toContain("3-way match, invoice before GR");expect(md).toContain("Legacy ID-only selections are not retroactively assigned");
    delete revision.content.bpic19_pipeline!.actions[0].selection_keep;
    expect(purchasingReportMarkdown(revision,manifest)).not.toContain("Verified purchasing selection lineage");
  });
  it("names each typed Keep's group with its reviewed operation, definition and parent",()=>{
    const {revision,manifest}=literal();
    revision.content.bpic19_pipeline!.actions[0].selection_keep={policy_id:"bpic19.measure_cohort_keep.v1",step_index:0,group:{kind:"activity_cohort",cohort:"positive"}};
    const md=purchasingReportMarkdown(revision,manifest).replaceAll("\\","");
    expect(md).toContain("Verified purchasing selection lineage");
    expect(md).toContain('{"kind":"activity_cohort","cohort":"positive"}');
    expect(md).toContain("| bpic19_profile | "+profileId+" |");
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
  it("declares the service-supplied frozen scope: source, preparation, grain, clock, cutoff, parent [A,B] and selected [A] (#125 AC01)",()=>{
    const {revision,manifest}=literal();
    const population={source:{source_id:baseIdentity.source_id,filename:"literal-ac01.csv",byte_count:321},
      preparation:{preparation_id:baseIdentity.preparation_id,policies:{time:{id:"incident.time.explicit_format_wall_clock.v1",parameters:{timestamp_kind:"wall_clock",snapshot_cutoff_local:"2019-01-28T00:00:00"}}}}};
    const scope=frozenScope(population,{identity:containingOpenedIdentity,parent:{case_ids:["A","B"],case_count:2,record_count:3},kept:{case_ids:["A"],case_count:1,record_count:2}});
    expect(scope).toEqual(expect.objectContaining({source:{source_id:baseIdentity.source_id,filename:"literal-ac01.csv",byte_count:321},preparation_id:baseIdentity.preparation_id,
      time_policy:"incident.time.explicit_format_wall_clock.v1",parent:{case_ids:["A","B"],case_count:2,record_count:3},selected:{case_ids:["A"],case_count:1,record_count:2}}));
    const md=purchasingReportMarkdown(revision,manifest,scope);
    expect(md).toContain("Frozen scope supplied by the service for this revision");
    expect(md).toContain("| Grain | complete PO item: one purchasing document item with its whole original event history |");
    expect(md).toContain("| Source file / bytes | literal-ac01.csv / 321 |");
    expect(md).toContain("| Clock and time policy | incident.time.explicit\\_format\\_wall\\_clock.v1 |");
    expect(md).toContain("| Time policy snapshot\\_cutoff\\_local | 2019-01-28T00:00:00 |");
    expect(md).toContain("| Parent items / records | 2 / 3 |");expect(md).toContain("| Parent item IDs | A, B |");
    expect(md).toContain("| Selected items / records | 1 / 2 |");expect(md).toContain("| Selected item IDs | A |");
    // A scope for another selection is never rendered as this revision's.
    expect(purchasingReportMarkdown(revision,manifest,{...scope,selection_identity:baseIdentity})).not.toContain("Frozen scope supplied");
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
