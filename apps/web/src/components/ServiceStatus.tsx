import { useEffect, useState } from "react";
import type { HealthResponse } from "../generated/health";

type Connection =
  | { state: "checking" }
  | { state: "ready"; health: HealthResponse }
  | { state: "unavailable"; message: string };

/** A small indicator of the local foundation service; it says nothing about analytical answers. */
interface ServiceStatusProps {
  checkHealth: (signal: AbortSignal) => Promise<HealthResponse>;
}

export function ServiceStatus({ checkHealth }: ServiceStatusProps) {
  const [connection, setConnection] = useState<Connection>({ state: "checking" });
  const [check, setCheck] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setConnection({ state: "checking" });
    checkHealth(controller.signal).then(
      (health) => {
        if (!controller.signal.aborted) setConnection({ state: "ready", health });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setConnection({ state: "unavailable", message: error instanceof Error ? error.message : "The local service is unavailable." });
        }
      },
    );
    return () => controller.abort();
  }, [check, checkHealth]);

  const summary = connection.state === "ready" ? "Connected" : connection.state === "checking" ? "Checking" : "Unavailable";
  return (
    <details className="service">
      <summary>
        <span className={`service-dot service-${connection.state}`} aria-hidden="true" />
        Local service: <span role="status">{summary}</span>
      </summary>
      <div className="service-body">
        {connection.state === "checking" && <p>Checking the connection to this computer…</p>}
        {connection.state === "ready" && (
          <p>
            Connected to this computer. Version {connection.health.version}, {connection.health.stage}.
          </p>
        )}
        {connection.state === "unavailable" && (
          <p>
            {connection.message} Check that the Python application is running, then check again.
          </p>
        )}
        <p className="muted">This checks only that the local service runs; it does not check any answer.</p>
        <button type="button" disabled={connection.state === "checking"} onClick={() => setCheck((value) => value + 1)}>
          Check again
        </button>
      </div>
    </details>
  );
}
