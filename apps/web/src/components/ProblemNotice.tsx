import type { Problem } from "../investigation/client";
import { describeProblem } from "../investigation/wording";

interface ProblemNoticeProps {
  title: string;
  problem: Problem;
  onRetry: () => void;
  /** The id of the text saying why trying again has to wait; while it is given, it waits. */
  waitingFor?: string;
}

/** A failed request: what happened, why if known, and a way to try again. Never an empty result. */
export function ProblemNotice({ title, problem, onRetry, waitingFor }: ProblemNoticeProps) {
  const text = describeProblem(problem);
  return (
    <div className="problem" role="alert">
      <p className="problem-title">{title}</p>
      <p>{text.message}</p>
      {text.reason && <p className="problem-reason">{text.reason}</p>}
      <button type="button" className="primary" disabled={waitingFor !== undefined} aria-describedby={waitingFor} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
