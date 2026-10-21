import { useEffect, useId, useState } from "react";
import { countOf } from "../data/wording";
import type { AnswerIdentity, SelectionPredicate } from "../generated/selection";
import type { SimilarSequencesAnswer } from "../generated/similar-sequences";
import { httpSimilarClient, type SimilarClient } from "./client";

const EDITS = [1, 2, 3] as const;

interface SimilarSequencesProps {
  workspaceId: string;
  identity: AnswerIdentity;
  revision: number;
  /** The chosen sequence, and how it is named. */
  anchor: readonly string[];
  anchorName: string;
  onStep: (step: SelectionPredicate) => void;
  onOpenCase: (caseId: string) => void;
  waitingFor?: string;
  client?: SimilarClient;
}

type Read = { phase: "loading" } | { phase: "ready"; answer: SimilarSequencesAnswer } | { phase: "failed"; message: string };

/**
 * Incidents whose sequence of labelled activities is within one, two or three edits of a chosen sequence, as suggestions
 * to review: families of exactly equal sequences of the frozen parent, nearest first, each with its distance, its support
 * in the parent and among the kept incidents, and a representative history. The method is stated and fixed before
 * anything is filtered; nothing is applied until a suggestion is kept, as a step of its incidents' identifiers.
 */
export function SimilarSequences({ workspaceId, identity, revision, anchor, anchorName, onStep, onOpenCase, waitingFor, client = httpSimilarClient }: SimilarSequencesProps) {
  const asked = useId();
  const [edits, setEdits] = useState<(typeof EDITS)[number]>(1);
  const [read, setRead] = useState<Read>({ phase: "loading" });
  const anchorKey = JSON.stringify(anchor);
  const identityKey = JSON.stringify(identity);
  useEffect(() => {
    const controller = new AbortController();
    setRead({ phase: "loading" });
    client.similar({ schema_version: 1, message_type: "similar_sequences_request", request_id: `similar-${asked}-${revision}-${edits}`, query_revision: revision,
      workspace_id: workspaceId, identity, anchor: [...anchor] as [string, ...string[]], maximum_edits: edits }, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        setRead(outcome.ok ? { phase: "ready", answer: outcome.answer }
          : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The similar sequences could not be read from the local service." });
      },
      () => !controller.signal.aborted && setRead({ phase: "failed", message: "The similar sequences could not be read from the local service." }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceId, revision, identityKey, anchorKey, edits, asked]);
  const answer = read.phase === "ready" ? read.answer : null;
  const keep = (caseIds: readonly string[]) => caseIds.length > 0 && onStep({ kind: "case_id_in", case_ids: [...caseIds] as [string, ...string[]], negate: false });
  const allKept = answer?.families.flatMap((family) => family.kept_case_ids) ?? [];

  return (
    <section className="similar-sequences" aria-labelledby={`${asked}-title`}>
      <h4 id={`${asked}-title`} className="view-title">Cases with a sequence similar to {anchorName}</h4>
      <p className="muted view-hint">
        Measure: the edit distance between two sequences of labelled activities, the least number of activities to insert, remove or replace to turn
        one into the other. It is applied to every case of the parent and does not change with the kept cases; only their counts follow the
        selection. A suggestion is applied only when you keep it.
      </p>
      <div className="similar-edits" role="radiogroup" aria-label="Edits allowed">
        {EDITS.map((value) => (
          <label key={value}><input type="radio" name={`${asked}-edits`} checked={edits === value} onChange={() => setEdits(value)} /> At most {countOf(value, "edit")}</label>
        ))}
      </div>
      {read.phase === "loading" && <p className="working-text">Comparing the sequences of the parent…</p>}
      {read.phase === "failed" && <p className="inline-error" role="alert">{read.message}</p>}
      {answer && (
        <>
          <p className="similar-support">
            {countOf(answer.family_count, "family", "families")} of exactly equal sequences within {countOf(answer.maximum_edits, "edit")}:{" "}
            {countOf(answer.suggested_parent_case_count, "case")} of the {answer.parent.eligible_case_count.toLocaleString("en")} eligible cases of the parent,{" "}
            {countOf(answer.suggested_kept_case_count, "kept case")} of {answer.kept_case_count.toLocaleString("en")}.
            {answer.parent.unevaluable_case_count > 0 && ` ${countOf(answer.parent.unevaluable_case_count, "case")} of the parent ${answer.parent.unevaluable_case_count === 1 ? "is" : "are"} not eligible: the order of the records is not known, or there is no labelled activity.`}
          </p>
          <ol className="similar-families" aria-label="Suggested families, nearest first">
            {answer.families.map((family) => (
              <li key={family.activities.join("\u0000")}>
                <p className="similar-family-head">
                  <span>{family.distance === 0 ? "The chosen sequence itself" : `${countOf(family.distance, "edit")} away`}</span>
                  {" · "}{countOf(family.parent_case_count, "case")} of the parent, {family.kept_case_ids.length.toLocaleString("en")} kept
                </p>
                <p className="similar-sequence">{family.activities.join(" → ")}</p>
                <p>
                  <button type="button" className="link-button" onClick={() => onOpenCase(family.exemplars[0])}>Open {family.exemplars[0]}, a complete history of this family</button>{" "}
                  <button type="button" disabled={waitingFor !== undefined || family.kept_case_ids.length === 0} aria-describedby={waitingFor} onClick={() => keep(family.kept_case_ids)}>
                    Keep this family's {countOf(family.kept_case_ids.length, "kept case")}
                  </button>
                </p>
              </li>
            ))}
          </ol>
          <p>
            <button type="button" className="primary" disabled={waitingFor !== undefined || allKept.length === 0} aria-describedby={waitingFor} onClick={() => keep(allKept)}>
              Keep the {countOf(allKept.length, "kept case")} suggested
            </button>
          </p>
          <p className="limitation">
            A suggestion follows the number of edits allowed: one more edit can add whole families. The distance reads only the order of the activities, not
            their times, and counts every repeated activity. A family is not a business class, a cause or a prediction.
          </p>
        </>
      )}
    </section>
  );
}
