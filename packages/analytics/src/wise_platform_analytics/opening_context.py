"""How the incidents of a population were opened, beside the incidents of its parent.

For every mapped context column the value at the first record of an incident in the declared
order is its opening value (``incident.context.first_record_in_declared_order.v1``, the anchor the
selection predicates use). An empty cell there stays missing: a later value never takes its place,
and missing is its own category, apart from the text ``Unknown`` and from any other recorded text.
An incident whose order cannot be evaluated has no first record to read; it is counted apart and
is in no denominator.

Every share is a count of incidents over the incidents of its group whose opening could be read,
and carries that denominator. A share of an empty group is unavailable, not zero. Columns with very
many distinct values list the most frequent ones and fold the others into one remainder; the
missing category is always listed.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from .mapping import ImportRefusal
from .preparation import PreparedData
from .selection import OPENING_CONTEXT_POLICY, SelectionError, case_ids

__all__ = [
    "DEFAULT_CATEGORY_LIMIT",
    "OPENING_CONTEXT_POLICY",
    "CategoryShare",
    "ContextCategory",
    "ContextColumn",
    "ContextRemainder",
    "GroupCoverage",
    "OpeningContext",
    "opening_context",
]

DEFAULT_CATEGORY_LIMIT = 10

_MISSING = object()
"""The key of the missing category; no text, not even an empty one, is equal to it."""


@dataclass(frozen=True)
class CategoryShare:
    """Incidents of one group in a category, over the incidents of the group whose opening was read."""

    count: int
    denominator: int

    @property
    def share(self) -> float | None:
        return None if self.denominator == 0 else self.count / self.denominator

    def to_dict(self) -> dict[str, object]:
        return {"count": self.count, "share": self.share, "denominator": self.denominator}


def _difference(population: CategoryShare, parent: CategoryShare) -> float | None:
    if population.share is None or parent.share is None:
        return None
    return (population.share - parent.share) * 100


@dataclass(frozen=True)
class ContextCategory:
    value: str | None
    missing: bool
    population: CategoryShare
    parent: CategoryShare

    @property
    def difference_percentage_points(self) -> float | None:
        return _difference(self.population, self.parent)

    def to_dict(self) -> dict[str, object]:
        return {"kind": "missing" if self.missing else "value", "value": self.value,
                "population": self.population.to_dict(), "parent": self.parent.to_dict(),
                "difference_percentage_points": self.difference_percentage_points}


@dataclass(frozen=True)
class ContextRemainder:
    """The values that are not listed, together."""

    distinct_value_count: int
    population: CategoryShare
    parent: CategoryShare

    @property
    def difference_percentage_points(self) -> float | None:
        return _difference(self.population, self.parent)

    def to_dict(self) -> dict[str, object]:
        return {"distinct_value_count": self.distinct_value_count, "population": self.population.to_dict(),
                "parent": self.parent.to_dict(), "difference_percentage_points": self.difference_percentage_points}


@dataclass(frozen=True)
class ContextColumn:
    column_index: int
    column_name: str
    distinct_value_count: int
    categories: tuple[ContextCategory, ...]
    remainder: ContextRemainder | None

    def to_dict(self) -> dict[str, object]:
        return {"column_index": self.column_index, "column_name": self.column_name,
                "distinct_value_count": self.distinct_value_count,
                "categories": [category.to_dict() for category in self.categories],
                "remainder": None if self.remainder is None else self.remainder.to_dict()}


@dataclass(frozen=True)
class GroupCoverage:
    """How many incidents a group holds, and which of them have no evaluable first record."""

    case_count: int
    unevaluable_case_ids: tuple[str, ...]
    # Incidents whose first record shares its time with the next: the declared order chose their first record.
    tied_first_record_case_count: int = 0

    @property
    def evaluable_case_count(self) -> int:
        return self.case_count - len(self.unevaluable_case_ids)

    def to_dict(self) -> dict[str, object]:
        return {"case_count": self.case_count, "evaluable_case_count": self.evaluable_case_count,
                "unevaluable_case_count": len(self.unevaluable_case_ids),
                "unevaluable_case_ids": list(self.unevaluable_case_ids),
                "tied_first_record_case_count": self.tied_first_record_case_count}


@dataclass(frozen=True)
class OpeningContext:
    category_limit: int
    population: GroupCoverage
    parent: GroupCoverage
    columns: tuple[ContextColumn, ...]

    def to_dict(self) -> dict[str, object]:
        return {"anchor_policy": OPENING_CONTEXT_POLICY, "category_limit": self.category_limit,
                "population": self.population.to_dict(), "parent": self.parent.to_dict(),
                "columns": [column.to_dict() for column in self.columns]}


def opening_context(prepared: PreparedData, population_ids: Iterable[str], parent_ids: Iterable[str],
                    category_limit: int = DEFAULT_CATEGORY_LIMIT) -> OpeningContext | ImportRefusal:
    """The opening value of every mapped context column for a population and for its parent.

    The population must lie within the parent. Categories are ranked by their count in the
    population, then in the parent, then values before missing and by their text.
    """
    if type(category_limit) is not int or category_limit < 1:
        return ImportRefusal("invalid_parameter", "The number of listed values must be a whole number of at least 1.",
                             "category_limit")
    try:
        parent = case_ids(prepared, parent_ids)
        population = case_ids(prepared, population_ids)
    except SelectionError as error:
        return ImportRefusal(error.code, str(error), "case_ids")
    if not set(population) <= set(parent):
        return ImportRefusal("invalid_parent", "The population holds cases outside its parent population.",
                             "case_ids")
    columns: Sequence[int] = tuple(prepared.mapping["context_columns"])
    if not columns:
        return ImportRefusal("no_context_columns",
                             "No context column is mapped in this preparation, so there is no opening value to show.",
                             "mapping.context_columns")
    openings = {case_id: _opening(prepared, case_id, columns) for case_id in parent}
    tied = {case_id for case_id in parent if openings[case_id] is not None and _tied_first(prepared, case_id)}
    population_coverage = _coverage(population, openings, tied)
    parent_coverage = _coverage(parent, openings, tied)
    answered = []
    for position, index in enumerate(columns):
        in_population = Counter(openings[case_id][position] for case_id in population if openings[case_id] is not None)
        in_parent = Counter(openings[case_id][position] for case_id in parent if openings[case_id] is not None)
        answered.append(_column(prepared.columns[index], index, in_population, in_parent,
                                population_coverage.evaluable_case_count, parent_coverage.evaluable_case_count,
                                category_limit))
    return OpeningContext(category_limit, population_coverage, parent_coverage, tuple(answered))


def _opening(prepared: PreparedData, case_id: str, columns: Sequence[int]) -> tuple[object, ...] | None:
    """The opening value of each column, ``_MISSING`` for an empty cell, or None without an evaluable first record."""
    records = prepared.histories[case_id]
    if not records or not prepared.sequence_evaluable(case_id):
        return None
    first = records[0]
    return tuple(_MISSING if (value := first.context_value(index)) is None else value for index in columns)


def _tied_first(prepared: PreparedData, case_id: str) -> bool:
    """Whether the first record shares its usable time with the second, so that the declared order chose it."""
    records = prepared.histories[case_id]
    return len(records) > 1 and records[0].time_value is not None and records[0].time_value == records[1].time_value


def _coverage(ids: tuple[str, ...], openings: Mapping[str, tuple[object, ...] | None], tied: set[str]) -> GroupCoverage:
    return GroupCoverage(len(ids), tuple(case_id for case_id in ids if openings[case_id] is None), sum(case_id in tied for case_id in ids))


def _column(name: str, index: int, in_population: Counter, in_parent: Counter, population_total: int,
            parent_total: int, limit: int) -> ContextColumn:
    def rank(key: object) -> tuple[object, ...]:
        missing = key is _MISSING
        return (-in_population[key], -in_parent[key], missing, "" if missing else key)

    keys = sorted(set(in_parent) | set(in_population), key=rank)
    values = [key for key in keys if key is not _MISSING]
    listed = set(values[:limit]) | ({_MISSING} if _MISSING in in_parent or _MISSING in in_population else set())
    categories = tuple(
        ContextCategory(None if key is _MISSING else key, key is _MISSING,
                        CategoryShare(in_population[key], population_total), CategoryShare(in_parent[key], parent_total))
        for key in keys if key in listed)
    rest = values[limit:]
    remainder = None if not rest else ContextRemainder(
        len(rest), CategoryShare(sum(in_population[key] for key in rest), population_total),
        CategoryShare(sum(in_parent[key] for key in rest), parent_total))
    return ContextColumn(index, name, len(values), categories, remainder)
