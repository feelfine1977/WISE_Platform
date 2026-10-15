"""Independent declarations for the closed prepared-input boundary only.

Run with stdlib unittest (also collected by pytest). No raw BPIC19 data, HTTP,
source history equivalence or public analyst acceptance is claimed here.
"""

from copy import deepcopy
from dataclasses import FrozenInstanceError
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from wise_platform_api import bpic19_method, method
from wise_platform_api.bpic19_prepared_input import PreparedInput, binding_catalogue, build_prepared_input


ALL = ("DF1", "DF2", "two_way", "Consignment")
INVOICE = ALL[:3]
GOODS = ("DF1", "DF2", "Consignment")
# Literal prepared cells, deliberately independent of a physically consistent
# event history. These values yield the seven T25-AC07 arithmetic penalties.
# attribute, existing product unit, declared flow scope, input value
CELLS = (
    ("c_l1_invoice_present", "event_occurrences", INVOICE, 1),
    ("c_l1_clear_invoice_present", "event_occurrences", INVOICE, 1),
    ("c_l1_goods_or_ses_present", "event_occurrences", ALL[:2], 1),
    ("c_l2_df1_invoice_after_goods", "boolean_observation", ("DF1",), 1),
    ("c_l2_df2_release_after_goods", "boolean_observation", ("DF2",), 0),
    ("c_l2_2way_no_goods_expected", "event_occurrences", ("two_way",), 0),
    ("c_l2_consignment_no_clear_invoice", "event_occurrences", ("Consignment",), 0),
    ("c_l3_df1_goods_to_invoice_days", "days", ("DF1",), 20),
    ("c_l3_invoice_to_clear_days", "days", INVOICE, 60),
    ("c_l3_df2_goods_to_rpb_days", "days", ("DF2",), 0),
    ("c_l3_df2_rpb_to_clear_days", "days", ("DF2",), 0),
    ("c_l4_goods_fragmentation", "event_occurrences", GOODS, 1),
    ("c_l4_change_approval_repeats", "event_occurrences", ALL, 0),
    ("c_l4_repeated_invoice_receipt", "event_occurrences", INVOICE, 1),
    ("c_l4_change_payment_terms_repeats", "event_occurrences", ALL, 0),
    ("c_l5_cancel_invoice_receipt", "event_occurrences", INVOICE, 0),
    ("c_l5_cancel_goods_receipt", "event_occurrences", GOODS, 0),
    ("c_l5_delete_item", "event_occurrences", ALL, 0),
    ("c_l5_debit_memo", "event_occurrences", ALL, 1),
    ("c_l5_credit_memo", "event_occurrences", ALL, 0),
    ("c_l6_change_price", "event_occurrences", ALL, 1),
    ("c_l6_change_quantity", "event_occurrences", ALL, 1),
    ("c_l6_high_exposure_memo", "normalized_proxy", ALL, 0.25),
    ("c_l6_high_exposure_price_change", "normalized_proxy", ALL, 0.25),
    ("c_l7_manual_touches", "resource_proxy_events", ALL, 7),
    ("c_l7_distinct_human_resources", "resource_proxy_identities", ALL, 4),
    ("c_l7_total_events", "event_occurrences", ALL, 25),
    ("c_l7_manual_share", "share_of_original_events", ALL, 0.75),
    ("c_l6_bal_networth_volatility", "coefficient_of_variation", INVOICE, 1),
)
COUNT = "c_l4_change_payment_terms_repeats"
TIME = "c_l3_invoice_to_clear_days"
ORIGINAL = {"source_id": "source.v1:sha256:" + "a" * 64, "row_id": "row.v1:sha256:" + "b" * 64}


def row(item="prepared-DF1", flow="DF1"):
    reference = "assessment:" + item
    return {
        "assessment_item_id": item,
        "assessment_row_ref": reference,
        "flow": flow,
        "measurements": {
            name: {"state": "available", "value": value, "reason": None, "unit": unit,
                   "provenance": {"kind": "declared_prepared_measurement",
                                  "declaration_ref": "T25-AC07:independent-arithmetic",
                                  "assessment_row_refs": [reference], "original_row_refs": []}}
            for name, unit, _scope, value in CELLS
        },
    }


def reseal(document):
    """Independent checksum oracle; invalid cases must reach semantic validation."""
    meaning = {key: value for key, value in document.items() if key not in {"content_id", "presentation"}}
    raw = json.dumps(meaning, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=True).encode("utf-8")
    document["content_id"] = "bpic19-prepared-input.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    return document


class PreparedInputContractTests(unittest.TestCase):
    def setUp(self):
        self.artifact = build_prepared_input([row()])

    def assert_rejected(self, document):
        with self.assertRaises(ValueError):
            PreparedInput(reseal(document))

    def test_frozen_catalogue_bytes_survive_git_autocrlf_checkout(self):
        root = Path(__file__).resolve().parents[1]
        relative = Path("apps/api/src/wise_platform_api/bpic19_reference/historical-notebook-norm.json")
        original = (root / relative).read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory)
            subprocess.run(["git", "init", "--quiet", str(checkout)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(checkout), "config", "core.autocrlf", "true"], check=True)
            (checkout / ".gitattributes").write_bytes((root / ".gitattributes").read_bytes())
            target = checkout / relative
            target.parent.mkdir(parents=True)
            target.write_bytes(original)
            subprocess.run(["git", "-C", str(checkout), "add", "--", ".gitattributes", relative.as_posix()],
                           check=True, capture_output=True)
            target.unlink()
            subprocess.run(["git", "-C", str(checkout), "checkout-index", "--force", "--", relative.as_posix()],
                           check=True, capture_output=True)
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(),
                             "498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef")

    def test_frozen_catalogue_still_refuses_a_meaning_changed_byte(self):
        raw = Path(bpic19_method.__file__).with_name("bpic19_reference").joinpath("historical-notebook-norm.json").read_bytes()
        changed = raw.replace(b'"within_layer_weight": 1.2', b'"within_layer_weight": 1.3', 1)
        self.assertNotEqual(raw, changed)
        self.assertEqual(json.loads(changed)["constraints"][0]["within_layer_weight"], 1.3)
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory)
            reference = fixture / "bpic19_reference" / "historical-notebook-norm.json"
            reference.parent.mkdir()
            reference.write_bytes(changed)
            # Redirect only the filesystem resource location; use the real loader and raw-byte guard.
            with patch.object(bpic19_method, "__file__", str(fixture / "bpic19_method.py")):
                self.assertEqual(bpic19_method.historical_catalogue()["source_sha256"], hashlib.sha256(changed).hexdigest())
                with self.assertRaisesRegex(ValueError, "The frozen historical catalogue differs"):
                    binding_catalogue()

    def test_exact_existing_29_attributes_units_scopes_and_schema_declarations(self):
        expected = {name: (unit, scopes) for name, unit, scopes, _value in CELLS}
        self.assertEqual(len(expected), 29)
        self.assertEqual({b.attribute: (b.unit, b.applicable_flows) for b in binding_catalogue()}, expected)
        native, omissions, _bindings = bpic19_method._historical_binding()
        self.assertEqual(omissions, [])
        self.assertEqual({c["params"]["attribute"] for c in native["constraints"]}, set(expected))
        schema = json.loads((Path(__file__).resolve().parents[1] / "contracts/bpic19-prepared-input.schema.json").read_text())
        declarations = schema["$defs"]["Measurements"]
        self.assertEqual(set(declarations["required"]), set(expected))
        self.assertEqual(set(declarations["properties"]), set(expected))
        for name, (unit, scopes) in expected.items():
            declaration = declarations["properties"][name]
            self.assertEqual(declaration["allOf"][0], {"$ref": "#/$defs/Measurement"})
            self.assertEqual(declaration["allOf"][1]["properties"]["unit"], {"const": unit})
            self.assertEqual(tuple(declaration["x-applicable-flows"]), scopes)
        self.assertEqual(schema["properties"]["catalogue_sha256"]["const"],
                         "498d0464d11ede078bf75818d0b329ff946077ffbe93a4b6f5f4aaf27eeddaef")
        self.assertEqual(schema["properties"]["profile_id"]["const"], native["name"])
        states = schema["$defs"]["Measurement"]["oneOf"]
        self.assertEqual(states[0]["properties"]["state"], {"const": "available"})
        self.assertEqual(states[0]["properties"]["reason"], {"type": "null"})
        self.assertEqual(states[1]["properties"]["state"], {"const": "unavailable"})
        self.assertEqual(states[1]["properties"]["value"], {"type": "null"})
        self.assertEqual(states[1]["properties"]["reason"], {"$ref": "#/$defs/Text"})
        for name, unit, _scope, _value in CELLS:
            domains = declarations["properties"][name]["allOf"][1]["properties"]["value"]["anyOf"]
            self.assertEqual(domains[1], {"type": "null"})
            if unit in ("event_occurrences", "resource_proxy_events", "resource_proxy_identities"):
                self.assertEqual(domains[0], {"type": "integer", "minimum": 0, "maximum": 9007199254740991})
            elif unit == "boolean_observation":
                self.assertEqual(domains[0], {"type": "number", "enum": [0, 1]})
            elif unit in ("share_of_original_events", "normalized_proxy"):
                self.assertEqual(domains[0], {"type": "number", "minimum": 0, "maximum": 1})
            else:
                self.assertEqual(domains[0], {"type": "number", "minimum": 0, "maximum": 1.7976931348623157e308})
        # Every object level is closed, including nested provenance/reference and
        # presentation objects; do not depend on generated model coercion.
        def check_objects(node):
            if isinstance(node, dict):
                if node.get("type") == "object":
                    self.assertIs(node.get("additionalProperties"), False)
                for child in node.values():
                    check_objects(child)
            elif isinstance(node, list):
                for child in node:
                    check_objects(child)
        check_objects(schema)

    def test_closed_keys_at_every_object_level(self):
        for level in ("top", "row", "measurements", "cell", "provenance", "original", "presentation"):
            with self.subTest(level=level):
                document = self.artifact.to_dict()
                source_row = document["rows"][0]
                cell = source_row["measurements"][COUNT]
                if level == "top":
                    target = document
                elif level == "row":
                    target = source_row
                elif level == "measurements":
                    target = source_row["measurements"]
                elif level == "cell":
                    target = cell
                elif level == "provenance":
                    target = cell["provenance"]
                elif level == "original":
                    target = deepcopy(ORIGINAL)
                    cell["provenance"]["original_row_refs"] = [target]
                else:
                    target = {"item_order": [source_row["assessment_item_id"]]}
                    document["presentation"] = target
                target["unexpected"] = "must refuse"
                self.assert_rejected(document)

    def test_unknown_operator_policy_attribute_algorithm_and_norm_refused(self):
        for field in ("operator", "policy", "expression", "algorithm", "norm"):
            document = self.artifact.to_dict()
            document["rows"][0]["measurements"][COUNT][field] = "arbitrary"
            with self.subTest(field=field):
                self.assert_rejected(document)
        for field, value in (("input_policy", "invented.v1"), ("profile_id", "paper"),
                             ("catalogue_sha256", "0" * 64), ("schema_version", 2),
                             ("schema_version", True), ("artifact_kind", "generic")):
            document = self.artifact.to_dict()
            document[field] = value
            with self.subTest(field=field, value=value):
                self.assert_rejected(document)

    def test_missing_fields_never_default_to_available_or_zero(self):
        for level, fields in (("top", ("schema_version", "rows", "input_policy")),
                              ("row", ("assessment_item_id", "assessment_row_ref", "flow", "measurements")),
                              ("cell", ("state", "value", "reason", "unit", "provenance")),
                              ("provenance", ("kind", "declaration_ref", "assessment_row_refs", "original_row_refs"))):
            for field in fields:
                document = self.artifact.to_dict()
                source_row = document["rows"][0]
                cell = source_row["measurements"][COUNT]
                target = {"top": document, "row": source_row, "cell": cell, "provenance": cell["provenance"]}[level]
                del target[field]
                with self.subTest(level=level, field=field):
                    self.assert_rejected(document)
        for attribute, _unit, _scope, _value in CELLS:
            document = self.artifact.to_dict()
            del document["rows"][0]["measurements"][attribute]
            with self.subTest(attribute=attribute):
                self.assert_rejected(document)
        document = self.artifact.to_dict()
        del document["content_id"]
        with self.assertRaises(ValueError):
            PreparedInput(document)

    def test_nonobject_and_wrong_container_shapes_refused(self):
        for document in (None, [], "artifact"):
            with self.subTest(document=document), self.assertRaises(ValueError):
                PreparedInput(document)
        for field in ("rows", "row", "measurements", "cell", "provenance", "original_row_refs", "assessment_row_refs"):
            document = self.artifact.to_dict()
            source_row = document["rows"][0]
            cell = source_row["measurements"][COUNT]
            if field == "rows":
                document["rows"] = {}
            elif field == "row":
                document["rows"][0] = []
            elif field == "measurements":
                source_row["measurements"] = []
            elif field == "cell":
                source_row["measurements"][COUNT] = []
            elif field == "provenance":
                cell["provenance"] = []
            else:
                cell["provenance"][field] = "a reference is not an array"
            with self.subTest(field=field):
                self.assert_rejected(document)

    def test_nonfinite_bool_and_nonnumeric_values_refused_in_every_attribute(self):
        for attribute, _unit, _scope, _value in CELLS:
            for value in (True, False, float("nan"), float("inf"), -float("inf"), "0", None, 10**400):
                document = self.artifact.to_dict()
                document["rows"][0]["measurements"][attribute]["value"] = value
                with self.subTest(attribute=attribute, value=str(value)[:20]):
                    self.assert_rejected(document)

    def test_numeric_domains_are_existing_measurement_domains(self):
        for attribute, value in ((COUNT, -1), (COUNT, 0.5), (COUNT, 2**53), (TIME, -0.1),
                                 ("c_l2_df1_invoice_after_goods", 0.5), ("c_l2_df2_release_after_goods", 2),
                                 ("c_l7_manual_share", 1.01), ("c_l6_high_exposure_memo", 1.01),
                                 ("c_l6_bal_networth_volatility", -0.1)):
            document = self.artifact.to_dict()
            document["rows"][0]["measurements"][attribute]["value"] = value
            with self.subTest(attribute=attribute, value=value):
                self.assert_rejected(document)
        inputs = row()
        inputs["measurements"][TIME]["value"] = 0
        inputs["measurements"][COUNT]["value"] = 2**53 - 1
        inputs["measurements"]["c_l6_bal_networth_volatility"]["value"] = 2.5
        self.assertEqual(build_prepared_input([inputs]).method_attributes()[0][TIME], 0)

    def test_contradictory_availability_refused(self):
        for updates in ({"state": "unavailable"}, {"state": "unknown"}, {"state": True},
                        {"reason": "missing"}, {"state": "available", "value": None},
                        {"state": "unavailable", "value": None, "reason": ""},
                        {"state": "unavailable", "value": None, "reason": "   "}):
            document = self.artifact.to_dict()
            document["rows"][0]["measurements"][COUNT].update(updates)
            with self.subTest(updates=updates):
                self.assert_rejected(document)

    def test_exact_available_zero_and_explicit_unavailable_survive_transport(self):
        known = self.artifact
        inputs = row()
        inputs["measurements"][COUNT].update(state="unavailable", value=None, reason="not declared by fixture author")
        unknown = build_prepared_input([inputs])
        self.assertEqual(known.method_attributes()[0][COUNT], 0)
        self.assertIsNone(unknown.method_attributes()[0][COUNT])
        self.assertNotEqual(known.content_id, unknown.content_id)
        cell = PreparedInput.from_json(unknown.to_json()).to_dict()["rows"][0]["measurements"][COUNT]
        self.assertEqual((cell["state"], cell["value"], cell["reason"]),
                         ("unavailable", None, "not declared by fixture author"))
        self.assertEqual(cell["provenance"]["original_row_refs"], [])

    def test_flow_scope_units_and_declared_provenance_preserved_without_raw_claim(self):
        inputs = [row("item:" + flow, flow) for flow in ALL]
        inputs[0]["measurements"][TIME]["provenance"]["original_row_refs"] = [deepcopy(ORIGINAL)]
        artifact = build_prepared_input(inputs)
        self.assertEqual(PreparedInput.from_json(artifact.to_json()).to_dict()["rows"], inputs)
        for attrs, source_row in zip(artifact.method_attributes(), inputs):
            self.assertEqual(attrs["flow"], source_row["flow"])
            self.assertEqual(attrs["assessment_row_id"], source_row["assessment_row_ref"])
            self.assertEqual(attrs["case_id"], source_row["assessment_item_id"])
            self.assertEqual(set(attrs), {"case_id", "assessment_row_id", "flow"} | {c[0] for c in CELLS})
            self.assertNotIn("row_ids", attrs)
            self.assertNotIn("activity", attrs)
            self.assertNotIn("time", attrs)
        provenance = artifact.to_dict()["rows"][0]["measurements"][TIME]["provenance"]
        self.assertEqual(provenance["original_row_refs"], [ORIGINAL])
        self.assertEqual(provenance["assessment_row_refs"], ["assessment:item:DF1"])
        self.assertEqual(provenance["kind"], "declared_prepared_measurement")

    def test_invalid_identity_flow_unit_and_provenance_refused(self):
        for key, value in (("assessment_item_id", ""), ("assessment_row_ref", " "),
                           ("flow", "2-way"), ("flow", None), ("flow", "unknown")):
            inputs = row()
            inputs[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                build_prepared_input([inputs])
        for updates in ({"assessment_row_refs": []}, {"assessment_row_refs": ["unrelated"]},
                        {"assessment_row_refs": ["assessment:prepared-DF1"] * 2},
                        {"kind": "verified_raw_witness"}, {"declaration_ref": ""},
                        {"original_row_refs": ["raw-1"]},
                        {"original_row_refs": [{"source_id": ORIGINAL["source_id"], "row_id": "assessment:prepared-DF1"}]},
                        {"original_row_refs": [ORIGINAL, ORIGINAL]}):
            inputs = row()
            inputs["measurements"][TIME]["provenance"].update(updates)
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                build_prepared_input([inputs])
        inputs = row()
        inputs["measurements"][TIME]["unit"] = "hours"
        with self.assertRaises(ValueError):
            build_prepared_input([inputs])

    def test_duplicate_items_rows_empty_rows_and_invalid_presentation_refused(self):
        for inputs in ([], [row(), row()]):
            with self.assertRaises(ValueError):
                build_prepared_input(inputs)
        other = row("second")
        other["assessment_row_ref"] = row()["assessment_row_ref"]
        with self.assertRaises(ValueError):
            build_prepared_input([row(), other])
        for order in ([], ["missing"], ["prepared-DF1", "prepared-DF1"]):
            with self.subTest(order=order), self.assertRaises(ValueError):
                build_prepared_input([row()], presentation_order=order)

    def test_every_valid_meaning_change_creates_a_new_content_identity(self):
        base = self.artifact.content_id
        for change in ("value", "flow", "item", "assessment_ref", "declaration", "original_ref", "reason"):
            inputs = row()
            cell = inputs["measurements"][COUNT]
            if change == "value":
                cell["value"] = 1
            elif change == "flow":
                inputs["flow"] = "DF2"
            elif change == "item":
                inputs["assessment_item_id"] = "another-item"
            elif change == "assessment_ref":
                inputs["assessment_row_ref"] = "assessment:changed"
                for measure in inputs["measurements"].values():
                    measure["provenance"]["assessment_row_refs"] = ["assessment:changed"]
            elif change == "declaration":
                cell["provenance"]["declaration_ref"] = "a different prepared declaration"
            elif change == "original_ref":
                cell["provenance"]["original_row_refs"] = [deepcopy(ORIGINAL)]
            else:
                cell.update(state="unavailable", value=None, reason="declared unavailable")
            with self.subTest(change=change):
                self.assertNotEqual(build_prepared_input([inputs]).content_id, base)
        inputs = row()
        inputs["measurements"][COUNT].update(state="unavailable", value=None, reason="first reason")
        first = build_prepared_input([inputs])
        inputs["measurements"][COUNT]["reason"] = "second reason"
        self.assertNotEqual(first.content_id, build_prepared_input([inputs]).content_id)
        inputs = row()
        inputs["measurements"][TIME]["provenance"]["original_row_refs"] = [deepcopy(ORIGINAL)]
        original = build_prepared_input([inputs])
        for field, replacement in (("source_id", "source.v1:sha256:" + "c" * 64),
                                   ("row_id", "row.v1:sha256:" + "d" * 64)):
            changed = deepcopy(inputs)
            changed["measurements"][TIME]["provenance"]["original_row_refs"][0][field] = replacement
            with self.subTest(reference_field=field):
                self.assertNotEqual(original.content_id, build_prepared_input([changed]).content_id)

    def test_declared_array_order_is_hashed_but_display_and_object_order_are_not(self):
        inputs = [row(), row("second")]
        provenance = inputs[0]["measurements"][TIME]["provenance"]
        provenance["assessment_row_refs"].append("assessment:second")
        provenance["original_row_refs"] = [deepcopy(ORIGINAL), {**ORIGINAL, "row_id": "row.v1:sha256:" + "c" * 64}]
        artifact = build_prepared_input(inputs)
        self.assertNotEqual(artifact.content_id, build_prepared_input(list(reversed(inputs))).content_id)
        for reference_field in ("assessment_row_refs", "original_row_refs"):
            changed = deepcopy(inputs)
            changed[0]["measurements"][TIME]["provenance"][reference_field].reverse()
            self.assertNotEqual(artifact.content_id, build_prepared_input(changed).content_id)
        display = build_prepared_input(inputs, presentation_order=["second", "prepared-DF1"])
        self.assertEqual(display.content_id, artifact.content_id)
        self.assertNotEqual(display.to_json(), artifact.to_json())
        document = artifact.to_dict()
        reversed_objects = json.dumps(document, sort_keys=True, ensure_ascii=False, indent=4)
        self.assertEqual(PreparedInput.from_json(reversed_objects).to_json(), artifact.to_json())

    def test_snapshot_is_immutable_and_independently_checksummed(self):
        inputs = [row()]
        artifact = build_prepared_input(inputs)
        original = artifact.to_json()
        inputs[0]["measurements"][COUNT]["value"] = 999
        detached = artifact.to_dict()
        detached["rows"].clear()
        attributes = artifact.method_attributes()
        attributes[0][COUNT] = 999
        self.assertEqual(artifact.to_json(), original)
        with self.assertRaises(FrozenInstanceError):
            artifact._serialized = b"{}"
        independent = reseal({k: v for k, v in artifact.to_dict().items() if k != "content_id"})
        self.assertEqual(artifact.content_id, independent["content_id"])
        changed = artifact.to_dict()
        changed["rows"][0]["measurements"][COUNT]["value"] = 1
        with self.assertRaisesRegex(ValueError, "content_id"):
            PreparedInput(changed)

    def test_reopen_is_deterministic_and_rejects_duplicate_keys_and_nonfinite_json(self):
        self.assertEqual(PreparedInput.from_json(self.artifact.to_json()).to_json(), self.artifact.to_json())
        duplicate = self.artifact.to_json().decode().replace('"reason":null', '"reason":null,"reason":null', 1)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            PreparedInput.from_json(duplicate)
        for token in ("NaN", "Infinity", "-Infinity", "1e10000"):
            payload = self.artifact.to_json().decode().replace('"value":0', '"value":' + token, 1)
            with self.subTest(token=token), self.assertRaises(ValueError):
                PreparedInput.from_json(payload)

    def test_unicode_identity_uses_the_existing_utf8_canonical_convention(self):
        inputs = row("prepared-Δ")
        inputs["measurements"][COUNT]["provenance"]["declaration_ref"] = "déclaration:Δ"
        artifact = build_prepared_input([inputs])
        self.assertIn("déclaration:Δ".encode("utf-8"), artifact.to_json())
        expected = reseal({k: v for k, v in artifact.to_dict().items() if k != "content_id"})
        self.assertEqual(artifact.content_id, expected["content_id"])
        escaped = json.dumps(artifact.to_dict(), ensure_ascii=True)
        self.assertEqual(PreparedInput.from_json(escaped).to_json(), artifact.to_json())

    def test_actual_packed_method_consumes_prepared_attributes_with_all_four_view_oracles(self):
        problem = method.method_problem()
        if problem is not None:
            self.skipTest("Packed Method consumption unavailable in image: " + problem.message)
        wise, pandas = method._wise(), method._pandas()
        document, omissions, _bindings = bpic19_method._historical_binding()
        self.assertEqual(omissions, [])
        norm = wise.Norm.from_dict(document)
        norm.validate()
        # These timestamps/activity names are native transport plumbing only,
        # exactly as in the existing bridge. They are not artifact/source rows.
        frame = pandas.DataFrame([{**attrs, "activity": "prepared_measure_transport", "time": "2000-01-01T00:00:00Z"}
                                  for attrs in self.artifact.method_attributes()])
        log = wise.EventLog(frame, case_col="case_id", activity_col="activity", timestamp_col="time",
                            event_id_col="assessment_row_id", case_attributes=["flow"] + [c[0] for c in CELLS],
                            utc=True, dedupe=False)
        result = wise.score(log, norm, mode="layer_balanced", derive=False)
        result.check_decomposition()
        expected_scope = {name for name, _unit, flows, _value in CELLS if "DF1" in flows}
        item = "prepared-DF1"
        self.assertEqual({c for c, scoped in result.in_scope.loc[item].items() if scoped}, expected_scope)
        self.assertEqual({c for c, evaluated in result.applicable.loc[item].items() if evaluated}, expected_scope)
        self.assertEqual(len(expected_scope), 24)
        penalties = (0, 1, 0.5, 0, 1.3 / 5.7, 2.35 / 5.8, 2.7 / 4.4)
        weights = {
            "Finance": (0.24, 0.08, 0.24, 0.06, 0.08, 0.24, 0.06),
            "Logistics": (0.08, 0.24, 0.22, 0.22, 0.08, 0.04, 0.12),
            "Compliance": (0.12, 0.30, 0.10, 0.06, 0.26, 0.06, 0.10),
            "Automation": (0.06, 0.08, 0.10, 0.28, 0.06, 0.08, 0.34),
        }
        for view, layer_weights in weights.items():
            expected_score = 1 - sum(p * w for p, w in zip(penalties, layer_weights))
            self.assertAlmostEqual(result.scores.loc[item, view], expected_score, delta=1e-8)
            self.assertAlmostEqual(result.contributions[view].loc[item].sum(), 1 - expected_score, delta=1e-8)
            raw = norm.raw_weights(view)
            scoped_weight = math.fsum(raw[c] for c in expected_scope)
            evaluated_weight = math.fsum(raw[c] for c in result.applicable.columns if result.applicable.loc[item, c])
            self.assertEqual(evaluated_weight / scoped_weight, 1)


if __name__ == "__main__":
    unittest.main()
