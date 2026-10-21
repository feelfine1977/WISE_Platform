import { useState } from "react";
import type { PredicateResult, RecordAttributesAll, SelectionPredicate } from "../generated/selection";
import "./record-filter.css";

interface RawColumn { index: number; name: string; values?: (string | null)[] }
interface ConditionDraft { column: string; values: string[]; missing: boolean }
export interface Bpic19RecordFilterProps {
  columns: RawColumn[];
  initialColumns?: number[];
  initialPredicate?: RecordAttributesAll;
  disabled?: boolean;
  onKeep: (predicate: SelectionPredicate) => void;
  result?: PredicateResult;
  onInspect?: (caseId: string, rowIds?: string[]) => void;
}

const draft = (column?: number): ConditionDraft => ({ column: column === undefined ? "" : String(column), values: [""], missing: false });
const policy = "incident.raw.same_record_all.v1";

/** Emits a finite complete-item selection intent. WISE's selection service owns membership. */
export function Bpic19RecordFilter({ columns, initialColumns, initialPredicate, disabled = false, onKeep, result, onInspect }: Bpic19RecordFilterProps) {
  const [conditions, setConditions] = useState<ConditionDraft[]>(() => initialPredicate
    ? initialPredicate.conditions.map(condition=>({column:String(condition.column_index),values:condition.values.filter((value):value is string=>value!==null),missing:condition.values.includes(null)}))
    : (initialColumns?.length ? initialColumns.slice(0, 32) : [undefined]).map(draft));
  const [negate, setNegate] = useState(initialPredicate?.negate ?? false);
  const update = (index: number, change: Partial<ConditionDraft>) => setConditions(current => current.map((condition, position) => position === index ? { ...condition, ...change } : condition));
  const valid = conditions.every(condition => condition.column !== "" && columns.some(column => String(column.index) === condition.column) &&
    (condition.values.some(value => value !== "") || condition.missing)) && new Set(conditions.map(condition => condition.column)).size === conditions.length &&
    conditions.every(condition => new Set(condition.values.filter(value => value !== "")).size === condition.values.filter(value => value !== "").length);
  const mapped = conditions.map(condition => {
    const values = [...condition.values.filter(value => value !== ""), ...(condition.missing ? [null] : [])];
    const selected: [string | null, ...(string | null)[]] = [values[0] ?? (condition.missing ? null : ""), ...values.slice(1)];
    return { column_index: Number(condition.column), values: selected };
  });
  const predicate: RecordAttributesAll = { kind: "record_attributes_all", policy_id: policy,
    conditions: [mapped[0], ...mapped.slice(1)], negate };
  const currentResult = result?.predicate.kind === "record_attributes_all" && JSON.stringify(result.predicate) === JSON.stringify(predicate) ? result : undefined;

  return <section className="bpic19-record-filter" aria-label="Same-original-record attribute filter">
    <h3>Keep items by one original record</h3>
    <p>At least one original record must satisfy every field condition. Alternative values within a field use OR; field conditions use AND. Keep retains each item’s complete history.</p>
    <p>Values match exact recorded text, including spaces and letter case. A blank cell matches only when selected; literal Unknown is a separate value. Structurally unavailable cells stay not evaluable, including when the filter is inverted. Record order and timestamps do not affect this filter.</p>
    <fieldset disabled={disabled}>
      <legend>All conditions on the same record</legend>
      {conditions.map((condition, index) => <div className="bpic19-record-condition" key={index}>
        <label>Original field {index + 1}<select value={condition.column} onChange={event => update(index, { column: event.target.value })}>
          <option value="">Choose an original field</option>{columns.map(column => <option key={column.index} value={column.index}>{column.index}: {column.name || "Unnamed field"}</option>)}
        </select></label>
        {condition.values.map((value, valueIndex) => <div key={valueIndex}><label>Exact value {index + 1}.{valueIndex + 1}<textarea rows={1} value={value} onChange={event => update(index, { values: condition.values.map((current, position) => position === valueIndex ? event.target.value : current) })} /></label><button type="button" disabled={condition.values.length === 1} onClick={() => update(index, { values: condition.values.filter((_, position) => position !== valueIndex) })}>Remove alternative {index + 1}.{valueIndex + 1}</button></div>)}
        {columns.find(column => String(column.index) === condition.column)?.values && <label>Recorded value for condition {index + 1}<select value="" onChange={event => {
          const selected = columns.find(column => String(column.index) === condition.column)?.values?.[Number(event.target.value)];
          if (selected === null) update(index, { missing: true });
          else if (selected !== undefined) update(index, { values: condition.values.includes(selected) ? condition.values : [...condition.values.filter(value => value !== ""), selected] });
        }}><option value="">Choose a recorded alternative</option>{columns.find(column => String(column.index) === condition.column)?.values?.map((value, position) => <option key={position} value={position}>{value === null ? "Blank cell" : JSON.stringify(value)}</option>)}</select></label>}
        <label><input type="checkbox" checked={condition.missing} onChange={event => update(index, { missing: event.target.checked })} /> Include a blank cell for field {index + 1}</label>
        <button type="button" onClick={() => update(index, { values: [...condition.values, ""] })}>Add alternative for field {index + 1}</button>
        <button type="button" disabled={conditions.length === 1} onClick={() => setConditions(current => current.filter((_, position) => position !== index))}>Remove condition {index + 1}</button>
      </div>)}
      <button type="button" disabled={conditions.length === 32} onClick={() => setConditions(current => [...current, draft()])}>Add field condition</button>
      <label><input type="checkbox" checked={negate} onChange={event => setNegate(event.target.checked)} /> Keep items where no original record satisfies all conditions</label>
      <button type="button" className="primary" disabled={!valid} onClick={() => onKeep(predicate)}>Keep complete items by this record filter</button>
      {!valid && <p role="status">Choose each field once and at least one exact value or blank cell per field. Duplicate alternatives must be removed.</p>}
    </fieldset>
    {currentResult && <div aria-label="Reviewed same-record support"><p>Kept: {currentResult.kept.case_count} items / {currentResult.kept.record_count} original records. Removed: {currentResult.removed.case_count} items. Not evaluable: {currentResult.unevaluable.case_count} items.</p>
      <p>Witnesses describe positive matches before inversion. Absence is evaluated over each complete history. Showing the first 20 items with matching or unavailable rows.</p>
      {currentResult.record_evidence?.cases.slice(0, 20).map(item => <details key={item.case_id}><summary>Original witnesses for item {item.case_id}</summary>
        <p>Matching rows: {item.matching_row_ids.join(", ") || "none"}. Unavailable rows: {item.unevaluable_row_ids.join(", ") || "none"}.</p>
        <button type="button" disabled={disabled || !onInspect} onClick={() => onInspect?.(item.case_id, [...item.matching_row_ids, ...item.unevaluable_row_ids])}>Inspect complete item {item.case_id}</button>
      </details>)}
    </div>}
  </section>;
}
