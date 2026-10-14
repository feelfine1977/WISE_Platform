import { sameJson } from "../data/coordinator";
import type { ResolutionDefinition } from "../generated/scoring";
import { type MissingMeaning, readHours } from "./wording";

/** What the analyst entered in the form, as text and choices. */
export interface DefinitionForm {
  name: string;
  owner: string;
  sourceLabel: string;
  rationale: string;
  start: string;
  response: string;
  target: string;
  width: string;
  missing: MissingMeaning;
  reviewed: boolean;
}

/** A part of the form that cannot become a definition, at the field it concerns. */
export interface FormProblem {
  field: keyof DefinitionForm;
  message: string;
}

export const emptyForm: DefinitionForm = {
  name: "",
  owner: "",
  sourceLabel: "",
  rationale: "",
  start: "",
  response: "",
  target: "",
  width: "0",
  missing: "violate",
  reviewed: false,
};

/** What is missing or unreadable in the form; the local service checks everything else. */
export function formProblems(form: DefinitionForm): FormProblem[] {
  const problems: FormProblem[] = [];
  const required: [keyof DefinitionForm, string][] = [
    ["name", "Give the expectation a name."],
    ["owner", "Name who owns the expectation."],
    ["sourceLabel", "Say where the expectation comes from."],
    ["rationale", "Say why the expectation holds."],
    ["start", "Choose the activity that starts the time."],
    ["response", "Choose the activity that is expected after it."],
  ];
  for (const [field, message] of required) {
    if (String(form[field]).trim() === "") problems.push({ field, message });
  }
  if (readHours(form.target) === null) problems.push({ field: "target", message: "Enter the target as a number of hours, for example 8 or 4.5." });
  if (readHours(form.width) === null) problems.push({ field: "width", message: "Enter the width as a number of hours, 0 or more." });
  return problems;
}

/**
 * The definition of the form for a preparation's clock, or null while the form has problems.
 * Target and width are hours; the start is the first start, and the response the first response
 * at or after it, at the same instant included.
 */
export function definitionOf(form: DefinitionForm, clockKind: ResolutionDefinition["clock_kind"], revision: number): ResolutionDefinition | null {
  const target = readHours(form.target);
  const width = readHours(form.width);
  if (formProblems(form).length > 0 || target === null || width === null) return null;
  return {
    kind: "resolution_first_after.v1",
    name: form.name.trim(),
    definition_revision: revision,
    review_state: form.reviewed ? "reviewed" : "draft",
    provenance: {
      kind: "locally_entered",
      owner_label: form.owner.trim(),
      source_label: form.sourceLabel.trim(),
      rationale: form.rationale.trim(),
    },
    role: "negotiable_target",
    scope: { kind: "all_cases" },
    endpoints: {
      activation_activity: form.start,
      response_activity: form.response,
      activation: "first",
      response: "first_after",
      response_time_comparison: "at_or_after",
    },
    clock_kind: clockKind,
    target,
    width,
    unit: "hours",
    missing_activation: "skip",
    missing_response: form.missing,
    calibration: "fixed_threshold",
  };
}

/** Whether two definitions mean the same: everything but their revision number and their review mark agrees. */
export function sameMeaning(one: ResolutionDefinition, other: ResolutionDefinition): boolean {
  const neutral = { definition_revision: 1, review_state: "draft" } as const;
  return sameJson({ ...one, ...neutral }, { ...other, ...neutral });
}
