import { useEffect, useRef, useState } from "react";
import { countOf } from "../data/wording";
import type { AnswerIdentity, SelectionPredicate } from "../generated/selection";
import type { MatrixCell, TransitionMatrixAnswer } from "../generated/transition-matrix";
import { StepPreviewLine, type StepPreviewer } from "../map/StepPreviewLine";
import { httpMatrixClient, type MatrixClient } from "./client";
import "./matrix.css";

/** How many passages of a cell are listed with their rows. */
export const WITNESS_LIMIT = 50;

export type MatrixMeasure = "incidents" | "passages" | "outgoing" | "median" | "mean";

const MEASURES: [MatrixMeasure, string][] = [
  ["incidents", "Incidents"],
  ["passages", "Passages"],
  ["outgoing", "Outgoing share"],
  ["median", "Median lag"],
  ["mean", "Mean lag"],
];

const whole = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = (share: number) => `${oneDecimal.format(share * 100)} %`;
const hoursText = (hours: number | null) => (hours === null ? "no usable lag" : `${oneDecimal.format(hours)} h`);

/** What a measure counts, its unit and its denominator, said beside the matrix. */
export function measureKey(measure: MatrixMeasure, answer: TransitionMatrixAnswer): string {
  const clock = answer.clock.lag_clock === "elapsed_utc_hours" ? "elapsed hours (UTC)" : "hours as recorded on the wall clock";
  switch (measure) {
    case "incidents":
      return `Incidents: the distinct incidents with the pair, of the ${countOf(answer.case_denominator, "incident")} whose order is known; a repeat adds no incident.`;
    case "passages":
      return "Passages: how often the pair occurs; an incident that repeats it adds a passage each time.";
    case "outgoing":
      return "Outgoing share: the pair's passages of all passages leaving its row's activity; a row no pair leaves has no denominator.";
    case "median":
      return `Median lag: the median of the ${clock} from the first record of each passage to the second; a zero is measured, a tie.`;
    case "mean":
      return `Mean lag: the mean of the ${clock} from the first record of each passage to the second.`;
  }
}

/** The value a cell shows for a measure, as text. */
export function cellValue(cell: MatrixCell, measure: MatrixMeasure): string {
  switch (measure) {
    case "incidents":
      return whole.format(cell.case_count);
    case "passages":
      return whole.format(cell.passage_count);
    case "outgoing":
      return percent(cell.outgoing_share);
    case "median":
      return cell.lag.median_hours === null ? "–" : oneDecimal.format(cell.lag.median_hours);
    case "mean":
      return cell.lag.mean_hours === null ? "–" : oneDecimal.format(cell.lag.mean_hours);
  }
}

/** Every measure of a cell in words, as assistive technology reads its button and the panel names it. */
export function cellDescription(cell: MatrixCell, answer: TransitionMatrixAnswer): string {
  const row = answer.rows.find((candidate) => candidate.activity === cell.source_activity);
  return (
    `From ${cell.source_activity} to ${cell.target_activity}: ${countOf(cell.case_count, "incident")} of ${whole.format(answer.case_denominator)} (${percent(cell.case_share)}), ` +
    `${countOf(cell.passage_count, "passage")}, ${percent(cell.outgoing_share)} of the ${whole.format(row?.outgoing_passage_count ?? 0)} passages leaving ${cell.source_activity}, ` +
    `median lag ${hoursText(cell.lag.median_hours)} over ${countOf(cell.lag.usable_count, "usable lag")}`
  );
}

type Shown = { phase: "loading" } | { phase: "ready"; answer: TransitionMatrixAnswer } | { phase: "failed"; message: string };

interface TransitionMatrixProps {
  workspaceId: string;
  revision: number;
  /** The selection shown: the matrix is of exactly its kept incidents. */
  identity: AnswerIdentity;
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  waitingFor?: string;
  /** Opens an incident's complete history beside the matrix, its rows of the passage marked. */
  onOpenCase: (caseId: string, rowIds: string[]) => void;
  /** The incident open beside the matrix; when the one opened from here closes, the focus returns to its button. */
  openCaseId?: string | null;
  client?: MatrixClient;
}

/**
 * The transition matrix of the kept incidents: each cell a pair of activities directly following each other in the
 * activity sequence, with its distinct incidents, passages, outgoing share and lag as separate measures, all supplied by
 * the local service. A cell is selected in the matrix or its table; its incidents and passages are inspected, and a step
 * keeping or removing its incidents is previewed and applied. A reply for an earlier selection is never shown.
 */
export function TransitionMatrix({ workspaceId, revision, identity, onStep, previewStep, waitingFor, onOpenCase, openCaseId = null, client = httpMatrixClient }: TransitionMatrixProps) {
  const [shown, setShown] = useState<Shown>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [measure, setMeasure] = useState<MatrixMeasure>("incidents");
  const [layout, setLayout] = useState<"matrix" | "table">("matrix");
  const [chosen, setChosen] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const opener = useRef<string | null>(null);
  const identityKey = JSON.stringify(identity);
  useEffect(() => {
    const controller = new AbortController();
    setShown({ phase: "loading" });
    client
      .matrix({ schema_version: 1, message_type: "transition_matrix_request", request_id: `matrix-${revision}-${attempt}`, query_revision: revision,
        workspace_id: workspaceId, identity, witness_limit: WITNESS_LIMIT }, controller.signal)
      .then((outcome) => {
        if (controller.signal.aborted) return;
        setShown(outcome.ok ? { phase: "ready", answer: outcome.answer }
          : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The matrix could not be read from the local service." });
      });
    return () => controller.abort();
    // The identity is compared by its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, revision, workspaceId, attempt, client]);
  // Back from an incident opened here, the focus returns to the button it was opened with.
  useEffect(() => {
    if (openCaseId !== null || opener.current === null) return;
    const key = opener.current;
    opener.current = null;
    [...(root.current?.querySelectorAll<HTMLElement>("[data-open-case]") ?? [])].find((button) => button.dataset.openCase === key)?.focus();
  }, [openCaseId]);
  const open = (caseId: string, rowIds: string[], key: string) => {
    opener.current = key;
    onOpenCase(caseId, rowIds);
  };
  const focusCell = (key: string) =>
    requestAnimationFrame(() => [...(root.current?.querySelectorAll<HTMLElement>("[data-cell]") ?? [])].find((button) => button.dataset.cell === key)?.focus());

  return (
    <section className="matrix-pane" aria-labelledby="matrix-title" aria-busy={shown.phase === "loading"} ref={root}>
      <h3 id="matrix-title" className="pane-title">
        Transitions between activities
      </h3>
      {shown.phase === "loading" && <p className="working-text">Counting every pair of the kept incidents…</p>}
      {shown.phase === "failed" && (
        <div className="problem" role="alert">
          <p>
            <strong>The matrix cannot be shown.</strong> {shown.message}
          </p>
          <button type="button" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </button>
        </div>
      )}
      {shown.phase === "ready" && (
        <MatrixBody answer={shown.answer} measure={measure} onMeasure={setMeasure} layout={layout} onLayout={setLayout} chosen={chosen}
          onChoose={(key) => setChosen((current) => (current === key ? null : key))} onStep={onStep} previewStep={previewStep} waitingFor={waitingFor}
          onOpen={open} onSettle={focusCell} />
      )}
    </section>
  );
}

const keyOf = (cell: MatrixCell) => JSON.stringify([cell.source_activity, cell.target_activity]);

interface MatrixBodyProps {
  answer: TransitionMatrixAnswer;
  measure: MatrixMeasure;
  onMeasure: (measure: MatrixMeasure) => void;
  layout: "matrix" | "table";
  onLayout: (layout: "matrix" | "table") => void;
  chosen: string | null;
  onChoose: (key: string) => void;
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  waitingFor?: string;
  onOpen: (caseId: string, rowIds: string[], key: string) => void;
  onSettle: (key: string) => void;
}

function MatrixBody({ answer, measure, onMeasure, layout, onLayout, chosen, onChoose, onStep, previewStep, waitingFor, onOpen, onSettle }: MatrixBodyProps) {
  const cells = new Map(answer.cells.map((cell) => [keyOf(cell), cell]));
  const selected = chosen === null ? undefined : cells.get(chosen);
  return (
    <>
      <p className="muted">
        A cell is a pair of activities whose records directly follow each other in the declared order of an incident whose order is known; records
        without an activity label between them are passed over and named as a bridge. It is neither a co-occurrence nor an indirect relation (
        <span className="identifier">{answer.relation.policy}</span>).
      </p>
      <p className="muted">
        Of the {countOf(answer.case_count, "incident")} kept, {countOf(answer.case_denominator, "incident")} {answer.case_denominator === 1 ? "has" : "have"} a
        known order.
        {answer.unevaluable_case_count > 0 &&
          ` ${countOf(answer.unevaluable_case_count, "incident")} with no known order ${answer.unevaluable_case_count === 1 ? "is" : "are"} in no cell.`}
      </p>
      <div className="matrix-controls">
        <div className="view-switch" role="group" aria-label="Measure in the cells">
          {MEASURES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={measure === value} onClick={() => onMeasure(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="view-switch" role="group" aria-label="Matrix layout">
          <button type="button" aria-pressed={layout === "matrix"} onClick={() => onLayout("matrix")}>
            Matrix
          </button>
          <button type="button" aria-pressed={layout === "table"} onClick={() => onLayout("table")}>
            Table
          </button>
        </div>
      </div>
      <p className="matrix-key">{measureKey(measure, answer)}</p>
      {answer.cells.length === 0 ? (
        <p className="working-text">
          {answer.case_denominator === 0
            ? "No kept incident has a known order, so there is no pair and no denominator."
            : "No pair: no kept incident has two labelled records one after the other."}
        </p>
      ) : layout === "matrix" ? (
        <Grid answer={answer} cells={cells} measure={measure} chosen={chosen} onChoose={onChoose} />
      ) : (
        <CellTable answer={answer} chosen={chosen} onChoose={onChoose} />
      )}
      {selected && (
        <CellPanel key={chosen} cell={selected} answer={answer} onStep={onStep} previewStep={previewStep} waitingFor={waitingFor} onOpen={onOpen}
          onSettle={() => onSettle(chosen!)} />
      )}
    </>
  );
}

function Grid({ answer, cells, measure, chosen, onChoose }: { answer: TransitionMatrixAnswer; cells: Map<string, MatrixCell>; measure: MatrixMeasure; chosen: string | null; onChoose: (key: string) => void }) {
  const rows = new Map(answer.rows.map((row) => [row.activity, row.outgoing_passage_count]));
  return (
    <div className="matrix-scroll">
      <table className="transition-matrix" aria-label="Transition matrix: each row the activity a pair leaves, each column the activity it enters">
        <thead>
          <tr>
            <th scope="col">From \ To</th>
            {answer.activities.map((activity) => (
              <th key={activity} scope="col" title={activity}>
                {activity}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {answer.activities.map((source) => (
            <tr key={source}>
              <th scope="row" title={source}>
                {source}
                <span className="muted matrix-row-count">
                  {rows.get(source) ? ` · ${whole.format(rows.get(source)!)} out` : " · no pair leaves it"}
                </span>
              </th>
              {answer.activities.map((target) => {
                const key = JSON.stringify([source, target]);
                const cell = cells.get(key);
                return (
                  <td key={target}>
                    {cell ? (
                      <button type="button" className="matrix-cell" data-cell={key} aria-pressed={chosen === key} aria-label={cellDescription(cell, answer)} onClick={() => onChoose(key)}>
                        {cellValue(cell, measure)}
                      </button>
                    ) : (
                      <>
                        <span aria-hidden="true" className="muted">
                          ·
                        </span>
                        <span className="visually-hidden">No pair from {source} to {target}</span>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellTable({ answer, chosen, onChoose }: { answer: TransitionMatrixAnswer; chosen: string | null; onChoose: (key: string) => void }) {
  return (
    <div className="matrix-scroll">
      <table className="matrix-table" aria-label="Pairs of the transition matrix">
        <thead>
          <tr>
            <th scope="col">From → To</th>
            <th scope="col">Incidents</th>
            <th scope="col">Passages</th>
            <th scope="col">Outgoing share</th>
            <th scope="col">Median lag (h)</th>
            <th scope="col">Mean lag (h)</th>
            <th scope="col">Bridged</th>
            <th scope="col">Ties</th>
          </tr>
        </thead>
        <tbody>
          {answer.cells.map((cell) => {
            const key = keyOf(cell);
            return (
              <tr key={key}>
                <th scope="row">
                  <button type="button" className="link-button" data-cell={key} aria-pressed={chosen === key} aria-label={cellDescription(cell, answer)} onClick={() => onChoose(key)}>
                    {cell.source_activity} → {cell.target_activity}
                  </button>
                </th>
                <td>{cellValue(cell, "incidents")}</td>
                <td>{cellValue(cell, "passages")}</td>
                <td>{cellValue(cell, "outgoing")}</td>
                <td>{cellValue(cell, "median")}</td>
                <td>{cellValue(cell, "mean")}</td>
                <td>{whole.format(cell.bridged_passage_count)}</td>
                <td>{whole.format(cell.tied_passage_count)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface CellPanelProps {
  cell: MatrixCell;
  answer: TransitionMatrixAnswer;
  onStep: (step: SelectionPredicate) => void;
  previewStep?: StepPreviewer;
  waitingFor?: string;
  onOpen: (caseId: string, rowIds: string[], key: string) => void;
  onSettle: () => void;
}

function CellPanel({ cell, answer, onStep, previewStep, waitingFor, onOpen, onSettle }: CellPanelProps) {
  const [pending, setPending] = useState<boolean | null>(null);
  const row = answer.rows.find((candidate) => candidate.activity === cell.source_activity);
  const pair = { kind: "directly_follows" as const, source_activity: cell.source_activity, target_activity: cell.target_activity };
  const step = (negate: boolean): SelectionPredicate => ({ ...pair, negate });
  const settle = () => {
    setPending(null);
    onSettle();
  };
  return (
    <section className="matrix-cell-panel" aria-labelledby="matrix-cell-title">
      <h4 id="matrix-cell-title">
        From {cell.source_activity} to {cell.target_activity}
      </h4>
      <dl className="pairs">
        <div>
          <dt>Incidents</dt>
          <dd>
            {countOf(cell.case_count, "incident")} of the {countOf(answer.case_denominator, "incident")} whose order is known ({percent(cell.case_share)})
          </dd>
        </div>
        <div>
          <dt>Passages</dt>
          <dd>{countOf(cell.passage_count, "passage")}; a repeat in one incident adds a passage, not an incident</dd>
        </div>
        <div>
          <dt>Outgoing share</dt>
          <dd>
            {percent(cell.outgoing_share)} of the {countOf(row?.outgoing_passage_count ?? 0, "passage")} leaving {cell.source_activity}
          </dd>
        </div>
        <div>
          <dt>Lag</dt>
          <dd>
            median {hoursText(cell.lag.median_hours)}, mean {hoursText(cell.lag.mean_hours)} over {countOf(cell.lag.usable_count, "usable lag")}
            {cell.lag.zero_count > 0 && `; ${countOf(cell.lag.zero_count, "measured zero")}`}
          </dd>
        </div>
        {cell.bridged_passage_count > 0 && (
          <div>
            <dt>Bridged</dt>
            <dd>
              {countOf(cell.bridged_passage_count, "passage")} in {countOf(cell.bridged_case_count, "incident")} pass over records without an activity label
            </dd>
          </div>
        )}
        {cell.tied_passage_count > 0 && (
          <div>
            <dt>Ties</dt>
            <dd>
              {countOf(cell.tied_passage_count, "passage")} between two records with the same time, ordered by the declared rule (sequence number, then place in the
              file)
            </dd>
          </div>
        )}
      </dl>
      {previewStep && pending === null && (
        <div className="matrix-actions">
          <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => setPending(false)}>
            Preview keeping these incidents
          </button>
          <button type="button" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={() => setPending(true)}>
            Preview removing these incidents
          </button>
        </div>
      )}
      {!previewStep && (
        <div className="matrix-actions">
          <button type="button" disabled={waitingFor !== undefined} onClick={() => onStep(step(false))}>Keep these incidents</button>
          <button type="button" disabled={waitingFor !== undefined} onClick={() => onStep(step(true))}>Remove these incidents</button>
        </div>
      )}
      {previewStep && pending !== null && (
        <div className="filter-preview" role="group" aria-label="Pair not yet applied">
          <StepPreviewLine id="matrix-cell-preview" step={step(pending)} previewer={previewStep} />
          <button type="button" className="primary" disabled={waitingFor !== undefined} aria-describedby={[waitingFor, "matrix-cell-preview"].filter(Boolean).join(" ")}
            onClick={() => { onStep(step(pending)); settle(); }}>
            Apply
          </button>
          <button type="button" onClick={settle}>Cancel</button>
        </div>
      )}
      <h5>Passages and their rows</h5>
      <ol className="matrix-witnesses" aria-label={`Passages from ${cell.source_activity} to ${cell.target_activity}`}>
        {cell.witnesses.map((witness, place) => {
          const key = `${witness.case_id}:${place}`;
          return (
            <li key={key}>
              Incident <span className="identifier">{witness.case_id}</span>: {oneDecimal.format(witness.hours)} h
              {witness.omitted_row_ids.length > 0 && `, over ${countOf(witness.omitted_row_ids.length, "record")} without an activity label`}
              {witness.tied && ", same time as the record before"}{" "}
              <button type="button" className="link-button" data-open-case={key}
                onClick={() => onOpen(witness.case_id, [witness.source_row_id, ...witness.omitted_row_ids, witness.target_row_id], key)}>
                Open incident {witness.case_id}
              </button>
            </li>
          );
        })}
      </ol>
      {cell.witnesses_truncated && <p className="muted">The first {countOf(cell.witnesses.length, "passage")} are listed; every incident is in the step.</p>}
    </section>
  );
}
