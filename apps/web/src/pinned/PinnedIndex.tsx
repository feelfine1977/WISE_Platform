import { useEffect, useRef, useState } from "react";
import type { Pin } from "../imported/coordinator";
import { originLine, ROLE_NAMES, shortPopulation } from "./pins";

interface PinnedIndexProps {
  pins: Pin[];
  /** The selection shown now, to say which pins were made under other steps. */
  currentPopulationId: string | null;
  onOpen: (pinId: number) => void;
  onUnpin: (pinId: number) => void;
  onPair: (pinIds: [number, number]) => void;
  /** The pin whose history is open beside the panel; its button takes the focus back when it closes. */
  openPinId: number | null;
}

/**
 * The histories pinned in this question, each with its role, its origin and the population it is read in; any one opens
 * its complete history, and two chosen ones are read side by side. Pins last as long as this question in this window.
 */
export function PinnedIndex({ pins, currentPopulationId, onOpen, onUnpin, onPair, openPinId }: PinnedIndexProps) {
  // The first two are chosen from the start, so that the pair can be read at once.
  const [chosen, setChosen] = useState<number[]>(() => pins.slice(0, 2).map((pin) => pin.id));
  const root = useRef<HTMLElement>(null);
  const opener = useRef<number | null>(null);
  // Back from a pinned history opened here, the focus returns to the button it was opened with.
  useEffect(() => {
    if (openPinId !== null || opener.current === null) return;
    const id = String(opener.current);
    opener.current = null;
    [...(root.current?.querySelectorAll<HTMLElement>("[data-open-pin]") ?? [])].find((button) => button.dataset.openPin === id)?.focus();
  }, [openPinId]);
  // Two are chosen as they are pinned, until the analyst chooses otherwise.
  useEffect(() => {
    setChosen((current) => {
      const held = current.filter((id) => pins.some((pin) => pin.id === id));
      for (const pin of pins) if (held.length < 2 && !held.includes(pin.id)) held.push(pin.id);
      return held;
    });
  }, [pins]);
  const toggle = (id: number) => setChosen((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id].slice(-2)));
  if (pins.length === 0)
    return (
      <section className="view-panel" aria-labelledby="pinned-title">
        <h3 id="pinned-title" className="view-title">Pinned histories</h3>
        <p className="muted view-hint">
          No history is pinned. Open an incident, kept or removed by the selection, and pin it as supporting or contrary to read two beside each other.
        </p>
      </section>
    );
  return (
    <section className="view-panel" aria-labelledby="pinned-title" ref={root}>
      <h3 id="pinned-title" className="view-title">Pinned histories</h3>
      <p className="muted view-hint">
        Each pin holds the exact population its history was read in. They last while this question is open in this window; saving them comes later.
      </p>
      <table className="pinned-index" aria-labelledby="pinned-title">
        <thead>
          <tr>
            <th scope="col">Read beside</th>
            <th scope="col">Pin</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {pins.map((pin) => (
            <tr key={pin.id}>
              <td>
                <input type="checkbox" aria-label={`Read ${pin.label} beside another`} checked={chosen.includes(pin.id)} onChange={() => toggle(pin.id)} />
              </td>
              <td>
                <p>
                  <strong>{ROLE_NAMES[pin.role]}</strong> · Incident <span className="identifier">{pin.caseId}</span>
                </p>
                <p className="pin-label">{pin.label}</p>
                <p className="muted">{originLine(pin)}</p>
                <p className="muted">
                  Population {shortPopulation(pin.identity.population_id)}
                  {currentPopulationId !== null && pin.question.populationId !== currentPopulationId ? " · pinned under other steps than those shown now" : ""}
                </p>
              </td>
              <td>
                <button type="button" data-open-pin={pin.id} aria-label={`Open the history of ${pin.label}`} onClick={() => { opener.current = pin.id; onOpen(pin.id); }}>
                  Open
                </button>
                <button type="button" aria-label={`Unpin ${pin.label}`} onClick={() => onUnpin(pin.id)}>
                  Unpin
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="primary" data-pair-open disabled={chosen.length !== 2} onClick={() => onPair([chosen[0], chosen[1]])}>
        Read the two chosen side by side
      </button>
      {chosen.length !== 2 && <p className="muted">Choose two pins to read them side by side.</p>}
    </section>
  );
}
