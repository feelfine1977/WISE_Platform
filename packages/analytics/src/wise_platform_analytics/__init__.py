"""Canonical descriptive analytics for event histories.

Two operations are public. ``open_population`` answers which incidents a
source holds; ``open_case`` returns every raw record of one of them. Both take
the bytes of an event-history CSV and a selection of registered policies, and
both return a typed answer or a typed ``Refusal``; neither raises for a
malformed source, an unusable selection, a mismatched identity or an unknown
case.

This package has no web, database or user-interface dependency.
"""

from .evidence import CaseEvidence, EvidenceRecord, open_case
from .identities import Identities
from .policies import AppliedPolicies, PolicyChoice, PolicySelection
from .population import (
    IncidentRecordCount,
    OmittedLabelCoverage,
    PopulationAnswer,
    open_population,
)
from .refusals import Refusal, RefusalCode
from .version import IMPLEMENTATION_VERSION

__version__ = IMPLEMENTATION_VERSION

__all__ = [
    "IMPLEMENTATION_VERSION",
    "AppliedPolicies",
    "CaseEvidence",
    "EvidenceRecord",
    "Identities",
    "IncidentRecordCount",
    "OmittedLabelCoverage",
    "PolicyChoice",
    "PolicySelection",
    "PopulationAnswer",
    "Refusal",
    "RefusalCode",
    "open_case",
    "open_population",
]
