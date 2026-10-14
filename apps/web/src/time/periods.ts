/**
 * The bins of the two charts beside the map. Both are fixed by the parent, so that the kept
 * incidents are counted in the same bins as the parent they are kept of, step after step.
 */

/** The edges in hours of the bins of recorded spans, the same on every log: an hour, four hours, a day, three days, a week, two weeks, 30 days, 90 days, a year. */
export const SPAN_EDGES_HOURS = [0, 1, 4, 24, 72, 168, 336, 720, 2160, 8760];

const SPAN_NAMES = new Map<number, string>([
  [0, "0"], [1, "1 h"], [4, "4 h"], [24, "1 d"], [72, "3 d"], [168, "1 wk"], [336, "2 wk"], [720, "30 d"], [2160, "90 d"], [8760, "1 yr"],
]);

/** A number of hours in the shortest words: a fixed edge by its name, any other in hours or days. */
export function hoursName(hours: number): string {
  const named = SPAN_NAMES.get(hours);
  if (named !== undefined) return named;
  return hours < 48 ? `${Number(hours.toFixed(1))} h` : `${Number((hours / 24).toFixed(1))} d`;
}

/** The label of a bin of spans: "under 1 h", "1 h–4 h", "1 yr or more". */
export function spanBinLabel(start: number, end: number | null): string {
  if (end === null) return `${hoursName(start)} or more`;
  if (start === 0) return `under ${hoursName(end)}`;
  return `${hoursName(start)}–${hoursName(end)}`;
}

/** The most bins a trend may have: the service takes at most 65 edges. */
export const MAX_PERIODS = 64;

/** The unit of the periods of starts: a week from Monday, a calendar month, a quarter or a year. */
export type PeriodUnit = "week" | "month" | "quarter" | "year";

export interface Periods {
  /** The edges of the periods in the preparation's clock, each a midnight. */
  edges: string[];
  unit: PeriodUnit;
}

const DAY = 86_400_000;
const dateOf = (text: string): Date | null => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (parts === null) return null;
  const date = new Date(0);
  date.setUTCFullYear(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};
const pad = (value: number, length = 2) => String(value).padStart(length, "0");
const midnight = (date: Date, utc: boolean) =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T00:00:00${utc ? "Z" : ""}`;
/** The first day of a month counted from January of year 0001, as a date. */
const monthStart = (months: number) => {
  const date = new Date(0);
  date.setUTCFullYear(Math.floor(months / 12) + 1, months % 12, 1);
  return date;
};

/**
 * The periods of starts over the parent's recorded range: weeks from Monday while there are at most
 * 64 of them, otherwise calendar months, quarters or years, the first that keeps the count at 64 or
 * fewer. They run from the start of the period of the earliest record to the end of the period of
 * the latest one. A calendar day is read as written on either clock. Null when the range is not one
 * the calendar can read.
 */
export function startPeriods(range: { timestamp_kind: "utc_instant" | "wall_clock"; earliest_recorded_timestamp: string; latest_recorded_timestamp: string }): Periods | null {
  const earliest = dateOf(range.earliest_recorded_timestamp);
  const latest = dateOf(range.latest_recorded_timestamp);
  if (earliest === null || latest === null || latest < earliest) return null;
  const utc = range.timestamp_kind === "utc_instant";
  // Monday is day 1 of the week in the calendar of the clock, Sunday day 0.
  const monday = new Date(earliest.getTime() - ((earliest.getUTCDay() + 6) % 7) * DAY);
  const weeks = Math.floor((latest.getTime() - monday.getTime()) / (7 * DAY)) + 1;
  if (weeks <= MAX_PERIODS) {
    return { unit: "week", edges: Array.from({ length: weeks + 1 }, (_, place) => midnight(new Date(monday.getTime() + place * 7 * DAY), utc)) };
  }
  const monthOf = (date: Date) => (date.getUTCFullYear() - 1) * 12 + date.getUTCMonth();
  for (const [unit, months] of [["month", 1], ["quarter", 3], ["year", 12]] as const) {
    const first = Math.floor(monthOf(earliest) / months) * months;
    const count = Math.floor((monthOf(latest) - first) / months) + 1;
    if (count <= MAX_PERIODS || unit === "year") {
      return { unit, edges: Array.from({ length: count + 1 }, (_, place) => midnight(monthStart(first + place * months), utc)) };
    }
  }
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A recorded timestamp's day in short words: "3 Mar 2025". */
export function dayName(timestamp: string): string {
  const date = dateOf(timestamp);
  return date === null ? timestamp : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The days a band of periods covers, its end excluded: "3 Mar 2025 to 17 Mar 2025". */
export function periodName(startInclusive: string, endExclusive: string): string {
  const end = dateOf(endExclusive);
  const last = end === null ? endExclusive : midnight(new Date(end.getTime() - DAY), true);
  return `${dayName(startInclusive)} to ${dayName(last)}`;
}
