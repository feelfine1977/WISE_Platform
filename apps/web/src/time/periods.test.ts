import { describe, expect, it } from "vitest";
import { dayName, hoursName, MAX_PERIODS, periodName, SPAN_EDGES_HOURS, spanBinLabel, startPeriods } from "./periods";

describe("the bins of recorded spans", () => {
  it("are the same on every log, from under an hour to a year or more, named in the shortest words", () => {
    expect(SPAN_EDGES_HOURS).toEqual([0, 1, 4, 24, 72, 168, 336, 720, 2160, 8760]);
    expect(spanBinLabel(0, 1)).toBe("under 1 h");
    expect(spanBinLabel(24, 72)).toBe("1 d–3 d");
    expect(spanBinLabel(8760, null)).toBe("1 yr or more");
    expect(hoursName(36)).toBe("36 h");
    expect(hoursName(100)).toBe("4.2 d");
  });
});

describe("the periods of starts", () => {
  it("are weeks from the Monday on or before the earliest record to the first Monday after the latest, on the clock of the preparation", () => {
    // 5 March 2025 is a Wednesday, 18 March a Tuesday.
    const utc = startPeriods({ timestamp_kind: "utc_instant", earliest_recorded_timestamp: "2025-03-05T10:00:00Z", latest_recorded_timestamp: "2025-03-18T23:59:59.999999Z" });
    expect(utc).toEqual({ unit: "week", edges: ["2025-03-03T00:00:00Z", "2025-03-10T00:00:00Z", "2025-03-17T00:00:00Z", "2025-03-24T00:00:00Z"] });
    const wall = startPeriods({ timestamp_kind: "wall_clock", earliest_recorded_timestamp: "2025-03-03T00:00:00", latest_recorded_timestamp: "2025-03-03T00:00:00" });
    // A latest record on a Monday at midnight still lies inside a period: the end is the Monday after it.
    expect(wall).toEqual({ unit: "week", edges: ["2025-03-03T00:00:00", "2025-03-10T00:00:00"] });
  });

  it("are calendar months, quarters or years where more than 64 weeks would be needed, the first unit that needs at most 64", () => {
    const months = startPeriods({ timestamp_kind: "utc_instant", earliest_recorded_timestamp: "2024-01-15T00:00:00Z", latest_recorded_timestamp: "2025-06-30T00:00:00Z" })!;
    expect(months.unit).toBe("month");
    expect(months.edges[0]).toBe("2024-01-01T00:00:00Z");
    expect(months.edges.at(-1)).toBe("2025-07-01T00:00:00Z");
    const quarters = startPeriods({ timestamp_kind: "wall_clock", earliest_recorded_timestamp: "2018-03-05T00:00:00", latest_recorded_timestamp: "2028-07-09T00:00:00" })!;
    expect(quarters.unit).toBe("quarter");
    expect(quarters.edges[0]).toBe("2018-01-01T00:00:00");
    expect(quarters.edges.at(-1)).toBe("2028-10-01T00:00:00");
    expect(quarters.edges.length).toBeLessThanOrEqual(MAX_PERIODS + 1);
    const years = startPeriods({ timestamp_kind: "utc_instant", earliest_recorded_timestamp: "1990-05-01T00:00:00Z", latest_recorded_timestamp: "2024-01-01T00:00:00Z" })!;
    expect(years.unit).toBe("year");
    expect(years.edges[0]).toBe("1990-01-01T00:00:00Z");
    expect(years.edges.at(-1)).toBe("2025-01-01T00:00:00Z");
  });

  it("read years far from today, and refuse a range the calendar cannot read", () => {
    expect(startPeriods({ timestamp_kind: "wall_clock", earliest_recorded_timestamp: "0001-01-03T00:00:00", latest_recorded_timestamp: "0001-01-04T00:00:00" })?.edges[0]).toBe("0001-01-01T00:00:00");
    expect(startPeriods({ timestamp_kind: "wall_clock", earliest_recorded_timestamp: "later", latest_recorded_timestamp: "2025-01-01T00:00:00" })).toBeNull();
  });

  it("name a period by its first and its last day, its end excluded", () => {
    expect(dayName("2025-03-03T00:00:00Z")).toBe("3 Mar 2025");
    expect(periodName("2025-03-03T00:00:00Z", "2025-03-17T00:00:00Z")).toBe("3 Mar 2025 to 16 Mar 2025");
  });
});
