import { describe, expect, it } from "vitest";
import type { CategoryComparison } from "../generated/comparison";
import { cutoffText, differenceCell, valueText } from "./wording";

const names: [string, string] = ["Early", "Late"];
const empty = { case_count: 0, denominator: 0, share: { status: "unavailable" as const, reason: "empty_profile_denominator" as const } };
const some = { case_count: 1, denominator: 2, share: { status: "available" as const, value: 0.5 } };

function category(part: Partial<CategoryComparison>): CategoryComparison {
  return {
    value: "ERP",
    parent: some,
    target: some,
    reference: some,
    difference_percentage_points: { status: "available", value: 0 },
    concentration_ratio: { status: "available", value: 1 },
    ...part,
  };
}

describe("the wording of a comparison", () => {
  it("gives the difference in points and the ratio, each with its own unavailable reason", () => {
    expect(differenceCell(category({ difference_percentage_points: { status: "available", value: 50 }, concentration_ratio: { status: "available", value: 3 } }), names)).toBe(
      "+50.0 pp · ratio 3.00",
    );
    expect(differenceCell(category({ concentration_ratio: { status: "unavailable", reason: "zero_reference_share" } }), names)).toBe(
      "±0.0 pp · ratio not available: the share in Late is 0",
    );
    expect(differenceCell(category({ concentration_ratio: { status: "available", value: 0 } }), names)).toBe("±0.0 pp · ratio 0.00");
  });

  it("says once why neither is available when a side has no readable opening", () => {
    const reason = { status: "unavailable" as const, reason: "empty_reference_profile" as const };
    expect(differenceCell(category({ reference: empty, difference_percentage_points: reason, concentration_ratio: reason }), names)).toBe(
      "not available: Late has no incident whose first record can be read",
    );
    const both = { status: "unavailable" as const, reason: "empty_both_profiles" as const };
    expect(differenceCell(category({ difference_percentage_points: both, concentration_ratio: both }), names)).toBe(
      "not available: neither group has an incident whose first record can be read",
    );
  });

  it("keeps missing apart from text and writes the stored cutoff on its clock", () => {
    expect([valueText(null), valueText("Unknown"), valueText(" ")]).toEqual(["not recorded", "Unknown", "“ ” (blank text)"]);
    const utc = { timestamp_kind: "utc_instant" as const, utc_instant: "2026-10-10T12:00:00Z", local_timestamp: null };
    expect(cutoffText({ timestamp_kind: "utc_instant", duration_clock: "elapsed_utc_hours", clock_limitation: null, snapshot_cutoff: utc })).toBe("2026-10-10 12:00 UTC");
    const wall = { timestamp_kind: "wall_clock" as const, utc_instant: null, local_timestamp: "2026-10-10T12:00:30" };
    expect(cutoffText({ timestamp_kind: "wall_clock", duration_clock: "recorded_wall_clock_hours", clock_limitation: "Clock changes.", snapshot_cutoff: wall })).toBe(
      "2026-10-10 12:00:30 as recorded",
    );
  });
});
