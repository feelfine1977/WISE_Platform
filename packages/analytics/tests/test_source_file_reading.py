"""A stored source file is read as it is parsed, answers exactly as its bytes do, and is refused once it changes."""
import hashlib

import pytest

from bpic_shaped_literal import arguments, native_arguments, native_source, source
from test_csv_preparation_core import choices, dialect, roles
from test_csv_tolerant_rows_v2 import twenty_with_ragged, v2_choices
from wise_platform_analytics.csv_inspection import SourceChanged, SourceFile, inspect_csv
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.preparation import prepare


def stored(tmp_path, raw, name="source.csv"):
    path = tmp_path / name
    path.write_bytes(raw)
    return SourceFile(path, "source.v1:sha256:" + hashlib.sha256(raw).hexdigest())


def answer(result):
    if isinstance(result, ImportRefusal):
        return result.to_dict()
    if isinstance(result, dict):
        return result
    plain = result.to_dict()
    if result.preparation is not None:
        plain["records"] = [record.to_dict() for record in result.preparation.records]
        plain["identity"] = result.preparation.identity_dict()
    return plain


CASES = [
    ("prepared", source(600), arguments()),
    ("native", native_source(600), native_arguments()),
    ("ragged", twenty_with_ragged()[0], (dialect(), roles(context=(3,)), v2_choices())),
    ("undecodable", b'Case,Event,At\r\nA,"bad"x,09.10.2026 08:00\r\n' + b"C,\xff,09.10.2026 08:02\r\n",
     (dialect(delimiter=","), roles(), choices())),
]


@pytest.mark.parametrize("name,raw,interpretation", CASES, ids=[case[0] for case in CASES])
def test_a_stored_file_answers_exactly_as_its_bytes(tmp_path, name, raw, interpretation):
    file = stored(tmp_path, raw)
    assert answer(inspect_csv(file)) == answer(inspect_csv(raw))
    for accept in (False, True):
        assert answer(prepare(file, *interpretation, accept)) == answer(prepare(raw, *interpretation, accept))


def test_a_stored_file_starting_with_a_byte_order_mark_is_inspected_as_utf8_sig(tmp_path):
    raw = b"\xef\xbb\xbfCase;Event;At\r\nA;Observed;09.10.2026 08:00\r\n"
    assert inspect_csv(stored(tmp_path, raw))["dialect_candidates"][0]["encoding"] == "utf-8-sig"


def test_changed_truncated_or_missing_bytes_raise_whatever_the_reading_concluded(tmp_path):
    raw = source(600)
    changed = stored(tmp_path, raw)
    changed.path.write_bytes(raw.replace(b"vendor_0001", b"vendor_9999", 1))
    with pytest.raises(SourceChanged):
        prepare(changed, *arguments(), True)
    with pytest.raises(SourceChanged):
        inspect_csv(changed)
    truncated = stored(tmp_path, raw, "truncated.csv")
    truncated.path.write_bytes(raw[: len(raw) // 2])
    with pytest.raises(SourceChanged):
        prepare(truncated, *arguments(), True)
    # A structural refusal early in the file still checks every remaining byte.
    refused = b'Case,Event,At\r\nA,"bad"x,09.10.2026 08:00\r\n' + b"B,Ok,09.10.2026 08:01\r\n" * 1000
    early = stored(tmp_path, refused, "early.csv")
    early.path.write_bytes(refused + b"B,Ok,09.10.2026 08:02\r\n")
    with pytest.raises(SourceChanged):
        prepare(early, dialect(delimiter=","), roles(), choices(), True)
    missing = stored(tmp_path, raw, "missing.csv")
    missing.path.unlink()
    with pytest.raises(SourceChanged):
        inspect_csv(missing)
