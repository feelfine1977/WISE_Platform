import Ajv2020 from "ajv/dist/2020.js";
import healthSchema from "../../../contracts/health.schema.json";
import type { HealthResponse } from "./generated/health";

const validate = new Ajv2020({ allErrors: true }).compile<HealthResponse>(healthSchema);

export async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/health", { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`The local service returned HTTP ${response.status}.`);
  const body: unknown = await response.json();
  if (!validate(body)) throw new Error("The local service returned an unsupported health response.");
  return body;
}
