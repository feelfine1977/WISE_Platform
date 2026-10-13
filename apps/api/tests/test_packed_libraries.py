"""The packed libraries in ``vendor`` are the files their manifest names."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

VENDOR = Path(__file__).resolve().parents[3] / "vendor"


def _artifacts() -> list[dict[str, str]]:
    manifest = json.loads((VENDOR / "manifest.json").read_text(encoding="utf-8"))
    return list(manifest["artifacts"])


@pytest.mark.parametrize("artifact", _artifacts(), ids=lambda artifact: artifact["name"])
def test_a_packed_library_has_the_recorded_checksum(artifact: dict[str, str]) -> None:
    packed = VENDOR / artifact["file"]
    assert packed.is_file(), f"{artifact['file']} is named in the manifest and is missing"
    assert hashlib.sha256(packed.read_bytes()).hexdigest() == artifact["sha256"]


def test_every_packed_file_is_named_in_the_manifest() -> None:
    named = {artifact["file"] for artifact in _artifacts()} | {"manifest.json", "README.md"}
    present = {entry.name for entry in VENDOR.iterdir() if entry.is_file()}
    assert present == named
