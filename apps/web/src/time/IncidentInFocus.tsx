import type { ContextColumnName, ContextValue, ExplorerCaseSummary } from "../generated/case-list";
import type { CaseId } from "../generated/imports";
import { timeSentences } from "./gapWording";

interface IncidentInFocusProps {
  row: ExplorerCaseSummary;
  /** The context columns chosen when the source was interpreted, in their order; nothing else is context. */
  columns: readonly ContextColumnName[];
  /** Opens the incident with the two records of its longest gap marked in its history. */
  onShowRecords?: (caseId: CaseId, rowIds: string[]) => void;
}

const valueOf = (values: readonly ContextValue[], column: number) => values.find((item) => item.column_index === column)?.value ?? null;

/**
 * What the list says of the incident in its current row: its first and last records, its span, its
 * longest gap with the two records that bound it, and the values of the chosen context columns at
 * those two records. The context is that of the columns chosen for the source; there is no sender
 * or recipient of its own.
 */
export function IncidentInFocus({ row, columns, onShowRecords }: IncidentInFocusProps) {
  const witness = row.time_summary.status === "available" ? row.time_summary.maximum_gap_witness : null;
  const context = row.maximum_gap_context;
  return (
    <section className="incident-focus" aria-labelledby="incident-focus-title">
      <h4 id="incident-focus-title" className="incident-focus-title">
        {row.case_id}: {row.record_count.toLocaleString("en")} {row.record_count === 1 ? "record" : "records"}
        {row.omitted_activity_record_count > 0 && `, ${row.omitted_activity_record_count.toLocaleString("en")} without activity label`}
      </h4>
      {timeSentences(row).map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
      {witness !== null && onShowRecords && (
        <button type="button" onClick={() => onShowRecords(row.case_id, [witness.from_row_id, witness.to_row_id])}>
          Show the two records of the gap
        </button>
      )}
      {witness !== null && context !== null &&
        (columns.length === 0 ? (
          <p className="muted">No context column was chosen for this source, so the gap has no context to show.</p>
        ) : (
          <table className="incident-focus-context">
            <caption>Context at the two records of the longest gap, from the context columns chosen for this source</caption>
            <thead>
              <tr>
                <th scope="col">Context column</th>
                <th scope="col">Where the gap begins</th>
                <th scope="col">Where it ends</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => {
                const from = valueOf(context.from_context, column.column_index);
                const to = valueOf(context.to_context, column.column_index);
                return (
                  <tr key={column.column_index}>
                    <th scope="row">{column.name}</th>
                    <td>{from ?? <span className="muted">not recorded</span>}</td>
                    <td>{to ?? <span className="muted">not recorded</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </section>
  );
}
