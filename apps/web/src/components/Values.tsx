/** An empty source cell: shown as missing, never as empty text and never as the word "Unknown". */
export function Missing({ written }: { written: string }) {
  return (
    <span className="missing">
      Missing<span className="visually-hidden">{written === "" ? " value: the source cell is empty" : " value"}</span>
      {written !== "" && <span className="written"> written as “{written}”</span>}
    </span>
  );
}

interface ValueProps {
  /** The value as interpreted by the local service; null when the cell is missing. */
  interpreted: string | number | null;
  /** The cell exactly as written in the source. */
  written: string;
}

/** Shows a source cell as written, and the interpretation next to it only when the two differ. */
export function Value({ interpreted, written }: ValueProps) {
  if (interpreted === null) return <Missing written={written} />;
  const shown = String(interpreted);
  if (shown === written) return <>{written}</>;
  return (
    <>
      {shown}
      <span className="written"> written as “{written}”</span>
    </>
  );
}
