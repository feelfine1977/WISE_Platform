import { workspaceExamples, type WorkspaceExample } from "./examples";
import { delimiters, encodings, formatLabels, timeFormats } from "./interpretation";
import { EMPTY_CELLS } from "./Understood";

/** The synthetic example the guide reads: it has an empty and a literal Unknown value side by side. */
const GUIDE_EXAMPLE = workspaceExamples.find((item) => item.id === "S3")!;

/**
 * How WISE reads an event-history CSV: the roles, every option this installation supports, and the reading of empty
 * cells. Its options are the screen's own lists, so the guide cannot name one the screen does not offer; its example is
 * a packaged synthetic file, read by the same operations as any file, so its report is an actual report.
 */
export function ImportGuide({ onLoadExample }: { onLoadExample: (example: WorkspaceExample) => void }) {
  return (
    <details className="report-more import-guide">
      <summary>How WISE reads a CSV file</summary>
      <p>
        Each row of the file is one recorded event or change of a case: an email received, a status set, a field changed. A file with one row per
        case (a list of cases rather than their histories) can be read, but its cases have one record each; the report says so before they are
        opened.
      </p>
      <dl className="report-figures">
        <div>
          <dt>Case id</dt>
          <dd>The column naming the case each row belongs to. A row without one stays outside every case, listed with its original text.</dd>
        </div>
        <div>
          <dt>Activity</dt>
          <dd>The column naming what happened, or the state or change recorded. A row without one stays in its case as a record without activity label.</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>The column with when it happened. A row whose time cannot be read stays in its case; that case's order is then not fully known.</dd>
        </div>
        <div>
          <dt>Sequence number (optional)</dt>
          <dd>A column of whole numbers that orders the records of a case with equal times; without it, equal times keep the order of the file.</dd>
        </div>
        <div>
          <dt>Context attributes (optional)</dt>
          <dd>Columns describing the case or the record, such as a service or a group; every other column also stays in each record as written.</dd>
        </div>
      </dl>
      <h4 className="label-text-strong">Options of this installation</h4>
      <ul>
        <li>Encodings: {encodings.map((item) => item.label).join("; ")}.</li>
        <li>Delimiters: {delimiters.map((item) => item.label).join("; ")}.</li>
        <li>Header: the first record names the columns.</li>
        <li>Time formats: {timeFormats.map((format) => formatLabels[format]).join("; ")}.</li>
        <li>Zones: as recorded, with no zone applied; the offset written in each value; or one fixed offset for every time.</li>
        <li>
          Rows that do not fit: tolerant (blank lines skipped and counted; records with another number of cells than the header kept as written outside
          every case, up to 5 % of the records) or strict (a blank line or such a record stops the reading).
        </li>
        <li>{EMPTY_CELLS}</li>
      </ul>
      <p>
        Your file is read on this computer and kept in the workspace folder; nothing is sent elsewhere. To see every role chosen and the actual report of a
        reading, load the synthetic example “{GUIDE_EXAMPLE.label}”.
      </p>
      <button type="button" onClick={() => onLoadExample(GUIDE_EXAMPLE)}>
        Load the synthetic example and read it
      </button>
    </details>
  );
}
