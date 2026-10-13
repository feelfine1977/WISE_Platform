"""Scoring one expectation about resolution time: the operations of the scoring contract.

An analyst states one expectation, "after activity A the activity B is
recorded within a target time", for the incidents of a preparation kept in a
workspace. Three operations serve it.

* **Validate** checks a definition against a named population of the
  preparation and, when every gate passes, keeps it in the workspace as an
  immutable definition version. A population whose order cannot be evaluated
  for some incident, or an empty one, is refused before the method library is
  called. The definition's clock must be the preparation's clock, its
  activities must be activities of the preparation, and its target and width
  must be durations the library can work with; otherwise the answer is
  blocked, with each reason at its field. The library's own check of the
  norm against the population's log comes last. A draft may be validated:
  that is exploration, and it cannot be scored.
* **Score** has the library score a reviewed definition version over a
  named population and keeps the run in the workspace. The run's identity is
  made from the identities of the preparation, the scored population, the
  definition version, its norm, the calibration, the clock and the library
  build; asking again for the same run answers the stored one without calling
  the library again. Scoring another population is another run.
* **Case witness** answers, for one incident of a stored run, its value as
  stored, every record of the incident, the records in the order the library
  traced them, and the records that can carry the start and the response the
  library paired: every record of that activity at that time.

Every value, scope and reason is the library's (see ``method``); the counts of
a run come from the analytics package. This module finds the workspace, the
preparation and the population, keeps definitions and runs, binds the
library's output to the platform's records, and turns every problem into the
contract's typed refusal.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ValidationError
from wise_platform_analytics.mapping import ImportRefusal as PackageRefusal
from wise_platform_analytics.preparation import PreparedData, content_identity
from wise_platform_analytics.prepared_operations import open_prepared_case
from wise_platform_analytics.score_support import endpoint_candidates, score_support

from . import method
from .boundary import SCHEMA_VERSION
from .generated.scoring import (
    DefinitionVersion,
    ExpectationValidationAnswer,
    ScoreCaseWitnessAnswer,
    ScoreCaseWitnessRequest,
    ScoreExpectationRequest,
    ScoreRun,
    ScoreRunAnswer,
    ScoringRefusal,
    ValidateExpectationRequest,
)
from .import_boundary import import_echo
from .imports import Imports
from .scoring_boundary import RECOVERY, STATUS, parse_scoring_body, scoring_refusal, unmet_condition
from .workspace import Problem, Workspace

logger = logging.getLogger(__name__)

VALIDATE = "validate_expectation"
SCORE = "score_expectation"
WITNESS = "score_case_witness"
TIE_POLICY = "matching_timestamp_candidates_in_declared_order.v1"
COMPILATION = {
    "requested_constraint_count": 1,
    "compiled_constraint_count": 1,
    "omitted_constraint_count": 0,
    "scope_kind": "all_cases",
    "pairing": "first_after",
    "unsupported_meaning_omitted": False,
}
_BOUND = ("source_id", "preparation_id", "representation_id", "case_dictionary_id", "implementation_version")
_LISTED = 5
"""How many incident ids a message names before it says how many more there are."""


@dataclass(frozen=True)
class ScoringReply:
    """A contract message, as the JSON it is sent as, and its HTTP status."""

    status: int
    body: dict


@dataclass(frozen=True)
class Blocker:
    """Why a definition is not ready for a population, at the field it concerns."""

    code: str
    field: str
    message: str
    case_ids: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "field": self.field,
            "message": self.message,
            "case_ids": list(self.case_ids),
            "case_count": len(self.case_ids),
            "recovery_actions": list(RECOVERY.get(self.code, ())),
        }


@dataclass(frozen=True)
class NamedPopulation:
    """The incidents a request names, as the selection or the preparation answered them."""

    name: str
    identity: dict[str, object]
    case_ids: tuple[str, ...]
    support: dict[str, object]


class Refused(Exception):
    """A reply that ends an operation early; raised inside one use case, sent by ``_answering``."""

    def __init__(self, reply: ScoringReply) -> None:
        super().__init__(reply.body.get("code"))
        self.reply = reply


class Expectations:
    """The scoring operations over the workspaces, preparations and selections of the import operations."""

    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def validate(self, body: bytes) -> ScoringReply:
        return _answering(VALIDATE, parse_scoring_body(body, ValidateExpectationRequest, VALIDATE), self._validate)

    def score(self, body: bytes) -> ScoringReply:
        return _answering(SCORE, parse_scoring_body(body, ScoreExpectationRequest, SCORE), self._score)

    def case_witness(self, body: bytes) -> ScoringReply:
        return _answering(WITNESS, parse_scoring_body(body, ScoreCaseWitnessRequest, WITNESS), self._case_witness)

    # Use cases ----------------------------------------------------------------------------

    def _validate(self, given: dict) -> ScoringReply:
        _method_available(VALIDATE, given)
        workspace, prepared = self._bound(VALIDATE, given)
        population = self._population(VALIDATE, workspace, prepared, given)
        _preparation_gate(VALIDATE, prepared, population, given)
        definition = _admitted(given["definition"])
        readiness = {
            "method_artifact": method.METHOD_ARTIFACT,
            "supported_definition": False,
            "preparation_gate_passed": True,
            "method_check_passed": False,
            "release_gate_pending": True,
        }
        compiled = _compiled(prepared, definition)
        blockers = compiled if isinstance(compiled, list) else []
        if isinstance(compiled, method.CompiledNorm):
            readiness["supported_definition"] = True
            blockers = _check_blockers(method.check(compiled, method.event_log(prepared, population.case_ids, _clock(prepared))), definition)
        if blockers:
            return _answer(
                ExpectationValidationAnswer,
                _envelope("expectation_validation_answer", given)
                | {
                    "state": "blocked",
                    "definition_version": None,
                    "readiness": readiness,
                    "blockers": [blocker.to_dict() for blocker in blockers],
                },
            )
        assert isinstance(compiled, method.CompiledNorm)
        stored = workspace.store_definition(_definition_version(prepared, definition, compiled))
        if isinstance(stored, Problem):
            raise Refused(_problem(VALIDATE, stored, given))
        return _answer(
            ExpectationValidationAnswer,
            _envelope("expectation_validation_answer", given)
            | {
                "state": "ready",
                "definition_version": dict(stored),
                "readiness": readiness | {"method_check_passed": True},
                "blockers": [],
            },
        )

    def _score(self, given: dict) -> ScoringReply:
        _method_available(SCORE, given)
        workspace, prepared = self._bound(SCORE, given)
        population = self._population(SCORE, workspace, prepared, given)
        version = _stored_definition(workspace, prepared, given)
        definition = version["definition"]
        if definition["review_state"] != "reviewed":
            raise Refused(
                _refused(
                    SCORE,
                    "definition_not_reviewed",
                    "This definition is a draft. A draft can be checked but not scored: mark it as reviewed, check it "
                    "again and score the reviewed version. The mark is a local note, not a sign-in.",
                    given,
                    "definition_version_id",
                )
            )
        _preparation_gate(SCORE, prepared, population, given)
        compiled = _compiled(prepared, definition)
        if isinstance(compiled, list):
            first = compiled[0]
            raise Refused(_refused(SCORE, first.code, first.message, given, first.field))
        norm = version["norm"]
        if compiled.document != norm["document"] or compiled.fingerprint != norm["norm_fingerprint"]:
            raise Refused(
                _refused(
                    SCORE,
                    "definition_unavailable",
                    "The installed method library compiles this definition version differently from when it was "
                    "checked. Check the definition again and score the new version.",
                    given,
                    "definition_version_id",
                )
            )
        clock = _clock(prepared)
        calibration = _calibration(version, population)
        identity = {
            "base_identity": prepared.identity_dict(),
            "scored_population_identity": population.identity,
            "definition_version_id": version["definition_version_id"],
            "norm_version_id": norm["norm_version_id"],
            "norm_fingerprint": norm["norm_fingerprint"],
            "calibration_id": calibration["calibration_id"],
            "method_artifact": method.METHOD_ARTIFACT,
            "clock": _run_clock(clock),
        }
        run_id = content_identity("score-run", {"format_version": 1, **identity})
        stored = workspace.run(run_id)
        if stored is None:
            log = method.event_log(prepared, population.case_ids, clock)
            issues = _check_blockers(method.check(compiled, log), definition)
            if issues:
                raise Refused(_refused(SCORE, issues[0].code, issues[0].message, given, issues[0].field))
            cases = method.score(compiled, log, population.case_ids, definition["unit"])
            run = {
                "identity": {"run_id": run_id, **identity, "method_log_fingerprint": method.log_fingerprint(log)},
                "named_population": {"name": population.name, "identity": population.identity},
                "population": population.support,
                "definition_version": version,
                "calibration": calibration,
                "support": score_support(cases),
                "cases": cases,
            }
            _checked(ScoreRun, run)
            kept = workspace.store_run(run)
            if isinstance(kept, Problem):
                raise Refused(_problem(SCORE, kept, given))
            stored = kept
        return _answer(ScoreRunAnswer, _envelope("score_run_answer", given) | {"run": dict(stored)})

    def _case_witness(self, given: dict) -> ScoringReply:
        _method_available(WITNESS, given)
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            raise Refused(_problem(WITNESS, workspace, given))
        run = workspace.run(given["run_id"])
        if run is None or not _valid(ScoreRun, run):
            raise Refused(
                _refused(
                    WITNESS,
                    "run_unavailable",
                    "This score run is not kept in the workspace. Score the expectation again.",
                    given,
                    "run_id",
                )
            )
        verdict = next((case for case in run["cases"] if case["case_id"] == given["case_id"]), None)
        if verdict is None:
            raise Refused(
                _refused(WITNESS, "case_not_found", "This incident was not scored in this run.", given, "case_id")
            )
        base = run["identity"]["base_identity"]
        found = self._imports.prepared_snapshot(workspace, base["preparation_id"], "run_id")
        if isinstance(found, Problem):
            raise Refused(_problem(WITNESS, found, given))
        if isinstance(found, PackageRefusal):
            raise Refused(_unreproduced(WITNESS, given, "run_id"))
        prepared = found[0]
        evidence = open_prepared_case(prepared, base, verdict["case_id"])
        if isinstance(evidence, PackageRefusal):
            raise Refused(_unreproduced(WITNESS, given, "run_id"))
        definition = run["definition_version"]["definition"]
        compiled = method.compile_norm(definition)
        if isinstance(compiled, method.DefinitionProblem):
            raise method.MethodContractError(compiled.message)
        traced = method.case_witness(compiled, prepared, verdict["case_id"], _clock(prepared))
        measurement = verdict["measurement"]
        history = prepared.histories[verdict["case_id"]]
        endpoints = definition["endpoints"]
        return _answer(
            ScoreCaseWitnessAnswer,
            _envelope("score_case_witness_answer", given)
            | {
                "run_identity": run["identity"],
                "case": verdict,
                "trace": {
                    "kind": "imported_csv",
                    **{
                        key: evidence[key]
                        for key in ("columns", "records", "coverage", "mapped_row_ids", "omitted_activity_row_ids")
                    },
                },
                "method_trace_row_ids": traced.trace_row_ids,
                "activation_candidate_row_ids": endpoint_candidates(
                    history,
                    endpoints["activation_activity"],
                    traced.activation_time if measurement["activation_known"] else None,
                ),
                # A response the library did not find has no record, whatever value its policy gave.
                "response_candidate_row_ids": endpoint_candidates(
                    history,
                    endpoints["response_activity"],
                    traced.response_time if measurement["response_known"] else None,
                ),
                "endpoint_tie_policy": TIE_POLICY,
            },
        )

    # Workspaces, preparations and populations -----------------------------------------------

    def _bound(self, operation: str, given: dict) -> tuple[Workspace, PreparedData]:
        """The workspace and the prepared snapshot the request's base identity names, exactly."""
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            raise Refused(_problem(operation, workspace, given))
        base = given["base_identity"]
        found = self._imports.prepared_snapshot(workspace, base["preparation_id"], "base_identity.preparation_id")
        if isinstance(found, Problem):
            field_name = found.field if found.field != "source_id" else "base_identity.source_id"
            raise Refused(_refused(operation, _code(found.code), found.message, given, field_name))
        if isinstance(found, PackageRefusal):
            raise Refused(_unreproduced(operation, given, "base_identity.preparation_id"))
        prepared = found[0]
        if dict(base) != prepared.identity_dict():
            raise Refused(
                _refused(
                    operation,
                    "identity_mismatch",
                    "The base identity is not the population of this preparation as it was opened. Open the incidents "
                    "of the preparation again.",
                    given,
                    "base_identity",
                )
            )
        return workspace, prepared

    def _population(self, operation: str, workspace: Workspace, prepared: PreparedData, given: dict) -> NamedPopulation:
        """Every incident of the preparation, or the kept incidents of a selection answered in this workspace."""
        named = given["named_population"]
        identity = dict(named["identity"])
        base = prepared.identity_dict()
        if identity == base:
            case_ids = tuple(sorted(prepared.histories))
            support = {
                "case_ids": list(case_ids),
                "case_count": len(case_ids),
                "record_count": sum(len(prepared.histories[case_id]) for case_id in case_ids),
            }
            return NamedPopulation(named["name"], identity, case_ids, support)
        if any(identity[name] != base[name] for name in _BOUND):
            raise Refused(
                _refused(
                    operation,
                    "identity_mismatch",
                    "The named population belongs to another preparation than the base identity.",
                    given,
                    "named_population.identity",
                )
            )
        selection = self._imports.selections.find(workspace.workspace_id, identity["population_id"])
        if selection is None:
            raise Refused(
                _refused(
                    operation,
                    "population_unavailable",
                    "This selected population is not known to the application any more. Select the incidents again.",
                    given,
                    "named_population.identity.population_id",
                )
            )
        if selection.identity_dict() != identity:
            raise Refused(
                _refused(
                    operation,
                    "identity_mismatch",
                    "The identity does not match the population it names. Select the incidents again.",
                    given,
                    "named_population.identity",
                )
            )
        return NamedPopulation(named["name"], identity, tuple(selection.kept.case_ids), selection.kept.to_dict())


# Gates ------------------------------------------------------------------------------------------


def _method_available(operation: str, given: Mapping[str, object]) -> None:
    unavailable = method.method_problem()
    if unavailable is not None:
        raise Refused(_refused(operation, "method_unavailable", unavailable.message, given))


def _preparation_gate(operation: str, prepared: PreparedData, population: NamedPopulation, given: Mapping[str, object]) -> None:
    """Refuse, before the library is called, a population without incidents or with an incident of unknown order."""
    if not population.case_ids:
        raise Refused(
            _refused(
                operation,
                "empty_population",
                "The named population has no incident, so there is nothing to score. Choose a population with incidents.",
                given,
                "named_population",
            )
        )
    unevaluable = tuple(case_id for case_id in population.case_ids if not prepared.sequence_evaluable(case_id))
    if unevaluable:
        raise Refused(
            _refused(
                operation,
                "unevaluable_sequence",
                f"The order of {_incidents(unevaluable)} of this population cannot be evaluated: a record has no "
                "usable time. Nothing was scored. Inspect the data quality of these incidents, or choose a population "
                "without them, for example by selecting the incidents whose order can be evaluated.",
                given,
                "named_population",
                unevaluable,
            )
        )


def _compiled(prepared: PreparedData, definition: Mapping[str, Any]) -> method.CompiledNorm | list[Blocker]:
    """The library's norm for a definition checked against the preparation, or every reason it cannot be had.

    The definition must read times on the preparation's clock, name two different activities
    of the preparation, and be taken by the library with its target and width.
    """
    blockers = []
    kind = prepared.report["timestamp_kind"]
    if definition["clock_kind"] != kind:
        blockers.append(
            Blocker(
                "clock_mismatch",
                "definition.clock_kind",
                f"The definition reads times as {_clock_words(str(definition['clock_kind']))}, but this preparation's "
                f"times are {_clock_words(str(kind))}. The definition must use the preparation's clock.",
            )
        )
    endpoints = definition["endpoints"]
    known = {str(item["activity"]) for item in prepared.report["activities"]}
    for name, role in (("activation_activity", "start"), ("response_activity", "response")):
        if endpoints[name] not in known:
            blockers.append(
                Blocker(
                    "invalid_parameter",
                    f"definition.endpoints.{name}",
                    f"No record of this preparation has the activity {endpoints[name]!r} chosen as the {role}. "
                    "Choose an activity of the preparation.",
                )
            )
    if endpoints["activation_activity"] == endpoints["response_activity"]:
        blockers.append(
            Blocker(
                "invalid_parameter",
                "definition.endpoints.response_activity",
                "The response is the same activity as the start. Choose another activity as the response.",
            )
        )
    compiled = method.compile_norm(definition)
    if isinstance(compiled, method.DefinitionProblem):
        code = "invalid_parameter" if compiled.field in ("definition.target", "definition.width") else "unsupported_definition"
        blockers.append(Blocker(code, compiled.field, compiled.message))
    return blockers or compiled  # type: ignore[return-value]


def _clock_words(kind: str) -> str:
    return "wall-clock times as recorded" if kind == "wall_clock" else "UTC instants"


def _check_blockers(issues: Sequence[str], definition: Mapping[str, Any]) -> list[Blocker]:
    endpoints = definition["endpoints"]
    blockers = []
    for issue in issues:
        where = "definition"
        for name in ("activation_activity", "response_activity"):
            if f"activity {endpoints[name]!r}" in issue:
                where = f"definition.endpoints.{name}"
        blockers.append(
            Blocker(
                "invalid_parameter",
                where,
                f"The method library's check of this definition against the incidents of this population: {issue}. "
                "Choose another activity, or a population in which it occurs.",
            )
        )
    return blockers


# Definitions, calibration and clock ---------------------------------------------------------------


def _admitted(definition: Mapping[str, Any]) -> dict[str, Any]:
    """The definition with its target and width as the decimal numbers the library validates."""
    return {**definition, "target": float(definition["target"]), "width": float(definition["width"])}


def _definition_version(prepared: PreparedData, definition: dict[str, Any], compiled: method.CompiledNorm) -> dict[str, object]:
    binding = {name: prepared.identity_dict()[name] for name in _BOUND}
    norm_version_id = content_identity(
        "norm-version",
        {"format_version": 1, "norm_fingerprint": compiled.fingerprint, "method_artifact": method.METHOD_ARTIFACT},
    )
    return {
        "definition_version_id": content_identity(
            "definition-version",
            {"format_version": 1, "source_binding": binding, "definition": definition, "method_artifact": method.METHOD_ARTIFACT},
        ),
        "source_binding": binding,
        "definition": definition,
        "norm": {"norm_version_id": norm_version_id, "norm_fingerprint": compiled.fingerprint, "document": compiled.document},
        "compilation": COMPILATION,
        "method_artifact": method.METHOD_ARTIFACT,
    }


def _stored_definition(workspace: Workspace, prepared: PreparedData, given: Mapping[str, Any]) -> Mapping[str, Any]:
    version = workspace.definition(given["definition_version_id"])
    if version is None or not _valid(DefinitionVersion, version):
        raise Refused(
            _refused(
                SCORE,
                "definition_unavailable",
                "This definition version is not kept in the workspace. Check the definition first.",
                given,
                "definition_version_id",
            )
        )
    if dict(version["source_binding"]) != {name: prepared.identity_dict()[name] for name in _BOUND}:
        raise Refused(
            _refused(
                SCORE,
                "identity_mismatch",
                "This definition version was checked for another preparation. Check the definition for this one.",
                given,
                "definition_version_id",
            )
        )
    return version


def _calibration(version: Mapping[str, Any], population: NamedPopulation) -> dict[str, object]:
    """The fixed-threshold calibration of a run: fitted to no population, so the same for every population."""
    definition, norm = version["definition"], version["norm"]
    calibration_id = content_identity(
        "calibration",
        {
            "kind": "fixed_threshold_calibration.v1",
            "policy": "fixed_threshold",
            "norm_version_id": norm["norm_version_id"],
            "norm_fingerprint": norm["norm_fingerprint"],
            "target": definition["target"],
            "width": definition["width"],
            "unit": definition["unit"],
            "clock_kind": definition["clock_kind"],
            "missing_activation": definition["missing_activation"],
            "missing_response": definition["missing_response"],
            "method_artifact": method.METHOD_ARTIFACT,
            "method_calibrations": {},
        },
    )
    return {
        "calibration_id": calibration_id,
        "policy": "fixed_threshold",
        "scored_population_id": population.identity["population_id"],
        "target": definition["target"],
        "width": definition["width"],
        "unit": definition["unit"],
        "population_fitted": False,
        "method_calibration_count": 0,
        "method_calibrations": {},
    }


def _clock(prepared: PreparedData) -> method.Clock:
    """The preparation's clock: its observation window from the first usable time to the snapshot cutoff."""
    report = prepared.report
    wall = report["timestamp_kind"] == "wall_clock"
    start = report["first_usable_local_timestamp" if wall else "first_usable_utc_instant"]
    cutoff = report["snapshot_cutoff_local" if wall else "snapshot_cutoff_utc"]
    return method.Clock(wall, _read_time(str(start)), _read_time(str(cutoff)))


def _run_clock(clock: method.Clock) -> dict[str, object]:
    if clock.wall:
        return {
            "timestamp_kind": "wall_clock",
            "duration_meaning": "recorded_wall_clock",
            "observation_start_utc": None,
            "snapshot_cutoff_utc": None,
            "observation_start_local": _local_text(clock.observation_start),
            "snapshot_cutoff_local": _local_text(clock.snapshot_cutoff),
        }
    return {
        "timestamp_kind": "utc_instant",
        "duration_meaning": "elapsed_utc",
        "observation_start_utc": _utc_text(clock.observation_start),
        "snapshot_cutoff_utc": _utc_text(clock.snapshot_cutoff),
        "observation_start_local": None,
        "snapshot_cutoff_local": None,
    }


def _read_time(text: str) -> datetime:
    return datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)


def _utc_text(moment: datetime) -> str:
    return moment.isoformat(timespec="microseconds" if moment.microsecond else "seconds").replace("+00:00", "Z")


def _local_text(moment: datetime) -> str:
    return moment.isoformat(timespec="microseconds" if moment.microsecond else "seconds")


def _incidents(case_ids: Sequence[str]) -> str:
    named = ", ".join(case_ids[:_LISTED])
    more = len(case_ids) - _LISTED
    count = f"{len(case_ids)} incident" + ("" if len(case_ids) == 1 else "s")
    return f"{count} ({named}{f' and {more} more' if more > 0 else ''})"


# Replies -------------------------------------------------------------------------------------------


def _envelope(message_type: str, given: Mapping[str, object]) -> dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "message_type": message_type,
        "request_id": given["request_id"],
        "query_revision": given["query_revision"],
        "workspace_id": given["workspace_id"],
    }


def _answering(
    operation: str, parsed: tuple[BaseModel, dict] | ScoringRefusal, answer: Callable[[dict], ScoringReply]
) -> ScoringReply:
    if isinstance(parsed, ScoringRefusal):
        return _sent_refusal(parsed)
    given = parsed[1]
    try:
        return answer(given)
    except Refused as refused:
        return refused.reply
    except Exception:
        logger.exception("The %s operation failed unexpectedly", operation)
        return _refused(
            operation,
            "computation_failed",
            "The answer could not be computed. Try again; if it fails again, the application needs to be repaired.",
            given,
        )


def _valid(model: type[BaseModel], value: object) -> bool:
    try:
        model.model_validate(value)
    except ValidationError:
        return False
    return True


def _checked(model: type[BaseModel], body: Mapping[str, object]) -> None:
    """Refuse to send or keep a message that is outside the contract."""
    try:
        model.model_validate(body)
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        raise ValueError(
            f"A {model.__name__} is outside the contract at {'.'.join(str(part) for part in first['loc'])}: {first['msg']}"
        ) from None
    unmet = unmet_condition(body)
    if unmet is not None:
        raise ValueError(f"A {model.__name__} breaks a condition of the contract: {unmet}")


def _answer(model: type[BaseModel], body: dict) -> ScoringReply:
    """Check an answer against its generated model and the contract's further conditions, and send it as it is."""
    _checked(model, body)
    return ScoringReply(200, body)


def _code(code: str) -> str:
    """A workspace problem in the scoring contract's terms, which has no separate code for a folder."""
    return code if code in STATUS else "workspace_unavailable"


def _problem(operation: str, problem: Problem, given: Mapping[str, object]) -> ScoringReply:
    return _refused(operation, _code(problem.code), problem.message, given, problem.field)


def _unreproduced(operation: str, given: Mapping[str, object], field_name: str) -> ScoringReply:
    logger.error("A kept preparation could not be prepared again for the %s operation", operation)
    return _refused(
        operation,
        "preparation_unavailable",
        "This preparation cannot be prepared again from its stored source. Confirm the interpretation of the source again.",
        given,
        field_name,
    )


def _refused(
    operation: str,
    code: str,
    message: str,
    given: Mapping[str, object],
    field_name: str | None = None,
    case_ids: Sequence[str] = (),
) -> ScoringReply:
    return _sent_refusal(scoring_refusal(operation, code, message, echo=import_echo(given), field=field_name, case_ids=case_ids))


def _sent_refusal(refusal: ScoringRefusal) -> ScoringReply:
    body = refusal.model_dump(mode="json")
    unmet = unmet_condition(body)
    if unmet is not None:
        raise ValueError(f"A scoring refusal breaks a condition of the contract: {unmet}")
    return ScoringReply(STATUS[refusal.code], body)
