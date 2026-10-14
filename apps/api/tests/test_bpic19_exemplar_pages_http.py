"""Exact frozen native exemplar pages are transient, never a new assessment."""
import csv
import hashlib
import io
import json
import zipfile

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
import pytest

from import_requests import envelope
from test_bpic19_scoring_http import app, prepare, given, read, criterion, ROOT
from test_bpic19_artifact_recovery_http import seed, immutable_receipt
from wise_platform_api.app import create_app
from wise_platform_api import bpic19_scoring
from wise_platform_api.bpic19_pipeline import canonical_output

VALIDATOR = Draft202012Validator(json.loads((ROOT / "contracts/bpic19-scoring.schema.json").read_text()))


def later_exemplar_source():
    """Independent 501-member literal: only Z-exemplar has a positive C04."""
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
                     "case GR-Based IV", "case Item Type", "case Company", "case Spend area text", "activity", "time",
                     "event org:resource", "event Cumulative net worth (EUR)"])
    for case in [f"A-{index:05}" for index in range(500)] + ["Z-exemplar"]:
        events = [("Create Purchase Order Item", "2018-01-01T00:00:00Z"),
                  ("Record Invoice Receipt", "2018-01-02T00:00:00Z"),
                  ("Record Goods Receipt", "2018-01-03T00:00:00Z"),
                  ("Clear Invoice", "2018-03-04T00:00:00Z" if case == "Z-exemplar" else "2018-01-04T00:00:00Z")]
        for activity, timestamp in events:
            writer.writerow([case, case, "00010", "3-way match, invoice before GR", "true", "true", "Standard",
                             "0000", "Packaging", activity, timestamp, "user_1", 10])
    return output.getvalue().encode()


def artifact_digests(folder):
    return {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in (folder / "score-run-artifacts").glob("*.json.gz")}


def zip_contents(response):
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def test_exemplar_beyond_first_page_reads_production_later_chunk_without_rescore(tmp_path, monkeypatch):
    folder = tmp_path / "workspace"; folder.mkdir()
    assert bpic19_scoring._CHUNK_SIZE == 500
    with TestClient(app()) as client:
        wid, identity = prepare(client, folder, later_exemplar_source())
        request = given(wid, identity); request["case_limit"] = 50
        scored = client.post('/api/investigations/bpic19-score', json=request)
        assert scored.status_code == 200, scored.text
        original = scored.json(); VALIDATOR.validate(original)
        assert original['report']['population_case_count'] == 501
        assert 'Z-exemplar' not in [case['case_id'] for case in original['report']['case_page']['cases']]
        assert original['native_exemplar_pages'] == [{'case_id': 'Z-exemplar', 'full_population_case_offset': 500, 'unavailable_reason': None}]
        exemplar = original['report']['exemplars'][0]
        assert exemplar['reference_median_days'] == 2 and exemplar['evaluated_support'] == 501 and exemplar['positive_support'] == 1
        assert exemplar['measurement_days'] == 61
        before = artifact_digests(folder)
        monkeypatch.setattr(bpic19_scoring, 'evaluate_features', lambda *args, **kwargs: pytest.fail('Native member reads must never rescore'))
        inspected = client.post('/api/investigations/bpic19-read', json={**read(wid, original['run_id']), 'case_offset': 500, 'case_limit': 50})
        assert inspected.status_code == 200, inspected.text
        answer = inspected.json(); VALIDATOR.validate(answer)
        assert [case['case_id'] for case in answer['report']['case_page']['cases']] == ['Z-exemplar']
        native = answer['report']['case_page']['cases'][0]
        assert len(native['criteria']) == 10 and criterion(native, 'C04')['measurement'] == 61
        assert criterion(native, 'C04')['deviation'] == pytest.approx(31 / 60)
        assert native['score'] == pytest.approx(1 - (31 / 60) / 9)
        assert criterion(native, 'C05')['reason'] == 'out_of_scope'
        for key in ('run_id', 'definition_id', 'definition_version_id', 'base_identity', 'named_population', 'snapshot'):
            assert answer[key] == original[key]
        assert answer['report']['norm_fingerprint'] == original['report']['norm_fingerprint']
        assert answer['report']['mean_score'] == original['report']['mean_score']
        assert artifact_digests(folder) == before
        assert len(list((folder / 'score-runs').glob('*.json'))) == 1


def test_offset_uses_frozen_membership_not_case_sorting_or_filtered_page(tmp_path, monkeypatch):
    folder = tmp_path / 'workspace'; folder.mkdir()
    real = bpic19_scoring.evaluate_features
    monkeypatch.setattr(bpic19_scoring, 'evaluate_features', lambda features, **settings: real(list(reversed(features)), **settings))
    with TestClient(app()) as client:
        wid, identity = prepare(client, folder)
        scored = client.post('/api/investigations/bpic19-score', json=given(wid, identity)).json()
        assert [case['case_id'] for case in scored['report']['case_page']['cases']] == ['D', 'C', 'B', 'A']
        assert scored['native_exemplar_pages'] == [{'case_id': 'A', 'full_population_case_offset': 3, 'unavailable_reason': None}]
        filtered = client.post('/api/investigations/bpic19-read', json=read(wid, scored['run_id'], case_filter={'group_values': {'document': 'D'}}))
        assert filtered.status_code == 200, filtered.text
        assert [case['case_id'] for case in filtered.json()['report']['case_page']['cases']] == ['B', 'A']
        assert filtered.json()['native_exemplar_pages'] == scored['native_exemplar_pages']
        monkeypatch.setattr(bpic19_scoring, 'evaluate_features', lambda *args, **kwargs: pytest.fail('Frozen reads cannot evaluate the current subset'))
        exact = client.post('/api/investigations/bpic19-read', json={**read(wid, scored['run_id']), 'case_offset': 3, 'case_limit': 50})
        assert exact.status_code == 200, exact.text
        assert [case['case_id'] for case in exact.json()['report']['case_page']['cases']] == ['A']
        assert criterion(exact.json()['report']['case_page']['cases'][0], 'C04')['measurement'] == 60


def test_declared_exemplar_outside_frozen_membership_has_explicit_absence(tmp_path, monkeypatch):
    folder = tmp_path / 'workspace'; folder.mkdir()
    with TestClient(app()) as client:
        wid, identity = prepare(client, folder)
        native = client.post('/api/investigations/bpic19-score', json=given(wid, identity)).json()
        real_load = bpic19_scoring._load_artifact
        def authored_report(workspace, receipt):
            value = real_load(workspace, receipt)
            if receipt['kind'] == 'report':
                value['exemplars'].append({'case_id': 'A_current_child_alias', 'criterion_id': 'C04'})
            return value
        monkeypatch.setattr(bpic19_scoring, '_load_artifact', authored_report)
        response = client.post('/api/investigations/bpic19-read', json=read(wid, native['run_id']))
        assert response.status_code == 200, response.text
        answer = response.json(); VALIDATOR.validate(answer)
        assert answer['native_exemplar_pages'][-1] == {'case_id': 'A_current_child_alias', 'full_population_case_offset': None, 'unavailable_reason': 'not_in_frozen_membership'}
        assert all(case['case_id'] != 'A_current_child_alias' for case in answer['report']['case_page']['cases'])


def test_pre_receipt_save_reopens_with_identical_manifest_and_native_artifact_bytes(tmp_path, monkeypatch):
    folder = tmp_path / 'workspace'; folder.mkdir()
    page = bpic19_scoring.Bpic19Scoring._page
    def legacy_page(self, workspace, run, request):
        answer = page(self, workspace, run, request)
        answer.pop('native_exemplar_pages')
        return answer
    monkeypatch.setattr(bpic19_scoring.Bpic19Scoring, '_page', legacy_page)
    with TestClient(create_app()) as client:
        wid, identity, native, saved_request, saved, recover, source_request, evidence, first = seed(client, folder)
        assert 'native_exemplar_pages' not in native
        stored = immutable_receipt(folder); artifacts = artifact_digests(folder)
        export_request = envelope('bpic19_export_request', workspace_id=wid, run_id=native['run_id'], case_offset=0, case_limit=50)
        original_zip = zip_contents(client.post('/api/investigations/bpic19-export', json=export_request))
        monkeypatch.setattr(bpic19_scoring.Bpic19Scoring, '_page', page)
        monkeypatch.setattr(bpic19_scoring, 'evaluate_features', lambda *args, **kwargs: pytest.fail('Reopen must read, not replace, old native output'))
        reopened = client.post('/api/investigations/reopen', json=envelope('reopen_investigation_request', workspace_id=wid, saved_revision_id=saved['revision']['saved_revision_id']))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()['bpic19_outputs'] == saved['bpic19_outputs']
        newer = client.post('/api/investigations/bpic19-read', json=read(wid, native['run_id']))
        assert newer.status_code == 200 and newer.json()['native_exemplar_pages']
        assert canonical_output(newer.json()) == canonical_output(native)
        assert 'native_exemplar_pages' not in saved['bpic19_outputs']['outputs'][0]['output']
        assert immutable_receipt(folder) == stored and artifact_digests(folder) == artifacts
        assert zip_contents(client.post('/api/investigations/bpic19-export', json=export_request)) == original_zip


@pytest.mark.parametrize('position,reason', [(-1, None), (True, None), (1, 'not_in_frozen_membership'), (None, None)])
def test_presentation_receipt_refuses_invalid_offset_or_contradictory_absence(position, reason):
    answer = json.loads((ROOT / 'apps/web/src/bpic19/scoring-fixtures/native-two-items.json').read_text())
    assert not list(VALIDATOR.iter_errors(answer))  # Legacy replies remain valid.
    answer['native_exemplar_pages'] = [{'case_id': 'B', 'full_population_case_offset': position, 'unavailable_reason': reason}]
    assert list(VALIDATOR.iter_errors(answer))
