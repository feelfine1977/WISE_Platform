import { describe, expect, it } from "vitest";
import type { ImportedSourceRecord } from "../generated/imports";
import { observationLine, orderRule } from "./ImportedInspector";

const record = (source_sequence: number | null) => ({ source_sequence }) as ImportedSourceRecord;

describe("#5 the declared order of an incident's records, in words", () => {
  it("names the sequence number, and that time decides, only where the records carry one", () => {
    expect(orderRule([record(2), record(null)])).toBe(
      "Records are in the declared order: by their usable time; records with the same time by their sequence number, then by their place in the file. Where a sequence number disagrees with the times, the time decides.",
    );
    expect(orderRule([record(null), record(null)])).toBe("Records are in the declared order: by their usable time; records with the same time by their place in the file.");
  });
});

describe("#11 how long an incident was observed", () => {
  const timed = (utc_instant: string | null, status: "usable" | "invalid" = "usable") => ({ utc_instant, local_timestamp: null, timestamp_status: status }) as unknown as ImportedSourceRecord;
  it("names the cutoff and the time from the last usable record to it, and never calls the incident complete", () => {
    expect(observationLine([timed("2026-04-01T08:00:00Z"), timed("2026-04-03T08:00:00Z"), timed(null, "invalid")], { timestamp_kind: "utc_instant", cutoff: "2026-04-10T08:00:00Z" }))
      .toBe("The export was taken at 2026-04-10 08:00:00 UTC, 7 days after the last usable time of this incident; records after the export are not in it, so this is no sign that the incident was complete.");
    expect(observationLine([timed(null, "invalid")], { timestamp_kind: "utc_instant", cutoff: "2026-04-10T08:00:00Z" })).toContain("how long it was observed is not known");
  });
});
