import { type ButtonHTMLAttributes, type Ref, useId } from "react";
import "./icons.css";

/** What an icon draws in its 16 px box: a line, and where it has one, a part that is filled. */
interface IconShape {
  line: string;
  filled?: string;
}

/** The eye of "show"; "hide" strikes it through. */
const EYE = "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z";

/**
 * The icons of the application. All are drawn in one grammar: a line of one width with round caps
 * and joins, no fill, in the colour of the text around it. The size of the box and the width of
 * the line are tokens and come from the stylesheet.
 */
const ICONS = {
  undo: { line: "M6 3.5 3 6.5l3 3M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" },
  redo: { line: "M10 3.5l3 3-3 3M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9" },
  clearAll: { line: "M2 3h9L7.5 7.5V12l-2-1V7.5zM10.5 10.5l3 3M13.5 10.5l-3 3" },
  save: { line: "M3 2.5h7.5L13 5v8.5H3zM5.5 2.5V6h4M5.5 13.5V10h5v3.5" },
  sidePanel: { line: "M2.5 3h11v10h-11zM6 3v10" },
  info: { line: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 7.5V11M8 5v0" },
  table: { line: "M2.5 3h11v10h-11zM2.5 6.5h11M6.5 6.5V13" },
  map: { line: "M2 6.5h4v3H2zM10 2.5h4v3h-4zM10 10.5h4v3h-4zM6 8h2M8 4v8M8 4h2M8 12h2" },
  paths: { line: "M2.5 5H12M10 3l2 2-2 2M2.5 11H12M10 9l2 2-2 2" },
  stages: { line: "M2.5 4.5 5 8l-2.5 3.5M7 4.5 9.5 8 7 11.5M11.5 4.5 14 8l-2.5 3.5" },
  show: { line: EYE },
  hide: { line: `${EYE}M3 13 13 3` },
  sort: { line: "M5 13V3M2.5 5.5 5 3l2.5 2.5M11 3v10M8.5 10.5 11 13l2.5-2.5" },
  // A circle on a line: what is pinned stays where it is.
  pin: { line: "M8 2.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 8.5V14" },
  // A rectangle with a filled corner: the whole map, small, in a corner of it.
  overview: { line: "M2.5 3h11v10h-11z", filled: "M9 9h4.5v4H9z" },
  // Three squares on a line: the stages in their order.
  editStages: { line: "M1.5 6.5h3v3h-3zM6.5 6.5h3v3h-3zM11.5 6.5h3v3h-3zM4.5 8h2M9.5 8h2" },
  close: { line: "M4 4l8 8M12 4l-8 8" },
  collapse: { line: "M6 3.5 10.5 8 6 12.5" },
  fullWidth: { line: "M2.5 8h11M5 5.5 2.5 8 5 10.5M11 5.5 13.5 8 11 10.5" },
} satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICONS;

/** Every icon by its name, in the order they are listed above. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** One icon. It is a picture beside or in place of words that are said elsewhere, so assistive technology passes over it. */
export function Icon({ name }: { name: IconName }) {
  const shape: IconShape = ICONS[name];
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={shape.line} />
      {shape.filled && <path className="icon-filled" d={shape.filled} />}
    </svg>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "title" | "className" | "children" | "aria-label" | "aria-pressed" | "aria-describedby"> {
  icon: IconName;
  /** What the button does, in a few words: its accessible name and its tooltip. */
  label: string;
  /** What more there is to say about it: a further line of the tooltip, and its description for assistive technology. */
  hint?: string;
  /** For a switch: whether it is on. */
  pressed?: boolean;
  /** That there is something to read behind the button, in words: drawn as a small dot on it and said to assistive technology. */
  mark?: string;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A button that shows an icon in place of its words. The words are its accessible name and its
 * tooltip, so nothing is offered that is not named. A frequent action is such a button; an action
 * that keeps or removes incidents keeps its words.
 */
export function IconButton({ icon, label, hint, pressed, mark, ref, ...rest }: IconButtonProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const markId = mark ? `${id}-mark` : undefined;
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      className="icon-button"
      aria-label={label}
      title={[label, hint, mark].filter(Boolean).join("\n")}
      aria-pressed={pressed}
      aria-describedby={[hintId, markId].filter(Boolean).join(" ") || undefined}
    >
      <Icon name={icon} />
      {hint && (
        <span className="visually-hidden" id={hintId}>
          {hint}
        </span>
      )}
      {mark && (
        <>
          <span className="icon-button-mark" aria-hidden="true" />
          <span className="visually-hidden" id={markId}>
            {mark}
          </span>
        </>
      )}
    </button>
  );
}
