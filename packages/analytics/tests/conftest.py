"""Small literal inputs shared by the analytics tests."""

from collections.abc import Callable

import pytest

HEADER = "incident_id,source_event_id,source_sequence,activity,timestamp_utc,service,assignment_group"


@pytest.fixture
def csv_source() -> Callable[..., bytes]:
    """Build source bytes from literal rows under the standard header."""

    def build(
        *rows: str, header: str = HEADER, newline: str = "\n", bom: bool = False
    ) -> bytes:
        text = "".join(line + newline for line in (header, *rows))
        return (b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8")

    return build
