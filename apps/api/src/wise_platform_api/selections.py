"""The selections made in this run of the application, each under its population identity.

A selection is a set of whole incidents of one preparation, together with the parent it was made
from. The analytics package computes it and its identity; this registry only keeps it, so that an
operation that names the selection's full identity in a workspace works on exactly its incidents.
Nothing is inferred from an identity that is not registered, and a selection is found only in the
workspace it was made in.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Mapping
from dataclasses import dataclass, field
from threading import Lock
from types import MappingProxyType

from wise_platform_analytics.selection import SelectionResult

_KEPT = 64


@dataclass(frozen=True)
class RegisteredSelection:
    """A selection, the workspace it belongs to and the identity of the population it was made from."""

    workspace_id: str
    selection: SelectionResult
    parent_identity: Mapping[str, str] = field(repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "parent_identity", MappingProxyType(dict(self.parent_identity)))

    @property
    def identity(self) -> dict[str, str]:
        return self.selection.identity_dict()


class SelectionRegistry:
    """The last selections made, at most ``limit`` of them; the oldest is forgotten first."""

    def __init__(self, limit: int = _KEPT) -> None:
        self._limit = limit
        self._held: OrderedDict[tuple[str, str], RegisteredSelection] = OrderedDict()
        self._lock = Lock()

    def register(self, workspace_id: str, selection: SelectionResult, parent_identity: Mapping[str, str]) -> RegisteredSelection:
        registered = RegisteredSelection(workspace_id, selection, parent_identity)
        key = (workspace_id, selection.population_id)
        with self._lock:
            self._held[key] = registered
            self._held.move_to_end(key)
            while len(self._held) > self._limit:
                self._held.popitem(last=False)
        return registered

    def find(self, workspace_id: str, identity: Mapping[str, object]) -> RegisteredSelection | None:
        """The selection with exactly this full identity in this workspace, if it is held."""
        population_id = identity.get("population_id")
        if not isinstance(population_id, str):
            return None
        with self._lock:
            registered = self._held.get((workspace_id, population_id))
            if registered is not None:
                self._held.move_to_end((workspace_id, population_id))
        if registered is None or dict(identity) != registered.identity:
            return None
        return registered
