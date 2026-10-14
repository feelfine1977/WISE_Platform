import { useId } from "react";

/** One area of the application as a tab of the app bar. */
export interface AreaTab<Id extends string> {
  id: Id;
  label: string;
  /** Why the area cannot be opened now; null while it can. */
  unavailable: string | null;
}

interface AreaTabsProps<Id extends string> {
  tabs: AreaTab<Id>[];
  current: Id;
  onChoose: (id: Id) => void;
}

/**
 * The areas of the application in the order of the work. The current one is marked with
 * `aria-current`. An area that cannot be opened yet stays focusable, so its reason can be reached
 * and read; it is marked `aria-disabled` and does nothing when chosen.
 */
export function AreaTabs<Id extends string>({ tabs, current, onChoose }: AreaTabsProps<Id>) {
  const prefix = useId();
  return (
    <nav className="areas" aria-label="Areas">
      {tabs.map((tab) => {
        const reasonId = `${prefix}-${tab.id}-reason`;
        return (
          <button
            key={tab.id}
            type="button"
            className="area-tab"
            aria-current={tab.id === current ? "page" : undefined}
            aria-disabled={tab.unavailable === null ? undefined : true}
            aria-describedby={tab.unavailable === null ? undefined : reasonId}
            title={tab.unavailable ?? undefined}
            onClick={() => {
              if (tab.unavailable === null) onChoose(tab.id);
            }}
          >
            {tab.label}
          </button>
        );
      })}
      {tabs.map(
        (tab) =>
          tab.unavailable !== null && (
            <span key={tab.id} id={`${prefix}-${tab.id}-reason`} className="visually-hidden">
              {tab.unavailable}
            </span>
          ),
      )}
    </nav>
  );
}
