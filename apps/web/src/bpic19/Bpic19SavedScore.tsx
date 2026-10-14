import { useEffect, useRef, useState } from "react";
import { Bpic19Scoring, type Bpic19ScoringProps } from "./Bpic19Scoring";
import { localBpic19Client } from "./scoring-client";
import type { Bpic19ScoreAnswer } from "./scoring-types";

/** Reopening reads the exact immutable run; it never evaluates a new norm. */
export function Bpic19SavedScore({ savedRunId, ...props }: Bpic19ScoringProps & { savedRunId?: string }) {
  const [restored, setRestored] = useState<Bpic19ScoreAnswer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const serial = useRef(0);
  const callbacks = useRef(props); callbacks.current = props;
  const basis = JSON.stringify([props.subject, props.revision, savedRunId]);
  useEffect(() => {
    if (!savedRunId) return;
    const controller = new AbortController(), token = ++serial.current;
    setRestored(null); setProblem(null); callbacks.current.onValidityChange?.(false);
    void (props.client ?? localBpic19Client).read({ schema_version: 1, message_type: "bpic19_read_request",
      request_id: crypto.randomUUID(), query_revision: props.revision ?? token,
      workspace_id: props.subject.workspace_id, run_id: savedRunId, case_offset: 0, case_limit: 50,
      group_offset: 0, group_limit: 50 }, controller.signal).then(outcome => {
      if (controller.signal.aborted || token !== serial.current) return;
      if (!outcome.ok) { setProblem(outcome.message); return; }
      const answer = outcome.answer;
      if (JSON.stringify(answer.base_identity) !== JSON.stringify(props.subject.base_identity) ||
          JSON.stringify(answer.named_population.identity) !== JSON.stringify(props.subject.named_population.identity)) {
        setProblem("This saved assessment belongs to another population. Reopen its investigation before reading it."); return;
      }
      setRestored(answer); callbacks.current.onReviewed?.(answer);
    });
    return () => { ++serial.current; controller.abort(); };
  }, [basis, attempt, props.client]);
  if (savedRunId && !restored) return <section aria-label="Restoring purchasing assessment">
    {problem ? <><p role="alert">{problem}</p><button onClick={() => setAttempt(value => value + 1)}>Retry saved assessment</button></> : <p role="status">Reading the saved native assessment…</p>}
  </section>;
  return <Bpic19Scoring key={basis} {...props} initialRun={restored ?? undefined} />;
}
