import type { KeyboardEvent, MouseEvent } from "react";
import type { CaseId, PopulationAnswer } from "../generated/investigation";
import { countOf, partitionRule } from "../investigation/wording";

interface IncidentTableProps {
  answer: PopulationAnswer;
  openCaseId: CaseId | null;
  onOpen: (caseId: CaseId) => void;
  /** Keeps each row's control so focus can move between rows and return to one. */
  rowControls: Map<CaseId, HTMLButtonElement>;
}

const movement: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_index, last) => last,
};

/** Every incident of the parent population in the supplied order, with the supplied counts. */
export function IncidentTable({ answer, openCaseId, onOpen, rowControls }: IncidentTableProps) {
  const caseIds = answer.cases.map((summary) => summary.case_id);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const move = movement[event.key];
    if (!move) return;
    event.preventDefault();
    rowControls.get(caseIds[move(index, caseIds.length - 1)])?.focus();
  }

  function openFromRow(event: MouseEvent<HTMLTableRowElement>, caseId: CaseId) {
    if ((event.target as Element).closest("button")) return;
    onOpen(caseId);
  }

  return (
    <>
      <p className="muted section-hint" id="incidents-hint">
        {countOf(answer.populations.parent.case_count, "incident")} with {countOf(answer.populations.parent.record_count, "record")}.{" "}
        {partitionRule(answer.policies)} Move with Tab or the arrow keys; Enter opens every record of an incident.
      </p>
      <div className="table-scroll">
        <table className="incident-table" aria-labelledby="incidents-title" aria-describedby="incidents-hint">
          <thead>
            <tr>
              <th scope="col">Incident</th>
              <th scope="col" className="number">Records</th>
              <th scope="col" className="number">Mapped records</th>
              <th scope="col" className="number">Left out: no activity</th>
              <th scope="col">Partition</th>
            </tr>
          </thead>
          <tbody>
            {answer.cases.map((summary, index) => {
              const open = summary.case_id === openCaseId;
              return (
                <tr key={summary.case_id} className={open ? "selected" : undefined} onClick={(event) => openFromRow(event, summary.case_id)}>
                  <th scope="row">
                    <button
                      type="button"
                      className="row-open"
                      aria-current={open ? "true" : undefined}
                      ref={(element) => {
                        if (element) rowControls.set(summary.case_id, element);
                        else rowControls.delete(summary.case_id);
                      }}
                      onKeyDown={(event) => moveFocus(event, index)}
                      onClick={() => onOpen(summary.case_id)}
                    >
                      {summary.case_id}
                    </button>
                  </th>
                  <td className="number">{summary.record_count}</td>
                  <td className="number">{summary.mapped_record_count}</td>
                  <td className="number">{summary.omitted_activity_record_count}</td>
                  <td>{summary.partition === "kept" ? "Kept" : "Removed"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
