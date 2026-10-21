import type { ReactNode, RefObject } from "react";
import { countOf, utcText, wallText } from "../data/wording";
import type { ImportedSourceRecord, ResolutionDefinition, ScoreCaseWitnessAnswer } from "../generated/scoring";
import type { WitnessState } from "./coordinator";
import { ExpectationProblem } from "./ExpectationProblem";
import { measurementText, reasonWords, valueText, verdictWords } from "./wording";

interface ExpectationWitnessProps {
  witness: Exclude<WitnessState, { phase: "closed" }>;
  definition: ResolutionDefinition;
  onReturn: () => void;
  onRetry: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

/** One scored incident: its value as the run stored it and every record, with the records of the start and the response marked. */
export function ExpectationWitness({ witness, definition, onReturn, onRetry, headingRef }: ExpectationWitnessProps) {
  return (
    <section className="expectation-witness" aria-labelledby="expectation-witness-title">
      <div className="expectation-witness-head">
        <h3 id="expectation-witness-title" tabIndex={-1} ref={headingRef}>
          Case <span className="expectation-identifier">{witness.caseId}</span>
        </h3>
        <button type="button" onClick={onReturn}>
          Return to the cases
        </button>
      </div>
      {witness.phase === "loading" && (
        <p role="status" className="expectation-status">
          Loading the records of {witness.caseId}…
        </p>
      )}
      {witness.phase === "failed" && (
        <ExpectationProblem title={`The records of ${witness.caseId} could not be shown`} problem={witness.problem} onRetry={onRetry} />
      )}
      {witness.phase === "ready" && <Witness answer={witness.answer} definition={definition} />}
    </section>
  );
}

function Witness({ answer, definition }: { answer: ScoreCaseWitnessAnswer; definition: ResolutionDefinition }) {
  const { case: verdict, trace } = answer;
  const start = definition.endpoints.activation_activity;
  const response = definition.endpoints.response_activity;
  const starts = new Set(answer.activation_candidate_row_ids);
  const responses = new Set(answer.response_candidate_row_ids);
  const traced = answer.method_trace_row_ids;
  const sameOrder = traced.length === trace.records.length && trace.records.every((record, index) => record.row_id === traced[index]);
  const facts: [string, string][] = [
    ["Value", valueText(verdict.value)],
    ["State", verdictWords(verdict)],
    ["Reason given by the library", reasonWords(verdict.reason)],
    ["Measured time", measurementText(verdict.measurement)],
    ["In scope", verdict.in_scope ? "yes" : "no"],
  ];
  return (
    <>
      <dl className="expectation-witness-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="expectation-muted">
        {sameOrder
          ? `The method library read ${traced.length === 1 ? "the one record" : `all ${countOf(traced.length, "record")}`} of this case${traced.length === 1 ? "" : ", in this order"}.`
          : `The method library read ${countOf(traced.length, "record")} of this case.`}{" "}
        {candidateLine("start", start, answer.activation_candidate_row_ids.length, verdict.measurement.activation_known)}{" "}
        {candidateLine("response", response, answer.response_candidate_row_ids.length, verdict.measurement.response_known)}
      </p>
      <ol className="expectation-records" aria-label={`Records of case ${verdict.case_id}`}>
        {trace.kind === "imported_csv"
          ? trace.records.map((record) => (
              <WitnessRecord key={record.row_id} record={record} time={<ImportedTime record={record} />} start={starts.has(record.row_id)} response={responses.has(record.row_id)} />
            ))
          : trace.records.map((record) => (
              <WitnessRecord key={record.row_id} record={record} time={utcText(record.timestamp_utc)} start={starts.has(record.row_id)} response={responses.has(record.row_id)} />
            ))}
      </ol>
    </>
  );
}

/** What the records marked for an endpoint are, and why there may be several or none. */
function candidateLine(role: "start" | "response", activity: string, count: number, known: boolean): string {
  if (!known || count === 0) {
    return role === "start"
      ? `No record is marked as the start: the case has no “${activity}”.`
      : `No record is marked as the response: the library found no “${activity}” at or after the start.`;
  }
  if (count === 1) return `One record is marked as the ${role}.`;
  return `${count} records are marked as the ${role}: they have the same activity and the same time, and each can be it.`;
}

interface WitnessRecordProps {
  record: { activity: string | null; source_position: number };
  time: ReactNode;
  start: boolean;
  response: boolean;
}

function WitnessRecord({ record, time, start, response }: WitnessRecordProps) {
  const marked = start || response;
  return (
    <li className={marked ? "expectation-record expectation-record-marked" : "expectation-record"}>
      <p className="expectation-record-activity">
        {record.activity === null ? <span className="expectation-missing">no activity label</span> : record.activity}
        {start && <span className="expectation-mark">Start</span>}
        {response && <span className="expectation-mark">Response</span>}
      </p>
      <p className="expectation-muted">
        {time} · source position {record.source_position}
      </p>
    </li>
  );
}

function ImportedTime({ record }: { record: ImportedSourceRecord }) {
  if (record.timestamp_status !== "usable") return <span className="expectation-missing">no usable time</span>;
  if (record.utc_instant !== null) return <>{utcText(record.utc_instant)}</>;
  if (record.local_timestamp !== null) return <>{wallText(record.local_timestamp)}</>;
  return <span className="expectation-missing">no usable time</span>;
}
