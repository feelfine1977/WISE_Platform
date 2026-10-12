"""Desired companion acceptance. Pending until a real product adapter is supplied."""
from pathlib import Path
import importlib.util
import json
import pytest

FIXTURES = Path(__file__).parent / 'fixtures' / 'incidents'
EXPECTED = json.loads((FIXTURES / 'expected.json').read_text(encoding='utf-8'))


def actual_companion_adapter():
    path = Path(__file__).parent / 'product_analytics_adapter.py'
    if not path.is_file():
        pytest.skip('Pending: a real semantic companion acceptance adapter is not implemented.')
    spec = importlib.util.spec_from_file_location('product_analytics_adapter', path)
    assert spec is not None and spec.loader is not None
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    assert callable(adapter.analyze_fixture)
    return adapter.analyze_fixture


@pytest.mark.parametrize('name', ['S0', 'S1', 'S2', 'S3'])
def test_actual_companion_matches_complete_cases_context_graphs_and_variants(name):
    analyze = actual_companion_adapter()
    actual = analyze(FIXTURES / (name + '.csv'), EXPECTED['policies'])
    expected = EXPECTED['fixtures'][name]
    # Each expected field is a contractual answer, not a replacement for real computation.
    for field, value in expected.items():
        assert actual[field] == value, (name, field)


def test_actual_companion_reports_measured_true_false_and_unevaluable_separately():
    analyze = actual_companion_adapter()
    policies = {**EXPECTED['policies'], 'measured_query': {'interval': 'first_resolution', 'operator': 'gt', 'hours': 4}}
    actual = analyze(FIXTURES / 'S0.csv', policies)
    for field in ('true_ids', 'false_ids', 'unknown_ids'):
        assert actual['measured_query'][field] == EXPECTED['fixtures']['Q1'][field]
