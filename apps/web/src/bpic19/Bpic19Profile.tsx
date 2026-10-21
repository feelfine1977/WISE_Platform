import { useEffect, useRef, useState } from "react";
import type { AnswerIdentity, Bpic19CategoryLineageQuery, Bpic19ProfileAnswer, Bpic19ProfileQuery, Bpic19Roles, Bpic19SuggestedRoles, Bpic19TypeCell, Bpic19SourceInterpretation } from "../generated/bpic19-profile";
import type { RecordAttributesAll, SelectionPredicate } from "../generated/selection";
import { httpBpic19ProfileClient, type Bpic19ProfileClient } from "./profile-client";
import type { Bpic19ComparisonSide, Bpic19GroupRecipe } from "./profile-types";
import "./profile.css";
import { SourceDefinition, SourceReview } from "./profile-source";

const policy = "bpic19.all_raw_case_attributes.v1";
const labels: Record<keyof Bpic19Roles, string> = { item_category: "Purchasing flow (Item Category)", item_type: "Item Type", goods_receipt: "Goods Receipt setting", gr_based_iv: "GR-Based Invoice Verification setting", purchasing_document: "Purchasing document", item: "Document item", source_case: "Original source case identifier (optional)" };
const emptyRoles: Bpic19SuggestedRoles = { item_category: null, item_type: null, goods_receipt: null, gr_based_iv: null, purchasing_document: null, item: null, source_case: null };
const number = new Intl.NumberFormat("en");
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });
const stateName = (state: string) => state.replaceAll("_", " ");
/** The service's reason, with the request field it names, so the analyst sees which role or policy to review. */
const refusalText = (refusal: { message: string; field?: string | null }) => refusal.field ? `${refusal.message} Field: ${refusal.field}.` : refusal.message;
type CategoryLineageDraft = Omit<Bpic19CategoryLineageQuery, "origin_column_index"> & { origin_column_index: number | null };

export interface Bpic19ProfileProps {
  workspaceId: string;
  identity: AnswerIdentity;
  revision: number;
  query?: Bpic19ProfileQuery;
  client?: Bpic19ProfileClient;
  onKeep: (predicate: SelectionPredicate, recipe: Bpic19GroupRecipe) => void;
  onKeepRecordPredicate?: (predicate: RecordAttributesAll) => void;
  onInspect: (caseId: string, rowIds?: string[]) => void;
  onInspectSource?: (caseId: string, rowIds?: string[]) => void;
  onCompare?: (target: Bpic19ComparisonSide, comparator: Bpic19ComparisonSide) => void;
  onReviewed?: (answer: Bpic19ProfileAnswer) => void;
  onColumns?: (answer: Bpic19ProfileAnswer) => void;
  onValidityChange?: (current: boolean) => void;
}

/** Source-derived answers lead this view; local state chooses reviewed bindings and navigation only. */
export function Bpic19Profile({ workspaceId, identity, revision, query, client = httpBpic19ProfileClient, onKeep, onKeepRecordPredicate, onInspect, onInspectSource = onInspect, onCompare, onReviewed, onColumns, onValidityChange }: Bpic19ProfileProps) {
  const [answer, setAnswer] = useState<Bpic19ProfileAnswer | null>(null);
  const [roles, setRoles] = useState<Bpic19SuggestedRoles>(emptyRoles);
  const [columns, setColumns] = useState<number[] | null>(null);
  const [source, setSource] = useState<Bpic19SourceInterpretation | null>(null);
  const [categoryLineage, setCategoryLineage] = useState<CategoryLineageDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [flow, setFlow] = useState("after_gr");
  const [target, setTarget] = useState("");
  const [comparator, setComparator] = useState("");
  const validity = useRef(onValidityChange); validity.current = onValidityChange;
  const serial = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retry = useRef<Bpic19ProfileQuery>({ roles: null, profile_columns: null, policy_id: policy });
  const identityKey = JSON.stringify(identity);
  const queryKey = JSON.stringify(query ?? null);

  async function load(next: Bpic19ProfileQuery) {
    validity.current?.(false);
    const token = ++serial.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    retry.current = next; setBusy(true); setProblem(null);
    const outcome = await client.profile({ schema_version: 1, message_type: "bpic19_profile_request", request_id: `bpic19-profile-${revision}-${token}`, query_revision: revision, workspace_id: workspaceId, identity, query: next }, abort.signal);
    if (token !== serial.current || abort.signal.aborted) return;
    setBusy(false);
    if (!outcome.ok) { setProblem(outcome.problem.kind === "refusal" ? refusalText(outcome.problem.refusal) : outcome.problem.kind === "unreachable" ? "The local service could not be reached. Retry the source profile." : outcome.problem.detail); return; }
    setAnswer(outcome.answer); setRoles(next.roles ?? outcome.answer.suggested_roles);
    setColumns(next.profile_columns); setSource(outcome.answer.profile?.source_review?.interpretation ?? next.source_interpretation ?? null); setCategoryLineage(next.category_lineage ?? null); setTarget(""); setComparator("");
    if (outcome.answer.profile) onReviewed?.(outcome.answer);
    else onColumns?.(outcome.answer);
  }
  useEffect(() => {
    validity.current?.(false); setAnswer(null); setRoles(emptyRoles); setColumns(null); setSource(null); setCategoryLineage(null);
    void load(query ?? { roles: null, profile_columns: null, policy_id: policy });
    return () => { validity.current?.(false); ++serial.current; controller.current?.abort(); };
    // Request publication is fenced by source/population/revision, including same-source selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, identityKey, revision, client, queryKey]);

  const profile = answer?.profile ?? null;
  const draftChanged = profile !== null && answer !== null && (JSON.stringify(roles) !== JSON.stringify(answer.query.roles) || JSON.stringify(columns) !== JSON.stringify(answer.query.profile_columns) || JSON.stringify(source) !== JSON.stringify(profile.source_review?.interpretation ?? null) || JSON.stringify(categoryLineage) !== JSON.stringify(answer.query.category_lineage ?? null));
  const actionsPaused = busy || !!problem || draftChanged;
  useEffect(() => { validity.current?.(profile !== null && !actionsPaused); }, [profile, actionsPaused]);
  const ready = (Object.keys(labels) as (keyof Bpic19Roles)[]).every(key => key === "source_case" || roles[key] !== null);
  const lineageReady = categoryLineage === null || categoryLineage.origin_preparation_id.trim() !== "" && categoryLineage.provenance.trim() !== "" && categoryLineage.provenance.length <= 2000 && categoryLineage.origin_column_index !== null && Number.isSafeInteger(categoryLineage.origin_column_index) && categoryLineage.origin_column_index >= 0;
  const reviewedRoles = (): Bpic19Roles | null => ready ? { item_category: roles.item_category!, item_type: roles.item_type!, goods_receipt: roles.goods_receipt!, gr_based_iv: roles.gr_based_iv!, purchasing_document: roles.purchasing_document!, item: roles.item!, source_case: roles.source_case } : null;
  function recipe(group: Bpic19GroupRecipe["group"], ids: string[]): Bpic19GroupRecipe {
    if (!profile || !answer) throw new Error("No reviewed profile");
    return { definition_id: profile.definition_id, definition: profile.definition, source_identity: answer.identity, query: answer.query, group, case_ids: ids };
  }
  function keep(ids: string[], group: Bpic19GroupRecipe["group"]) {
    if (!ids.length || actionsPaused) return;
    onKeep({ kind: "case_id_in", case_ids: [ids[0], ...ids.slice(1)], negate: false }, recipe(group, ids));
  }
  function keepFlagView(requireGoodsReceipt: boolean) {
    if (!profile || actionsPaused || !onKeepRecordPredicate) return;
    const reviewed = profile.definition.roles;
    onKeepRecordPredicate({ kind: "record_attributes_all", policy_id: "incident.raw.same_record_all.v1", negate: false,
      conditions: requireGoodsReceipt
        ? [{ column_index: reviewed.goods_receipt, values: ["true"] }, { column_index: reviewed.gr_based_iv, values: ["false"] }]
        : [{ column_index: reviewed.gr_based_iv, values: ["false"] }] });
  }
  function values(column: number, offset: number, selectValue = false, value: string | null = null) {
    if (!answer || !profile || actionsPaused) return;
    void load({ ...answer.query, attribute_view: { column_index: column, offset, limit: 12, select_value: selectValue, value } });
  }
  function inspectIssue(caseId: string, state: string) {
    if (!profile || actionsPaused) return;
    const reviewed = profile.definition.roles;
    const fields = state === "conflicting_document_or_item" ? [reviewed.purchasing_document, reviewed.item] : state === "conflicting" ? [reviewed.item_category] : [];
    const rows = profile.attributes.filter(attribute => fields.includes(attribute.column_index))
      .flatMap(attribute => attribute.conflicting_witnesses?.find(witness => witness.case_id === caseId)?.rows ?? []);
    if (rows.length) onInspect(caseId, [...new Set(rows.map(row => row.row_id))]);
    else onInspect(caseId);
  }
  const cells = profile?.flow_item_types.filter(cell => cell.flow_id === flow) ?? [];
  const cellName = (cell: Bpic19TypeCell) => cell.item_type_state === "invariant" ? cell.item_type_value ?? "not recorded" : stateName(cell.item_type_state);
  function compare() {
    if (!onCompare || !profile || !answer || actionsPaused || target === comparator) return;
    const left = cells[Number(target)], right = cells[Number(comparator)];
    if (!left || !right) return;
    const side = (cell: Bpic19TypeCell): Bpic19ComparisonSide => ({ name: `${profile.flows.find(f => f.flow_id === cell.flow_id)?.label}: ${cellName(cell)}`, caseIds: cell.case_ids,
      recipe: recipe({ kind: "flow_item_type", flow_id: cell.flow_id, state: cell.item_type_state, item_type_value: cell.item_type_value }, cell.case_ids) });
    onCompare(side(left), side(right));
  }

  return <section className="bpic19-profile" aria-labelledby="bpic19-profile-title" aria-busy={busy}>
    <h2 id="bpic19-profile-title">Understand the purchasing flows</h2>
    <p>Review the source fields before comparing PO items. Purchasing flow is Item Category; Item Type describes a separate subtype. Every selected item keeps its complete recorded history.</p>
    {busy && <p role="status">{profile ? "Updating this source profile… The earlier answer is shown; its actions are paused." : "Reading the source fields…"} <button type="button" onClick={() => { ++serial.current; controller.current?.abort(); setBusy(false); setProblem("The source review was cancelled. Review the current definition or retry."); validity.current?.(false); }}>Cancel source review</button></p>}
    {draftChanged && <p role="status">Field choices have changed. Review them to update the profile; actions on the earlier answer are paused.</p>}
    {problem && <div role="alert"><p>{problem}</p><button type="button" disabled={busy} onClick={() => void load(retry.current)}>Retry source profile</button></div>}
    {answer && <details open={!profile} className="bpic19-bindings"><summary>Reviewed source field roles</summary>
      <p>Header matches are suggestions. Check the category, flags and business identifiers. Blank source cells stay missing; changing values are never filled from a first row.</p>
      <div className="bpic19-role-grid">{(Object.keys(labels) as (keyof Bpic19Roles)[]).map(role => <label key={role}>{labels[role]}<select value={roles[role] ?? ""} disabled={busy} onChange={event => setRoles({ ...roles, [role]: event.target.value === "" ? null : Number(event.target.value) })}>
        <option value="">{role === "source_case" ? "No original source case column" : "Choose a source field"}</option>
        {answer.columns.map(column => <option key={column.index} value={column.index}>{column.index}: {column.name || "Unnamed source field"}</option>)}
      </select></label>)}</div>
      <details><summary>Item Category source lineage</summary>
        <p>Optionally declare an origin preparation already imported into this workspace. The service checks identical original record positions, raw case cells and raw category cells across the entire source, including records without usable timestamps. Other fields and conversion authorship are not verified; source__ names alone establish no lineage.</p>
        <label className="bpic19-column-check"><input type="checkbox" disabled={busy} checked={categoryLineage !== null} onChange={event => setCategoryLineage(event.target.checked ? { policy_id: "bpic19.same_position_category_lineage.v1", origin_preparation_id: "", origin_column_index: null, provenance: "" } : null)} />Verify category against an imported origin</label>
        {categoryLineage && <div className="bpic19-role-grid">
          <label>Origin preparation ID<input type="text" disabled={busy} value={categoryLineage.origin_preparation_id} onChange={event => setCategoryLineage({ ...categoryLineage, origin_preparation_id: event.target.value })} /></label>
          <label>Origin Item Category column index<input type="number" min="0" step="1" disabled={busy} value={categoryLineage.origin_column_index ?? ""} onChange={event => setCategoryLineage({ ...categoryLineage, origin_column_index: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          <label>Category lineage provenance<input type="text" maxLength={2000} disabled={busy} value={categoryLineage.provenance} onChange={event => setCategoryLineage({ ...categoryLineage, provenance: event.target.value })} /></label>
        </div>}
        <p>Column indices are zero-based within each source. Review this declaration with the field roles; changing or removing it creates a different definition.</p>
      </details>
      <details><summary>Additional attributes to profile</summary><p>With no custom selection, all supplied case attributes are profiled. Event-varying fields can be selected explicitly.</p>
        {answer.columns.map(column => <label className="bpic19-column-check" key={column.index}><input type="checkbox" disabled={busy} checked={columns === null ? column.name.startsWith("case ") || column.name.startsWith("source__case ") : columns.includes(column.index)} onChange={event => {
          const current = columns ?? answer.columns.filter(c => c.name.startsWith("case ") || c.name.startsWith("source__case ")).map(c => c.index);
          setColumns(event.target.checked ? [...current, column.index] : current.filter(i => i !== column.index));
        }} />{column.name || `Column ${column.index}`}</label>)}
      </details>
      {source && <SourceDefinition value={source} disabled={busy} onChange={setSource} />}
      <button type="button" className="primary" disabled={busy || !ready || !lineageReady} onClick={() => { const chosen = reviewedRoles(); if (chosen && lineageReady) void load({ roles: chosen, profile_columns: columns, policy_id: policy, include_zero_cells: true, ...(source ? { source_interpretation: source } : {}), ...(categoryLineage && categoryLineage.origin_column_index !== null ? { category_lineage: { ...categoryLineage, origin_column_index: categoryLineage.origin_column_index } } : {}) }); }}>Review these field roles</button>
    </details>}
    {profile && <div className="bpic19-answers" data-stale={actionsPaused ? "true" : undefined}>
      <p className="bpic19-population"><strong>{number.format(profile.population.case_count)} PO items</strong> · {number.format(profile.population.record_count)} original records · {number.format(profile.population.document_count)} purchasing documents</p>
      <p>Items without a verified purchasing document: {number.format(profile.population.document_unknown_case_count)}. They remain in item and record totals, outside known-document supports.</p>
      {profile.definition.category_lineage && <div className="bpic19-quality">
        <h3>Verified Item Category correspondence</h3>
        <p>Origin field: <code>{profile.definition.category_lineage.origin_column_index}: {profile.definition.category_lineage.origin_column_name}</code></p>
        <p>Reviewed field: <code>{profile.definition.category_lineage.column_index}: {profile.definition.category_lineage.column_name}</code></p>
        <p>{number.format(profile.definition.category_lineage.verified_record_count)} original records checked across the entire source, independent of this parent.</p>
        <p>Origin source: <code>{profile.definition.category_lineage.origin_source_id}</code></p>
        <p>Origin preparation: <code>{profile.definition.category_lineage.origin_preparation_id}</code></p>
        <p>Declared provenance: {profile.definition.category_lineage.provenance}</p>
        <p>Policy: <code>{profile.definition.category_lineage.policy_id}</code>. This verifies category correspondence, not other fields or conversion authorship.</p>
      </div>}
      {profile.source_review && <SourceReview review={profile.source_review} disabled={actionsPaused} onInspect={onInspectSource} onKeep={(ids,state) => keep(ids, { kind: "source_inclusion", state })} />}
      <p>Four supplied categories partition these items; unknown or changing categories remain separate. Before-GR permits either observed receipt order. Flag checks do not change the category.</p>
      <details><summary>Historical flag-only views · overlapping purchasing flows</summary>
        <p>These views use exact lowercase raw flag strings on at least one same original record. Every retained item keeps its complete history. GR=true AND IV=false includes before-GR and Consignment in the original BPIC19 source; IV=false alone additionally includes two-way items. These are overlapping flag views, separate from the four category partitions.</p>
        <p>Goods Receipt field: {profile.definition.roles.goods_receipt}. GR-Based Invoice Verification field: {profile.definition.roles.gr_based_iv}. Missing cells are not the string false, and changing case attributes are not filled from a first row. Source category conflicts can remain in a raw flag view; review the typed partition separately.</p>
        <button type="button" disabled={actionsPaused || !onKeepRecordPredicate} onClick={() => keepFlagView(true)}>Keep overlapping GR=true AND IV=false items</button>
        <button type="button" disabled={actionsPaused || !onKeepRecordPredicate} onClick={() => keepFlagView(false)}>Keep overlapping IV=false items</button>
        <p>The selection service supplies the membership, denominator and original-record witnesses. Use the same-record filter below to review AND across fields, OR among exact alternatives and its explicit missing-value branch.</p>
      </details>
      <div className="bpic19-table-scroll"><table className="plain-table"><caption>Purchasing flow at PO-item grain</caption><thead><tr><th>Purchasing flow</th><th>PO items</th><th>Share of parent</th><th>Records</th><th>Documents</th><th>Full-history action</th></tr></thead><tbody>
        {profile.flows.map(group => <tr key={group.flow_id}><th scope="row">{group.label}<small>{group.category_value}</small></th><td>{number.format(group.case_count)}</td><td>{group.share === null ? "unavailable" : percent.format(group.share)}</td><td>{number.format(group.record_count)}</td><td>{number.format(group.document_count)}</td><td><button type="button" disabled={actionsPaused || !group.case_count} onClick={() => keep(group.case_ids, { kind: "flow", flow_id: group.flow_id })}>Keep {group.label}</button>{group.example_case_ids[0] && <button type="button" disabled={actionsPaused} onClick={() => onInspect(group.example_case_ids[0])}>Inspect an item</button>}</td></tr>)}
      </tbody></table></div>
      <p>Document memberships can overlap: {number.format(profile.grain.mixed_flow_document_count)} documents contain items in several flows. Their row counts must not be added as distinct documents.</p>
      <details><summary>Document siblings outside the reviewed parent</summary><p>Current profile totals include only the reviewed parent. Siblings elsewhere in the original source are separate scope evidence and never enter those totals.</p>{profile.grain.outside_parent_siblings ? <><p>Outside this parent, the same verified documents contain {number.format(profile.grain.outside_parent_siblings.case_count)} other items / {number.format(profile.grain.outside_parent_siblings.record_count)} original records / {number.format(profile.grain.outside_parent_siblings.document_count)} documents.</p><p>Outside-scope item examples: {profile.grain.outside_parent_siblings.example_case_ids.join(", ") || "none"}.</p><p>{number.format(profile.grain.possible_sibling_conflict_case_ids?.length ?? 0)} outside items have changing document cells that mention these documents; they are not asserted as verified siblings.</p></> : <button type="button" disabled={actionsPaused} onClick={() => { if (answer) void load({...answer.query,include_document_siblings:true}); }}>Review outside-parent document siblings</button>}</details>
      <div className="bpic19-quality"><h3>Unresolved categories and cross-checks</h3>
        {[...profile.unresolved, ...profile.cross_checks, ...profile.grain.identity_issues].map((group, index) => <p key={`${index}-${group.state}`}><strong>{stateName(group.state)}</strong>: {number.format(group.case_count)} items{group.case_count > 0 && <> <button disabled={actionsPaused} type="button" onClick={() => inspectIssue(group.example_case_ids[0], group.state)}>Inspect {stateName(group.state)}</button></>}</p>)}
        <p>Partition: {profile.partition.is_disjoint && profile.partition.covers_parent ? "each parent item appears exactly once among the four flows and unresolved categories" : "the partition is incomplete; review the source"}.</p>
        {profile.grain.mixed_flow_document_examples.map(doc => <details key={doc.document}><summary>Mixed-flow document {doc.document}</summary><p>{doc.flow_ids.map(stateName).join(", ")}</p>{doc.case_ids.map(id => <button key={id} type="button" disabled={actionsPaused} onClick={() => onInspect(id)}>Inspect item {id}</button>)}</details>)}
      </div>
      <h3>Compare item types within one flow</h3><label>Purchasing flow<select value={flow} disabled={busy} onChange={event => { setFlow(event.target.value); setTarget(""); setComparator(""); }}>{profile.flows.map(f => <option key={f.flow_id} value={f.flow_id}>{f.label}</option>)}</select></label>
      <div className="bpic19-table-scroll"><table className="plain-table"><caption>Item Type subgroups · complete PO items</caption><thead><tr><th>Item Type</th><th>PO items</th><th>Records</th><th>Documents</th><th>Action</th></tr></thead><tbody>{cells.map((cell,index) => <tr key={index}><th scope="row">{cellName(cell)}</th><td>{number.format(cell.case_count)}</td><td>{number.format(cell.record_count)}</td><td>{number.format(cell.document_count)}</td><td><button type="button" disabled={actionsPaused || !cell.case_count} onClick={() => keep(cell.case_ids, { kind: "flow_item_type", flow_id: cell.flow_id, state: cell.item_type_state, item_type_value: cell.item_type_value })}>Keep {cellName(cell)}</button></td></tr>)}</tbody></table></div>
      {profile.item_type_totals && <details><summary>Item Type column totals across the four flows</summary><p>Invariant subtype totals are distinct from unresolved category and missing/changing subtype support. Known empty cells above remain zero; Service is an Item Type, not an extra flow.</p><table className="plain-table"><caption>Invariant Item Type totals</caption><thead><tr><th>Item Type</th><th>Items</th><th>Records</th><th>Documents</th></tr></thead><tbody>{profile.item_type_totals.map(total => <tr key={total.item_type_value}><th scope="row">{total.item_type_value}</th><td>{number.format(total.case_count)}</td><td>{number.format(total.record_count)}</td><td>{number.format(total.document_count)}</td></tr>)}</tbody></table></details>}
      {onCompare && <div className="bpic19-compare"><label>Target subtype<select value={target} onChange={event => setTarget(event.target.value)} disabled={busy}><option value="">Choose a subtype</option>{cells.map((cell,index) => <option key={index} value={index}>{cellName(cell)}</option>)}</select></label><label>Comparator subtype<select value={comparator} onChange={event => setComparator(event.target.value)} disabled={busy}><option value="">Choose a subtype</option>{cells.map((cell,index) => <option key={index} value={index}>{cellName(cell)}</option>)}</select></label><button type="button" disabled={actionsPaused || target === "" || comparator === "" || target === comparator} onClick={compare}>Compare these subgroups</button></div>}
      <details><summary>Case attributes and source grain</summary><p>Every raw record is checked, regardless of timestamp availability. A field may vary intentionally at event grain; review its role before using it as a case attribute. Value supports can overlap for changing fields.</p>
        {profile.attributes.map(attribute => <details key={attribute.column_index}><summary>{attribute.column_name}: {number.format(attribute.distinct_nonmissing_value_count)} values · {number.format(attribute.conflicting_case_count)} changing items · {number.format(attribute.missing_case_count)} missing items</summary>
          <p>{number.format(attribute.invariant_case_count)} invariant items; {number.format(attribute.missing_record_count)} missing records. {attribute.omitted_distinct_value_count > 0 && `${number.format(attribute.omitted_distinct_value_count)} further values omitted from this bounded preview.`}</p>
          <p>At document grain: {number.format(attribute.invariant_document_count)} invariant, {number.format(attribute.missing_document_count)} missing, {number.format(attribute.conflicting_document_count)} changing. Items without a verified document identifier are outside these document counts.</p>
          {attribute.document_conflict_examples.map(doc => <details key={doc.document}><summary>Changing field in document {doc.document}</summary>{doc.case_ids.map(id => <button key={id} disabled={actionsPaused} type="button" onClick={() => onInspect(id)}>Inspect item {id}</button>)}</details>)}
          {attribute.conflicting_witnesses?.map(witness => <details key={witness.case_id}><summary>Conflicting original rows: {witness.case_id}</summary>{witness.rows.map(row => <p key={row.row_id}>Original record {row.source_position + 1}: <code>{row.value === null ? "[missing]" : row.value}</code></p>)}<button type="button" disabled={actionsPaused} onClick={() => onInspect(witness.case_id, witness.rows.map(row => row.row_id))}>Inspect conflicting rows {witness.case_id}</button></details>)}
          {attribute.conflicting_example_case_ids.map(id => <button key={id} disabled={actionsPaused} type="button" onClick={() => onInspect(id)}>Inspect changing item {id}</button>)}
          {attribute.missing_example_case_ids.map(id => <button key={id} disabled={actionsPaused} type="button" onClick={() => onInspect(id)}>Inspect missing item {id}</button>)}
          <ul>{(profile.attribute_view?.column_index === attribute.column_index ? profile.attribute_view.values : attribute.values).map((value,index) => <li key={index}>{value.value === null ? "not recorded" : value.value.trim() === "" ? JSON.stringify(value.value) : value.value}: {number.format(value.case_count)} items, {number.format(value.record_count)} records, {number.format(value.document_count)} documents{value.example_case_ids[0] && <button disabled={actionsPaused} type="button" onClick={() => onInspect(value.example_case_ids[0])}>Inspect source item</button>}<button type="button" disabled={actionsPaused} onClick={() => values(attribute.column_index, profile.attribute_view?.column_index === attribute.column_index ? profile.attribute_view.offset : 0, true, value.value)}>Review complete-item membership for {value.value === null ? "missing" : value.value}</button></li>)}</ul>
          {profile.attribute_view?.column_index === attribute.column_index ? <>
            <p>Value page {profile.attribute_view.offset + 1}–{Math.min(profile.attribute_view.offset + profile.attribute_view.values.length,profile.attribute_view.total_value_count)} of {profile.attribute_view.total_value_count}. Global value/support totals are unchanged.</p>
            <button type="button" aria-label={`Previous values for column ${attribute.column_index}: ${attribute.column_name}`} disabled={actionsPaused || profile.attribute_view.offset === 0} onClick={() => values(attribute.column_index, Math.max(0,profile.attribute_view!.offset - profile.attribute_view!.limit))}>Previous attribute values</button>
            <button type="button" aria-label={`Next values for column ${attribute.column_index}: ${attribute.column_name}`} disabled={actionsPaused || profile.attribute_view.next_offset === null} onClick={() => values(attribute.column_index, profile.attribute_view!.next_offset ?? 0)}>Next attribute values</button>
            {profile.attribute_view.selection && <div><p>Reviewed exact raw value {profile.attribute_view.selection.value === null ? "[missing]" : JSON.stringify(profile.attribute_view.selection.value)}: {number.format(profile.attribute_view.selection.case_count)} complete items. Any original record may witness this value; this membership can overlap other values and is separate from invariant case admission.</p><button type="button" disabled={actionsPaused || !profile.attribute_view.selection.case_count} onClick={() => keep(profile.attribute_view!.selection!.case_ids, { kind: "attribute_value", column_index: attribute.column_index, value: profile.attribute_view!.selection!.value })}>Keep reviewed attribute-value items</button>{profile.attribute_view.selection.witnesses.map(witness => <button key={witness.case_id} type="button" disabled={actionsPaused} onClick={() => onInspect(witness.case_id,witness.row_ids)}>Inspect attribute witness {witness.case_id}</button>)}</div>}
          </> : attribute.omitted_distinct_value_count > 0 && <button type="button" aria-label={`Next values for column ${attribute.column_index}: ${attribute.column_name}`} disabled={actionsPaused} onClick={() => values(attribute.column_index,12)}>Next attribute values</button>}
        </details>)}
      </details>
    </div>}
  </section>;
}
