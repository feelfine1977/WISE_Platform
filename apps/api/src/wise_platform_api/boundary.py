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
import re
from collections.abc import Sequence
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .generated.investigation import InputPolicies, Refusal

RequestModel = TypeVar("RequestModel", bound=BaseModel)
Location = tuple[str | int, ...]

SCHEMA_VERSION = 1

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
    try:
        message = json.loads(body.decode("utf-8"), parse_constant=_no_constant)
    except (UnicodeDecodeError, ValueError):
        return refusal(operation, "invalid_request", "The request body is not JSON.")
    except RecursionError:
        return refusal(
            operation, "invalid_request", "The request body is nested too deeply to be read."
        )
    if not isinstance(message, dict):
        return refusal(operation, "invalid_request", "The request body is not a JSON object.")

    request_id = message.get("request_id")
    revision = message.get("query_revision")
    echo = {
        "request_id": request_id
        if isinstance(request_id, str) and _REQUEST_ID.fullmatch(request_id)
        else None,
        "query_revision": revision if type(revision) is int and revision >= 1 else None,
    }

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
    different = _first_difference(message, parsed.model_dump(mode="json"), ())
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


def _first_difference(
    given: object, validated: object, path: Location
) -> Location | None:
    """Return the location of the first value whose type or content differs, if any."""
    if isinstance(given, dict) and isinstance(validated, dict):
        for name in [*given, *validated]:
            if name not in given or name not in validated:
                return (*path, name)
        for name in given:
            found = _first_difference(given[name], validated[name], (*path, name))
            if found is not None:
                return found
        return None
    if isinstance(given, list) and isinstance(validated, list):
        if len(given) != len(validated):
            return path
        for index, (item, checked) in enumerate(zip(given, validated)):
            found = _first_difference(item, checked, (*path, index))
            if found is not None:
                return found
        return None
    if type(given) is not type(validated) or given != validated:
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
