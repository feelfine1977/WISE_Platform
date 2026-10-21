import { describe, expect, it } from "vitest";
import type { ImportedSourceRecord } from "../generated/imports";
import { orderRule } from "./ImportedInspector";

const record = (source_sequence: number | null) => ({ source_sequence }) as ImportedSourceRecord;

describe("#5 the declared order of an incident's records, in words", () => {
  it("names the sequence number, and that time decides, only where the records carry one", () => {
    expect(orderRule([record(2), record(null)])).toBe(
      "Records are in the declared order: by their usable time; records with the same time by their sequence number, then by their place in the file. Where a sequence number disagrees with the times, the time decides.",
    );
    expect(orderRule([record(null), record(null)])).toBe("Records are in the declared order: by their usable time; records with the same time by their place in the file.");
  });
});
