import { useEffect, useId, useState } from "react";
import { countOf } from "../data/wording";
import type { AnswerIdentity } from "../generated/selection";
import type { ActivityValues, StageProposalAnswer, StageProposalRequest } from "../generated/stage-proposal";
import { originOf, type StageDefinitions, withPhaseColumn, withProposed } from "./definitions";
import { httpProposalClient, type ProposalClient } from "./proposalClient";
import type { StagedReading, StageStore } from "./store";

/** How many values of an activity are listed; the records of the others are counted together. */
export const VALUES_LISTED = 10;

/** The incidents the proposal counts over, and the context columns that can be the phase column. */
export interface ProposalSource {
  workspaceId: string;
  /** The kept incidents shown: every record of each of their labelled activities is counted. */
  identity: AnswerIdentity;
  revision: number;
  columns: readonly { index: number; name: string }[];
}

type Read = { phase: "idle" } | { phase: "loading" } | { phase: "ready"; answer: StageProposalAnswer } | { phase: "failed"; message: string };

interface StageProposalProps {
  reading: StagedReading;
  store: StageStore;
  definitions: StageDefinitions;
  source: ProposalSource;
  client?: ProposalClient;
}

/** The leading value of an activity, or why there is none. */
function proposalOf(item: ActivityValues): string {
  if (item.leading !== null) return `“${item.leading.value}”, ${countOf(item.leading.record_count, "record")} of ${item.record_count.toLocaleString("en")}`;
  return item.value_count === 0 ? "None: no record has a value" : "None: values tie";
}

/**
 * Stages proposed from a context column that holds the phase of a record. The local service counts the column's values on
 * every record of each labelled activity of the kept incidents, with the records that have none; this lists them, mixed
 * values included, with the value most of an activity's records hold as its proposal. Nothing is put into a stage until
 * the analyst takes a value: one activity at a time, or every activity whose records hold one value only, at once.
 */
export function StageProposal({ reading, store, definitions, source, client = httpProposalClient }: StageProposalProps) {
  const asked = useId();
  const columnId = useId();
  const titleId = useId();
  const [column, setColumn] = useState<number | null>(definitions.phaseColumn ?? source.columns[0]?.index ?? null);
  // The column counted for the incidents shown: counted again when other incidents are kept.
  const [counted, setCounted] = useState<number | null>(null);
  const [read, setRead] = useState<Read>({ phase: "idle" });
  const [said, setSaid] = useState("");
  const identityKey = JSON.stringify(source.identity);

  useEffect(() => {
    if (counted === null) return;
    const controller = new AbortController();
    const request: StageProposalRequest = {
      schema_version: 1, message_type: "stage_proposal_request", request_id: `proposal-${asked}-${source.revision}-${counted}`, query_revision: source.revision,
      workspace_id: source.workspaceId, identity: source.identity, column_index: counted, value_limit: VALUES_LISTED,
    };
    setRead({ phase: "loading" });
    client.propose(request, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        setRead(outcome.ok ? { phase: "ready", answer: outcome.answer }
          : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The values could not be counted by the local service." });
      },
      () => !controller.signal.aborted && setRead({ phase: "failed", message: "The values could not be counted by the local service." }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, counted, source.workspaceId, source.revision, identityKey, asked]);

  if (source.columns.length === 0) {
    return (
      <section className="stages-proposal" aria-labelledby={titleId}>
        <h4 id={titleId} className="stages-title">Propose stages from a phase column</h4>
        <p className="stages-note">No context column was mapped when the source was interpreted, so there is no column to read a phase from.</p>
      </section>
    );
  }
  const nameOf = (index: number) => source.columns.find((item) => item.index === index)?.name ?? `column ${index}`;
  const count = () => {
    if (column === null) return;
    store.change(reading, (current) => withPhaseColumn(current, column));
    setCounted(column);
  };
  const take = (activity: string, value: string) => {
    if (counted === null) return;
    store.change(reading, (current) => withProposed(current, activity, counted, value));
    setSaid(`“${activity}” is in the stage “${value}”, taken from ${nameOf(counted)}.`);
  };
  const stageNow = (activity: string) => {
    const stageId = definitions.assigned.get(activity);
    const stage = definitions.stages.find((item) => item.id === stageId);
    if (!stage) return "No stage";
    const origin = originOf(definitions, activity);
    return origin.kind === "manual" ? `${stage.name}, set by hand` : `${stage.name}, from ${nameOf(origin.column)} “${origin.value}”`;
  };
  const taken = (activity: string, value: string) => {
    const origin = originOf(definitions, activity);
    return definitions.assigned.has(activity) && origin.kind === "proposed" && origin.column === counted && origin.value === value;
  };
  const answer = read.phase === "ready" ? read.answer : null;
  // One value on every record that has one: the proposal can be taken for all of these at once, the analyst having read them.
  const single = answer?.activities.filter((item) => !item.mixed && item.leading !== null && !taken(item.activity, item.leading.value)) ?? [];
  const takeSingle = () => {
    if (counted === null || single.length === 0) return;
    store.change(reading, (current) => single.reduce((next, item) => withProposed(next, item.activity, counted, item.leading!.value), current));
    setSaid(`${countOf(single.length, "activity", "activities")} put into the stage of the one value their records hold.`);
  };

  return (
    <section className="stages-proposal" aria-labelledby={titleId}>
      <h4 id={titleId} className="stages-title">Propose stages from a phase column</h4>
      <p className="stages-note">
        The values of a context column on every record of each activity of the kept incidents, not only on the first record of an incident. Nothing is put
        into a stage until you take a value; mixed values stay listed.
      </p>
      <div className="stages-add">
        <label htmlFor={columnId} className="stages-label">Phase column</label>
        <select id={columnId} className="stages-choice" value={column === null ? "" : String(column)} onChange={(event) => setColumn(Number(event.target.value))}>
          {source.columns.map((item) => <option key={item.index} value={String(item.index)}>{item.name}</option>)}
        </select>
        <button type="button" onClick={count} disabled={column === null}>Count the values</button>
      </div>
      {read.phase === "loading" && <p className="working-text">Counting the values on every record…</p>}
      {read.phase === "failed" && <p className="inline-error" role="alert">{read.message}</p>}
      {answer && (
        <>
          <p className="stages-note">
            {answer.column_name || nameOf(answer.column_index)}: counted on {countOf(answer.kept.labelled_record_count, "record")} with an activity label of the{" "}
            {countOf(answer.kept.case_count, "kept incident")}
            {answer.kept.unlabelled_record_count > 0 ? `; ${countOf(answer.kept.unlabelled_record_count, "record")} without an activity label ${answer.kept.unlabelled_record_count === 1 ? "is" : "are"} in no activity` : ""}.
          </p>
          <table className="stages-table stages-values" aria-label={`Values of ${answer.column_name || nameOf(answer.column_index)} by activity`}>
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col" className="stages-number">Records</th>
                <th scope="col">Values on its records</th>
                <th scope="col" className="stages-number">No value</th>
                <th scope="col">Proposal</th>
                <th scope="col">Stage now</th>
                <th scope="col">Take a value</th>
              </tr>
            </thead>
            <tbody>
              {answer.activities.map((item) => (
                <tr key={item.activity} data-mixed={item.mixed || undefined}>
                  <th scope="row">{item.activity}</th>
                  <td className="stages-number">{item.record_count.toLocaleString("en")}</td>
                  <td>
                    {item.mixed && <span className="stages-mixed">Mixed: </span>}
                    {item.values.map((value) => `“${value.value}” ${value.record_count.toLocaleString("en")}`).join(" · ") || "No value"}
                    {item.values_truncated && ` · ${countOf(item.other_record_count, "record")} with ${item.value_count - item.values.length} other values`}
                  </td>
                  <td className="stages-number">{item.missing_record_count.toLocaleString("en")}</td>
                  <td>{proposalOf(item)}</td>
                  <td className="stages-origin">{stageNow(item.activity)}</td>
                  <td className="stages-take">
                    {item.values.map((value) => (
                      <button key={value.value} type="button" aria-label={`Put “${item.activity}” in the stage “${value.value}”`}
                        aria-pressed={taken(item.activity, value.value)} onClick={() => take(item.activity, value.value)}>
                        {value.value}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <button type="button" disabled={single.length === 0} onClick={takeSingle}>
              Take the proposal for {countOf(single.length, "activity", "activities")} whose records hold one value
            </button>{" "}
            <span className="stages-note">Mixed activities and those without a value are left for you to decide.</span>
          </p>
        </>
      )}
      <p role="status" className="stages-said">{said}</p>
    </section>
  );
}
