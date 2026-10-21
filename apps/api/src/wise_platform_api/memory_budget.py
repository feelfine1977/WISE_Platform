"""One byte budget for the population-sized data the service holds and the work it admits.

Kept preparations, held parses, selections and summaries report an estimated footprint. Work that reads a
source or computes over a population is admitted only if what is held, plus the work's estimated peak, fits the
budget after evicting entries no running request uses; otherwise it is refused before it starts. The entries a
request uses stay pinned, and its admitted peak stays reserved, until the request ends.

The costs below are measured service memory, from the BPIC19 descriptive journey in docs/capacity.md.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable, Hashable, Iterable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
import os
from threading import Lock

from .workspace import Problem

GIB = 1 << 30
DEFAULT_LIMIT_BYTES = 10 * GIB
"""The full-source journey peaked at 6.1 GB of service memory; the default leaves room above it."""
LIMIT_ENVIRONMENT = "WISE_MEMORY_BUDGET_BYTES"
SERVICE_BYTES_PER_ESTIMATED_BYTE = 1.7
"""Service memory per byte of a footprint estimate: allocator overhead and memory Python does not return."""
READ_PEAK_PER_SOURCE_BYTE = 3.0
"""Peak service memory while parsing a source, per stored byte: 2.2 for the prepared and 2.7 for the native source."""
OPERATION_PEAK_PER_RECORD = 700
"""Peak service memory above what is held, per record, of the costliest measured population operation (the graph)."""
SCORING_PEAK_PER_RECORD = 1_800
"""Peak service memory above what is held, per scored record: 2.8 GB for the 1,595,923 BPIC19 records."""

_scope: ContextVar[_Scope | None] = ContextVar("memory_budget_scope", default=None)


def configured_limit() -> int:
    value = os.environ.get(LIMIT_ENVIRONMENT)
    return int(value) if value else DEFAULT_LIMIT_BYTES


@dataclass
class _Held:
    footprint: int
    release: Callable[[], None]


@dataclass
class _Scope:
    pins: set[Hashable] = field(default_factory=set)
    reserved: int = 0


def _gb(value: int) -> str:
    return f"{value / 1e9:.1f} GB" if value >= 1e9 else f"{value / 1e6:.0f} MB"


class MemoryBudget:
    def __init__(self, limit: int | None = None) -> None:
        self.limit = configured_limit() if limit is None else limit
        self._held: OrderedDict[Hashable, _Held] = OrderedDict()
        self._scopes: list[_Scope] = []
        self._reserved = 0
        self._lock = Lock()

    # What is held -----------------------------------------------------------------------------

    def hold(self, key: Hashable, estimated_bytes: int, release: Callable[[], None]) -> None:
        """Count an entry as held until it is evicted, which calls ``release``, or forgotten by its owner."""
        with self._lock:
            self._held[key] = _Held(round(estimated_bytes * SERVICE_BYTES_PER_ESTIMATED_BYTE), release)
            self._held.move_to_end(key)

    def forget(self, key: Hashable) -> None:
        with self._lock:
            self._held.pop(key, None)

    def holds(self, key: Hashable) -> bool:
        with self._lock:
            if key in self._held:
                self._held.move_to_end(key)
                return True
            return False

    def held_bytes(self) -> int:
        with self._lock:
            return sum(entry.footprint for entry in self._held.values())

    def footprint(self, key: Hashable) -> int | None:
        with self._lock:
            entry = self._held.get(key)
            return None if entry is None else entry.footprint

    # Admission --------------------------------------------------------------------------------

    @contextmanager
    def request(self) -> Iterator[None]:
        """One request: what it pins and the peak it is admitted for are released when it ends."""
        scope = _Scope()
        token = _scope.set(scope)
        with self._lock:
            self._scopes.append(scope)
        try:
            yield
        finally:
            with self._lock:
                self._scopes.remove(scope)
                self._reserved -= scope.reserved
            _scope.reset(token)

    def admit(self, peak: int, *, keys: Iterable[Hashable] = (), work: str) -> Problem | None:
        """Admit work whose estimated peak is ``peak`` bytes and which uses the held entries ``keys``.

        A request is reserved its largest admitted peak, not their sum. Unpinned entries are evicted, least
        recently used first, until the work fits; if it cannot fit, nothing is evicted and it is refused."""
        released = []
        with self._lock:
            scope = _scope.get()
            transient = scope is None
            if transient:
                scope = _Scope()
            scope.pins.update(key for key in keys if key in self._held)
            extra = max(0, peak - scope.reserved)
            pinned = set().union(scope.pins, *(other.pins for other in self._scopes))
            held = sum(entry.footprint for entry in self._held.values())
            evictable = [key for key in self._held if key not in pinned]
            freed = 0
            while held - freed + self._reserved + extra > self.limit and len(released) < len(evictable):
                key = evictable[len(released)]
                freed += self._held[key].footprint
                released.append(key)
            if held - freed + self._reserved + extra > self.limit:
                return Problem(
                    "memory_unavailable",
                    f"{work[0].upper() + work[1:]} needs about {_gb(extra)} more memory than the service may use now: "
                    f"its budget is {_gb(self.limit)}, and {_gb(held - freed + self._reserved)} is held for open work "
                    "that cannot be released. Nothing was read or changed. Close other work, or raise the budget "
                    f"with {LIMIT_ENVIRONMENT} if this computer has the memory.",
                    None,
                )
            callbacks = [self._held.pop(key).release for key in released]
            if not transient:
                scope.reserved += extra
                self._reserved += extra
        for release in callbacks:
            release()
        return None

    def passed(self) -> None:
        """The current request's admitted peak has passed; what it keeps is now held and counted as such."""
        with self._lock:
            scope = _scope.get()
            if scope is not None:
                self._reserved -= scope.reserved
                scope.reserved = 0


class BudgetScope:
    """ASGI middleware giving each HTTP request its own budget scope."""

    def __init__(self, app, budget: MemoryBudget) -> None:
        self.app = app
        self.budget = budget

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        with self.budget.request():
            await self.app(scope, receive, send)
