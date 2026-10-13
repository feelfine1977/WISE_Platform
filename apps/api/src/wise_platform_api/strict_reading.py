"""Reading a request strictly against a generated model, as the source schema means it.

The generated models are validated strictly as JSON, so a truth value is not a
whole number and a text is not a truth value. The validated model, written
back without the fields the request left out, must then give the very values
of the request; three things a model writes differently are not differences:

* an optional field the request leaves out is not written back as ``null``,
  because only the fields the request set are written back;
* a whole number given for a JSON number field, such as ``4`` for ``4.0``, is
  that number; it is refused only if the model holds another number for it;
* an instant is written back in the model's own spelling; the text the request
  gave is kept, and whether it has the contract's form is checked by
  ``instant_failures``.

A model with alternatives (one of several kinds of predicate, of group or of
period) reports a failure for each alternative. Only the alternatives the
request chose by its ``kind``, ``mode`` or ``timestamp_kind`` are kept, and the
names of the alternatives are left out of the place a failure is named at. A
value that chooses none of them is named at its discriminating field.

What the generated models do not carry (``uniqueItems``, the pattern of an
instant, ASCII digits of a version) is checked by the helpers below for the
places a contract has them.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from types import ModuleType
from typing import TypeVar

from pydantic import BaseModel, ValidationError

RequestModel = TypeVar("RequestModel", bound=BaseModel)
Location = tuple[str | int, ...]

UTC_INSTANT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z")
ASCII_VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
_DISCRIMINATORS = frozenset({"kind", "mode", "timestamp_kind"})


@dataclass(frozen=True)
class Failure:
    """A place of a request that is not what the contract allows, and why."""

    path: Location
    reason: str

    @property
    def field(self) -> str:
        return ".".join(str(part) for part in self.path)


def alternatives_of(module: ModuleType) -> frozenset[str]:
    """The names of the generated models of a module, as they appear in the place of a failure."""
    return frozenset(
        name
        for name, value in vars(module).items()
        if isinstance(value, type) and issubclass(value, BaseModel) and value.__module__ == module.__name__
    )


def read_strictly(
    message: Mapping[str, object], model: type[RequestModel], alternatives: frozenset[str]
) -> RequestModel | list[Failure]:
    """The model of a request, or every failure of it within the alternatives the request chose."""
    try:
        parsed = model.model_validate_json(json.dumps(message, ensure_ascii=False, allow_nan=False), strict=True)
    except ValidationError as error:
        return _chosen(error.errors(include_url=False), alternatives)
    different = written_back_difference(message, parsed.model_dump(mode="json", exclude_unset=True))
    if different is not None:
        return [Failure(different, "the value has another JSON type than the contract requires")]
    return parsed


def written_back_difference(given: object, written: object, path: Location = ()) -> Location | None:
    """The first place where the written-back model differs from the request, if any."""
    if isinstance(given, dict) and isinstance(written, dict):
        for name in [*given, *written]:
            if name not in given or name not in written:
                return (*path, name)
        for name in given:
            found = written_back_difference(given[name], written[name], (*path, name))
            if found is not None:
                return found
        return None
    if isinstance(given, list) and isinstance(written, list):
        if len(given) != len(written):
            return path
        for index, (item, checked) in enumerate(zip(given, written)):
            found = written_back_difference(item, checked, (*path, index))
            if found is not None:
                return found
        return None
    if type(given) is int and type(written) is float:
        # The model read a whole number as the very number; any other number was changed by reading it.
        return None if written.is_integer() and int(written) == given else path
    if type(given) is not type(written):
        return path
    if isinstance(given, str) and given != written:
        return None if UTC_INSTANT.fullmatch(given) else path
    return None if given == written else path


def repeated_failures(message: Mapping[str, object], paths: Iterable[Location]) -> list[Failure]:
    """A failure for each array at these places that holds an item twice; ``*`` stands for every index."""
    failures = []
    for path in paths:
        for place, value in _at(message, path):
            if isinstance(value, list):
                seen: set[str] = set()
                for index, item in enumerate(value):
                    key = json.dumps(item, sort_keys=True, ensure_ascii=False)
                    if key in seen:
                        failures.append(Failure((*place, index), "the item repeats an earlier one"))
                        break
                    seen.add(key)
    return failures


def instant_failures(message: Mapping[str, object], paths: Iterable[Location]) -> list[Failure]:
    """A failure for each text at these places that is not an instant written as the contract requires."""
    return [
        Failure(place, "an instant is written as YYYY-MM-DDThh:mm:ss with up to six decimals of a second and Z")
        for path in paths
        for place, value in _at(message, path)
        if isinstance(value, str) and UTC_INSTANT.fullmatch(value) is None
    ]


def version_failures(message: Mapping[str, object], paths: Iterable[Location]) -> list[Failure]:
    """A failure for each implementation version at these places not written in ASCII digits."""
    return [
        Failure(place, "the version must be three numbers in ASCII digits")
        for path in paths
        for place, value in _at(message, path)
        if isinstance(value, str) and ASCII_VERSION.fullmatch(value) is None
    ]


def _at(value: object, path: Location, place: Location = ()) -> list[tuple[Location, object]]:
    """The values at a place of a JSON value; ``*`` stands for every index of an array."""
    if not path:
        return [(place, value)]
    head, rest = path[0], path[1:]
    if head == "*":
        if not isinstance(value, list):
            return []
        return [found for index, item in enumerate(value) for found in _at(item, rest, (*place, index))]
    if isinstance(value, dict) and head in value:
        return _at(value[head], rest, (*place, head))
    return []


def _chosen(errors: Sequence[Mapping[str, object]], alternatives: frozenset[str]) -> list[Failure]:
    failures = [(tuple(error["loc"]), str(error["type"]), str(error["msg"])) for error in errors]
    rejected: dict[Location, Location] = {}
    for loc, kind, _ in failures:
        if kind == "literal_error" and loc and loc[-1] in _DISCRIMINATORS:
            branch = max((index for index, part in enumerate(loc) if part in alternatives), default=None)
            if branch is not None:
                rejected.setdefault(loc[: branch + 1], loc[branch + 1 :])
    kept = [failure for failure in failures if not any(failure[0][: len(branch)] == branch for branch in rejected)]
    found: list[Failure] = []
    for branch, discriminator in rejected.items():
        union = branch[:-1]
        if not any(failure[0][: len(union)] == union for failure in kept):
            failure = Failure(
                _named(union, alternatives) + _named(discriminator, alternatives),
                "the value is not a kind this contract knows here"
            )
            if failure not in found:
                found.append(failure)
    for loc, _, reason in kept:
        failure = Failure(_named(loc, alternatives), reason[0].lower() + reason[1:] if reason else "it is not valid")
        if failure not in found:
            found.append(failure)
    return found or [Failure((), "it is not valid")]


def _named(loc: Location, alternatives: frozenset[str]) -> Location:
    """A place without the names of the alternatives pydantic adds to it."""
    return tuple(part for part in loc if part not in alternatives)
