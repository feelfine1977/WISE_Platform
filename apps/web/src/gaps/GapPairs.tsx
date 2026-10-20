import { useEffect, useId, useState } from "react";
import { countOf } from "../data/wording";
import type { GapFigures, GapPairsAnswer, GapPairsRequest } from "../generated/gap-pairs";
import type { AnswerIdentity } from "../generated/selection";
import { type GapsClient, httpGapsClient } from "./client";
import "./gaps.css";

type Relation = GapPairsRequest["relation"];
type Read = { phase: "loading" } | { phase: "ready"; answer: GapPairsAnswer } | { phase: "failed"; message: string };

/** The order of the kept incidents a chosen pair gives the incident table: a view, never a step. */
export interface GapOrder {
  id: string;
  label: string;
  caseIds: readonly string[];
  ordered: true;
  note: string;
}

interface GapPairsProps {
  workspaceId: string;
  revision: number;
  /** The kept incidents: their gaps are said against the parent's. */
  identity: AnswerIdentity;
  /** Orders the incident table by the chosen pair's longest gap; null lets the order go. */
  onOrder: (order: GapOrder | null) => void;
  /** The id of the order the table shows now, if it is one of these pairs'. */
  ordered: string | null;
  client?: GapsClient;
}

/** An activity of a pair as the list writes it; a record without a label is an endpoint of its own. */
export const endpoint = (activity: string | null) => activity ?? "(no activity label)";
const pairName = (from: string | null, to: string | null) => `${endpoint(from)} → ${endpoint(to)}`;
const hoursText = (value: number | null) => (value === null ? "–" : new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value));
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

/** The relations a gap is read under, in words. */
const RELATIONS: Record<Relation, string> = {
  raw_adjacent: "Between adjacent records",
  mapped_path: "Along the map's paths",
};

/**
 * The pairs of activities that carry the longest recorded gaps among the kept incidents, against the fixed parent: each
 * pair's incidents and their share of the incidents whose order is known, its passages, its median and 90th percentile
 * in hours, and its passages longer than the analyst's threshold, as the local service supplies them under its stated
 * weighting and quantile policies. Choosing a pair orders the incident table by its longest gap and takes no step.
 */
export function GapPairs({ workspaceId, revision, identity, onOrder, ordered, client = httpGapsClient }: GapPairsProps) {
  const asked = useId();
  const [relation, setRelation] = useState<Relation>("raw_adjacent");
  const [typed, setTyped] = useState("24");
  const [threshold, setThreshold] = useState(24);
  const [read, setRead] = useState<Read>({ phase: "loading" });
  const [choosing, setChoosing] = useState<string | null>(null);
  const identityKey = JSON.stringify(identity);

  const request = (chosen: GapPairsRequest["chosen"]): GapPairsRequest => ({
    schema_version: 1, message_type: "gap_pairs_request", request_id: `gaps-${asked}-${revision}-${relation}-${threshold}${chosen ? "-chosen" : ""}`, query_revision: revision,
    workspace_id: workspaceId, identity, relation, threshold_hours: threshold, limit: 50, chosen, case_limit: 1000,
  });

  useEffect(() => {
    const controller = new AbortController();
    setRead({ phase: "loading" });
    client.gaps(request(null), controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        setRead(outcome.ok ? { phase: "ready", answer: outcome.answer }
          : { phase: "failed", message: outcome.problem.kind === "refusal" ? outcome.problem.refusal.message : "The gaps could not be read from the local service." });
      },
      () => !controller.signal.aborted && setRead({ phase: "failed", message: "The gaps could not be read from the local service." }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceId, revision, identityKey, relation, threshold, asked]);

  async function choose(from: string | null, to: string | null) {
    const id = `gap-${relation}-${JSON.stringify([from, to])}`;
    if (ordered === id) {
      onOrder(null);
      return;
    }
    setChoosing(id);
    const outcome = await client.gaps(request({ from_activity: from, to_activity: to }), new AbortController().signal);
    setChoosing(null);
    if (!outcome.ok || outcome.answer.chosen === null) return;
    const chosen = outcome.answer.chosen;
    onOrder({
      id, label: pairName(from, to), ordered: true, caseIds: chosen.cases.map((item) => item.case_id),
      note: `The table lists the ${countOf(chosen.case_count, "kept incident")} with a gap ${pairName(from, to)}, the longest of their gaps first. This is an order of the list: the selection and every count stay as they are until a step is taken.`,
    });
  }

  const answer = read.phase === "ready" ? read.answer : null;
  const figures = (side: GapFigures) => (
    <>
      <td className="number">
        {side.incident_count.toLocaleString("en")}
        {side.incident_share !== null && <span className="muted"> · {percent.format(side.incident_share)}</span>}
      </td>
      <td className="number">{side.passage_count.toLocaleString("en")}</td>
      <td className="number">{hoursText(side.median_hours)}</td>
      <td className="number">{hoursText(side.p90_hours)}</td>
    </>
  );

  return (
    <section className="gap-pairs" aria-labelledby={`${asked}-title`}>
      <h3 id={`${asked}-title`} className="view-title">Longest recorded gaps</h3>
      <p className="muted">
        A gap is the recorded time from one record to the next. It is not a working or a waiting time: what happened in between is not recorded.
      </p>
      <div className="gap-pairs-choices">
        <div role="group" aria-label="Gaps between">
          {(Object.keys(RELATIONS) as Relation[]).map((key) => (
            <button key={key} type="button" aria-pressed={relation === key} onClick={() => { setRelation(key); onOrder(null); }}>
              {RELATIONS[key]}
            </button>
          ))}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); const value = Number(typed); if (typed.trim() !== "" && Number.isFinite(value) && value >= 0) setThreshold(value); }}>
          <label>
            Longer than (hours)
            <input type="number" min="0" step="any" value={typed} onChange={(event) => setTyped(event.target.value)} />
          </label>
          <button type="submit">Count</button>
        </form>
      </div>
      {read.phase === "loading" && <p className="working-text">Reading the gaps…</p>}
      {read.phase === "failed" && <p className="inline-error" role="alert">{read.message}</p>}
      {answer && (
        <>
          <p className="muted gap-pairs-basis">
            Over the {countOf(answer.kept.evaluable_case_count, "kept incident")} whose order of records is known, against {countOf(answer.parent.evaluable_case_count, "incident")}{" "}
            of the parent; each passage of a pair counts once, an incident passing it twice twice. The median is the middle passage, or the midpoint of the two
            middle ones; the 90th percentile is the passage at the nearest rank. {relation === "raw_adjacent"
              ? "A record without an activity label is an endpoint of its own."
              : "A record without an activity label is passed over, as on the map's paths."}
          </p>
          {(answer.kept.order_unknown_case_count > 0 || answer.parent.order_unknown_case_count > 0) && (
            <p className="limitation">
              {countOf(answer.kept.order_unknown_case_count, "kept incident")} (parent {answer.parent.order_unknown_case_count.toLocaleString("en")}) whose order of records is
              not known {answer.kept.order_unknown_case_count === 1 ? "has" : "have"} no gaps and {answer.kept.order_unknown_case_count === 1 ? "is" : "are"} not in these figures.
            </p>
          )}
          {answer.pairs.length === 0 ? (
            <p className="working-text">The kept incidents have no gap between two records.</p>
          ) : (
            <div className="gap-pairs-scroll">
              <table className="gap-pairs-table" aria-label="Pairs with their recorded gaps, the longest 90th percentile first">
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2}>Pair</th>
                    <th scope="colgroup" colSpan={5}>Kept incidents</th>
                    <th scope="colgroup" colSpan={4}>Parent</th>
                  </tr>
                  <tr>
                    <th scope="col" className="number">Incidents · share</th>
                    <th scope="col" className="number">Passages</th>
                    <th scope="col" className="number">Median (h)</th>
                    <th scope="col" className="number">90th percentile (h)</th>
                    <th scope="col" className="number">Passages longer than {hoursText(answer.threshold_hours)} h</th>
                    <th scope="col" className="number">Incidents · share</th>
                    <th scope="col" className="number">Passages</th>
                    <th scope="col" className="number">Median (h)</th>
                    <th scope="col" className="number">90th percentile (h)</th>
                  </tr>
                </thead>
                <tbody>
                  {answer.pairs.map((pair) => {
                    const id = `gap-${relation}-${JSON.stringify([pair.from_activity, pair.to_activity])}`;
                    return (
                      <tr key={id} className={ordered === id ? "selected" : undefined}>
                        <th scope="row">
                          <button type="button" aria-pressed={ordered === id} disabled={choosing !== null} title="Order the incident list by this pair's longest gap"
                            onClick={() => void choose(pair.from_activity, pair.to_activity)}>
                            {pairName(pair.from_activity, pair.to_activity)}
                          </button>
                        </th>
                        {figures(pair.kept)}
                        <td className="number">
                          {pair.kept.above_threshold_passage_count.toLocaleString("en")}
                          <span className="muted"> in {pair.kept.above_threshold_incident_count.toLocaleString("en")}</span>
                        </td>
                        {figures(pair.parent)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {answer.pairs_truncated && <p className="muted">The first {answer.pairs.length} of {answer.pair_count.toLocaleString("en")} pairs.</p>}
        </>
      )}
    </section>
  );
}
