"""#13: actual complete variants, and keeping exactly one of them as a step.

Against the hand-written oracle of tests/fixtures/variants: ordinary, repeated, tied-order, missing-label and empty
sequences, and an incident of unknown order. A variant is the complete mapped sequence in the declared order, repeats
kept; its step keeps the exact members, leaves the unknown-order incident unevaluable (also negated), keeps every raw
record, compares, and saves and reopens with its identity. Sequence coverage belongs to the sequence: an unrelated
step still evaluates the incident of unknown order.
"""

import json
from pathlib import Path

import pytest

from test_import_acceptance import envelope, evidence
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/variants"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
POLICY = "incident.activity.omit_missing_retain_raw_gaps.v1"


def step(variant, negate=False):
    return {"kind": "variant_is", "variant": {"id": variant["id"], "activities": variant["activities"], "projection_policy": POLICY}, "negate": negate}


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def variants_of(client, workspace, identity):  # noqa: F811
    response = client.post("/api/investigations/variants", json=envelope("variants_request", "variants-1", 2, workspace_id=workspace["workspace_id"], identity=identity))
    assert response.status_code == 200, response.text
    # The variants answer the population asked about: the same source, representation and revision as every linked view.
    assert response.json()["identity"] == identity
    return response.json()["variants"]


def test_variants_are_the_complete_sequences_and_reconcile_with_the_population(client, opened):  # noqa: F811
    workspace, base = opened
    summary = variants_of(client, workspace, base["identity"])
    assert [(item["activities"], item["id"], sorted(item["case_ids"])) for item in summary["variants"]] == [
        (item["activities"], item["id"], item["members"]) for item in EXPECTED["variants"]]
    assert summary["unevaluable"]["case_ids"] == EXPECTED["unevaluable"]
    assert (summary["case_count"], summary["record_count"], summary["omitted_activity_record_count"], summary["sequence_evaluable_case_count"]) == (
        EXPECTED["incidents"], EXPECTED["records"], EXPECTED["records_without_label"], EXPECTED["known_order"])
    # Every incident is in exactly one variant or is of unknown order; shares are of the incidents of known order.
    assert sum(item["case_count"] for item in summary["variants"]) + summary["unevaluable"]["case_count"] == summary["case_count"]
    assert all(item["denominator"] == EXPECTED["known_order"] and item["share"] == item["case_count"] / EXPECTED["known_order"] for item in summary["variants"])
    repeated = EXPECTED["repeated"]
    assert summary["variants"][repeated["variant"]]["activities"] == repeated["labels_in_order"]


@pytest.mark.parametrize("index", range(len(EXPECTED["variants"])))
def test_keeping_a_variant_keeps_its_exact_members_whole(client, opened, index):  # noqa: F811
    workspace, base = opened
    variant = EXPECTED["variants"][index]
    selected = select(client, workspace, base, [step(variant)])
    everyone = sorted({case for item in EXPECTED["variants"] for case in item["members"]})
    assert selected["kept"]["case_ids"] == variant["members"]
    assert selected["removed"]["case_ids"] == [case for case in everyone if case not in variant["members"]]
    assert selected["unevaluable"]["case_ids"] == EXPECTED["unevaluable"]
    assert selected["predicate_results"][0]["predicate"] == step(variant)
    for case in variant["members"]:
        assert len(evidence(client, workspace, selected, case)["records"]) == len(evidence(client, workspace, base, case)["records"])
    # Negated, the incident of unknown order stays unevaluable: no sequence is never "another sequence".
    negated = select(client, workspace, base, [step(variant, True)])
    assert (negated["kept"]["case_ids"], negated["unevaluable"]["case_ids"]) == (selected["removed"]["case_ids"], EXPECTED["unevaluable"])


def test_the_unlabelled_record_stays_in_the_kept_history(client, opened):  # noqa: F811
    workspace, base = opened
    witness = EXPECTED["missing_label_witness"]
    variant = next(item for item in EXPECTED["variants"] if witness["case"] in item["members"])
    selected = select(client, workspace, base, [step(variant)])
    records = evidence(client, workspace, selected, witness["case"])["records"]
    assert [record["source_position"] for record in records] == witness["source_positions"]
    assert [record["source_position"] for record in records if record["activity"] is None] == [witness["unlabelled_position"]]


def test_an_unrelated_step_still_evaluates_the_incident_of_unknown_order(client, opened):  # noqa: F811
    workspace, base = opened
    unrelated = EXPECTED["unrelated_step"]
    selected = select(client, workspace, base, [{"kind": unrelated["kind"], "activity": unrelated["activity"], "negate": False}])
    assert (selected["kept"]["case_ids"], selected["removed"]["case_ids"], selected["unevaluable"]["case_ids"]) == (
        unrelated["kept"], unrelated["removed"], unrelated["unevaluable"])


def test_a_variant_whose_identity_does_not_match_its_sequence_is_refused(client, opened):  # noqa: F811
    workspace, base = opened
    first, second = EXPECTED["variants"][:2]
    wrong = {"kind": "variant_is", "variant": {"id": second["id"], "activities": first["activities"], "projection_policy": POLICY}, "negate": False}
    other = {**step(first), "variant": {**step(first)["variant"], "projection_policy": "incident.activity.keep_missing.v1"}}
    for predicate in (wrong, other):
        refused = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "select-x", 2, workspace_id=workspace["workspace_id"],
                              identity=base["identity"], parent_case_ids=None, predicates=[predicate]))
        assert refused.status_code in (400, 422) and refused.json()["field"].startswith("predicates.0"), refused.text


def test_a_variant_compares_saves_and_reopens_with_its_identity(client, opened):  # noqa: F811
    workspace, base = opened
    variant = EXPECTED["variants"][0]
    request = envelope("compare_groups_request", workspace_id=workspace["workspace_id"], identity=base["identity"], parent_case_ids=None,
                       context_column_index=EXPECTED["mapping"]["context_columns"][0], context_policy="incident.context.first_record_in_declared_order.v1",
                       definition={"mode": "two_named_groups",
                                   "target": {"name": "Variant 1", "definition": {"kind": "predicates", "predicates": [step(variant)]}},
                                   "reference": {"name": "Not variant 1", "definition": {"kind": "predicates", "predicates": [step(variant, True)]}}})
    compared = client.post("/api/investigations/compare-groups", json=request)
    assert compared.status_code == 200, compared.text
    groups = compared.json()
    others = [case for case in sorted({c for item in EXPECTED["variants"] for c in item["members"]}) if case not in variant["members"]]
    assert (groups["target"]["included"]["case_ids"], groups["target"]["unevaluable"]["case_ids"]) == (variant["members"], EXPECTED["unevaluable"])
    assert (groups["reference"]["included"]["case_ids"], groups["reference"]["unevaluable"]["case_ids"]) == (others, EXPECTED["unevaluable"])
    selected = select(client, workspace, base, [step(variant)])
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
        expected_revision_id=None, name="Invented variant", base_identity=base["identity"], selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": [step(variant)]},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
    assert reopened["revision"]["content"]["selection_recipe"]["predicates"] == [step(variant)]
    assert (reopened["restored_selection"]["identity"], reopened["restored_selection"]["kept"]["case_ids"]) == (selected["identity"], variant["members"])
