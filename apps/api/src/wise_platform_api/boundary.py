"""Validation of request bodies against the investigation contract.

A body becomes a generated request model only when it is exactly what the
contract allows. The generated models are validated strictly, so a truth
value or a text is not taken for a whole number, and two places where they
are still weaker than the contract are closed here:

* a value of another JSON type that a model takes as equal to a constant,
  such as ``true`` for the schema version ``1`` or ``0`` for the parameter
  value ``false``, is refused: the validated model must serialise back to the
  very values of the body;
* the implementation version must be written with the ASCII digits the
  contract's pattern means, not with other decimal digits.

Anything else is refused with the contract's code for the place it fails:
another whole schema version is ``unsupported_schema``; a policy identifier
or a role the contract does not know is ``unsupported_policy``; a policy
parameter is ``invalid_parameter``; everything else is ``invalid_request``.
When several places fail, the envelope is named before the shape of the
policies, the shape before an identifier, and an identifier before a
parameter. A refusal echoes the request id and the query revision only when
they are valid themselves.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Sequence
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .generated.investigation import InputPolicies, Refusal

RequestModel = TypeVar("RequestModel", bound=BaseModel)
Location = tuple[str | int, ...]

SCHEMA_VERSION = 1
_HALF_A_CHARACTER = re.compile("[\\ud800-\\udfff]")
LARGEST_REVISION = 2**53 - 1
"""The largest query revision every reader of an answer carries unchanged."""

STATUS: dict[str, int] = {
    "unsupported_schema": 400,
    "unsupported_policy": 400,
    "invalid_parameter": 400,
    "invalid_request": 400,
    "source_unavailable": 404,
    "malformed_source": 422,
    "case_not_found": 404,
    "case_not_in_population": 409,
    "identity_mismatch": 409,
    "computation_failed": 500,
}
RETRYABLE = frozenset({"source_unavailable", "computation_failed"})
"""Codes for a state of this computer rather than of the request: the same request can succeed later."""

_REQUEST_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
_IMPLEMENTATION_VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
_ROLES = frozenset(InputPolicies.model_fields)

# Order in which failing places are named, first one first.
_ENVELOPE, _POLICY_SHAPE, _POLICY_ID, _PARAMETER = range(4)
_CODES = {
    _ENVELOPE: "invalid_request",
    _POLICY_SHAPE: "invalid_request",
    _POLICY_ID: "unsupported_policy",
    _PARAMETER: "invalid_parameter",
}


def refusal(
    operation: str,
    code: str,
    message: str,
    *,
    request_id: str | None = None,
    query_revision: int | None = None,
    field: str | None = None,
) -> Refusal:
    """Build a contract refusal; whether a retry can help follows from its code."""
    return Refusal(
        schema_version=SCHEMA_VERSION,
        message_type="refusal",
        request_id=request_id,
        query_revision=query_revision,
        operation=operation,
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
    )


def parse_request(
    body: bytes, model: type[RequestModel], operation: str
) -> RequestModel | Refusal:
    """Return the request model of a body, or the refusal the contract names for it."""
    message = read_object(body)
    if isinstance(message, str):
        return refusal(operation, "invalid_request", message)
    echo = echo_of(message)

    version = message.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return refusal(
            operation,
            "unsupported_schema",
            f"Schema version {version} is not supported; this application reads version "
            f"{SCHEMA_VERSION}.",
            field="schema_version",
            **echo,
        )

    try:
        parsed = model.model_validate(message, strict=True)
    except ValidationError as error:
        failures = [
            (tuple(failure["loc"]), failure["type"], failure["msg"])
            for failure in error.errors(include_url=False)
        ]
    else:
        failures = _weaker_than_the_contract(message, parsed)
        if not failures:
            return parsed

    path, kind, reason = min(
        failures, key=lambda failure: _rank(failure[0], failure[1])
    )
    rank = _rank(path, kind)
    field = ".".join(str(part) for part in path)
    return refusal(
        operation, _CODES[rank], _message(rank, path, reason), field=field, **echo
    )


def _weaker_than_the_contract(
    message: dict, parsed: BaseModel
) -> list[tuple[Location, str, str]]:
    failures = []
    different = first_difference(message, parsed.model_dump(mode="json"))
    if different is not None:
        failures.append(
            (different, "type", "the value has another JSON type than the contract requires")
        )
    identity = message.get("identity")
    version = identity.get("implementation_version") if isinstance(identity, dict) else None
    if isinstance(version, str) and not _IMPLEMENTATION_VERSION.fullmatch(version):
        failures.append(
            (
                ("identity", "implementation_version"),
                "pattern",
                "the version must be three numbers in ASCII digits",
            )
        )
    return failures


def read_object(body: bytes) -> dict | str:
    """The JSON object of a request body, or the sentence that says why it is not one."""
    try:
        message = json.loads(body.decode("utf-8"), parse_constant=_no_constant, parse_float=_finite)
    except _UnreadableNumber:
        return "The request body holds a number that is too large to be read."
    except (UnicodeDecodeError, ValueError):
        return "The request body is not JSON."
    except RecursionError:
        return "The request body is nested too deeply to be read."
    if not isinstance(message, dict):
        return "The request body is not a JSON object."
    if holds_half_a_character(message):
        return "The request body holds text that is not valid Unicode."
    return message


def holds_half_a_character(value: object) -> bool:
    """Whether any text or name in a JSON value holds one half of a surrogate pair.

    JSON may escape such a half by itself. It is no character, cannot be written as UTF-8, and
    would fail far from here, in the first identity that is made from it.
    """
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            if _HALF_A_CHARACTER.search(item) is not None:
                return True
        elif isinstance(item, dict):
            pending.extend(item)
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return False


def echo_of(message: dict) -> dict[str, str | int | None]:
    """The request id and query revision of a message, each only when it is valid itself."""
    request_id = message.get("request_id")
    revision = message.get("query_revision")
    return {
        "request_id": request_id
        if isinstance(request_id, str) and _REQUEST_ID.fullmatch(request_id)
        else None,
        "query_revision": revision if type(revision) is int and 1 <= revision <= LARGEST_REVISION else None,
    }


def first_difference(
    given: object,
    validated: object,
    path: Location = (),
    *,
    compare_text: bool = True,
    numbers_by_value: bool = False,
) -> Location | None:
    """Return the location of the first value whose type or content differs, if any.

    With ``compare_text=False`` two texts count as equal: a model may write a valid text value,
    such as an instant, in another spelling, and only the type of the given value matters.

    With ``numbers_by_value=True`` a whole number given where the model holds a decimal number is
    the same value when the decimal number is exactly that whole number: ``4`` read as ``4.0``.
    A whole number that a decimal number cannot hold exactly, such as 9007199254740993, differs.
    """
    if isinstance(given, dict) and isinstance(validated, dict):
        for name in [*given, *validated]:
            if name not in given or name not in validated:
                return (*path, name)
        for name in given:
            found = first_difference(
                given[name],
                validated[name],
                (*path, name),
                compare_text=compare_text,
                numbers_by_value=numbers_by_value,
            )
            if found is not None:
                return found
        return None
    if isinstance(given, list) and isinstance(validated, list):
        if len(given) != len(validated):
            return path
        for index, (item, checked) in enumerate(zip(given, validated)):
            found = first_difference(
                item, checked, (*path, index), compare_text=compare_text, numbers_by_value=numbers_by_value
            )
            if found is not None:
                return found
        return None
    if numbers_by_value and type(given) is int and type(validated) is float:
        return None if validated.is_integer() and int(validated) == given else path
    if type(given) is not type(validated):
        return path
    if given != validated and (compare_text or not isinstance(given, str)):
        return path
    return None


def _rank(path: Sequence[str | int], kind: str) -> int:
    if not path or path[0] != "policies" or len(path) < 2:
        return _ENVELOPE
    if len(path) == 2:
        return _POLICY_SHAPE if path[1] in _ROLES else _POLICY_ID
    if path[2] == "id":
        return _POLICY_SHAPE if kind == "missing" else _POLICY_ID
    if path[2] == "parameters":
        return _PARAMETER
    return _POLICY_SHAPE


def _message(rank: int, path: Sequence[str | int], reason: str) -> str:
    reason = reason[0].lower() + reason[1:] if reason else "it is not valid"
    if rank == _POLICY_ID:
        return f"The policy given for the role {path[1]!r} is not supported: {reason}."
    if rank == _PARAMETER:
        if len(path) > 3:
            return (
                f"The parameter {path[3]!r} of the {path[1]!r} policy is not supported: "
                f"{reason}."
            )
        return f"The parameters of the {path[1]!r} policy are not valid: {reason}."
    where = ".".join(str(part) for part in path) or "the request"
    return f"The request is not valid at {where}: {reason}."


def _no_constant(name: str) -> object:
    raise ValueError(f"{name} is not JSON")


def _finite(text: str) -> float:
    """The number written in ``text``, refused when it is too large to be a number here (1e400)."""
    number = float(text)
    if not math.isfinite(number):
        raise _UnreadableNumber(text)
    return number


class _UnreadableNumber(ValueError):
    """A number of the JSON text that no float can hold."""
