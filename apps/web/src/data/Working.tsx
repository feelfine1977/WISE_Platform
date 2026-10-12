import { useEffect, useState } from "react";

interface WorkingProps {
  /** What the local service is doing, in plain words. */
  label: string;
  /** When the request was sent, in milliseconds since 1970. */
  startedAt: number;
  onStop: () => void;
}

/**
 * Shows that the local service is working: a thin progress line, what it does, how long it has been
 * working, and a way to stop waiting. The page stays usable meanwhile.
 */
export function Working({ label, startedAt, onStop }: WorkingProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <div className="working">
      <div className="progress-line" aria-hidden="true" />
      <p role="status" className="working-text">
        {label}
        <span className="muted"> · working for {seconds} s</span>
      </p>
      <button type="button" onClick={onStop}>
        Stop waiting
      </button>
    </div>
  );
}
