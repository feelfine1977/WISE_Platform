"""The selections answered in this run, each kept under the population identity it was given.

A selected population is named by its population identity alone. To answer
for it later (its map, or the complete history of one of its incidents) the
application looks the selection up here; the analytics package then checks
the whole identity against it. A population identity is meaningful only in
the workspace it was answered in, so the workspace is part of the key.

Only the selections answered last are kept. A population identity that is no
longer kept is unavailable and is selected again from its preparation.
"""

from __future__ import annotations

from collections import OrderedDict
from threading import Lock

from wise_platform_analytics.selection import SelectionResult

from .memory_budget import MemoryBudget

_KEPT = 128


def selection_footprint(selection: SelectionResult) -> int:
    """Estimated bytes of a selection: its member lists refer to identifiers the preparation already holds."""
    members = sum(len(support.case_ids) for support in (selection.parent, selection.kept, selection.removed, selection.unevaluable))
    return 8 * 2 * members + 1024


class SelectionRegistry:
    def __init__(self, limit: int = _KEPT, budget: MemoryBudget | None = None) -> None:
        self._limit = limit
        self._budget = budget
        self._selections: OrderedDict[tuple[str, str], SelectionResult] = OrderedDict()
        self._lock = Lock()

    def keep(self, workspace_id: str, selection: SelectionResult) -> None:
        key = (workspace_id, selection.population_id)
        with self._lock:
            self._selections[key] = selection
            self._selections.move_to_end(key)
            dropped = []
            while len(self._selections) > self._limit:
                dropped.append(self._selections.popitem(last=False)[0])
        if self._budget is not None:
            for old in dropped:
                self._budget.forget(("selection", old))
            self._budget.hold(("selection", key), selection_footprint(selection), lambda: self._drop(key))

    def _drop(self, key: tuple[str, str]) -> None:
        with self._lock:
            self._selections.pop(key, None)

    def find(self, workspace_id: str, population_id: object) -> SelectionResult | None:
        """The selection answered in this workspace under this population identity, if it is still kept."""
        if not isinstance(population_id, str):
            return None
        key = (workspace_id, population_id)
        with self._lock:
            selection = self._selections.get(key)
            if selection is not None:
                self._selections.move_to_end(key)
        return selection
