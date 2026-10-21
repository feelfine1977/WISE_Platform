import { useState } from "react";
import type { Pin, PinRole, PinWords } from "../imported/coordinator";
import { ROLE_NAMES } from "./pins";

interface PinControlProps {
  caseId: string;
  /** The pins of this incident already made. */
  pinned: Pin[];
  onPin: (role: PinRole, words: PinWords) => void;
  onUnpin: (pinId: number) => void;
}

/**
 * Pins the history read with the analyst's role and words. Supporting and contrary are the analyst's reading, not a label
 * WISE computes; a label is offered, and an observation, a limitation and a next check can be written, none required.
 */
export function PinControl({ caseId, pinned, onPin, onUnpin }: PinControlProps) {
  const [words, setWords] = useState<PinWords>({ label: `Incident ${caseId}`, observation: "", limitation: "", nextCheck: "" });
  const [said, setSaid] = useState("");
  const field = (name: keyof PinWords) => ({
    value: words[name],
    onChange: (event: { target: { value: string } }) => setWords((current) => ({ ...current, [name]: event.target.value })),
  });
  const pin = (role: PinRole) => {
    onPin(role, words);
    setSaid(`Pinned as ${ROLE_NAMES[role].toLowerCase()}. The pinned histories are listed under Pinned in the side panel.`);
  };
  return (
    <section className="pin-control" aria-labelledby="pin-control-title">
      <h3 id="pin-control-title">Pin this history</h3>
      <p className="muted">Supporting and contrary are your reading of this incident; WISE does not decide them. Pinning changes no step.</p>
      <label>
        Label
        <input type="text" {...field("label")} />
      </label>
      <details>
        <summary>Notes, none required</summary>
        <label>
          Observation
          <textarea rows={2} {...field("observation")} />
        </label>
        <label>
          Limitation
          <textarea rows={2} {...field("limitation")} />
        </label>
        <label>
          Next check
          <textarea rows={2} {...field("nextCheck")} />
        </label>
      </details>
      <div className="pin-actions">
        <button type="button" onClick={() => pin("supporting")}>
          Pin as supporting
        </button>
        <button type="button" onClick={() => pin("contrary")}>
          Pin as contrary
        </button>
      </div>
      <p role="status" className="muted">
        {said}
      </p>
      {pinned.length > 0 && (
        <ul className="pin-list" aria-label={`Pins of incident ${caseId}`}>
          {pinned.map((pin) => (
            <li key={pin.id}>
              {ROLE_NAMES[pin.role]} · {pin.label}{" "}
              <button type="button" className="link-button" onClick={() => onUnpin(pin.id)}>
                Unpin
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
