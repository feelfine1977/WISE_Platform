import type { GroupRule, RuleGroupKey } from "../generated/rule-groups";

/** The edges of the bands of numbers of records: one record, two to four, five to nine, ten to 19, 20 to 49, 50 or more. */
export const RECORD_BANDS = [1, 2, 5, 10, 20, 50];

/** A rule the analyst can group by, with its words in the list. */
export interface RuleChoice {
  value: string;
  label: string;
  rule: GroupRule;
}

/** The rules offered: four that need nothing more, and the shared value of each mapped context column. */
export function ruleChoices(contextColumns: readonly { index: number; name: string }[]): RuleChoice[] {
  return [
    { value: "first", label: "First activity", rule: { kind: "first_raw_activity" } },
    { value: "last", label: "Last activity", rule: { kind: "last_raw_activity" } },
    { value: "records", label: "Number of records", rule: { kind: "raw_record_count_bands", edges: RECORD_BANDS } },
    { value: "sequence", label: "Exact sequence of activities", rule: { kind: "exact_mapped_sequence" } },
    ...contextColumns.map((column) => ({
      value: `reference-${column.index}`,
      label: `Same ${column.name}`,
      rule: { kind: "shared_reference" as const, column_index: column.index, minimum_parent_case_count: 2 },
    })),
  ];
}

/** What a group stands for, in short words. */
export function groupLabel(key: RuleGroupKey): string {
  switch (key.kind) {
    case "activity":
      return key.activity;
    case "missing_activity":
      return "No activity label";
    case "raw_record_count_band":
      if (key.end_exclusive === null) return `${key.start_inclusive} or more records`;
      if (key.end_exclusive - key.start_inclusive === 1) return key.start_inclusive === 1 ? "1 record" : `${key.start_inclusive} records`;
      return `${key.start_inclusive}–${key.end_exclusive - 1} records`;
    case "activity_presence":
      return `${key.present ? "With" : "Without"} ${key.activity}`;
    case "reference_value":
      return key.value;
    case "missing_reference":
      return "Not recorded";
    case "exact_sequence":
      return key.activities.join(" → ");
  }
}
