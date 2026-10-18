"""Invented BPIC19-shaped rows for memory budgets: 29 prepared columns with the source's kind of repetition.

Nothing here is BPIC19 data. Case attributes repeat across the about six events of a case, event attributes
come from small vocabularies, and the event identifier, source record and net worth are unique per event,
as in the prepared BPIC19 representation.
"""
import csv
import io

from test_csv_preparation_core import choices, dialect, roles

EVENTS_PER_CASE = 6
ACTIVITIES = [f"Activity {index:02d}" for index in range(40)]
SOURCE_COLUMNS = ["eventID ", "case Spend area text", "case Company", "case Document Type", "case Sub spend area text",
                  "case Purchasing Document", "case Purch. Doc. Category name", "case Vendor", "case Item Type",
                  "case Item Category", "case Spend classification text", "case Source", "case Name",
                  "case GR-Based Inv. Verif.", "case Item", "case concept:name", "case Goods Receipt", "event User",
                  "event org:resource", "event concept:name", "event Cumulative net worth (EUR)", "event time:timestamp"]
HEADER = ["case_id", "activity", "timestamp", "source_path", "source_record", "timestamp_kind", "source_field_count",
          *["source__" + name for name in SOURCE_COLUMNS]]


def cells(position):
    case, step = divmod(position, EVENTS_PER_CASE)
    document = 4507000000 + case // 3
    activity = ACTIVITIES[(case + step * 7) % len(ACTIVITIES)]
    day, minute = 1 + case % 28, (case * 13 + step * 97) % 1440
    stamp = f"2018-{1 + case % 12:02d}-{day:02d}T{minute // 60:02d}:{minute % 60:02d}:00"
    vendor = f"vendor_{case % 1975:04d}"
    user = f"user_{(case * 7 + step) % 600:03d}"
    case_id = f"{document}_{(case % 3 + 1) * 10:05d}"
    return [case_id, activity, stamp, "BPIC 2019/BPI_Challenge_2019.csv", str(position + 1), "wall_clock", "22",
            f"ev_{position:08d}", f"Spend area {case % 20}", f"companyID_{case % 4:04d}", f"Doc type {case % 3}",
            f"Sub spend {case % 100}", str(document), f"Category {case % 2}", vendor, f"Item type {case % 7}",
            f"Item category {case % 4}", f"Classification {case % 4}", "sys1", f"Name of {vendor}",
            "true" if case % 2 else "false", f"{(case % 3 + 1) * 10:05d}", case_id, "true" if case % 3 else "false",
            user, user, activity, f"{(position * 7919) % 1000003 / 7:.6f}", f"{day:02d}-{1 + case % 12:02d}-2018 {minute // 60:02d}:{minute % 60:02d}:00.000"]


def source(rows):
    text = io.StringIO(newline="")
    writer = csv.writer(text)
    writer.writerow(HEADER)
    writer.writerows(cells(position) for position in range(rows))
    return text.getvalue().encode()


def arguments():
    return dialect(delimiter=","), roles(context=range(3, len(HEADER))), choices(format_name="iso8601")
