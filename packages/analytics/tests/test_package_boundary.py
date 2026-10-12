"""What the package offers and what it is allowed to depend on."""

import ast
import inspect
import sys
from pathlib import Path

import wise_platform_analytics
from wise_platform_analytics import open_case, open_population


def test_two_operations_are_public_beside_the_records_they_use():
    public = {
        name: getattr(wise_platform_analytics, name)
        for name in wise_platform_analytics.__all__
    }

    assert sorted(
        name for name, value in public.items() if inspect.isfunction(value)
    ) == [
        "open_case",
        "open_population",
    ]
    assert sorted(name for name, value in public.items() if inspect.isclass(value)) == [
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
    ]
    assert wise_platform_analytics.IMPLEMENTATION_VERSION == "0.1.0"


def test_the_operations_take_their_arguments_in_the_agreed_order():
    assert list(inspect.signature(open_population).parameters) == ["source", "policies"]
    assert list(inspect.signature(open_case).parameters) == [
        "source",
        "policies",
        "population_id",
        "case_id",
    ]


def test_the_package_imports_only_the_standard_library_and_itself():
    package = Path(wise_platform_analytics.__file__).parent
    foreign = set()
    for path in sorted(package.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                imported = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                imported = [node.module or ""]
            else:
                continue
            foreign.update(
                (path.name, name)
                for name in imported
                if name.split(".")[0] not in sys.stdlib_module_names
            )

    assert foreign == set()
