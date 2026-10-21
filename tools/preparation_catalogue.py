"""A reviewed local preparation catalogue (#99): inventory, conversion, reconciliation and an independent reading.

A catalogue (tools/preparation-catalogue.schema.json) declares every file and archive member of an analyst's source
collection with its provenance, identity, alias classification and analytical role, and the event views prepared from
it. This module checks the declaration against the folder, writes each view as a CSV the import accepts, with side
files for what a CSV row cannot hold, and reads every view again on its own, without the product's code, so that the
product's preparation and evidence can be compared with it cell by cell.

Nothing is cleaned or paired here. Faults are counted and kept: a record without an incident or an activity, an
unreadable time, a repeated observation, tied times, a ragged or blank record and a join key that matches no row or
several rows. Originals stay authoritative; a view is a declared reading of them.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import csv
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
from xml.etree import ElementTree
import zipfile

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "tools/preparation-catalogue.schema.json").read_text(encoding="utf-8"))
EVENT_ROLES = {"event_log", "object_centric_event_log"}
# Files an operating system writes into any folder; they are counted, never read.
SYSTEM_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}


class Refused(Exception):
    """The catalogue or the collection cannot be used as declared; ``problems`` says every reason found."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


# Declaration -------------------------------------------------------------------------------------------------------

def load(path: Path) -> dict:
    catalogue = json.loads(path.read_text(encoding="utf-8"))
    check_declaration(catalogue)
    return catalogue


def check_declaration(catalogue: dict) -> None:
    """The schema, then what a schema cannot say: unique ids, references, roles and every context column's origin."""
    problems = [f"{'/'.join(map(str, error.absolute_path)) or 'catalogue'}: {error.message}"
                for error in Draft202012Validator(SCHEMA, format_checker=FormatChecker()).iter_errors(catalogue)]
    if problems:
        raise Refused(problems)
    entries = {}
    for source in catalogue["sources"]:
        for entry in [source, *source.get("members", [])]:
            if entry["id"] in entries:
                problems.append(f"the id {entry['id']} is declared twice")
            entries[entry["id"]] = entry
        if source.get("members") and source["kind"] != "zip_archive":
            problems.append(f"{source['id']}: only a zip archive has members")
    for entry in entries.values():
        alias = entry["alias"]
        if "of" in alias and alias["of"] not in entries:
            problems.append(f"{entry['id']}: its alias names {alias['of']}, which is not declared")
        if alias["classification"] == "subset_of" and "selection" not in alias:
            problems.append(f"{entry['id']}: a subset says how it was selected")
    views = set()
    for view in catalogue["views"]:
        name = view["id"]
        if name in views:
            problems.append(f"the view {name} is declared twice")
        views.add(name)
        source = entries.get(view["source"])
        if source is None:
            problems.append(f"{name}: its source {view['source']} is not declared")
            continue
        if source["role"] not in EVENT_ROLES:
            problems.append(f"{name}: {view['source']} is {source['role']}, not an event log; it cannot be read as one")
        kind = view["conversion"]["kind"]
        expected = {"csv_as_is": "csv", "xes_to_csv": "xes", "ocel_object_type": "ocel2_json"}[kind]
        if source["kind"] != expected:
            problems.append(f"{name}: {kind} reads a {expected} source, not {source['kind']}")
        if (kind == "ocel_object_type") != (source["role"] == "object_centric_event_log"):
            problems.append(f"{name}: an object-centric log is read only through one named object type")
        for join in view.get("joins", []):
            master = entries.get(join["master"])
            if master is None or master["role"] != "static_master_data" or master["kind"] != "csv":
                problems.append(f"{name}: a join reads a declared static master data CSV, not {join['master']}")
            elif "snapshot" not in master:
                problems.append(f"{name}: {join['master']} says when its snapshot was taken")
        context = view["mapping"]["context"]
        if set(view["context_origin"]) != set(context):
            problems.append(f"{name}: every context column, and only those, has a declared origin")
        joined = {f"{join['master']}:{column}" for join in view.get("joins", []) for column in join["columns"]}
        for column, origin in view["context_origin"].items():
            if (origin == "static_snapshot_join") != (column in joined):
                problems.append(f"{name}: {column} comes from a static snapshot exactly when a join supplies it")
        if view["lifecycle"]["reading"] == "transition_as_context" and "xes_lifecycle" not in view["context_origin"].values():
            problems.append(f"{name}: a lifecycle read as context names its column")
        if view["time"]["clock"] == "fixed_offset" and "offset_minutes" not in view["time"]:
            problems.append(f"{name}: a fixed offset says its minutes")
        order = {"csv_as_is": "file_record_order", "xes_to_csv": "xes_document_order", "ocel_object_type": "ocel_event_order"}[kind]
        if view["source_order"] != order:
            problems.append(f"{name}: the source order of {kind} is {order}")
    if problems:
        raise Refused(problems)


# Inventory ---------------------------------------------------------------------------------------------------------

@dataclass
class Item:
    """One declared file, folder or archive member as found."""

    id: str
    kind: str
    role: str
    alias: dict
    sha256: str
    bytes: int
    archive: str | None = None
    files: int | None = None
    """For a folder: how many files it holds."""


@dataclass
class Inventory:
    items: dict[str, Item]
    contents: dict[str, bytes]
    """The bytes of every file and member that a view or a join reads, by id."""
    ignored_system_files: int
    subsets: dict[str, dict] = field(default_factory=dict)


def inventory(catalogue: dict, root: Path) -> Inventory:
    """Every file under the collection folder and every archive member has exactly one record, and every record a file."""
    problems: list[str] = []
    found = {path.relative_to(root).as_posix(): path for path in sorted(root.rglob("*")) if path.is_file()}
    ignored = [name for name in found if PurePosixPath(name).name in SYSTEM_FILES]
    for name in ignored:
        del found[name]
    read = {view["source"] for view in catalogue["views"]} | {join["master"] for view in catalogue["views"] for join in view.get("joins", [])}
    read |= {entry["alias"]["of"] for source in catalogue["sources"] for entry in [source, *source.get("members", [])]
             if entry["alias"]["classification"] == "subset_of"}
    items: dict[str, Item] = {}
    contents: dict[str, bytes] = {}
    covered: set[str] = set()
    for source in catalogue["sources"]:
        path = source["path"].strip("/")
        if source["kind"] == "directory":
            inside = sorted(name for name in found if name.startswith(path + "/"))
            if not inside:
                problems.append(f"{source['id']}: the folder {path} holds no file")
                continue
            covered.update(inside)
            listing = "".join(f"{name[len(path) + 1:]}\0{sha256(found[name].read_bytes())}\n" for name in inside)
            items[source["id"]] = Item(source["id"], "directory", source["role"], source["alias"], sha256(listing.encode()),
                                       sum(found[name].stat().st_size for name in inside), files=len(inside))
            continue
        if path not in found:
            problems.append(f"{source['id']}: no file at {path}")
            continue
        covered.add(path)
        content = found[path].read_bytes()
        items[source["id"]] = Item(source["id"], source["kind"], source["role"], source["alias"], sha256(content), len(content))
        if source["id"] in read:
            contents[source["id"]] = content
        if source["kind"] == "zip_archive":
            declared = {member["name"]: member for member in source.get("members", [])}
            try:
                bundle = zipfile.ZipFile(io.BytesIO(content))
            except zipfile.BadZipFile:
                problems.append(f"{source['id']}: not a readable zip archive")
                continue
            names = [info.filename for info in bundle.infolist() if not info.is_dir()]
            for name in names:
                if PurePosixPath(name).name in SYSTEM_FILES:
                    ignored.append(f"{path}:{name}")
                    continue
                member = declared.pop(name, None)
                if member is None:
                    problems.append(f"{source['id']}: the member {name} has no record")
                    continue
                data = bundle.read(name)
                items[member["id"]] = Item(member["id"], member["kind"], member["role"], member["alias"], sha256(data), len(data), archive=source["id"])
                if member["id"] in read:
                    contents[member["id"]] = data
            for name in declared:
                problems.append(f"{source['id']}: no member {name}")
    for name in sorted(set(found) - covered):
        problems.append(f"the file {name} has no record")
    problems += _aliases(items)
    if problems:
        raise Refused(problems)
    result = Inventory(items, contents, len(ignored))
    for item in items.values():
        if item.alias["classification"] == "subset_of":
            result.subsets[item.id] = _subset(contents[item.id], contents[item.alias["of"]], item.id)
    return result


def _aliases(items: dict[str, Item]) -> list[str]:
    """Identical bytes are declared copies of one original; a declared copy has its original's bytes."""
    problems = []
    by_digest: dict[str, list[Item]] = defaultdict(list)
    for item in items.values():
        if item.kind != "directory":
            by_digest[item.sha256].append(item)
    for group in by_digest.values():
        if len(group) > 1 and sum(item.alias["classification"] != "byte_identical_copy" for item in group) != 1:
            problems.append("identical bytes in " + ", ".join(sorted(item.id for item in group)) + " are not declared as copies of one of them")
    for item in items.values():
        if item.alias["classification"] == "byte_identical_copy":
            original = items.get(item.alias["of"])
            if original is not None and original.sha256 != item.sha256:
                problems.append(f"{item.id} is declared a byte-identical copy of {original.id} but its bytes differ")
    return problems


def _subset(part: bytes, whole: bytes, name: str) -> dict:
    """A supplied subset's records all occur in the original, as many times or fewer; its header is the original's."""
    def records(content: bytes) -> tuple[list[str], Counter]:
        rows = list(csv.reader(io.StringIO(content.decode("utf-8-sig"), newline="")))
        return rows[0], Counter(tuple(row) for row in rows[1:] if row)
    part_header, part_rows = records(part)
    whole_header, whole_rows = records(whole)
    if part_header != whole_header or part_rows - whole_rows:
        raise Refused([f"{name} is declared a subset but holds records its original does not"])
    return {"records": sum(part_rows.values()), "original_records": sum(whole_rows.values())}


# Conversion --------------------------------------------------------------------------------------------------------

@dataclass
class ViewFiles:
    csv: bytes
    side_files: dict[str, bytes]
    reconciliation: dict
    """What the conversion and the joins did, counted: never a silent change."""


def write_csv(header: list[str], rows: list[list[str]], delimiter: str = ",") -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, delimiter=delimiter, quotechar='"', lineterminator="\r\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def materialise(view: dict, found: Inventory, catalogue: dict) -> ViewFiles:
    kind = view["conversion"]["kind"]
    content = found.contents[view["source"]]
    if kind == "csv_as_is":
        files = ViewFiles(content, {}, {"conversion": "none: the source bytes are the view"})
    elif kind == "xes_to_csv":
        files = xes_to_csv(content)
    else:
        files = ocel_to_csv(content, view["conversion"]["object_type"])
    for join in view.get("joins", []):
        files = joined(files, view, join, found.contents[join["master"]])
    subset = found.subsets.get(view["source"])
    if subset is not None:
        files.reconciliation["supplied_subset"] = _cropped(files.csv, found.contents[found.items[view["source"]].alias["of"]], view)
    return files


def _cropped(part: bytes, whole: bytes, view: dict) -> dict:
    """How many of a supplied subset's incidents have fewer records than in its original: their histories are cropped."""
    def per_case(content: bytes) -> Counter:
        rows = list(csv.reader(io.StringIO(content.decode(_codec(view["dialect"]["encoding"])), newline=""), delimiter=view["dialect"]["delimiter"]))
        index = rows[0].index(view["mapping"]["case"])
        return Counter(row[index].strip() for row in rows[1:] if len(row) > index and row[index].strip())
    mine, theirs = per_case(part), per_case(whole)
    return {"incidents": len(mine), "incidents_with_cropped_history": sum(1 for case, count in mine.items() if count < theirs.get(case, 0)),
            "records_not_in_this_subset": sum(theirs[case] - mine[case] for case in mine if theirs.get(case, 0) > mine[case])}


def joined(files: ViewFiles, view: dict, join: dict, master: bytes) -> ViewFiles:
    """Append a static snapshot's columns where exactly one master row has the key; say which records matched none or several.

    Every record keeps its cells and its place, blank and ragged ones too: a ragged record gets the same columns
    appended, so it stays ragged by the same cells."""
    delimiter = view["dialect"]["delimiter"]
    rows = list(csv.reader(io.StringIO(files.csv.decode(_codec(view["dialect"]["encoding"])), newline=""), delimiter=delimiter))
    header, records = rows[0], rows[1:]
    table = list(csv.reader(io.StringIO(master.decode("utf-8-sig"), newline="")))
    master_header = table[0]
    if join["view_key"] not in header or join["master_key"] not in master_header or not set(join["columns"]) <= set(master_header):
        raise Refused([f"{view['id']}: the join to {join['master']} names a column that is not there"])
    key, master_key = header.index(join["view_key"]), master_header.index(join["master_key"])
    matches: dict[str, list[list[str]]] = defaultdict(list)
    for row in table[1:]:
        if row:
            matches[row[master_key]].append(row)
    taken = [master_header.index(column) for column in join["columns"]]
    status_counts: Counter = Counter()
    out = []
    for record in records:
        if not record:
            out.append(record)
            continue
        value = record[key] if key < len(record) else ""
        found = matches.get(value, []) if value != "" else []
        status = "no_key" if value == "" else "matched" if len(found) == 1 else "unmatched" if not found else "ambiguous"
        status_counts[status] += 1
        cells = [found[0][index] for index in taken] if status == "matched" else ["" for _ in taken]
        out.append(record + cells + [status])
    columns = [f"{join['master']}:{column}" for column in join["columns"]] + [f"join:{join['master']}"]
    reconciliation = dict(files.reconciliation)
    reconciliation.setdefault("joins", []).append({
        "master": join["master"], "records": dict(sorted(status_counts.items())),
        "ambiguous_keys": sum(1 for rows_ in matches.values() if len(rows_) > 1),
        "rule": "values only where exactly one master row has the key; otherwise empty, with the status in its own column"})
    return ViewFiles(write_csv(header + columns, out, delimiter), files.side_files, reconciliation)


def _codec(encoding: str) -> str:
    return {"utf-8": "utf-8", "utf-8-sig": "utf-8-sig", "windows-1252": "cp1252"}[encoding]


XES_SCALARS = {"string", "date", "int", "float", "boolean", "id"}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def xes_to_csv(content: bytes) -> ViewFiles:
    """One row per XES event in document order; trace attributes repeat on its rows; nothing is paired or dropped.

    Scalar attributes become columns named trace:<key> and event:<key>; a nested or list attribute goes, whole, to a
    side file with its trace and event positions. Log-level declarations go to their own side file."""
    log = ElementTree.fromstring(content)
    if _local(log.tag) != "log":
        raise Refused(["the XES document has no log element"])

    def tree(element) -> dict:
        return {"type": _local(element.tag), "key": element.get("key"), "value": element.get("value"),
                "children": [tree(child) for child in element]}

    declarations = {"attributes": {}, "extensions": [], "globals": [], "classifiers": []}
    traces = []
    for child in log:
        name = _local(child.tag)
        if name == "trace":
            traces.append(child)
        elif name == "extension":
            declarations["extensions"].append(dict(child.attrib))
        elif name == "global":
            declarations["globals"].append({"scope": child.get("scope"), "attributes": [tree(item) for item in child]})
        elif name == "classifier":
            declarations["classifiers"].append(dict(child.attrib))
        elif name in XES_SCALARS:
            declarations["attributes"][child.get("key")] = child.get("value")
        else:
            declarations.setdefault("other", []).append(tree(child))
    nested: list[dict] = []
    trace_keys: set[str] = set()
    event_keys: set[str] = set()
    parsed = []
    for trace_position, trace in enumerate(traces):
        attributes: dict[str, str] = {}
        events = []
        for child in trace:
            name = _local(child.tag)
            if name == "event":
                values: dict[str, str] = {}
                for attribute in child:
                    if _local(attribute.tag) in XES_SCALARS and len(attribute) == 0:
                        values[attribute.get("key")] = attribute.get("value", "")
                    else:
                        nested.append({"trace_position": trace_position, "event_position": len(events), **tree(attribute)})
                event_keys.update(values)
                events.append(values)
            elif name in XES_SCALARS and len(child) == 0:
                attributes[child.get("key")] = child.get("value", "")
            else:
                nested.append({"trace_position": trace_position, "event_position": None, **tree(child)})
        trace_keys.update(attributes)
        parsed.append((attributes, events))
    fixed = ["concept:name", "time:timestamp", "lifecycle:transition"]
    event_columns = fixed + sorted(event_keys - set(fixed))
    trace_columns = ["concept:name"] + sorted(trace_keys - {"concept:name"})
    header = ([f"trace:{key}" for key in trace_columns[:1]] + [f"event:{key}" for key in event_columns]
              + [f"trace:{key}" for key in trace_columns[1:]] + ["xes:trace_position", "xes:event_position"])
    rows = []
    for trace_position, (attributes, events) in enumerate(parsed):
        for event_position, values in enumerate(events):
            rows.append([attributes.get("concept:name", "")] + [values.get(key, "") for key in event_columns]
                        + [attributes.get(key, "") for key in trace_columns[1:]] + [str(trace_position), str(event_position)])
    absent = {f"event:{key}": sum(1 for _, events in parsed for values in events if key not in values) for key in fixed}
    side = {"xes-log.json": (json.dumps(declarations, indent=1, ensure_ascii=False) + "\n").encode("utf-8")}
    if nested:
        side["xes-nested-attributes.jsonl"] = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in nested).encode("utf-8")
    return ViewFiles(write_csv(header, rows), side, {
        "conversion": "XES to one row per event in document order",
        "traces": len(parsed), "events": len(rows), "traces_without_name": sum(1 for attributes, _ in parsed if not attributes.get("concept:name")),
        "events_without": absent, "nested_attributes_in_side_file": len(nested),
        "lifecycle": "each transition is its own record; starts and completes are not paired"})


def ocel_to_csv(content: bytes, object_type: str) -> ViewFiles:
    """One row per event and related object of the named type, in event order; the event's identity repeats on each.

    An event related to several objects of the type appears in each of their histories with the same event id; an
    event related to none is not in this view and is counted. Object attributes, which change over time, are not
    joined into the events: they go to a side file with their times, as do relations between objects and the
    relations of events to objects of other types."""
    document = json.loads(content)
    types = {item["id"]: item["type"] for item in document.get("objects", [])}
    if object_type not in {item["name"] for item in document.get("objectTypes", [])}:
        raise Refused([f"the object-centric log has no object type {object_type}"])
    attribute_names = sorted({attribute["name"] for event in document["events"] for attribute in event.get("attributes", [])})
    header = ["object:id", "event:type", "event:time", "event:id", "e2o:qualifier"] + [f"event:{name}" for name in attribute_names]
    rows, others = [], []
    unrelated = shared = 0
    for event in document["events"]:
        values = {attribute["name"]: attribute["value"] for attribute in event.get("attributes", [])}
        mine = [relation for relation in event.get("relationships", []) if types.get(relation["objectId"]) == object_type]
        unrelated += not mine
        shared += len(mine) > 1
        for relation in mine:
            rows.append([relation["objectId"], event["type"], event["time"], event["id"], relation.get("qualifier", "")]
                        + ["" if values.get(name) is None else str(values[name]) for name in attribute_names])
        for relation in event.get("relationships", []):
            if types.get(relation["objectId"]) != object_type:
                others.append([event["id"], relation["objectId"], types.get(relation["objectId"], ""), relation.get("qualifier", "")])
    attributes = [[item["id"], attribute["name"], attribute.get("time", ""), json.dumps(attribute["value"], ensure_ascii=False)]
                  for item in document["objects"] if item["type"] == object_type for attribute in item.get("attributes", [])]
    relations = [[item["id"], item["type"], relation["objectId"], types.get(relation["objectId"], ""), relation.get("qualifier", "")]
                 for item in document["objects"] for relation in item.get("relationships", [])]
    unknown = sum(1 for event in document["events"] for relation in event.get("relationships", []) if relation["objectId"] not in types)
    perspective = [item["id"] for item in document["objects"] if item["type"] == object_type]
    with_events = {row[0] for row in rows}
    return ViewFiles(write_csv(header, rows), {
        f"ocel-{object_type}-attributes.csv": write_csv(["object:id", "attribute", "time", "value_json"], attributes),
        "ocel-object-relations.csv": write_csv(["source:id", "source:type", "target:id", "target:type", "qualifier"], relations),
        f"ocel-{object_type}-other-event-objects.csv": write_csv(["event:id", "object:id", "object:type", "qualifier"], others),
    }, {
        "conversion": f"OCEL 2.0 read from the perspective of object type {object_type}",
        "events": len(document["events"]), "rows": len(rows), "events_with_no_object_of_this_type": unrelated,
        "events_shared_by_several_objects_of_this_type": shared, "objects_of_this_type": len(perspective),
        "objects_of_this_type_without_events": len(set(perspective) - with_events),
        "relations_to_undeclared_objects": unknown,
        "object_attributes": "kept with their times in a side file, not joined into events"})


# Independent reading -----------------------------------------------------------------------------------------------

_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?")
_TEMPLATES = {"dmy_dot_minute": "%d.%m.%Y %H:%M", "mdy_dot_minute": "%m.%d.%Y %H:%M", "dmy_slash_minute": "%d/%m/%Y %H:%M",
              "mdy_slash_minute": "%m/%d/%Y %H:%M", "dmy_dot_second": "%d.%m.%Y %H:%M:%S", "mdy_dot_second": "%m.%d.%Y %H:%M:%S",
              "dmy_slash_second": "%d/%m/%Y %H:%M:%S", "mdy_slash_second": "%m/%d/%Y %H:%M:%S", "dmy_dash_second": "%d-%m-%Y %H:%M:%S",
              "ymd_slash_second": "%Y/%m/%d %H:%M:%S", "mdy_slash_12h_minute": "%m/%d/%Y %I:%M %p", "mdy_slash_12h_second": "%m/%d/%Y %I:%M:%S %p"}


def read_time(value: str, declared: dict) -> datetime | None:
    """A time as the view declares it, compared on one axis: UTC for zoned clocks, the recorded wall otherwise."""
    if declared["format"] == "iso8601":
        match = _ISO.fullmatch(value)
        if match is None:
            return None
        year, month, day, hour, minute, second, fraction, zone = match.groups()
        try:
            moment = datetime(int(year), int(month), int(day), int(hour), int(minute), int(second or 0), int((fraction or "").ljust(6, "0") or 0))
        except ValueError:
            return None
        if zone is not None:
            if zone == "Z":
                offset = timedelta(0)
            else:
                hours, minutes = int(zone[1:3]), int(zone[4:6])
                if hours > 23 or minutes > 59:
                    return None
                offset = timedelta(hours=hours, minutes=minutes) * (1 if zone[0] == "+" else -1)
            moment = moment.replace(tzinfo=timezone(offset))
    else:
        try:
            moment = datetime.strptime(value, _TEMPLATES[declared["format"]])
        except ValueError:
            return None
    clock = declared["clock"]
    if clock == "wall_clock_as_recorded":
        return None if moment.tzinfo else moment
    if clock == "offset_in_values":
        return moment.astimezone(timezone.utc) if moment.tzinfo else None
    return None if moment.tzinfo else moment.replace(tzinfo=timezone(timedelta(minutes=declared["offset_minutes"]))).astimezone(timezone.utc)


@dataclass
class Record:
    position: int
    cells: list[str]
    time: datetime | None


@dataclass
class Reading:
    """A view read without the product: what its preparation and evidence must show."""

    header: list[str]
    columns: dict[str, int]
    records: int
    blank: int
    ragged: list[int]
    missing_case: list[int]
    cases: dict[str, list[Record]]
    """Every record of each incident in source order."""
    missing_activity: int
    unavailable_time: int
    """Records of incidents whose time is not usable."""
    unread_times: int
    """Every non-blank record whose time is not usable: those of incidents, those without an incident, and ragged
    records, whose cells are never read."""
    duplicates: int
    tie_groups: int
    tied_records: int
    outside_horizon: dict

    def ordered(self, case: str) -> list[Record]:
        """Usable times ascending, ties and unavailable times by source position, unavailable times last."""
        records = self.cases[case]
        usable = sorted((record for record in records if record.time is not None), key=lambda record: (record.time, record.position))
        return usable + [record for record in records if record.time is None]

    def evaluable(self, case: str) -> bool:
        return all(record.time is not None for record in self.cases[case])

    def sequence(self, case: str) -> list[str]:
        activity = self.columns["activity"]
        return [record.cells[activity] for record in self.ordered(case) if record.cells[activity] != ""]

    def variants(self) -> dict[tuple[str, ...], list[str]]:
        found: dict[tuple[str, ...], list[str]] = defaultdict(list)
        for case in sorted(self.cases):
            if self.evaluable(case):
                found[tuple(self.sequence(case))].append(case)
        return found

    def follows(self) -> dict[tuple[str, str], dict]:
        """Directly-follows pairs of the mapped sequences of incidents in known order, with their counts and incidents."""
        found: dict[tuple[str, str], dict] = {}
        for case in sorted(self.cases):
            if not self.evaluable(case):
                continue
            sequence = self.sequence(case)
            for pair in zip(sequence, sequence[1:]):
                entry = found.setdefault(pair, {"count": 0, "cases": set()})
                entry["count"] += 1
                entry["cases"].add(case)
        return found


def read_view(content: bytes, view: dict) -> Reading:
    dialect = view["dialect"]
    text = content.decode(_codec(dialect["encoding"]))
    rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=dialect["delimiter"], quotechar='"'))
    header, records = rows[0], rows[1:]
    mapping = view["mapping"]
    named = {"case": mapping["case"], "activity": mapping["activity"], "time": mapping["time"]}
    if mapping["sequence"] is not None:
        named["sequence"] = mapping["sequence"]
    missing = [name for name in [*named.values(), *mapping["context"]] if header.count(name) != 1]
    if missing:
        raise Refused([f"{view['id']}: the view has no single column for a mapped name ({len(missing)} of them)"])
    columns = {role: header.index(name) for role, name in named.items()}
    horizon = view["observation_horizon"]
    bounds = [read_time(horizon[key], {"format": "iso8601", "clock": "offset_in_values" if view["time"]["clock"] != "wall_clock_as_recorded" else "wall_clock_as_recorded"})
              for key in ("start", "end")]
    cases: dict[str, list[Record]] = defaultdict(list)
    blank, ragged, missing_case = 0, [], []
    seen: set[tuple[str, ...]] = set()
    duplicates = missing_activity = unavailable = unread = before = after = 0
    for position, cells in enumerate(records):
        if not cells:
            blank += 1
            continue
        if len(cells) != len(header):
            ragged.append(position)
            unread += 1
            continue
        moment = read_time(cells[columns["time"]], view["time"])
        unread += moment is None
        case = cells[columns["case"]].strip()
        if case == "":
            missing_case.append(position)
            continue
        cases[case].append(Record(position, cells, moment))
        missing_activity += cells[columns["activity"]] == ""
        unavailable += moment is None
        if moment is not None and None not in bounds:
            before += moment < bounds[0]
            after += moment > bounds[1]
        key = tuple(cells)
        duplicates += key in seen
        seen.add(key)
    tie_groups = tied = 0
    for records_ in cases.values():
        counts = Counter(record.time for record in records_ if record.time is not None)
        tie_groups += sum(1 for count in counts.values() if count > 1)
        tied += sum(count for count in counts.values() if count > 1)
    return Reading(header, columns, len(records), blank, ragged, missing_case, dict(cases), missing_activity, unavailable,
                   unread, duplicates, tie_groups, tied, {"before_start": before, "after_end": after})


def pilot(reading: Reading, view: dict) -> tuple[list[str], bytes]:
    """A deterministic pilot of complete incidents: those with a reconciled fault first, then the others by id.

    The pilot holds every record of each chosen incident, in source order, under the view's own header."""
    activity = reading.columns["activity"]
    def faulty(case: str) -> bool:
        records = reading.cases[case]
        times = Counter(record.time for record in records if record.time is not None)
        return (any(record.time is None or record.cells[activity] == "" for record in records) or any(count > 1 for count in times.values())
                or len({tuple(record.cells) for record in records}) < len(records))
    wanted = view["pilot"]["case_count"]
    chosen = [case for case in sorted(reading.cases) if faulty(case)][:wanted]
    chosen += [case for case in sorted(reading.cases) if case not in chosen][: wanted - len(chosen)]
    rows = sorted((record for case in chosen for record in reading.cases[case]), key=lambda record: record.position)
    return sorted(chosen), write_csv(reading.header, [record.cells for record in rows], view["dialect"]["delimiter"])


# The product's declared reading ------------------------------------------------------------------------------------

def policies(view: dict) -> dict:
    declared = view["time"]
    if declared["clock"] == "wall_clock_as_recorded":
        time = {"id": "incident.time.wall_clock_as_recorded.v1", "parameters": {
            "format": declared["format"], "timezone": "none_as_recorded", "snapshot_cutoff_local": declared["snapshot_cutoff"]}}
    else:
        zone = {"mode": "from_values"} if declared["clock"] == "offset_in_values" else {"mode": "fixed_offset", "offset_minutes": declared["offset_minutes"]}
        time = {"id": "incident.time.explicit_format_timezone_utc.v1", "parameters": {
            "format": declared["format"], "timezone": zone, "snapshot_cutoff_utc": declared["snapshot_cutoff"]}}
    rows = {"missing_case_id": "outside_population_preserve_source", "unavailable_timestamp": "retain_case_raw_flag_order_unknown",
            "invalid_mapped_sequence": "block_preparation", "duplicate_candidates": "retain_all"}
    if view["rows"] == "tolerant":
        row_policy = {"id": "incident.rows.missing_id_outside_invalid_time_retained.v2", "parameters": {
            **rows, "blank_records": "skip_count_preserve_source_ordinal", "ragged_records": "outside_population_preserve_raw",
            "maximum_ragged_fraction": 0.05, "field_character_limit": 10485760}}
    else:
        row_policy = {"id": "incident.rows.missing_id_outside_invalid_time_retained.v1", "parameters": rows}
    return {
        "time": time,
        "order": {"id": "incident.order.declared_time_optional_sequence_source_position.v1", "parameters": {
            "primary": "usable_declared_time_ascending", "secondary": "mapped_sequence_or_source_position",
            "tie_breaker": "source_position_ascending", "unavailable_timestamp": "presentation_tail_source_position",
            "unavailable_timestamp_case_sequence": "unevaluable"}},
        "rows": row_policy,
        "missing_values": {"id": "incident.missing.empty_mapped_activity_context.v1", "parameters": {"empty_activity_context": "missing", "literal_values": "preserve"}},
        "identifier": {"id": "incident.identifier.trim_outer_whitespace.v1", "parameters": {"normalization": "trim_outer_whitespace_preserve_raw"}},
        "activity_projection": {"id": "incident.activity.omit_missing_retain_raw_gaps.v1", "parameters": {
            "missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"}},
        "parent": {"id": "incident.parent.all_identified_cases.v1", "parameters": {"eligibility": "nonempty_normalized_case_identifier"}},
    }


def mapping(view: dict, header: list[str]) -> dict:
    declared = view["mapping"]
    return {"case_column": header.index(declared["case"]), "activity_column": header.index(declared["activity"]),
            "timestamp_column": header.index(declared["time"]),
            "sequence_column": None if declared["sequence"] is None else header.index(declared["sequence"]),
            "context_columns": [header.index(name) for name in declared["context"]]}


def overlaps(catalogue: dict, found: Inventory) -> dict[str, list[str]]:
    """Views that share records: read from the same source, from copies of it, or from a supplied subset of it.

    Their populations are never added up as one."""
    def root(entry_id: str) -> str:
        alias = found.items[entry_id].alias
        return root(alias["of"]) if alias["classification"] in {"byte_identical_copy", "subset_of"} else entry_id
    by_root: dict[str, list[str]] = defaultdict(list)
    for view in catalogue["views"]:
        by_root[root(view["source"])].append(view["id"])
    return {view["id"]: sorted(set(by_root[root(view["source"])]) - {view["id"]}) for view in catalogue["views"]}
