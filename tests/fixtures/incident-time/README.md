# Complete recorded-time evidence

The two CSVs exercise declared UTC and recorded wall clocks with unlabelled RAW
records, missing and invalid timestamps, normalized overflow, timestamp ties,
microsecond precision and the full Gregorian range. Their preparation requests
fix the exact source interpretation and deterministic analytical identities.

The positive payloads contain 33 native expected answers and two protocol-only
all-valid histories with unknown order. The latter are tested through the pure
and validation boundaries; CSV preparation does not produce them. Native HTTP
comparisons replace only workspace ID in the complete expected answer.

The negative payloads alter complete messages. Some violate source structure;
others retain admissible structure but disagree with native records or exact
arithmetic. The validation corpus also exercises structural and semantic
controls across the source and the transient tuple generation view.
