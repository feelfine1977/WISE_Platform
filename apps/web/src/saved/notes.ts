/**
 * The notes of a saved investigation as the analyst writes them: a question, an observation, a counterexample, a
 * limitation and a next check, each optional, and anything else. They are kept in the one notes text of the saved
 * revision, one labelled paragraph each, so that nothing is stored twice and a note written before reads as it was.
 */
export interface NoteFields {
  question: string;
  observation: string;
  counterexample: string;
  limitation: string;
  nextCheck: string;
  /** What the labelled fields do not hold. */
  other: string;
}

export const NOTE_FIELDS: [Exclude<keyof NoteFields, "other">, string][] = [
  ["question", "Question"],
  ["observation", "Observation"],
  ["counterexample", "Counterexample"],
  ["limitation", "Limitation"],
  ["nextCheck", "Next check"],
];

export const emptyNotes: NoteFields = { question: "", observation: "", counterexample: "", limitation: "", nextCheck: "", other: "" };

/** The notes text of the fields: a labelled paragraph for each field written, then the rest. */
export function composeNotes(fields: NoteFields): string {
  const paragraphs = NOTE_FIELDS.filter(([field]) => fields[field].trim() !== "").map(([field, label]) => `${label}: ${fields[field].trim()}`);
  if (fields.other.trim() !== "") paragraphs.push(fields.other.trim());
  return paragraphs.join("\n\n");
}

/** The fields of a notes text: each labelled paragraph in its field, every other paragraph in the rest. */
export function readNotes(text: string): NoteFields {
  const fields: NoteFields = { ...emptyNotes };
  const other: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    if (trimmed === "") continue;
    const field = NOTE_FIELDS.find(([key, label]) => trimmed.startsWith(`${label}: `) && fields[key] === "");
    if (field) fields[field[0]] = trimmed.slice(field[1].length + 2);
    else other.push(trimmed);
  }
  fields.other = other.join("\n\n");
  return fields;
}
