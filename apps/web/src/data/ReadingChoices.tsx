import { useId } from "react";
import type {
  CsvInspectionAnswer,
  Delimiter,
  Encoding,
  RoleSuggestion,
  TimestampFormat,
} from "../generated/imports";
import type { PreparationTarget } from "../imported/coordinator";
import type { DataCoordinator, DataState, ProposalState } from "./coordinator";
import { exampleColumns, exampleReading } from "./examples";
import { ImportProblemNotice } from "./ImportProblemNotice";
import {
  type Draft,
  type RowRule,
  type ZoneChoice,
  cutoffFieldValue,
  delimiters,
  encodings,
  formatEvidence,
  formatLabels,
  missingChoices,
  offsetLabel,
  offsets,
  readingConsequences,
} from "./interpretation";
import { Report } from "./Report";
import { countOf, delimiterName, encodingName, utcText, wallText } from "./wording";
import { Working } from "./Working";

interface ReadingChoicesProps {
  state: DataState;
  coordinator: DataCoordinator;
  onOpenIncidents: (target: PreparationTarget) => void;
}

/** The inspection of the current source, the analyst's choices for reading it, and the report. */
export function ReadingChoices({ state, coordinator, onOpenIncidents }: ReadingChoicesProps) {
  const { inspection, source } = state;
  if (source.phase !== "stored") return null;
  return (
    <>
      <section className="step" aria-labelledby="inspection-title">
        <h3 id="inspection-title" className="step-title">
          How {source.source.filename} is written
        </h3>
        {state.example !== null && <ExampleReading label={state.example.label} />}
        {inspection.phase !== "none" && (
          <Dialect
            detected={state.detected}
            draft={state.draft}
            coordinator={coordinator}
          />
        )}
        {inspection.phase === "inspecting" && (
          <Working
            label={`Inspecting ${source.source.filename}: encoding, delimiter, columns and times…`}
            startedAt={inspection.startedAt}
            onStop={() => coordinator.stopWaiting()}
          />
        )}
        {inspection.phase === "failed" && (
          <ImportProblemNotice
            title={`${source.source.filename} could not be inspected`}
            problem={inspection.problem}
            onRetry={() => coordinator.inspect(inspection.hints)}
          />
        )}
        {inspection.phase === "none" && (
          <button type="button" onClick={() => coordinator.inspect(null)}>
            Inspect {source.source.filename}
          </button>
        )}
        {inspection.phase === "ready" && <Findings answer={inspection.answer} />}
        {inspection.phase === "ready" && inspection.answer.columns.length > 0 && (
          <RowRuleChoice draft={state.draft} coordinator={coordinator} />
        )}
      </section>
      {inspection.phase === "ready" && inspection.answer.columns.length > 0 && (
        <Choices answer={inspection.answer} state={state} coordinator={coordinator} onOpenIncidents={onOpenIncidents} />
      )}
    </>
  );
}

interface DialectProps {
  /** The first way the inspection without hints found to read the source, once it has answered. */
  detected: CsvInspectionAnswer["dialect_candidates"][number] | null;
  draft: Draft;
  coordinator: DataCoordinator;
}

/** Encoding and delimiter as detected or chosen; changing one inspects the source again. */
function Dialect({ detected, draft, coordinator }: DialectProps) {
  const encodingId = useId();
  const delimiterId = useId();
  const read = (change: { encoding?: Encoding; delimiter?: Delimiter }) => {
    const encoding = change.encoding ?? draft.encoding;
    const delimiter = change.delimiter ?? draft.delimiter;
    coordinator.inspect({ ...(encoding === null ? {} : { encoding }), ...(delimiter === null ? {} : { delimiter }) });
  };
  return (
    <>
      <div className="choice-row">
        <div className="choice">
          <label htmlFor={encodingId} className="label-text">
            Encoding
          </label>
          <select
            id={encodingId}
            value={draft.encoding ?? ""}
            onChange={(event) => read({ encoding: event.target.value as Encoding })}
          >
            {draft.encoding === null && <option value="">Choose an encoding</option>}
            {encodings.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
                {detected?.encoding === item.value ? " (detected)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="choice">
          <label htmlFor={delimiterId} className="label-text">
            Delimiter
          </label>
          <select
            id={delimiterId}
            value={draft.delimiter ?? ""}
            onChange={(event) => read({ delimiter: event.target.value as Delimiter })}
          >
            {draft.delimiter === null && <option value="">Choose a delimiter</option>}
            {delimiters.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
                {detected?.delimiter === item.value ? " (detected)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="choice">
          <span className="label-text">Header</span>
          <span>First record</span>
        </div>
      </div>
    </>
  );
}

/** What the inspection found with the current encoding and delimiter. */
function Findings({ answer }: { answer: CsvInspectionAnswer }) {
  return (
    <>
      <p>
        <span className="label-text">Records after the header</span>{" "}
        <span className="figure-inline">{answer.record_count === null ? "not known" : countOf(answer.record_count, "record")}</span>
      </p>
      {answer.blank_record_count !== undefined && (
        <p>
          <span className="label-text">Blank lines</span>{" "}
          <span className="figure-inline">{countOf(answer.blank_record_count, "blank line")}</span>
        </p>
      )}
      {answer.ragged_record_count !== undefined && (
        <p>
          <span className="label-text">Records with another number of cells than the header</span>{" "}
          <span className="figure-inline">{countOf(answer.ragged_record_count, "record")}</span>
        </p>
      )}
      {answer.dialect_candidates.length > 1 && (
        <p className="muted">
          The source can be read in {answer.dialect_candidates.length} ways; the first is shown. Change the encoding or delimiter if the sample
          does not look right.
        </p>
      )}
      {answer.unresolved.length > 0 && (
        <ul className="notes" aria-label="To confirm">
          {answer.unresolved.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {answer.columns.length > 0 && <Sample answer={answer} />}
    </>
  );
}

const rowRuleLabels: Record<RowRule, { title: string; sentence: string }> = {
  tolerant: {
    title: "Tolerant",
    sentence:
      "Blank lines are skipped and counted, and records without a case id or with another number of cells than the header are kept as written outside every case, as long as those with another number of cells are at most 5 % of the records.",
  },
  strict: {
    title: "Strict",
    sentence: "Every line must be a record with as many cells as the header; a blank line or a record with another number of cells stops the reading.",
  },
};

/** The row rule for this reading: the tolerant one unless the analyst chooses the strict one. */
function RowRuleChoice({ draft, coordinator }: { draft: Draft; coordinator: DataCoordinator }) {
  return (
    <fieldset className="checks">
      <legend className="label-text-strong">Rows that do not fit</legend>
      {(["tolerant", "strict"] as const).map((rule) => (
        <label key={rule} className="check check-long">
          <input type="radio" name="row-rule" checked={draft.rowRule === rule} onChange={() => coordinator.choose({ rowRule: rule })} />
          <span>
            <span className="check-title">{rowRuleLabels[rule].title}:</span> {rowRuleLabels[rule].sentence}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** The fixed reading of a packaged example, as the screen first applies it. */
function ExampleReading({ label }: { label: string }) {
  const name = (index: number | null) => (index === null ? "none" : exampleColumns[index]);
  const rows: [string, string][] = [
    ["Encoding", encodingName(exampleReading.encoding!)],
    ["Delimiter", delimiterName(exampleReading.delimiter!)],
    ["Case id", name(exampleReading.caseColumn)],
    ["Activity", name(exampleReading.activityColumn)],
    ["Time", `${name(exampleReading.timestampColumn)}, ${formatLabels[exampleReading.timeFormat!]}`],
    ["Zone of the times", "Offsets written in the values"],
    ["Sequence number", name(exampleReading.sequenceColumn)],
    ["Context attributes", exampleReading.contextColumns.map((index) => exampleColumns[index]).join(", ")],
    ["Export taken at", utcText(`${exampleReading.cutoff}Z`)],
    ["Rows that do not fit", rowRuleLabels[exampleReading.rowRule].title],
  ];
  return (
    <div className="example-reading">
      <p>
        {label}. It is read with this fixed reading; the choices below show it and can be changed like for any CSV.
      </p>
      <dl className="pairs" aria-label="Fixed reading of the example">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Sample({ answer }: { answer: CsvInspectionAnswer }) {
  return (
    <div className="sample">
      <div className="table-scroll" role="region" aria-labelledby="sample-title" tabIndex={0}>
        <table className="plain-table sample-table">
          <caption id="sample-title" className="caption">
            The first records as read, by source position
          </caption>
          <thead>
            <tr>
              <th scope="col" className="number">Position</th>
              {answer.columns.map((column) => (
                <th scope="col" key={column.index}>
                  {column.name === "" ? <span className="missing-text">no name</span> : column.name}
                  <span className="column-index"> · column {column.index}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {answer.sample_rows.map((row) => (
              <tr key={row.source_position}>
                <td className="number">{row.source_position}</td>
                {row.cells.map((cell, index) => (
                  <td key={index}>{cell === "" ? <span className="missing-text">missing</span> : cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Role = "case_id" | "activity" | "timestamp" | "source_sequence";

const roleFields: Record<Role, "caseColumn" | "activityColumn" | "timestampColumn" | "sequenceColumn"> = {
  case_id: "caseColumn",
  activity: "activityColumn",
  timestamp: "timestampColumn",
  source_sequence: "sequenceColumn",
};

const roleLabels: Record<Role, string> = {
  case_id: "Case id",
  activity: "Activity",
  timestamp: "Time",
  source_sequence: "Sequence number (optional)",
};

function evidenceOf(suggestion: RoleSuggestion | undefined): string {
  if (suggestion === undefined) return "not inspected";
  return `${countOf(suggestion.nonempty_count, "filled cell")}, ${countOf(suggestion.distinct_nonempty_count, "distinct value")}`;
}

/** A column of the source with what the inspection found in it; nothing when it reported nothing about it. */
interface ColumnEvidence {
  index: number;
  suggestion: RoleSuggestion | undefined;
}

/**
 * Every column of the source for one role: first those the inspection suggests for it, then the
 * others. Each keeps the source order and what the inspection found in it.
 */
function columnsFor(role: Role | "context", answer: CsvInspectionAnswer): { suggested: ColumnEvidence[]; others: ColumnEvidence[] } {
  const all: ColumnEvidence[] = answer.columns.map((column) => ({
    index: column.index,
    suggestion: answer.role_suggestions.find((item) => item.column_index === column.index),
  }));
  return {
    suggested: all.filter((item) => item.suggestion?.roles.includes(role) === true),
    others: all.filter((item) => item.suggestion?.roles.includes(role) !== true),
  };
}

function columnName(names: Map<number, string>, index: number): string {
  return names.get(index) || `Column ${index}`;
}

function Choices({
  answer,
  state,
  coordinator,
  onOpenIncidents,
}: {
  answer: CsvInspectionAnswer;
  state: DataState;
  coordinator: DataCoordinator;
  onOpenIncidents: (target: PreparationTarget) => void;
}) {
  const { draft, interpretation } = state;
  const missing = missingChoices(draft);
  const missingId = useId();
  const names = new Map(answer.columns.map((column) => [column.index, column.name]));
  const timestamp = answer.role_suggestions.find((item) => item.column_index === draft.timestampColumn);
  const consequences = readingConsequences(draft, answer);
  const consequencesId = useId();
  const describedBy = [missing.length > 0 ? missingId : null, consequences.length > 0 ? consequencesId : null].filter((id) => id !== null);
  const working = interpretation.phase === "preparing";
  return (
    <>
      <section className="step" aria-labelledby="roles-title">
        <h3 id="roles-title" className="step-title">
          Column roles
        </h3>
        <p className="muted">
          Each list offers every column of the source: first those the inspection suggests for the role, then the other columns, each with
          what the inspection found in it. Columns without a role stay in every record as written. Where the names and the contents of the columns point to one column for a role, it is already chosen, and columns whose values repeat are ticked as context: these are proposals, so check each one.
        </p>
        <div className="choice-row">
          {(Object.keys(roleFields) as Role[]).map((role) => (
            <RoleChoice key={role} role={role} answer={answer} names={names} draft={draft} coordinator={coordinator} />
          ))}
        </div>
        <ContextChoice answer={answer} names={names} draft={draft} coordinator={coordinator} />
      </section>
      <section className="step" aria-labelledby="time-title">
        <h3 id="time-title" className="step-title">
          Times
        </h3>
        {draft.timestampColumn === null ? (
          <p className="muted">Choose the time column first.</p>
        ) : (
          <FormatChoice suggestion={timestamp} answer={answer} draft={draft} coordinator={coordinator} />
        )}
        <ZoneChoiceFields draft={draft} proposal={state.proposal} coordinator={coordinator} />
      </section>
      <section className="step" aria-labelledby="report-title">
        <h3 id="report-title" className="step-title">
          Interpretation report
        </h3>
        {consequences.length > 0 && (
          <div id={consequencesId} className="state-line state-confirm">
            <span className="label-text-strong">What these choices mean for the reading</span>
            <ul className="notes" aria-label="What these choices mean for the reading">
              {consequences.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        {missing.length > 0 && (
          <p id={missingId} className="muted">
            Still to choose: {missing.join(", ")}.
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={missing.length > 0 || working}
          aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
          onClick={() => coordinator.confirm(false)}
        >
          Read the source with these choices
        </button>
        {interpretation.phase === "preparing" && (
          <Working
            label="Reading every record with these choices…"
            startedAt={interpretation.startedAt}
            onStop={() => coordinator.stopWaiting()}
          />
        )}
        {interpretation.phase === "failed" && (
          <ImportProblemNotice
            title="The source cannot be read with these choices"
            problem={interpretation.problem}
            onRetry={() => coordinator.confirm(interpretation.request.accept_report_issues)}
          />
        )}
        {interpretation.phase === "failed" &&
          interpretation.problem.kind === "refusal" &&
          interpretation.problem.refusal.code === "cutoff_before_records" &&
          state.proposal.phase === "ready" &&
          state.proposal.answer.proposed_cutoff !== null && (
            <button type="button" onClick={() => coordinator.useProposal()}>
              Use the proposed cutoff {proposalText(state.proposal.answer.proposed_cutoff)}
            </button>
          )}
        {interpretation.phase === "answered" && (
          <Report
            request={interpretation.request}
            answer={interpretation.answer}
            filename={state.source.phase === "stored" ? state.source.source.filename : undefined}
            cutoffEntered={draft.cutoffEdited}
            previous={interpretation.previous}
            names={names}
            onAccept={() => coordinator.confirm(true)}
            onOpenIncidents={(preparationId) =>
              onOpenIncidents({
                workspaceId: interpretation.answer.workspace_id,
                preparationId,
                sourceName: state.source.phase === "stored" ? state.source.source.filename : undefined,
              })
            }
          />
        )}
      </section>
    </>
  );
}

function RoleChoice({
  role,
  answer,
  names,
  draft,
  coordinator,
}: {
  role: Role;
  answer: CsvInspectionAnswer;
  names: Map<number, string>;
  draft: Draft;
  coordinator: DataCoordinator;
}) {
  const id = useId();
  const field = roleFields[role];
  const { suggested, others } = columnsFor(role, answer);
  const value = draft[field];
  const option = (item: ColumnEvidence) => (
    <option key={item.index} value={item.index}>
      {columnName(names, item.index)} — {evidenceOf(item.suggestion)}
    </option>
  );
  return (
    <div className="choice">
      <label htmlFor={id} className="label-text">
        {roleLabels[role]}
      </label>
      <select
        id={id}
        value={value === null ? "" : String(value)}
        onChange={(event) => coordinator.choose({ [field]: event.target.value === "" ? null : Number(event.target.value) })}
      >
        <option value="">{role === "source_sequence" ? "No sequence column" : "Choose a column"}</option>
        {suggested.length > 0 && <optgroup label="Suggested for this role">{suggested.map(option)}</optgroup>}
        {others.length > 0 && <optgroup label="Other columns">{others.map(option)}</optgroup>}
      </select>
      {suggested.length === 0 && <span className="muted">The inspection suggests no column for this role.</span>}
    </div>
  );
}

function ContextChoice({
  answer,
  names,
  draft,
  coordinator,
}: {
  answer: CsvInspectionAnswer;
  names: Map<number, string>;
  draft: Draft;
  coordinator: DataCoordinator;
}) {
  const roles = new Set([draft.caseColumn, draft.activityColumn, draft.timestampColumn, draft.sequenceColumn]);
  const free = (item: ColumnEvidence) => !roles.has(item.index);
  const columns = columnsFor("context", answer);
  const suggested = columns.suggested.filter(free);
  const others = columns.others.filter(free);
  if (suggested.length === 0 && others.length === 0) return null;
  const chosen = new Set(draft.contextColumns);
  const check = (item: ColumnEvidence) => (
    <label key={item.index} className="check">
      <input
        type="checkbox"
        checked={chosen.has(item.index)}
        onChange={(event) =>
          coordinator.choose({
            contextColumns: event.target.checked
              ? [...draft.contextColumns, item.index]
              : draft.contextColumns.filter((index) => index !== item.index),
            ...(!event.target.checked && draft.documentColumn === item.index ? { documentColumn: null } : {}),
            ...(!event.target.checked ? { numericColumns: draft.numericColumns.filter((numeric) => numeric.column !== item.index) } : {}),
          })
        }
      />
      {columnName(names, item.index)} <span className="muted">— {evidenceOf(item.suggestion)}</span>
    </label>
  );
  return (
    <fieldset className="checks">
      <legend className="label-text">Context attributes (optional)</legend>
      {suggested.map(check)}
      {others.length > 0 && <span className="label-text">Other columns</span>}
      {others.map(check)}
      {draft.contextColumns.length > 0 && <NumericChoice names={names} draft={draft} coordinator={coordinator} />}
      {draft.contextColumns.length > 0 && (
        <label>
          <span className="label-text">Document reference (optional)</span>
          <select
            value={draft.documentColumn !== null && chosen.has(draft.documentColumn) ? String(draft.documentColumn) : ""}
            onChange={(event) => coordinator.choose({ documentColumn: event.target.value === "" ? null : Number(event.target.value) })}
          >
            <option value="">No document reference</option>
            {[...draft.contextColumns].sort((left, right) => left - right).map((index) => (
              <option key={index} value={String(index)}>{columnName(names, index)}</option>
            ))}
          </select>
          <span className="muted">The column whose value names each record's document in the workspace's document folder. Nothing of a document is imported.</span>
        </label>
      )}
    </fieldset>
  );
}

function FormatChoice({
  suggestion,
  answer,
  draft,
  coordinator,
}: {
  suggestion: RoleSuggestion | undefined;
  answer: CsvInspectionAnswer;
  draft: Draft;
  coordinator: DataCoordinator;
}) {
  const evidence = formatEvidence(suggestion);
  const statusId = useId();
  const column = draft.timestampColumn;
  const examples = [
    ...new Set(answer.sample_rows.map((row) => (column === null ? undefined : row.cells[column])).filter((cell) => cell !== undefined && cell !== "")),
  ].slice(0, 3);
  const readsNone = evidence.readings.every((item) => item.parsed === 0);
  const legend = evidence.question
    ? "These times can be read in more than one way. Which comes first: the day or the month?"
    : "Time format";
  const status =
    evidence.complete.length > 1
    ? `${evidence.complete.length} formats read every filled cell, so none is proposed. Compare the values above with the examples in the labels.`
    : evidence.proposed !== null
      ? `Proposed: ${formatLabels[evidence.proposed]}, the only format that reads every filled cell.`
      : suggestion === undefined
        ? "The inspection reported nothing about this column, so no format is proposed."
        : evidence.filled === 0
          ? "This column has no filled cell, so no format is proposed. With any format, no record has a usable time and no case's order can be evaluated."
          : readsNone
            ? "No format reads any filled cell of this column, so none is proposed. With any format, no record has a usable time and no case's order can be evaluated."
            : "No format reads every filled cell, so none is proposed. A value the chosen format does not read stays in its case without a usable time.";
  return (
    <fieldset className="checks" aria-describedby={statusId}>
      <legend className="label-text-strong">{legend}</legend>
      {examples.length > 0 && (
        <p className="muted">
          Values in this column, for example: <span className="identifier">{examples.join(" · ")}</span>
        </p>
      )}
      <p id={statusId} className={evidence.question ? "question" : "muted"}>
        {status}
      </p>
      {evidence.readings.map((item) => (
        <label key={item.format} className="check check-long">
          <input
            type="radio"
            name="time-format"
            value={item.format}
            checked={draft.timeFormat === item.format}
            onChange={() => coordinator.choose({ timeFormat: item.format as TimestampFormat })}
          />
          <span>
            {formatLabels[item.format]}{" "}
            <span className="muted">
              —{" "}
              {item.parsed === null
                ? "not inspected"
                : evidence.filled === 0
                  ? "no filled cell to read"
                  : `reads ${countOf(item.parsed, "filled cell")} of ${countOf(evidence.filled, "filled cell")}`}
            </span>
          </span>
        </label>
      ))}
      <p className="muted">The formats with seconds also read fractions of a second, for example 17:45:10.250.</p>
    </fieldset>
  );
}

/** A proposed or supplied cutoff in words, on its own clock. */
function proposalText(time: string): string {
  return time.endsWith("Z") ? utcText(time) : wallText(time);
}

function Proposal({ proposal, draft, coordinator }: { proposal: ProposalState; draft: Draft; coordinator: DataCoordinator }) {
  switch (proposal.phase) {
    case "none":
      return <p className="muted">Once the columns, the time format and the zone are chosen, a cutoff is proposed from the data.</p>;
    case "proposing":
      return (
        <p className="muted" role="status">
          Proposing a cutoff from the latest usable time of the time column…
        </p>
      );
    case "failed":
      return <ImportProblemNotice title="No cutoff can be proposed with these choices" problem={proposal.problem} />;
    case "ready": {
      const { last_usable_time: last, proposed_cutoff: proposed } = proposal.answer;
      if (last === null) {
        return (
          <p className="muted" role="status">
            No record has a usable time with these choices, so nothing is proposed. Enter when the export was taken.
          </p>
        );
      }
      if (proposed === null) {
        return (
          <p className="muted" role="status">
            The latest usable time {proposalText(last)} cannot be rounded up to a full minute, so nothing is proposed. Enter when the export
            was taken, at that time or later.
          </p>
        );
      }
      const shown = cutoffFieldValue(proposed);
      return (
        <p className="proposal" role="status">
          Proposed from the data: {proposalText(proposed)}, the latest usable time {proposalText(last)} rounded up to a full minute.
          {draft.cutoff !== shown && (
            <>
              {" "}
              <button type="button" className="link-button" onClick={() => coordinator.useProposal()}>
                Use the proposal
              </button>
            </>
          )}
        </p>
      );
    }
  }
}

function ZoneChoiceFields({ draft, proposal, coordinator }: { draft: Draft; proposal: ProposalState; coordinator: DataCoordinator }) {
  const offsetId = useId();
  const cutoffId = useId();
  const choose = (zone: ZoneChoice) => coordinator.choose({ zone });
  return (
    <>
      <fieldset className="checks">
        <legend className="label-text-strong">Zone of the times</legend>
        <label className="check">
          <input type="radio" name="zone" checked={draft.zone === "as_recorded"} onChange={() => choose("as_recorded")} />
          As recorded: no zone is applied
        </label>
        {draft.zone === "as_recorded" && (
          <p className="limitation">
            Times are kept as the wall clock showed them. Across a change to or from daylight saving time, the difference between two times can
            be off by an hour.
          </p>
        )}
        <label className="check">
          <input type="radio" name="zone" checked={draft.zone === "from_values"} onChange={() => choose("from_values")} />
          Offsets written in the values, for example Z or +02:00
        </label>
        <label className="check">
          <input type="radio" name="zone" checked={draft.zone === "fixed_offset"} onChange={() => choose("fixed_offset")} />
          One fixed offset for every time
        </label>
        {draft.zone === "fixed_offset" && (
          <div className="choice nested">
            <label htmlFor={offsetId} className="label-text">
              Offset from UTC
            </label>
            <select id={offsetId} value={String(draft.offsetMinutes)} onChange={(event) => coordinator.choose({ offsetMinutes: Number(event.target.value) })}>
              {offsets.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {offsetLabel(minutes)}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      <div className="choice">
        <label htmlFor={cutoffId} className="label-text">
          Export taken at {draft.zone === "as_recorded" ? "(as recorded)" : "(UTC)"}
        </label>
        <input
          id={cutoffId}
          type="datetime-local"
          step={1}
          value={draft.cutoff}
          onChange={(event) => coordinator.choose({ cutoff: event.target.value })}
        />
        <Proposal proposal={proposal} draft={draft} coordinator={coordinator} />
      </div>
    </>
  );
}

/**
 * Which context columns are read as numbers, each with an optional unit. The analyst declares them for each log; a
 * column's name decides nothing. A cell that is not a number stays in its record and is counted, never read as zero.
 */
function NumericChoice({ names, draft, coordinator }: { names: Map<number, string>; draft: Draft; coordinator: DataCoordinator }) {
  const declared = new Map(draft.numericColumns.map((item) => [item.column, item.unit]));
  const set = (column: number, unit: string | null) =>
    coordinator.choose({
      numericColumns: unit === null
        ? draft.numericColumns.filter((item) => item.column !== column)
        : [...draft.numericColumns.filter((item) => item.column !== column), { column, unit }],
    });
  return (
    <fieldset className="checks numeric-choice">
      <legend className="label-text">Read as numbers (optional)</legend>
      <span className="muted">
        A number is digits with at most one decimal point or comma (0.8 or 0,8) and an optional sign; anything else stays as written and is counted as “not a
        number”, never as zero.
      </span>
      {[...draft.contextColumns].sort((left, right) => left - right).map((column) => (
        <div key={column} className="numeric-column">
          <label className="check">
            <input type="checkbox" checked={declared.has(column)} onChange={(event) => set(column, event.target.checked ? "" : null)} />
            {columnName(names, column)} is a number
          </label>
          {declared.has(column) && (
            <label>
              <span className="label-text">Unit of {columnName(names, column)} (optional)</span>
              <input type="text" maxLength={32} value={declared.get(column) ?? ""} onChange={(event) => set(column, event.target.value)} />
            </label>
          )}
        </div>
      ))}
    </fieldset>
  );
}
