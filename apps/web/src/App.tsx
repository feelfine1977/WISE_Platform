import { useEffect, useState } from "react";
import { fetchHealth } from "./api";
import type { HealthResponse } from "./generated/health";

type Connection =
  | { state: "checking" }
  | { state: "ready"; health: HealthResponse }
  | { state: "unavailable"; message: string };

export default function App() {
  const [connection, setConnection] = useState<Connection>({ state: "checking" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setConnection({ state: "checking" });
    fetchHealth(controller.signal).then(
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
  }, [revision]);

  return (
    <main className="workspace">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">W</span>
        <div><p className="eyebrow">Local process analysis</p><h1>WISE Platform</h1></div>
      </header>
      <section className="introduction" aria-labelledby="foundation-title">
        <p className="stage">Foundation</p>
        <h2 id="foundation-title">A clean home for your investigations</h2>
        <p>The local application host and browser connection are the first foundation. Event-log analysis is being built next.</p>
      </section>
      <section className="connection panel" aria-labelledby="connection-title">
        <div><h3 id="connection-title">Local service</h3>
          <div role="status" aria-live="polite">
            {connection.state === "checking" && <p>Checking the connection…</p>}
            {connection.state === "ready" && <><p className="success">Connected to this computer</p><p className="detail">Version {connection.health.version} · {connection.health.stage}</p></>}
            {connection.state === "unavailable" && <><p className="failure">Connection unavailable</p><p className="detail">{connection.message} Check that the Python application is running, then retry.</p></>}
          </div>
        </div>
        <button type="button" disabled={connection.state === "checking"} onClick={() => setRevision((value) => value + 1)}>Check connection</button>
      </section>
      <section className="panel" aria-labelledby="next-title">
        <h3 id="next-title">What comes next</h3>
        <p>This foundation does not yet import CSVs, show process maps or charts, calculate WISE scores, or save investigations.</p>
        <ol className="journey">
          <li><strong>Data</strong><span>Import locally and review the event-log interpretation.</span></li>
          <li><strong>Investigations</strong><span>Explore linked views, compare groups and inspect complete histories.</span></li>
          <li><strong>Expectations</strong><span>Add reviewed local targets and scoring when useful.</span></li>
        </ol>
      </section>
      <footer>No event log has been loaded. This page checks only the local foundation service.</footer>
    </main>
  );
}
