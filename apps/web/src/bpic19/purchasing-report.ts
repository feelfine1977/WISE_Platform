import type { AnswerIdentity, Bpic19PipelineManifest, Bpic19PipelineOutput, SavedRevision } from "../generated/saving";
import { sameJson } from "../data/coordinator";

const MAX_ROWS = 20, MAX_IDS = 10, MAX_TEXT = 4000;
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record).filter(value => Object.keys(value).length > 0) : []; }
function text(value: unknown): string {
  if (value === null || value === undefined) return "unavailable / not supplied";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "invalid non-finite value";
  if (typeof value === "boolean") return String(value);
  if (typeof value !== "string") return "structured declaration; see machine export";
  return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) + "… [shortened; full text in machine export]" : value;
}
function escaped(value: unknown): string { return text(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/[\\`*_{}\[\]#|~]/g,"\\$&").replace(/\r?\n/g,"<br>"); }
function table(headers: string[], rows: unknown[][]): string {
  if (!rows.length) return "No supplied rows.\n";
  return ["| " + headers.map(escaped).join(" | ") + " |", "| " + headers.map(() => "---").join(" | ") + " |", ...rows.slice(0,MAX_ROWS).map(row => "| " + row.map(escaped).join(" | ") + " |"),
    ...(rows.length > MAX_ROWS ? [`\nFirst ${MAX_ROWS} of ${rows.length} rows; complete rows are retained in the machine export.`] : [])].join("\n") + "\n";
}
function idPreview(value: unknown): string {
  if (!Array.isArray(value)) return "not supplied";
  return value.length ? value.slice(0,MAX_IDS).map(text).join(", ") + (value.length > MAX_IDS ? `; ${value.length-MAX_IDS} further IDs in the machine export` : "") : "none";
}
function identities(identity: AnswerIdentity): string { return table(["Identity field","Frozen value"],Object.entries(identity)); }
function scalarFacts(value: unknown): string {
  const entries=Object.entries(record(value)).filter(([,item])=>item===null || ["string","number","boolean"].includes(typeof item));
  return entries.length ? table(["Recorded field","Actual value"],entries) : "No scalar support was recorded at this location.\n";
}
function scalarRows(value: unknown, title: string): string {
  const rows=records(value);if(!rows.length)return "";
  const keys=[...new Set(rows.slice(0,MAX_ROWS).flatMap(row=>Object.keys(row).filter(key=>row[key]===null || ["string","number","boolean"].includes(typeof row[key]))))].slice(0,12);
  return `\n**${title}**\n\n`+table(keys,rows.map(row=>keys.map(key=>row[key])))+(rows.some(row=>Object.keys(row).length>keys.length)?"Additional fields remain in the machine output.\n":"");
}
function outputIdentity(output: Record<string,unknown>): unknown { return output.identity ?? record(output.named_population).identity; }
function checkedOutputs(revision: SavedRevision, manifest: Bpic19PipelineManifest): { entry: Bpic19PipelineOutput; step: number }[] {
  const pipeline=revision.content.bpic19_pipeline;
  if(!pipeline)throw new Error("A purchasing report needs this revision's saved pipeline.");
  if(!sameJson(manifest.literature_claims ?? [],pipeline.literature_claims ?? []))throw new Error("The literature notes do not match this saved revision's manifest.");
  const matched=new Set<number>();
  const outputs=manifest.outputs.map(entry=>{
    const index=pipeline.actions.findIndex((action,i)=>!matched.has(i) && action.operation===entry.operation && action.definition_id===entry.definition_id &&
      sameJson(action.identity,outputIdentity(entry.output)) && (entry.operation!=="bpic19_score" || action.query.run_id===entry.output.run_id) &&
      (entry.output.query===undefined || sameJson(action.query,entry.output.query)));
    if(index<0)throw new Error("The output manifest does not match this saved revision's definitions, populations or native run references.");
    matched.add(index);return {entry,step:index+1};
  });
  for(const omission of manifest.omissions ?? []){
    const action=pipeline.actions[omission.step-1];
    if(!action || action.operation!=="bpic19_method_gate" || action.definition_id!==omission.definition_id || !sameJson(action.identity,omission.identity) ||
      action.query.method_id!==omission.method_id || action.query.source_locator!==omission.source_locator || action.query.gate_reason!==omission.gate_reason || matched.has(omission.step-1))throw new Error("An omission differs from the saved source-method gate.");
    matched.add(omission.step-1);
  }
  if(matched.size!==pipeline.actions.length || (manifest.omissions?.length && manifest.claim_level!=="partial"))throw new Error("The manifest does not account for every declared pipeline step and its claim level.");
  const linkedRuns=new Set(outputs.filter(value=>value.entry.operation==="bpic19_score").map(value=>value.entry.output.run_id));
  if((pipeline.literature_claims ?? []).some(claim=>claim.compared_run_id!==null && !linkedRuns.has(claim.compared_run_id)))throw new Error("A literature note refers to a native run outside this saved pipeline.");
  return outputs;
}
function predicateLabel(value: unknown): string {
  const predicate=record(value),kind=text(predicate.kind);
  if(kind==="case_id_in")return `${predicate.negate ? "Exclude":"Include"} explicit complete-item IDs: ${idPreview(predicate.case_ids)} (predicate definition, not final population)`;
  if(kind==="record_attributes_all")return `At least one same original record satisfies all field conditions (AND); exact alternatives within each field use OR. ${records(predicate.conditions).map(condition=>`Column ${text(condition.column_index)} in [${idPreview(condition.values)}]`).join("; ")}. Negated: ${text(predicate.negate)}`;
  return kind+": "+Object.entries(predicate).filter(([key])=>key!=="kind").map(([key,item])=>`${key}=${Array.isArray(item)?idPreview(item):text(item)}`).join("; ");
}
const tools:Record<string,string>={bpic19_profile:"WISE all-original-record source profile",bpic19_measures:"WISE source-witnessed descriptive measures",bpic19_cohorts:"WISE whole-item inclusion/completion recipes",bpic19_score:"Native wise-pm Method with frozen WISE measurement inputs",bpic19_flow_comparison:"WISE typed flow/Item Type count comparison",bpic19_interval_comparison:"WISE independent-minimum interval distribution comparison",bpic19_cohort_comparison:"WISE same-parent completion recipe comparison",bpic19_operator_comparison:"WISE explicitly paired ordinal/FIFO recipes"};
function definitionFacts(output: Record<string,unknown>): string {
  const definition=record(output.definition ?? record(output.profile).definition),report=record(output.report),settings=record(report.settings);
  let result=scalarFacts(definition);
  for(const key of ["activity_selector","interval_source","interval_target","creation_selector","value_band_edges"]){if(definition[key]!==undefined)result+=`\n${key}: ${escaped(idPreview(definition[key]))}.\n`;}
  if(Object.keys(record(definition.roles)).length)result+="\n**Original-column role bindings**\n\n"+scalarFacts(definition.roles);
  if(Object.keys(record(definition.category_lineage)).length)result+="\n**Verified Item Category correspondence**\n\n"+scalarFacts(definition.category_lineage)+"\nSame-position raw case and category cells were checked across the entire source, including records without usable timestamps. This does not verify other fields or conversion authorship.\n";
  if(Object.keys(record(definition.category_labels)).length)result+="\n**Exact supplied category labels**\n\n"+scalarFacts(definition.category_labels);
  if(Object.keys(record(definition.calibration)).length)result+="\n**Frozen exposure calibration**\n\n"+scalarFacts(definition.calibration);
  if(Object.keys(settings).length)result+="\n**Frozen native settings**\n\n"+scalarFacts(settings);
  for(const key of ["source_interpretation","completion","inclusion","recipe"]){
    const declared=record(definition[key]);
    if(Object.keys(declared).length){result+=`\n**Declared ${escaped(key==="recipe"?"operator":key)} recipe**\n\n`+scalarFacts(declared);
      for(const [name,value]of Object.entries(declared))if(Array.isArray(value))result+=`\n${escaped(name)}: ${escaped(idPreview(value))}.\n`;
      for(const nested of ["inclusion","horizon"])if(Object.keys(record(declared[nested])).length)result+=`\n${escaped(nested)}:\n\n`+scalarFacts(declared[nested]);
    }
  }
  if(Array.isArray(settings.group_by))result+=`\nFrozen grouping fields: ${escaped(idPreview(settings.group_by))}.\n`;
  if(Object.keys(record(report.method_artifact)).length)result+="\n**Actual Method artifact and release qualification**\n\n"+scalarFacts(report.method_artifact);
  return result;
}
function nestedSummary(value:unknown,depth=0):string{
  let result=scalarFacts(value);
  const nested=Object.entries(record(value)).filter(([,fields])=>Object.keys(record(fields)).length>0);
  if(depth<3){
    for(const [name,fields]of nested.slice(0,MAX_ROWS))result+=`\n${escaped(name)}:\n\n`+nestedSummary(fields,depth+1);
    if(nested.length>MAX_ROWS)result+=`\n${nested.length-MAX_ROWS} further distribution groups remain in the machine output.\n`;
  }else if(nested.length){
    result+="Additional nested summary fields remain in the machine output.\n";
  }
  return result;
}
function computedResults(operation: string, output: Record<string,unknown>): string {
  let result="";const profile=record(output.profile),cohorts=record(output.cohorts),comparison=record(output.comparison),report=record(output.report);
  if(Object.keys(profile).length){result+="**Measured original parent support**\n\n"+scalarFacts(profile.population)+scalarRows(profile.flows,"Purchasing-flow support")+scalarRows(profile.unresolved,"Unresolved category support")+scalarRows(profile.cross_checks,"Category/flag cross-check support")+scalarFacts(profile.partition)+scalarFacts(profile.grain)+scalarRows(profile.attributes,"All-record field and grain quality support")+scalarRows(profile.flow_item_types,"Flow × Item Type support");const source=record(profile.source_review),interpretation=record(source.interpretation);if(Object.keys(source).length){result+="\n**Reviewed source inclusion, clock and horizon**\n\n"+scalarFacts(source)+"\n"+scalarFacts(interpretation.inclusion)+"\n"+scalarFacts(interpretation.horizon);for(const key of ["raw_support","retained","excluded","unavailable","projection"])if(source[key]!==undefined)result+=`\n${key}:\n\n`+scalarFacts(source[key]);result+=scalarRows(source.anomalies,"Recorded timestamp anomaly support");}}
  if(output.population_case_count!==undefined)result+="\n**Actual measured population**\n\n"+table(["Field","Actual value"],[["PO items",output.population_case_count],["Original records",output.population_record_count]]);
  if(Object.keys(record(output.summaries)).length)result+="\n**Raw measure distributions; unavailable values are separate from zero**\n\n"+table(["Measure","Eligible items","Known zero","Unavailable","Minimum","Median","Mean","Maximum"],Object.entries(record(output.summaries)).map(([key,value])=>{const summary=record(value);return [key,summary.available_case_count,summary.zero_case_count,summary.unavailable_case_count,summary.minimum,summary.median,summary.mean,summary.maximum];}));
  if(Object.keys(cohorts).length){result+="\n**Cohort original support**\n\n"+scalarFacts(cohorts.original);for(const [key,value]of Object.entries(record(cohorts.inclusion)))if(["retained","excluded","unknown"].includes(key))result+=`\nInclusion ${key}:\n\n`+scalarFacts(value);result+=scalarRows(cohorts.completion_groups,"Recorded completion states");for(const [key,value]of Object.entries(record(cohorts.retention)))result+=`\nAnalysis ${key}:\n\n`+scalarFacts(value);}
  if(Object.keys(comparison).length){result+="\n**Explicit comparison support**\n\n"+scalarFacts(comparison.parent);for(const key of ["target","reference","outside","unavailable","shares","documents"])if(comparison[key]!==undefined){result+=`\n${key}:\n\n`+scalarFacts(comparison[key]);const summary=record(comparison[key]).summary;if(summary)result+="\n"+scalarFacts(summary);const reasons=record(comparison[key]).unavailable_reasons;if(reasons)result+="\nLocal unavailable reasons:\n\n"+scalarFacts(reasons);}
    result+=scalarRows(comparison.transitions ?? comparison.completion_transitions,"Recorded state transitions")+scalarRows(comparison.same_state_groups,"Recorded same-state support");
    const differences=records(comparison.support_differences);
    if(differences.length)result+="\n**Recipe support differences; memberships remain in the machine export**\n\n"+table(["Support","Both recipes","Target only","Reference only"],differences.map(value=>[value.support,Array.isArray(value.both)?value.both.length:null,Array.isArray(value.target_only)?value.target_only.length:null,Array.isArray(value.reference_only)?value.reference_only.length:null]));
    for(const key of ["first","second"]){const side=record(comparison[key]);if(Object.keys(side).length)result+=`\n**Reviewed ${key} recipe: ${escaped(side.definition_id)}**\n\n`+definitionFacts(side)+computedResults(typeof side.operation==="string"?side.operation:"bpic19_cohorts",side);}
  }
  if(Object.keys(report).length){result+="\n**Native computed results**\n\n"+scalarFacts(report)+scalarRows(report.criterion_summary,"Criterion support, scope and availability")+scalarRows(report.groups,"Group page; full groups remain in the native artifact");}
  if(output.summary!==undefined)result+="\n**Actual operator summary**\n\n"+nestedSummary(output.summary);
  const cases=Array.isArray(output.cases)?output.cases:record(report.case_page).cases ?? record(cohorts.page).items ?? record(comparison.page).items;
  if(Array.isArray(cases)){result+=`\nServed evidence-page item IDs: ${escaped(idPreview(cases.map(value=>record(value).case_id)))}. This page is not the complete population membership.\n`;const witnessIds=cases.slice(0,3).flatMap(value=>{const item=record(value);return Array.isArray(item.record_row_ids)?item.record_row_ids:Array.isArray(item.witness_row_ids)?item.witness_row_ids:[];});if(witnessIds.length)result+=`\nBounded original-record references: ${escaped(idPreview(witnessIds))}. Exact complete witnesses remain in the saved machine output/native artifacts.\n`;}
  const limitations=[...(Array.isArray(output.limitations)?output.limitations:[]),...(Array.isArray(cohorts.limitations)?cohorts.limitations:[]),...(Array.isArray(comparison.limitations)?comparison.limitations:[])];
  if(limitations.length)result+="\n**Recorded limitations**\n\n"+limitations.slice(0,MAX_ROWS).map(item=>"- "+escaped(item)).join("\n")+"\n";
  return result || `No scalar summary is supplied for ${escaped(operation)}; the complete registered answer remains in the machine output.\n`;
}
function interpretation(output: Record<string,unknown>): string {
  const review=record(record(output.report).analysis_review),findings=records(review.findings);if(!findings.length)return "";
  let result="\n**Separately user-entered improvement interpretation**\n\nObservation, proposed change, adoption and tested outcome are separate supplied statuses. They do not change or independently validate the native score.\n";
  for(const finding of findings.slice(0,MAX_ROWS)){result+=`\n${escaped(finding.title)}\n\n`+table(["Stage","Supplied status","Supplied note","Evidence references"],["observation","proposed_change","adoption","tested_outcome"].map(stage=>{const item=record(finding[stage]),evidence=record(item.evidence);return [stage,item.status,item.note,`Items: ${idPreview(evidence.case_ids)}; rows: ${idPreview(evidence.row_ids)}; criteria: ${idPreview(evidence.criterion_ids)}`];}));}
  if(findings.length>MAX_ROWS)result+=`\n${findings.length-MAX_ROWS} further explicitly supplied findings remain in the machine export.\n`;
  return result;
}
function artifactRefs(output: Record<string,unknown>): string {
  const snapshot=record(output.snapshot),artifacts=records(snapshot.artifacts);if(!artifacts.length)return "Complete source witnesses are retained in this step's saved machine answer.\n";
  let result="**Immutable native witness-file references**\n\nA matching complete native-run ZIP must accompany these references. After extraction, links use its `artifacts/` directory. Standalone Markdown neither contains nor writes the complete artifact bundle. The machine manifest retains every reference.\n\n";
  result+="| Kind | File in matching native ZIP | Bytes | SHA-256 |\n| --- | --- | --- | --- |\n";
  for(const ref of artifacts.slice(0,MAX_ROWS)){const filename=typeof ref.filename==="string"?ref.filename:"";const link=/^[a-f0-9]{64}\.json\.gz$/.test(filename)?`[${filename}](artifacts/${filename})`:escaped(filename || "file not supplied");result+=`| ${escaped(ref.kind)} | ${link} | ${escaped(ref.byte_count)} | ${escaped(ref.sha256)} |\n`;}
  if(artifacts.length>MAX_ROWS)result+=`\nFirst ${MAX_ROWS} of ${artifacts.length} immutable files. Remaining file IDs/checksums and full original witnesses are in the machine manifest and matching native ZIP; they were not omitted from that bundle.\n`;
  return result;
}

/** Pure deterministic rendering of a server-verified saved revision and its matching output manifest. */
export function purchasingReportMarkdown(revision: SavedRevision, manifest: Bpic19PipelineManifest): string {
  const checked=checkedOutputs(revision,manifest),content=revision.content,pipeline=content.bpic19_pipeline!;
  let result=`# ${escaped(content.name)}\n\nSaved purchasing investigation: ${escaped(revision.saved_revision_id)}. Investigation: ${escaped(revision.investigation_id)}.\n\n`;
  result+=`Pipeline run: ${escaped(manifest.run_id)}. Claim level: ${escaped(manifest.claim_level)}. Replay admission: ${escaped(pipeline.replay_mode ?? "require_all")}.\n\nComplete registered pipeline means only its declared admitted operations; it does not establish reproduction of every human report, external method or source publication.\n\n`;
  result+="## Frozen source and selected population\n\n**Source/base identity**\n\n"+identities(content.base_identity)+"\n**Current selected-population identity**\n\n"+identities(content.selection_identity);
  result+=`\nGrain: complete PO items/cases; original event records and purchasing documents remain separate supports. Frozen selection parent: ${content.selection_recipe.parent_case_ids.length} explicit item IDs. Bounded parent IDs: ${escaped(idPreview(content.selection_recipe.parent_case_ids))}.\n\nExact parent/selected membership and all field predicates remain in the [machine investigation export](purchasing-investigation.json). Final selected membership is supplied by the service, not inferred here from predicate syntax.\n\nSaved generic context policy: ${escaped(content.context_policy)}. Each registered operator additionally declares its own raw-field reducer, clock, scope and units.\n\n`;
  result+="## Recorded analyst steps and actual tools\n\n"+table(["Step","Registered operation / actual tool","Definition","Population","Output SHA-256"],pipeline.actions.map((action,index)=>[index+1,`${action.operation} / ${tools[action.operation] ?? "WISE finite registered operator"}`,action.definition_id,action.identity.population_id,checked.find(value=>value.step===index+1)?.entry.sha256 ?? "omitted source-method gate"]));
  result+="\n**Complete-item selection declarations**\n\n"+(content.selection_recipe.predicates.length?content.selection_recipe.predicates.map((value,index)=>`${index+1}. ${escaped(predicateLabel(value))}`).join("\n"):"No additional selection predicates.")+"\n";
  const typedKeeps=pipeline.actions.filter(action=>action.selection_keep);
  if(typedKeeps.length)result+="\n**Verified purchasing selection lineage**\n\n"+table(["Selection step","Finite group selector","Exact reviewed parent","Profile definition"],typedKeeps.map(action=>[action.selection_keep!.step_index+1,JSON.stringify(action.selection_keep!.group),action.identity.population_id,action.definition_id]))+"\nEach association was verified against the actual selection predicate and the replayed parent profile. Item/record/document support and the parent denominator remain in that profile's output below. Legacy ID-only selections are not retroactively assigned a typed origin.\n";
  result+="\n## Computed saved-run results and evidence\n\nThese numbers and states belong to the recorded platform outputs below. They are not promoted to literature reproduction, causality, realised savings or business adoption. This formatter neither replays actions nor independently rehashes stored artifacts; it renders the server-verified saved manifest.\n";
  for(const {entry,step}of checked){result+=`\n### Step ${step}: ${escaped(entry.operation)}\n\nDefinition ${escaped(entry.definition_id)}. Output SHA-256 ${escaped(entry.sha256)}. Native run ${escaped(entry.output.run_id)}.\n\n`+definitionFacts(entry.output)+"\n"+computedResults(entry.operation,entry.output)+"\n"+artifactRefs(entry.output)+interpretation(entry.output);}
  result+="\n## Reported literature claims — not rerun\n\nEvery entry below has claim level `reported_not_rerun`. A compared-run reference links a supplied claim to a computation; numeric similarity does not verify or promote the claim.\n\n";
  const claims=pipeline.literature_claims ?? [];
  // The authoritative boundary permits 100 claims; render every explicit citation.
  if(claims.length)for(let offset=0;offset<claims.length;offset+=MAX_ROWS)result+=table(["Claim ID","Supplied report","Page / cell / source locator","Reported statement","Claim level","Compared native run"],claims.slice(offset,offset+MAX_ROWS).map(claim=>[claim.claim_id,claim.report_id,claim.source_locator,claim.claim,claim.claim_level,claim.compared_run_id]));
  else result+="No literature claims were explicitly supplied in this saved revision.\n";
  result+="\n## Unavailable source methods and qualifications\n\n";
  if(manifest.omissions?.length)result+=table(["Omitted step","Method / definition","Source locator","Input / version / formula gate"],manifest.omissions.map(value=>[value.step,`${value.method_id} / ${value.definition_id}`,value.source_locator,value.gate_reason]));
  else result+="No declared step is listed as omitted in this manifest. This is not a claim that every source method was admitted or rerun.\n";
  result+="\nObserved scope, local unavailable states and known zero are kept distinct in the recorded outputs. Native artifact release qualification is recorded per score step; a readable export is not a full-source/browser/restart or human-benefit qualification receipt.\n";
  if(content.notes)result+="\n## Unclassified investigation notes\n\nThese are user-entered notes; no observation, adoption or tested-outcome status is inferred.\n\n"+escaped(content.notes)+"\n";
  return result;
}
