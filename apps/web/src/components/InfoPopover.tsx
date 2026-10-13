import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "./icons";
import "./popover.css";

interface InfoPopoverProps {
  /** What the panel is about, as "About this map": the name of its button and of the panel. */
  label: string;
  /** That the panel holds something that is said nowhere else at the moment, in words; the button carries a mark while it is given. */
  mark?: string;
  /** What the panel says. It is rendered only while the panel is open. */
  children: ReactNode;
}

/**
 * What explains a pane, behind one info button. The panel opens over the page under its button, so
 * nothing is pushed aside or resized by it. It follows its button in the document, so the keyboard
 * and assistive technology reach it from there, and it takes the keyboard itself so that a long one
 * can be scrolled. Escape closes it and so does a click outside it, and the keyboard is back on the
 * button; it also closes when the keyboard goes on to something else.
 */
export function InfoPopover({ label, mark, children }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  // From which edge of its button the panel opens: from the end towards the start while it has the room, else the other way.
  const [side, setSide] = useState<"end" | "start">("end");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open || !button.current || !panel.current) return;
    setSide(button.current.getBoundingClientRect().right >= panel.current.offsetWidth ? "end" : "start");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // The key closes the panel and nothing else the screen has open: whoever listens after this finds it used.
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Node) || root.current?.contains(event.target)) return;
      // A click on something that takes the keyboard leaves it there; any other gives it back to the button.
      const taken = document.activeElement !== null && document.activeElement !== document.body && !root.current?.contains(document.activeElement);
      setOpen(false);
      if (!taken) button.current?.focus();
    }
    // Heard on the way down, before anything on the page can keep the key or the click to itself.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [open]);

  return (
    <div
      className="popover"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <IconButton icon="info" label={label} mark={mark} aria-expanded={open} aria-controls={open ? panelId : undefined} ref={button} onClick={() => setOpen((shown) => !shown)} />
      {open && (
        <div className="popover-panel" id={panelId} ref={panel} role="group" aria-label={label} tabIndex={0} data-side={side}>
          {children}
        </div>
      )}
    </div>
  );
}
