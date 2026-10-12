import type { Problem } from "../investigation/client";
import { describeProblem } from "../investigation/wording";

interface ProblemNoticeProps {
  title: string;
  problem: Problem;
  onRetry: () => void;
}

/** A failed request: what happened, why if known, and a way to try again. Never an empty result. */
export function ProblemNotice({ title, problem, onRetry }: ProblemNoticeProps) {
  const text = describeProblem(problem);
  return (
    <div className="problem" role="alert">
      <p className="problem-title">{title}</p>
      <p>{text.message}</p>
      {text.reason && <p className="problem-reason">{text.reason}</p>}
      <button type="button" className="primary" onClick={onRetry}>Try again</button>
    </div>
  );
}
