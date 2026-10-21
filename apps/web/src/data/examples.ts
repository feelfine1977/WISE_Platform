import type { ExampleId } from "../generated/investigation";
import type { Draft } from "./interpretation";

/** A packaged synthetic example as the Data area offers it for a workspace. */
export interface WorkspaceExample {
  id: ExampleId;
  label: string;
  /** The name under which its bytes are stored in the workspace. */
  filename: string;
}

export const workspaceExamples: readonly WorkspaceExample[] = [
  { id: "S0", label: "Synthetic example S0: fictional IT cases", filename: "Synthetic example S0.csv" },
  { id: "S1", label: "Synthetic example S1: fictional IT cases, one reopened", filename: "Synthetic example S1.csv" },
  {
    id: "S2",
    label: "Synthetic example S2: fictional IT cases with missing activity labels and equal timestamps",
    filename: "Synthetic example S2.csv",
  },
  { id: "S3", label: "Synthetic example S3: a literal Unknown assignment group beside a missing one", filename: "Synthetic example S3.csv" },
];

/** The header every packaged example has; the fixed reading names its columns by these positions. */
export const exampleColumns: readonly string[] = [
  "incident_id",
  "source_event_id",
  "source_sequence",
  "activity",
  "timestamp_utc",
  "service",
  "assignment_group",
];

/**
 * How every packaged example is read. Its times carry their UTC mark, and the examples declare
 * one snapshot cutoff, 2 October 2026 00:00 UTC, the same as when they are explored without a workspace.
 */
export const exampleReading: Draft = {
  encoding: "utf-8",
  delimiter: ",",
  caseColumn: 0,
  activityColumn: 3,
  timestampColumn: 4,
  sequenceColumn: 2,
  contextColumns: [5, 6],
  documentColumn: null,
  numericColumns: [],
  timeFormat: "iso8601",
  zone: "from_values",
  offsetMinutes: 0,
  cutoff: "2026-10-02T00:00:00",
  cutoffEdited: true,
  rowRule: "tolerant",
};
