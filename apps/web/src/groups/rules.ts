import type { GroupRule, RuleGroupKey } from "../generated/rule-groups";

/**
 * The edges of the bands of numbers of records: one record, two to four, five to nine, ten to 19, 20 to 49, 50 or more.
 * The service's edges begin at zero; the band below one record holds no incident and is not shown (see `shownGroup`).
 */
export const RECORD_BANDS = [0, 1, 2, 5, 10, 20, 50];

/** Whether a group is shown: every group but the band below one record, which no incident can be in. */
export function shownGroup(key: RuleGroupKey): boolean {
  return !(key.kind === "raw_record_count_band" && key.start_inclusive === 0 && key.end_exclusive === 1);
}

/** A rule the analyst can group by, with its words in the list. */
export interface RuleChoice {
  value: string;
  label: string;
  rule: GroupRule;
}

/** The rules offered: four that need nothing more, the shared value of each mapped context column, and with or without each activity. */
export function ruleChoices(contextColumns: readonly { index: number; name: string }[], activities: readonly string[] = []): RuleChoice[] {
  return [
    { value: "first", label: "First activity", rule: { kind: "first_raw_activity" } },
    { value: "last", label: "Last activity", rule: { kind: "last_raw_activity" } },
    { value: "records", label: "Number of records", rule: { kind: "raw_record_count_bands", edges: RECORD_BANDS } },
    { value: "sequence", label: "Exact sequence of activities", rule: { kind: "exact_mapped_sequence" } },
    // A context column groups the incidents by the value of one record, the first or the latest with a value, or by every
    // value any record holds (#51): the reading is named in the choice.
    ...contextColumns.flatMap((column) => [
      { value: `reference-${column.index}`, label: `Same ${column.name}, on any record`, rule: { kind: "shared_reference" as const, column_index: column.index, minimum_parent_case_count: 2 } },
      { value: `reference-first-${column.index}`, label: `${column.name} at the first record`,
        rule: { kind: "shared_reference" as const, column_index: column.index, minimum_parent_case_count: 2, policy: "first_record" as const } },
      { value: `reference-latest-${column.index}`, label: `${column.name}, latest recorded value`,
        rule: { kind: "shared_reference" as const, column_index: column.index, minimum_parent_case_count: 2, policy: "latest_record" as const } },
    ]),
    ...activities.map((activity) => ({ value: `presence-${activity}`, label: `With or without ${activity}`, rule: { kind: "activity_presence" as const, activity } })),
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

/** Whether a rule reads the order of the records, so that an incident whose order is not fully known cannot be evaluated. */
export function readsOrder(rule: GroupRule): boolean {
  return rule.kind === "first_raw_activity" || rule.kind === "last_raw_activity" || rule.kind === "exact_mapped_sequence"
    || (rule.kind === "shared_reference" && (rule.policy ?? "any_record") !== "any_record");
}

/**
 * How a rule groups the incidents, in words: what it reads, which incidents it cannot evaluate, and where an incident
 * with a missing value goes. The rule is the analyst's; nothing in it is a business class.
 */
export function ruleSentence(rule: GroupRule, columnName: (index: number) => string): string {
  switch (rule.kind) {
    case "first_raw_activity":
    case "last_raw_activity": {
      const which = rule.kind === "first_raw_activity" ? "first" : "last";
      return `Each incident is in the group of the activity of its ${which} record in the declared order. An incident whose order is not fully known cannot be evaluated; one whose ${which} record has no activity label is in “No activity label”.`;
    }
    case "raw_record_count_bands":
      return "Each incident is in the band of its number of records, records without an activity label included. Every incident can be evaluated.";
    case "exact_mapped_sequence":
      return "Each incident is in the group of its exact sequence of labelled activities in the declared order; records without an activity label are left out of the sequence. An incident whose order is not fully known cannot be evaluated.";
    case "activity_presence":
      return `Each incident is in “With ${rule.activity}” if at least one of its records has that activity, otherwise in “Without ${rule.activity}”. Every incident can be evaluated.`;
    case "shared_reference": {
      const name = columnName(rule.column_index);
      const fewer = `A value recorded in fewer than ${rule.minimum_parent_case_count} incidents of the parent forms no group.`;
      // A recorded value such as “Unknown” is a value like any other; only an empty cell is “Not recorded”.
      switch (rule.policy ?? "any_record") {
        case "first_record":
          return `Each incident is in the group of the value of ${name} on its first record in the declared order, so it is in exactly one group; an empty cell there puts it in “Not recorded”, and a recorded “Unknown” is a value. ${fewer} An incident whose order is not fully known cannot be evaluated.`;
        case "latest_record":
          return `Each incident is in the group of the latest value of ${name} recorded in it, in the declared order, so it is in exactly one group; with no value on any record it is in “Not recorded”, and a recorded “Unknown” is a value. ${fewer} An incident whose order is not fully known cannot be evaluated.`;
        default:
          return `Each incident is in the group of every value of ${name} recorded in it, so an incident with several values is in several groups. ${fewer} An incident with a record without a value of ${name} is also in “Not recorded”.`;
      }
    }
  }
}

/** The rule of one group, in words: which incidents it holds. */
export function groupRuleSentence(key: RuleGroupKey, rule: GroupRule, columnName: (index: number) => string): string {
  switch (key.kind) {
    case "activity":
    case "missing_activity": {
      const which = rule.kind === "last_raw_activity" ? "last" : "first";
      return key.kind === "activity"
        ? `Incidents whose ${which} record in the declared order has the activity “${key.activity}”.`
        : `Incidents whose ${which} record in the declared order has no activity label.`;
    }
    case "raw_record_count_band":
      return `Incidents with ${groupLabel(key)}, records without an activity label included.`;
    case "activity_presence":
      return key.present ? `Incidents with at least one record of “${key.activity}”.` : `Incidents with no record of “${key.activity}”.`;
    case "reference_value":
    case "missing_reference": {
      const name = columnName(key.column_index);
      const policy = rule.kind === "shared_reference" ? rule.policy ?? "any_record" : "any_record";
      if (key.kind === "reference_value") {
        return policy === "first_record" ? `Incidents whose first record has ${name} “${key.value}”.`
          : policy === "latest_record" ? `Incidents whose latest recorded ${name} is “${key.value}”.`
            : `Incidents with at least one record whose ${name} is “${key.value}”.`;
      }
      return policy === "first_record" ? `Incidents whose first record has no value of ${name}.`
        : policy === "latest_record" ? `Incidents with no value of ${name} on any record.`
          : `Incidents with at least one record without a value of ${name}.`;
    }
    case "exact_sequence":
      return key.activities.length === 0
        ? "Incidents without a labelled activity in the declared order."
        : `Incidents whose labelled activities in the declared order are exactly ${key.activities.map((activity) => `“${activity}”`).join(", then ")}.`;
  }
}
