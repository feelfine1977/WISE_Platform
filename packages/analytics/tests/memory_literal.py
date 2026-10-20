"""Invented two-record cases with 26 literal context cells for memory qualification."""
import csv
import io

from test_csv_preparation_core import choices, dialect, roles


def cells(position):
    return [f" M{position // 2:05d} ", "Opened" if position % 2 == 0 else "Closed",
            "2018-01-01T00:00:00" if position % 2 == 0 else "2018-01-02T00:00:00",
            *["" if column == 3 else "Unknown" if column == 4 else f"value-{column}" for column in range(3, 29)]]


def source(rows):
    text = io.StringIO(newline="")
    writer = csv.writer(text)
    writer.writerow(["case", "activity", "time", *[f"context-{column}" for column in range(3, 29)]])
    writer.writerows(cells(position) for position in range(rows))
    return text.getvalue().encode()


def arguments(context=True):
    return dialect(delimiter=","), roles(context=range(3, 29) if context else ()), choices(format_name="iso8601")
