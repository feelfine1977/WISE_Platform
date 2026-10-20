import { useEffect, useState } from "react";
import { fetchHealth } from "../api";
import type { HealthResponse } from "../generated/health";

/**
 * The first supported capacity tier, as tools/qualify_incident_capacity.py measured the incident journey on a named
 * machine and docs/capacity.md records it. A measurement, not a promise for other machines or larger files.
 */
export const MEASURED_TIER = {
  incidents: 50_000,
  records: 394_433,
  contextColumns: 3,
  machine: "an Apple M1 Max with 64 GB and Python 3.13",
  slowestStepSeconds: 6,
  peakGigabytes: 0.7,
} as const;

const gib = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toLocaleString("en", { maximumFractionDigits: 1 })} GiB` : `${Math.round(bytes / 1024 ** 2).toLocaleString("en")} MiB`;

/**
 * What the Data area says about how large a file can be: the tier measured, that larger files are not measured, the
 * memory budget of the service shown, which refuses work that would not fit before it starts, and that every figure is
 * exact.
 */
export function CapacityNote({ checkHealth = fetchHealth }: { checkHealth?: (signal: AbortSignal) => Promise<HealthResponse> }) {
  const [budget, setBudget] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    checkHealth(controller.signal).then((health) => setBudget(health.memory_budget_bytes ?? null), () => undefined);
    return () => controller.abort();
  }, [checkHealth]);
  const tier = MEASURED_TIER;
  return (
    <p className="muted capacity-note">
      Measured: the incident journey with up to {tier.incidents.toLocaleString("en")} incidents and {tier.records.toLocaleString("en")} records with{" "}
      {tier.contextColumns} context columns, on {tier.machine}: each step within {tier.slowestStepSeconds} seconds and at most {tier.peakGigabytes} GB of
      memory. Larger files are not measured. Work that would not fit the memory this service may use{budget === null ? "" : `, ${gib(budget)}`}, is refused
      before it starts, with what to do. Every figure is exact: nothing is sampled.
    </p>
  );
}
