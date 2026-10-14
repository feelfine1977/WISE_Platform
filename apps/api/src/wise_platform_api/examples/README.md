# Synthetic examples

These four event histories are synthetic: every incident, activity, service,
assignment group and timestamp in them is fictional. They contain no company
or public event-log records. The application offers them as clearly labelled
examples so an analyst can try the investigation without importing data.

- `S0.csv`: ordinary incident histories, some outside the parent population.
- `S1.csv`: the same incidents, one of them reopened and resolved again.
- `S2.csv`: missing activity labels and records sharing a timestamp.
- `S3.csv`: the literal assignment group `Unknown` beside a missing one.

The files are read as bytes and must not be edited: their source identity is
the SHA-256 of these exact bytes, including the Windows line ends.
