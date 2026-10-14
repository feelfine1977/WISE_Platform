"""Which incidents form the parent population and how its predicate splits them.

Both rules look at the whole history of an incident and at nothing else, so
an incident is selected or not as a whole.

* Under ``incident.parent.all_service_s_and_has_opened.v1`` an incident is in
  the parent population when every one of its records has the ``service``
  named by the policy and one of its records has the activity it names.
* Under ``incident.predicate.has_recorded_resolved.v1`` a parent incident is
  kept when one of its records has the activity the policy names, and removed
  otherwise. Only a recorded label counts: a record whose activity is missing
  is not a recorded ``Resolved``. The predicate can always be evaluated.

A predicate answers ``True`` (kept), ``False`` (removed) or ``None`` for an
incident it cannot evaluate; the population keeps such incidents apart as
unevaluable rather than counting them on either side.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence

from .parsing import SourceRecord
from .policies import (
    PARENT_ALL_SERVICE_S_AND_HAS_OPENED_V1,
    PREDICATE_HAS_RECORDED_RESOLVED_V1,
    PolicyChoice,
)

History = Sequence[SourceRecord]
ParentRule = Callable[[History, Mapping[str, object]], bool]
PredicateRule = Callable[[History, Mapping[str, object]], bool | None]


def _all_of_service_and_has_activity(
    history: History, parameters: Mapping[str, object]
) -> bool:
    return all(record.service == parameters["service"] for record in history) and any(
        record.activity == parameters["contains_activity"] for record in history
    )


def _has_recorded_activity(
    history: History, parameters: Mapping[str, object]
) -> bool | None:
    return any(record.activity == parameters["contains_activity"] for record in history)


_PARENT_RULES: Mapping[str, ParentRule] = {
    PARENT_ALL_SERVICE_S_AND_HAS_OPENED_V1: _all_of_service_and_has_activity,
}
_PREDICATE_RULES: Mapping[str, PredicateRule] = {
    PREDICATE_HAS_RECORDED_RESOLVED_V1: _has_recorded_activity,
}


def in_parent(history: History, policy: PolicyChoice) -> bool:
    """Say whether the policy takes this incident into the parent population."""
    return _PARENT_RULES[policy.policy_id](history, policy.parameters)


def predicate_holds(history: History, policy: PolicyChoice) -> bool | None:
    """Say whether the predicate holds for this incident, or ``None`` if it cannot tell."""
    return _PREDICATE_RULES[policy.policy_id](history, policy.parameters)
