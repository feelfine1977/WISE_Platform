"""The adapter to the method library ``wise``: the only module of the application that imports it.

The library scores; this module translates and binds. It turns a prepared
snapshot into the library's event log, one resolution definition into the
library's norm (schema 3), hands both to ``wise.score``, and reads back per
incident the library's value, scope and reason, the endpoint times the
library pairs, and the trace of one incident with the platform's row
identities. It computes no score, threshold or verdict of its own and
changes no value the library returns.

* Every record of the scored incidents goes into the log with its row
  identity, its place in the declared order, and its time as prepared: an
  instant in UTC, or a wall-clock time as recorded, which the library keeps
  without a zone. The case attributes are the opening context: the context
  values of each incident's first record in the declared order, missing
  values included.
* The log's window is the preparation's observation window, from its first
  usable time to its snapshot cutoff.
* The measured time of an incident is the library's interval between the
  start and the first response at or after it, in the definition's unit, and
  only where both endpoints are known. A missing response stays without a
  measured time, also when the library's policy gives the incident a value;
  the age of an open incident scored by censoring is reported apart.

The library is imported when it is first needed, so that the application
runs without it; every operation that needs it then refuses with the way to
install it.
"""

from __future__ import annotations

import importlib
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import ModuleType
from typing import Any

from wise_platform_analytics.preparation import PreparedData

QUALIFIED_VERSION = "0.2.0"
METHOD_ARTIFACT: dict[str, object] = {
    "distribution": "wise-pm",
    "version": QUALIFIED_VERSION,
    "source_commit": "6883db5269e622d9ce5274d207e831d12ab134fe",
    "wheel_sha256": "7329b7929bb8a3e40c596b359f352aace23cc233d8f29322ee063612733aecc3",
    "qualification": "candidate_component_checked_release_pending",
    "eligible_release": False,
}
"""The exact build of the library this adapter is qualified with: an untagged state, not a release."""

INSTALL_COMMAND = "python -m pip install -c requirements-dev.lock vendor/wise_pm-0.2.0-py3-none-any.whl"
CONSTRAINT_ID = "resolution"
_UNITS = {"hours": "h", "days": "D"}

_CASE, _ACTIVITY, _TIME, _ORDER, _ROW = "case_id", "activity", "time", "declared_order", "row_id"


@dataclass(frozen=True)
class MethodUnavailable:
    """Why the library cannot be used, with what to do about it."""

    message: str


@dataclass(frozen=True)
class DefinitionProblem:
    """A part of a definition the library cannot take, at the field of the definition it concerns."""

    field: str
    message: str


@dataclass(frozen=True)
class CompiledNorm:
    """A definition as the library's norm: the document given to it, its fingerprint and the norm itself."""

    document: dict[str, object]
    fingerprint: str
    norm: Any


@dataclass(frozen=True)
class Clock:
    """How the times of a preparation are read: as UTC instants or as wall-clock times as recorded."""

    wall: bool
    observation_start: datetime
    snapshot_cutoff: datetime


@dataclass(frozen=True)
class CaseWitness:
    """The trace of one incident as the library ordered it, and the endpoint times it paired."""

    trace_row_ids: list[str]
    activation_time: datetime | None
    response_time: datetime | None


class MethodContractError(RuntimeError):
    """The library answered outside what this adapter is qualified for."""


def method_problem() -> MethodUnavailable | None:
    """Nothing when the qualified library can be imported, else why not and how to install it."""
    try:
        wise = _wise()
    except ImportError:
        return MethodUnavailable(
            "The method library wise-pm, which scores expectations, is not installed. From the folder of the "
            f"application, run: {INSTALL_COMMAND} and start the application again. Everything else works without it."
        )
    version = getattr(wise, "__version__", None)
    if version != QUALIFIED_VERSION:
        return MethodUnavailable(
            f"The installed method library wise-pm is version {version}, but this application is checked only with "
            f"version {QUALIFIED_VERSION}. From the folder of the application, run: {INSTALL_COMMAND} and start the "
            "application again."
        )
    return None


def norm_document(definition: Mapping[str, Any]) -> dict[str, object]:
    """The library's norm document (schema 3) for one resolution definition: one lag constraint, nothing else."""
    endpoints = definition["endpoints"]
    return {
        "schema_version": 3,
        "name": definition["name"],
        "version": str(definition["definition_revision"]),
        "missing_values": "three_valued",
        "scoring_mode": "flat",
        "layers": [{"id": "Timing"}],
        "views": [{"name": "Resolution", "constraint_weights": {CONSTRAINT_ID: 1}}],
        "constraints": [
            {
                "id": CONSTRAINT_ID,
                "layer": "Timing",
                "type": "lag",
                "params": {
                    "a": endpoints["activation_activity"],
                    "b": endpoints["response_activity"],
                    "activation": endpoints["activation"],
                    "response": endpoints["response"],
                    "delta": float(definition["target"]),
                    "width": float(definition["width"]),
                    "unit": _UNITS[definition["unit"]],
                    "missing_a": definition["missing_activation"],
                    "missing_b": definition["missing_response"],
                },
            }
        ],
    }


def compile_norm(definition: Mapping[str, Any]) -> CompiledNorm | DefinitionProblem:
    """Build and validate the library's norm for a definition, and admit its target and width.

    The library turns target plus width into a duration in the definition's unit whenever it
    scores with censoring, and that duration must exist: a target or a width whose duration
    cannot be represented is refused here, at its field, whatever the policy for a missing
    response and whether or not an incident would need it.
    """
    wise = _wise()
    document = norm_document(definition)
    try:
        norm = wise.Norm.from_dict(document)
        norm.validate()
    except wise.WiseError as error:
        return DefinitionProblem("definition", f"The method library does not accept this definition: {error}")
    params = document["constraints"][0]["params"]  # type: ignore[index]
    problem = _duration_problem(norm.constraints[0].constraint, params["delta"], params["width"])
    if problem is not None:
        return problem
    return CompiledNorm(document, norm.fingerprint(), norm)


def event_log(prepared: PreparedData, case_ids: Sequence[str], clock: Clock) -> Any:
    """The library's event log of every record of these incidents, with their opening context."""
    wise, pandas = _wise(), _pandas()
    columns: dict[str, list[object]] = {_CASE: [], _ACTIVITY: [], _TIME: [], _ORDER: [], _ROW: []}
    opening: dict[str, dict[str, str | None]] = {}
    order = 0
    for case_id in case_ids:
        history = prepared.histories[case_id]
        for row in history:
            columns[_CASE].append(case_id)
            columns[_ACTIVITY].append(row.activity)
            columns[_TIME].append(row.time_value)
            columns[_ORDER].append(order)
            columns[_ROW].append(row.row_id)
            order += 1
        for value in history[0].context if history else ():
            opening.setdefault(f"opening_column_{value.column_index}", {})[case_id] = value.value
    log = wise.EventLog(
        pandas.DataFrame(columns),
        case_col=_CASE,
        activity_col=_ACTIVITY,
        timestamp_col=_TIME,
        order_col=_ORDER,
        event_id_col=_ROW,
        missing_timestamps="keep",
        utc=not clock.wall,
        dedupe=False,
        window=(_moment(clock.observation_start), _moment(clock.snapshot_cutoff)),
    )
    if opening:
        log = log.with_case_attributes(
            {name: pandas.Series(values, dtype="object") for name, values in opening.items()}
        )
    return log


def check(compiled: CompiledNorm, log: Any) -> list[str]:
    """The library's own check of the norm against the log: an empty list when it finds nothing."""
    return [str(issue) for issue in compiled.norm.check(log)]


def log_fingerprint(log: Any) -> str:
    return str(log.fingerprint())


def score(compiled: CompiledNorm, log: Any, case_ids: Sequence[str], unit: str) -> list[dict[str, object]]:
    """Score every incident of the log; per incident the library's value, scope and reason and the measured time.

    The result must use no fitted calibration: a fixed threshold needs none, and a run that
    reports one is refused rather than stored with a calibration it does not name.
    """
    wise = _wise()
    result = wise.score(log, compiled.norm)
    if dict(result.calibrations):
        raise MethodContractError("The method library fitted a calibration for a fixed-threshold definition.")
    verdicts = result.verdicts().xs(CONSTRAINT_ID, level="constraint")
    params = compiled.document["constraints"][0]["params"]  # type: ignore[index]
    lag = compiled.norm.constraints[0].constraint
    started, responded = log.first_after(params["a"], params["b"], activation=params["activation"], response=params["response"])
    censoring_end = log.censoring_end(tolerance=(params["delta"] + params["width"]) * lag.timedelta_unit)
    values = verdicts["value"].to_dict()
    scopes = verdicts["in_scope"].to_dict()
    reasons = verdicts["reason"].astype(str).to_dict()
    measured = _in_units(responded - started, lag.unit).to_dict()
    ages = _in_units(censoring_end - started, lag.unit).to_dict()
    has_start, has_response = started.notna().to_dict(), responded.notna().to_dict()
    cases = []
    for case_id in case_ids:
        value = _number(values[case_id])
        if value is not None and not 0 <= value <= 1:
            raise MethodContractError(f"The method library gave incident {case_id!r} a value outside 0 to 1.")
        reason = reasons[case_id]
        activation_known = bool(has_start[case_id])
        response_known = activation_known and bool(has_response[case_id])
        status = "observed" if response_known else "missing_response" if activation_known else "missing_activation"
        cases.append(
            {
                "case_id": case_id,
                "value": value,
                "in_scope": bool(scopes[case_id]),
                "reason": reason,
                "measurement": {
                    "status": status,
                    "value": _number(measured[case_id]) if status == "observed" else None,
                    "unit": unit,
                    "activation_known": activation_known,
                    "response_known": response_known,
                    "censor_age": _number(ages[case_id]) if reason == "censored" else None,
                },
            }
        )
    return cases


def case_witness(compiled: CompiledNorm, prepared: PreparedData, case_id: str, clock: Clock) -> CaseWitness:
    """The library's trace of one incident and the start and response times it pairs for it."""
    log = event_log(prepared, [case_id], clock)
    params = compiled.document["constraints"][0]["params"]  # type: ignore[index]
    started, responded = log.first_after(params["a"], params["b"], activation=params["activation"], response=params["response"])
    return CaseWitness(
        [str(row_id) for row_id in log.trace(case_id)[_ROW].tolist()],
        _datetime(started[case_id]),
        _datetime(responded[case_id]),
    )


def _duration_problem(lag: Any, target: float, width: float) -> DefinitionProblem | None:
    unit = lag.timedelta_unit
    if not _represented(target, unit):
        return DefinitionProblem(
            "definition.target",
            "The target cannot be represented as a duration in this unit: the method library cannot work with a time "
            "span this long. Enter a smaller target.",
        )
    if not math.isfinite(target + width) or not _represented(target + width, unit):
        return DefinitionProblem(
            "definition.width",
            "Target and width together cannot be represented as a duration in this unit: the method library adds them "
            "to judge open incidents and cannot work with a time span this long. Enter a smaller width.",
        )
    return None


def _represented(amount: float, unit: Any) -> bool:
    try:
        duration = amount * unit
    except (OverflowError, ValueError):
        return False
    return not _pandas().isna(duration)


def _in_units(differences: Any, unit: str) -> Any:
    return importlib.import_module("wise.constraints").in_units(differences, unit)


def _moment(value: datetime) -> Any:
    return _pandas().Timestamp(value)


def _missing(value: object) -> bool:
    return bool(_pandas().isna(value))


def _number(value: object) -> float | None:
    if _missing(value):
        return None
    number = float(value)  # type: ignore[arg-type]
    if not math.isfinite(number):
        raise MethodContractError("The method library returned a number that is not finite.")
    return number


def _datetime(value: object) -> datetime | None:
    return None if _missing(value) else value.to_pydatetime()  # type: ignore[attr-defined]


def _wise() -> ModuleType:
    return importlib.import_module("wise")


def _pandas() -> ModuleType:
    return importlib.import_module("pandas")
