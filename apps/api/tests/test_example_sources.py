"""The packaged synthetic examples: their bytes, their labels and how they are read."""

import fnmatch
import hashlib
import tomllib
from datetime import datetime, timezone
from pathlib import Path

import pytest
from api_requests import FIXTURES, ROOT

import wise_platform_api
from wise_platform_api.examples import CATALOG, PACKAGED_EXAMPLES, read_example

PACKAGE = Path(wise_platform_api.__file__).parent

# SHA-256 of each fixture event history, computed once with an independent tool.
DIGESTS = {
    "S0": "795a78f842a08e292de49651f309549578b18e80bcc179b6db01aec5eff0db3b",
    "S1": "73d6e28c3a4a85daa635eed7938b4c0809d28e9f62014cfe31a315e34bcc6856",
    "S2": "c133fbc366bd9c20b518e3a3e445bf064bb5d789978b78fecef560027b40923a",
    "S3": "3b4e64d704704c51ace18fdcefba2248c2f1f946599676f1782e59650362b058",
}


@pytest.mark.parametrize("example", sorted(DIGESTS))
def test_each_packaged_example_has_the_checksum_of_its_fixture(example):
    packaged = (PACKAGE / "examples" / f"{example}.csv").read_bytes()

    assert hashlib.sha256(packaged).hexdigest() == DIGESTS[example]
    assert packaged == (FIXTURES / f"{example}.csv").read_bytes()


def test_the_packaged_examples_are_read_from_the_package_itself():
    assert PACKAGED_EXAMPLES == PACKAGE / "examples"
    assert "tests" not in PACKAGED_EXAMPLES.relative_to(PACKAGE).parts


def test_the_examples_are_package_data():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    patterns = project["tool"]["setuptools"]["package-data"]["wise_platform_api"]

    for example in sorted(DIGESTS):
        name = f"examples/{example}.csv"
        assert any(fnmatch.fnmatch(name, pattern) for pattern in patterns), name


def test_every_example_of_the_contract_is_labelled_synthetic_with_its_cutoff():
    assert sorted(CATALOG) == ["S0", "S1", "S2", "S3"]
    for example_id, example in CATALOG.items():
        assert example.example_id == example_id
        assert example.label.startswith("Synthetic example")
        # The fixtures declare one observation cutoff for all four examples.
        assert example.snapshot_cutoff_utc == datetime(2026, 10, 2, tzinfo=timezone.utc)


def test_an_example_is_read_as_its_exact_bytes(tmp_path):
    (tmp_path / "S1.csv").write_bytes(b"a,b\r\n\xef\xbb\xbf")

    assert read_example(tmp_path, "S1") == b"a,b\r\n\xef\xbb\xbf"
    assert read_example(PACKAGED_EXAMPLES, "S2") == (FIXTURES / "S2.csv").read_bytes()


def test_a_missing_or_unreadable_example_is_none(tmp_path):
    (tmp_path / "S2.csv").mkdir()

    assert read_example(tmp_path / "absent", "S0") is None
    assert read_example(tmp_path, "S0") is None
    assert read_example(tmp_path, "S2") is None


def test_only_catalogued_examples_are_read(tmp_path):
    (tmp_path / "S9.csv").write_bytes(b"x")

    with pytest.raises(KeyError):
        read_example(tmp_path, "S9")
