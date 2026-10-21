"""Write the invented source collection of tests/fixtures/catalogue (#99): every byte is made up here.

The collection looks like an analyst's folder: a service-desk event log with the usual faults, a team table taken as a
current snapshot, an archive holding a byte-identical copy of the log, a September export cropped by date and earlier
scores; an XES log with lifecycle transitions, trace attributes and a nested attribute; an object-centric OCEL 2.0 log
of orders, items and packages; a cache, an old workspace folder and a note. No real person, ticket or company is
described. The output is the same on every run, so the committed files can be checked against it.

    python tools/make_catalogue_fixture.py [--output tests/fixtures/catalogue/collection]
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path
import random
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / "tests/fixtures/catalogue/collection"
ZIP_TIME = (2026, 10, 1, 12, 0, 0)


def tickets() -> list[list[str]]:
    """Forty invented tickets over September and October 2026, with one of each fault the catalogue reconciles."""
    rng = random.Random(99)
    rows: list[list[str]] = []
    paths = [["Opened", "Assigned", "Resolved", "Closed"], ["Opened", "Assigned", "Asked customer", "Customer replied", "Resolved", "Closed"],
             ["Opened", "Resolved", "Closed"], ["Opened", "Assigned", "Asked customer", "Resolved"]]
    for number in range(1, 41):
        ticket = f"T-{number:03d}"
        day, hour = 1 + (number * 7) % 40, 8 + number % 5
        team, channel = f"D{1 + number % 4}", ("Phone", "Mail", "Portal")[number % 3]
        if number in (6, 21):
            team = "D9"
        minutes = 0
        for activity in paths[number % 4]:
            month, mday = (9, day) if day <= 30 else (10, day - 30)
            stamp = f"2026-{month:02d}-{mday:02d}T{hour + minutes // 60:02d}:{minutes % 60:02d}:00+02:00"
            rows.append([ticket, activity, stamp, team, channel])
            minutes += 15 + rng.randrange(0, 40)
    # The faults, each once, placed among the records.
    rows.insert(3, ["", "Opened", "2026-09-02T09:00:00+02:00", "D1", "Mail"])
    at = next(index for index, row in enumerate(rows) if row[0] == "T-005")
    rows[at + 1][1] = ""
    at = next(index for index, row in enumerate(rows) if row[0] == "T-007")
    rows[at + 2][2] = "31.09.2026 10:00"
    at = next(index for index, row in enumerate(rows) if row[0] == "T-010")
    rows.insert(at + 1, list(rows[at + 1]))
    at = next(index for index, row in enumerate(rows) if row[0] == "T-012")
    rows[at + 1][2] = rows[at][2]
    at = next(index for index, row in enumerate(rows) if row[0] == "T-015")
    rows[at + 2] = rows[at + 2] + ["left over"]
    at = next(index for index, row in enumerate(rows) if row[0] == "T-030")
    rows.insert(at, [])
    return rows


def csv_text(header: list[str], rows: list[list[str]]) -> bytes:
    def cell(value: str) -> str:
        return f'"{value}"' if any(mark in value for mark in ',"\r\n') else value
    return "".join(",".join(cell(value) for value in row) + "\r\n" for row in [header, *rows]).encode("utf-8")


TICKET_HEADER = ["Ticket", "Status", "At", "Team", "Channel"]


def september(rows: list[list[str]]) -> list[list[str]]:
    """The export as it was supplied: the records dated in September, so histories crossing into October are cropped."""
    return [row for row in rows if len(row) >= 3 and row[2].startswith("2026-09-")]


def teams() -> bytes:
    rows = [["D1", "First line", "North"], ["D2", "Second line", "North"], ["D3", "Field service", "South"],
            ["D3", "Field service (old name)", "South"], ["D4", "Accounts", "West"]]
    return csv_text(["Team", "Team name", "Region"], rows)


def xes() -> bytes:
    """Eight invented service cases; every activity has a start and a complete, one label and one time are missing."""
    rng = random.Random(1999)
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<log xes.version="1.0" xes.features="nested-attributes">',
             '  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>',
             '  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>',
             '  <extension name="Lifecycle" prefix="lifecycle" uri="http://www.xes-standard.org/lifecycle.xesext"/>',
             '  <extension name="Organizational" prefix="org" uri="http://www.xes-standard.org/org.xesext"/>',
             '  <global scope="event">', '    <string key="concept:name" value="__INVALID__"/>', '  </global>',
             '  <classifier name="Activity" keys="concept:name lifecycle:transition"/>',
             '  <string key="concept:name" value="Invented service visits"/>']
    for number in range(1, 9):
        lines += ["  <trace>", f'    <string key="concept:name" value="S-{number}"/>',
                  f'    <string key="channel" value="{("Phone", "Portal")[number % 2]}"/>',
                  f'    <boolean key="priority" value="{"true" if number % 3 == 0 else "false"}"/>']
        minute = 0
        for step, activity in enumerate(["Register", "Visit", "Report"][: 2 + number % 2]):
            for transition in ("start", "complete"):
                minute += 10 + rng.randrange(0, 50)
                attributes = []
                if not (number == 4 and step == 1 and transition == "start"):
                    attributes.append(f'<string key="concept:name" value="{activity}"/>')
                attributes.append(f'<string key="lifecycle:transition" value="{transition}"/>')
                if not (number == 6 and step == 0 and transition == "complete"):
                    attributes.append(f'<date key="time:timestamp" value="2026-08-{number:02d}T{9 + minute // 60:02d}:{minute % 60:02d}:00.000+02:00"/>')
                attributes.append(f'<string key="org:resource" value="Engineer {1 + (number + step) % 3}"/>')
                if transition == "complete":
                    attributes.append(f'<float key="cost" value="{12.5 * (step + 1) + number}"/>')
                if number == 2 and activity == "Visit" and transition == "complete":
                    attributes.append('<list key="parts"><values><string key="part" value="Valve"/><string key="part" value="Seal"/></values></list>')
                lines.append("    <event>" + "".join(attributes) + "</event>")
        lines.append("  </trace>")
    lines.append("</log>")
    return ("\n".join(lines) + "\n").encode("utf-8")


def ocel() -> bytes:
    """Five invented orders, nine items and three packages; events relate to several objects with qualifiers."""
    orders = [f"O-{n}" for n in range(1, 6)]
    items = {order: [f"I-{2 * index + k}" for k in (1, 2)][: 1 + index % 2] for index, order in enumerate(orders)}
    item_ids = [item for order in orders for item in items[order]]
    packages = ["P-1", "P-2", "P-3"]
    carried = {package: [] for package in packages}
    for index, item in enumerate(item_ids):
        carried[packages[index % 3]].append(item)
    events, clock = [], 0

    def event(kind: str, relations: list[tuple[str, str]], **attributes) -> None:
        nonlocal clock
        clock += 37
        events.append({"id": f"e{len(events) + 1}", "type": kind, "time": f"2026-07-{1 + clock // 1440:02d}T{clock % 1440 // 60:02d}:{clock % 60:02d}:00Z",
                       "attributes": [{"name": name, "value": value} for name, value in sorted(attributes.items())],
                       "relationships": [{"objectId": object_id, "qualifier": qualifier} for object_id, qualifier in relations]})

    for order in orders:
        event("place order", [(order, "order")] + [(item, "part") for item in items[order]], channel="Portal")
    for item in item_ids:
        event("pick item", [(item, "picked")], picker=f"Picker {1 + int(item[2:]) % 2}")
    event("check stock", [], note="no object")
    for package in packages:
        event("pack", [(package, "package")] + [(item, "packed") for item in carried[package]])
    for package in packages:
        owners = sorted({order for order in orders for item in carried[package] if item in items[order]})
        event("ship", [(package, "shipped")] + [(order, "delivered") for order in owners], carrier="Invented Freight")
    objects = []
    for index, order in enumerate(orders):
        objects.append({"id": order, "type": "order",
                        "attributes": [{"name": "value", "time": "1970-01-01T00:00:00Z", "value": 100 + 10 * index},
                                       {"name": "value", "time": "2026-07-02T00:00:00Z", "value": 90 + 10 * index}],
                        "relationships": [{"objectId": item, "qualifier": "contains"} for item in items[order]]})
    for item in item_ids:
        objects.append({"id": item, "type": "item", "attributes": [{"name": "weight", "time": "1970-01-01T00:00:00Z", "value": int(item[2:]) * 0.5}],
                        "relationships": []})
    for package in packages:
        objects.append({"id": package, "type": "package", "attributes": [],
                        "relationships": [{"objectId": item, "qualifier": "carries"} for item in carried[package]]})
    document = {"objectTypes": [{"name": "item", "attributes": [{"name": "weight", "type": "float"}]},
                                {"name": "order", "attributes": [{"name": "value", "type": "float"}]},
                                {"name": "package", "attributes": []}],
                "eventTypes": [{"name": "check stock", "attributes": [{"name": "note", "type": "string"}]},
                               {"name": "pack", "attributes": []},
                               {"name": "pick item", "attributes": [{"name": "picker", "type": "string"}]},
                               {"name": "place order", "attributes": [{"name": "channel", "type": "string"}]},
                               {"name": "ship", "attributes": [{"name": "carrier", "type": "string"}]}],
                "objects": objects, "events": events}
    return (json.dumps(document, indent=1, ensure_ascii=False) + "\n").encode("utf-8")


def archive(rows: list[list[str]], log: bytes) -> bytes:
    buffer = io.BytesIO()
    # These small invented members are stored without compression: zlib and zlib-ng
    # produce different valid DEFLATE bytes for the same input on supported hosts.
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as bundle:
        scores = {"note": "Invented scores from an earlier analysis; not an event log.",
                  "scores": [{"ticket": f"T-{n:03d}", "score": round(0.1 * (n % 10), 1)} for n in range(1, 11)]}
        for name, content in [("tickets-copy.csv", log), ("tickets-2026-09.csv", csv_text(TICKET_HEADER, september(rows))),
                              ("scores/earlier-scores.json", (json.dumps(scores, indent=1) + "\n").encode("utf-8"))]:
            info = zipfile.ZipInfo(name, ZIP_TIME)
            info.create_system = 3  # Keep the committed Unix ZIP metadata on every host.
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, content)
    return buffer.getvalue()


def collection() -> dict[str, bytes]:
    rows = tickets()
    log = csv_text(TICKET_HEADER, rows)
    return {
        "README.txt": ("An invented collection for the preparation catalogue of WISE (#99). Nothing here describes a real\n"
                       "person, ticket or company.\n").encode("utf-8"),
        "desk/tickets.csv": log,
        "desk/teams.csv": teams(),
        "desk/exports.zip": archive(rows, log),
        "service/visits.xes": xes(),
        "orders/orders.ocel.json": ocel(),
        "cache/population.cache": bytes(range(64)),
        "old-workspace/workspace.json": b'{"note": "an invented earlier workspace"}\n',
        "old-workspace/revisions/r1.json": b'{"note": "an invented earlier saved revision"}\n',
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=DEFAULT)
    args = parser.parse_args()
    for name, content in collection().items():
        path = args.output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
