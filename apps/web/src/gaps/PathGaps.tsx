import { useEffect, useId, useState } from "react";
import type { GapPairsAnswer } from "../generated/gap-pairs";
import type { AnswerIdentity } from "../generated/selection";
import type { GapsClient } from "./client";
import "./gaps.css";

interface PathGapsProps {
  workspaceId: string;
  revision: number;
  identity: AnswerIdentity;
  source: string;
  target: string;
  client: GapsClient;
}

type Read = { phase: "loading" } | { phase: "ready"; figures: GapPairsAnswer["pairs"][number]["kept"] | null } | { phase: "failed" };
const hours = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/**
 * On the card of a selected path of the map: the 90th percentile of its lag over its passages, and how many of its
 * passages are longer than a threshold the analyst sets, as the local service supplies them along the map's paths.
 */
export function PathGaps({ workspaceId, revision, identity, source, target, client }: PathGapsProps) {
  const asked = useId();
  const [typed, setTyped] = useState("24");
  const [threshold, setThreshold] = useState(24);
  const [read, setRead] = useState<Read>({ phase: "loading" });
  const identityKey = JSON.stringify(identity);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ phase: "loading" });
    client.gaps({
      schema_version: 1, message_type: "gap_pairs_request", request_id: `path-gaps-${asked}-${revision}-${threshold}`, query_revision: revision, workspace_id: workspaceId,
      identity, relation: "mapped_path", threshold_hours: threshold, limit: 1, chosen: { from_activity: source, to_activity: target }, case_limit: 1,
    }, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        if (!outcome.ok) return setRead({ phase: "failed" });
        if (outcome.answer.chosen === null) return setRead({ phase: "failed" });
        setRead({ phase: "ready", figures: outcome.answer.chosen.kept });
      },
      () => !controller.signal.aborted && setRead({ phase: "failed" }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceId, revision, identityKey, source, target, threshold, asked]);

  return (
    <div className="path-gaps" aria-label="Long lags of this path" role="group">
      {read.phase === "loading" && <p className="working-text">Reading the lags of this path…</p>}
      {read.phase === "failed" && <p className="muted">The long lags of this path could not be read.</p>}
      {read.phase === "ready" && (
        read.figures === null || read.figures.p90_hours === null ? (
          <p className="muted">No kept case passes this path in a known order, so it has no lag to rank.</p>
        ) : (
          <p>
            90th percentile lag <strong>{hours.format(read.figures.p90_hours)} h</strong> over {read.figures.passage_count.toLocaleString("en")} passages;{" "}
            {read.figures.above_threshold_passage_count.toLocaleString("en")} {read.figures.above_threshold_passage_count === 1 ? "passage is" : "passages are"} longer than{" "}
            {hours.format(threshold)} h, in {read.figures.above_threshold_incident_count.toLocaleString("en")} {read.figures.above_threshold_incident_count === 1 ? "case" : "cases"}.
            <span className="muted"> A recorded gap, not a working or waiting time.</span>
          </p>
        )
      )}
      <form onSubmit={(event) => { event.preventDefault(); const value = Number(typed); if (typed.trim() !== "" && Number.isFinite(value) && value >= 0) setThreshold(value); }}>
        <label>
          Count passages longer than (hours)
          <input type="number" min="0" step="any" value={typed} onChange={(event) => setTyped(event.target.value)} />
        </label>
        <button type="submit">Count</button>
      </form>
    </div>
  );
}
