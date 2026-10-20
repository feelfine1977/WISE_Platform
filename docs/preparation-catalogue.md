# Preparation catalogue

An analyst's source collection usually holds more than one event log: archives, spreadsheets, XES and object-centric logs, team tables, earlier scores, caches and old workspaces. The import reads one CSV with declared incident, activity and time columns. Converting the rest into such CSVs without a record can change what an incident is, mix clocks, crop histories, duplicate observations, or turn a current snapshot into historical event context.

A preparation catalogue (#99) records each of those choices. It is a local JSON file written by the analyst, checked by `tools/qualify_preparation_catalogue.py` and described by [tools/preparation-catalogue.schema.json](../tools/preparation-catalogue.schema.json). It reuses the existing import, preparation and saved revisions; it adds no import or analysis engine.

## What a catalogue declares

**Every source and archive member** has an id, a path relative to the collection folder (or a member name inside its zip archive), a kind, an analytical role, an alias classification and its provenance (origin, licence, date obtained).

**Roles:**
- Only an `event_log` or an `object_centric_event_log` becomes a view.
- `static_master_data` joins a view only as a dated snapshot.
- `earlier_analysis_state`, `cache`, `earlier_workspace`, `documentation`, `archive` and `unreviewed` are recorded and never read as event logs.

**Aliases:**
- `original`;
- `byte_identical_copy` of another record (checked: the bytes are the same);
- `subset_of` another record, with how it was selected (checked: it holds only its original's records);
- `derived_from` another record.

Identical bytes that are not declared as copies are refused.

**Coverage.** Every file under the collection folder and every archive member needs a record, and every record needs its file. Operating-system files such as `.DS_Store` are counted and never read. A folder, such as an old workspace, can be recorded as one `directory` whose identity is the digest of its listing.

**Every view** declares:
- its source;
- its conversion: `csv_as_is`, `xes_to_csv`, or `ocel_object_type` with one named object type;
- its case grain, in words;
- the dialect and the exact column mapping, by header;
- where each context column comes from;
- the time format, the clock (`offset_in_values`, `fixed_offset` with its minutes, or `wall_clock_as_recorded`) and the snapshot cutoff;
- how lifecycle is read;
- the source order and the row rules (`tolerant` or `strict`);
- a proposed observation horizon with its basis;
- the size of its pilot.

## Conversions and reconciliation

Nothing is cleaned or paired. Each of these is counted and kept:
- records without an incident or an activity;
- unreadable times;
- repeated observations and tied times;
- ragged and blank records;
- join keys that match no master row or several.

The import's own row rules decide what is outside the population, and the catalogue's reading checks that they did.

- **CSV, as is.** The source bytes are the view.
- **Joins.** A static master table's columns are appended under `<master>:<column>` only where exactly one master row has the key. A `join:<master>` column says `matched`, `unmatched`, `ambiguous` or `no_key`. Blank and ragged records keep their places; a ragged record stays ragged by the same cells.
- **XES.**
  - One row per event, in document order.
  - Scalar attributes become `event:<key>` and `trace:<key>` columns; trace attributes repeat on each of the trace's rows.
  - Every lifecycle transition is its own record. Starts and completes are never paired.
  - Nested and list attributes go whole to `xes-nested-attributes.jsonl`, with their trace and event positions.
  - Extensions, globals, classifiers and log attributes go to `xes-log.json`.
- **OCEL 2.0 (JSON), from one object type's perspective.**
  - One row per event and related object of that type, with the event's id and the relation's qualifier.
  - An event related to several objects of the type appears in each of their histories under the same event id. An event related to none is counted and is not in the view.
  - Object attributes, which change over time, are not joined into events: they go to `ocel-<type>-attributes.csv` with their times.
  - Relations between objects go to `ocel-object-relations.csv`.
  - Relations of events to objects of other types go to `ocel-<type>-other-event-objects.csv`.
- **Supplied subsets.** For a supplied subset, the view counts how many of its incidents have fewer records than in the original, which means their histories are cropped.
- **Overlaps.** Views read from the same source, from copies of it or from a subset of it are named as sharing records. They are never added up as one population.

## Qualification

```sh
python tools/qualify_preparation_catalogue.py --catalogue CATALOGUE.json --collection FOLDER --views VIEWS_FOLDER \
    --output receipt.json [--node NODE --playwright PLAYWRIGHT_INDEX_MJS --chrome CHROME]
```

The tool writes each view into `VIEWS_FOLDER`, with its side files, its pilot and a readable `catalogue-report.md`. The report covers provenance, roles, aliases, the declarations, the reconciliations, the pilot and the workload. Each view is also read again independently, without the product's code. Then, through the service as its own process, it runs:

- **Workloads.**
  - Each whole view runs in a fresh process and workspace. It is stored, inspected, prepared and opened, and the map and variants of the whole population are produced.
  - The receipt records the records, incidents, columns and versions, and the elapsed time and peak memory of the process tree, separately for the import and for the investigation.
  - The preparation's count of each fault is compared with the independent reading.
  - The workloads are measured apart from the pilots. No capacity tier is claimed from them; a confirmed limit becomes a follow-up under #29.
- **Pilots.**
  - A pilot holds every record of a deterministic set of incidents: those with a reconciled fault first, then the others in id order.
  - Each pilot is stored, inspected, prepared and opened.
  - Its population, map paths, variants and every incident's complete evidence are compared with the independent reading, in order: each raw cell, record, place and time status.
- **A real restart.** A new process reopens the same workspace. Every pilot preparation gives the same identities, population, map, variants and evidence.
- **Built screens, when the browser is named.** Each pilot reading opens from the Data area, and a complete history shows every record, before and after the restart. Without the browser, the receipt says the screens were not checked.

**What the receipt holds:** digests, counts, timings and checks by each view's place in the catalogue.

**What it does not hold:** paths, file or column names, identifiers, or values. Those appear only in the report, which stays in `VIEWS_FOLDER`.

## The shipped example

`tests/fixtures/catalogue` is an invented collection, licensed with the repository, and `catalogue.json` declares it. The collection contains:
- a service-desk log with one of each fault;
- a team table with an unmatched and an ambiguous key;
- an archive with a byte-identical copy, a September export that crops one history, and earlier scores;
- an XES log with lifecycle transitions and a nested attribute;
- an OCEL 2.0 log of orders, items and packages read as two overlapping views;
- a cache, an old workspace and a note.

To regenerate it:

```sh
python tools/make_catalogue_fixture.py
```

The output is the same on every run, and `tests/test_issue99_catalogue.py` checks the committed bytes against it.

## The analyst's own collection

The catalogue of a private collection is written and kept outside this repository: its paths and descriptions are the analyst's own. Run the tool against it on the analyst's computer:
- keep `--views` in a local folder;
- keep the receipt anywhere;
- name the browser to qualify the screens.

Private paths and company records stay out of the source and the tracker. Only the receipt, which holds none of them, may be shared.
