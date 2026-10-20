import { useEffect, useRef, useState } from "react";
import { countOf, describeImportProblem } from "../data/wording";
import type { ImportedCaseEvidenceAnswer } from "../generated/imports";
import type { Pin, PinEvidence } from "../imported/coordinator";
import { contextAtFirst, historyMarks, originLine, recordTime, ROLE_NAMES, shortPopulation } from "./pins";

interface PairedHistoriesProps {
  pins: [Pin, Pin];
  /** Asks for a pinned history in exactly the population it was pinned in. */
  evidence: (pinId: number, signal: AbortSignal) => Promise<PinEvidence>;
  /** The selection shown now, to say when a pin was made under other steps. */
  currentPopulationId: string | null;
  onReturn: () => void;
}

/** A history while it is asked for (null), then its evidence or the refusal. */
type Loaded = PinEvidence | null;

/**
 * Two pinned histories beside each other, each with every original record in the declared order, its source position and
 * row identifier, and what to notice at it; then the context at the first record of each, read as it is. The two were
 * chosen by the analyst: nothing is matched, scored or concluded. A history that cannot be read says why; the other stays.
 */
export function PairedHistories({ pins, evidence, currentPopulationId, onReturn }: PairedHistoriesProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [loaded, setLoaded] = useState<[Loaded, Loaded]>([null, null]);
  const [attempt, setAttempt] = useState(0);
  const key = `${pins[0].id}-${pins[1].id}-${attempt}`;
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded([null, null]);
    pins.forEach((pin, side) =>
      evidence(pin.id, controller.signal).then((outcome) => {
        if (!controller.signal.aborted) setLoaded((current) => (side === 0 ? [outcome, current[1]] : [current[0], outcome]));
      }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [left, right] = loaded;
  return (
    <section className="paired-histories" aria-labelledby="paired-title" onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      // The question behind keeps its own Escape for the incident open beside it.
      event.preventDefault();
      onReturn();
    }}>
      <div className="paired-head">
        <h3 id="paired-title" className="pane-title" tabIndex={-1} ref={heading}>
          Two pinned histories
        </h3>
        <button type="button" onClick={onReturn}>
          Return to the question
        </button>
      </div>
      <p className="muted">
        You chose these two incidents and their roles; WISE does not match, score or explain them. Each is read in the population it was pinned in.
        Reading them changes no step. Escape returns to the question.
      </p>
      <div className="paired-sides">
        {pins.map((pin, side) => (
          <PairedSide key={pin.id} pin={pin} loaded={loaded[side]} stale={currentPopulationId !== null && pin.question.populationId !== currentPopulationId}
            onRetry={() => setAttempt((count) => count + 1)} />
        ))}
      </div>
      {left?.ok && right?.ok && (
        <ContextOfBoth pins={pins} left={left.answer} right={right.answer} />
      )}
    </section>
  );
}

function PairedSide({ pin, loaded, stale, onRetry }: { pin: Pin; loaded: Loaded; stale: boolean; onRetry: () => void }) {
  const title = `paired-${pin.id}-title`;
  return (
    <section className="paired-side" aria-labelledby={title} data-role={pin.role}>
      <h4 id={title}>
        {ROLE_NAMES[pin.role]} · Incident <span className="identifier">{pin.caseId}</span>
      </h4>
      {pin.label !== `Incident ${pin.caseId}` && <p className="pin-label">{pin.label}</p>}
      <p className="muted">{originLine(pin)}</p>
      <p className="muted">
        Population {shortPopulation(pin.identity.population_id)} · preparation {shortPopulation(pin.identity.preparation_id)}
      </p>
      {stale && <p className="order-note">Pinned under other steps than those shown now; it is read in the population it was pinned in.</p>}
      <PinNotes pin={pin} />
      {loaded === null ? (
        <p className="working-text">Reading every record of incident {pin.caseId}…</p>
      ) : !loaded.ok ? (
        <div className="problem" role="alert">
          <p>
            <strong>The history of incident {pin.caseId} cannot be read in the population it was pinned in.</strong> {describeImportProblem(loaded.problem).message}
          </p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <Records answer={loaded.answer} />
      )}
    </section>
  );
}

function PinNotes({ pin }: { pin: Pin }) {
  const notes = [["Observation", pin.observation], ["Limitation", pin.limitation], ["Next check", pin.nextCheck]].filter(([, text]) => text !== "");
  if (notes.length === 0) return null;
  return (
    <dl className="pin-notes">
      {notes.map(([name, text]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Records({ answer }: { answer: ImportedCaseEvidenceAnswer }) {
  const marks = historyMarks(answer);
  const names = new Map(answer.columns.map((column) => [column.index, column.name === "" ? `Column ${column.index}` : column.name]));
  const contextColumns = answer.records[0].context.map((value) => value.column_index);
  return (
    <div className="paired-records">
      <table>
        <caption>
          All {countOf(answer.records.length, "record")} of incident {answer.case_id} in the declared order
          {answer.sequence_evaluable ? "" : "; the order is not fully known"}
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Source position</th>
            <th scope="col">Row</th>
            <th scope="col">Time</th>
            <th scope="col">Activity</th>
            {contextColumns.map((index) => (
              <th key={index} scope="col">
                {names.get(index) ?? `Column ${index}`}
              </th>
            ))}
            <th scope="col">To notice</th>
          </tr>
        </thead>
        <tbody>
          {answer.records.map((record, place) => (
            <tr key={record.row_id}>
              <td>{place + 1}</td>
              <td>{record.source_position}</td>
              <td className="identifier">{record.row_id}</td>
              <td>{recordTime(record)}</td>
              <td>{record.activity ?? <span className="missing-text">no activity label</span>}</td>
              {contextColumns.map((index) => {
                const value = record.context.find((candidate) => candidate.column_index === index)?.value ?? null;
                return <td key={index}>{value ?? <span className="missing-text">missing</span>}</td>;
              })}
              <td>{marks[place].join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContextOfBoth({ pins, left, right }: { pins: [Pin, Pin]; left: ImportedCaseEvidenceAnswer; right: ImportedCaseEvidenceAnswer }) {
  const rows = contextAtFirst(left, right);
  if (rows.length === 0) return <p className="muted">No context column is mapped, so there is no context to read beside each other.</p>;
  return (
    <section className="paired-context" aria-labelledby="paired-context-title">
      <h4 id="paired-context-title">Context at the first record of each</h4>
      <p className="muted">
        Read as recorded: a value that is not recorded stays missing, and no other incident is looked for to match either one.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Column</th>
            <th scope="col">
              {ROLE_NAMES[pins[0].role]} · {pins[0].caseId}
            </th>
            <th scope="col">
              {ROLE_NAMES[pins[1].role]} · {pins[1].caseId}
            </th>
            <th scope="col">Reading</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.index}>
              <th scope="row">{row.name}</th>
              <td>{row.left ?? <span className="missing-text">not recorded</span>}</td>
              <td>{row.right ?? <span className="missing-text">not recorded</span>}</td>
              <td>{row.reading}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
