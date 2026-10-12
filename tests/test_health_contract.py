"""Foundation schema, generated model and actual HTTP behavior; no analytics readiness claim."""
from pathlib import Path
import json
import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError
from fastapi.testclient import TestClient
from wise_platform_api.app import create_app
from wise_platform_api.generated.health import HealthResponse

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / 'contracts' / 'health.schema.json').read_text(encoding='utf-8'))
VALID = {'status': 'ok', 'stage': 'foundation', 'version': '0.1.0'}


def test_source_schema_is_a_valid_closed_foundation_contract():
    Draft202012Validator.check_schema(SCHEMA)
    assert SCHEMA['$schema'] == 'https://json-schema.org/draft/2020-12/schema'
    assert SCHEMA['additionalProperties'] is False
    assert set(SCHEMA['required']) == {'status', 'stage', 'version'}
    Draft202012Validator(SCHEMA).validate(VALID)


@pytest.mark.parametrize('payload', [
    {'stage': 'foundation', 'version': '0.1.0'},
    {'status': 'ok', 'version': '0.1.0'},
    {'status': 'ok', 'stage': 'foundation'},
    {**VALID, 'status': 'ready'},
    {**VALID, 'stage': 'complete'},
    {**VALID, 'version': 'latest'},
    {**VALID, 'private_path': 'unexpected'},
])
def test_json_and_generated_python_reject_the_same_invalid_payloads(payload):
    assert list(Draft202012Validator(SCHEMA).iter_errors(payload))
    with pytest.raises(ValidationError):
        HealthResponse.model_validate(payload)


def test_generated_python_preserves_closed_fields_constants_and_version_validation():
    assert HealthResponse.model_validate(VALID).model_dump(mode='json') == VALID
    generated = HealthResponse.model_json_schema()
    assert generated['additionalProperties'] is False
    assert set(generated['required']) == set(SCHEMA['required'])
    for name in ('status', 'stage'):
        assert generated['properties'][name]['const'] == SCHEMA['properties'][name]['const']
    assert generated['properties']['version']['pattern'] == SCHEMA['properties']['version']['pattern']


def test_health_is_an_actual_api_answer_without_built_web_assets(tmp_path):
    absent_assets = tmp_path / 'not-built'
    with TestClient(create_app(static_dir=absent_assets)) as client:
        response = client.get('/api/health')
        assert response.status_code == 200
        assert response.json() == VALID
        HealthResponse.model_validate(response.json())
        root = client.get('/')
        assert root.status_code == 503
        assert 'browser assets are not built' in root.text.lower()
        assert client.get('/api/unknown').status_code == 404


def test_built_files_do_not_mask_unknown_api_routes(tmp_path):
    static = tmp_path / 'web'
    static.mkdir()
    (static / 'index.html').write_text('<html><body>Local fixture page</body></html>', encoding='utf-8')
    (static / 'asset.txt').write_text('local asset', encoding='utf-8')
    with TestClient(create_app(static_dir=static)) as client:
        assert client.get('/').status_code == 200
        assert 'Local fixture page' in client.get('/').text
        assert client.get('/asset.txt').text == 'local asset'
        assert client.get('/api/health').json() == VALID
        assert client.get('/api/unknown').status_code == 404
        assert client.get('/absent.js').status_code == 404
