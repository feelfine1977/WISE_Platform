"""The metadata of a source upload, read from the query parameters."""

import pytest

from wise_platform_api.import_boundary import upload_message

HALF = "\ud800"


def test_whole_numbers_in_ascii_digits_are_read_as_numbers_and_other_text_stays_text():
    message = upload_message(
        [("schema_version", "1"), ("query_revision", "07"), ("filename", "Vorgänge 2026.csv")]
    )

    assert message == {"schema_version": 1, "query_revision": "07", "filename": "Vorgänge 2026.csv"}


@pytest.mark.parametrize(
    "items",
    [
        [("filename", HALF)],
        [("filename", f"export {HALF}.csv")],
        [(f"file{HALF}name", "export.csv")],
        [(HALF, "1"), (HALF, "2")],
    ],
)
def test_half_a_surrogate_pair_in_a_name_or_value_is_refused_and_not_repeated(items):
    reason = upload_message(items)

    assert isinstance(reason, str)
    assert "not valid Unicode" in reason
    reason.encode("utf-8")


def test_a_parameter_given_twice_is_refused():
    assert isinstance(upload_message([("filename", "a.csv"), ("filename", "b.csv")]), str)


@pytest.mark.parametrize("name", ["schema_version", "query_revision"])
def test_a_number_of_thousands_of_digits_stays_text_and_is_never_converted(name):
    digits = "9" * 5000

    assert upload_message([(name, digits)]) == {name: digits}
    assert upload_message([(name, "9" * 20)]) == {name: int("9" * 20)}
