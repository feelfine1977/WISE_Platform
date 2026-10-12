# Fictional event-history import inputs

These five byte-preserved CSV inputs exercise Windows-1252 with umlauts, UTF-8 BOM, quoted separators and multiline fields, ambiguous day/month dates, optional sequence, deterministic ties, missing versus literal Unknown, and invalid timestamps and identifiers. No company data is included.

The literal interpretations use one-based logical data-record ordinals; operation evidence uses zero-based source positions. B5 has six source records: four identified records in three cases and two unassigned records. Four usable timestamps concern all source rows, while only two belong to identified cases. Invalid-time records remain complete evidence, with their case sequences explicitly unevaluable. Missing-ID records remain in the immutable source and report, outside every case population.

Fixture arithmetic does not qualify a parser. `test_import_acceptance.py` sends the actual original bytes through the workspace, inspection, confirmed mapping, population and evidence operations and verifies these literal supports and cells. Wall-clock interpretation remains separate from UTC. A fresh app-instance continuity test is separate from actual process restart and Windows qualification.
