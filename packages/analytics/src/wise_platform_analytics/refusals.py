"""Typed refusals.

An operation that cannot give a truthful answer returns a ``Refusal`` instead
of raising or returning an empty success. The set of codes is closed; the
``detail`` names what was offending in plain JSON-compatible values.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType

DetailValue = str | int | None | tuple[str, ...]


class RefusalCode(StrEnum):
    """Every reason for which an operation can refuse."""

    MALFORMED_SOURCE = "malformed_source"
    UNKNOWN_POLICY = "unknown_policy"
    UNSUPPORTED_PARAMETER = "unsupported_parameter"
    MISSING_POLICY = "missing_policy"
    IDENTITY_MISMATCH = "identity_mismatch"
    UNKNOWN_CASE = "unknown_case"


@dataclass(frozen=True)
class Refusal:
    """A refused request: a code, a readable message and the offending detail."""

    code: RefusalCode
    message: str
    detail: Mapping[str, DetailValue] = field(hash=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "detail", MappingProxyType(dict(self.detail)))

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": "refusal",
            "code": self.code.value,
            "message": self.message,
            "detail": {
                name: list(value) if isinstance(value, tuple) else value
                for name, value in self.detail.items()
            },
        }
