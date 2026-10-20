# Bounded memory for prepared data

**Status:** accepted by the owner on 20 October 2026, on the measured implementation (#135–#140, PRs #141–#146).

On the complete native and prepared BPIC19 sources (1,595,923 records each, 251,734 cases), on the machine named in [Measured capacity](../capacity.md):
- The journey peak fell from 15.1 GB (failed) to 4.43 GB.
- Method scoring peaks at 6.17 GB.
- A cold reopen peaks at 3.97 GB.
- All are within the default 10 GiB budget.
- Work that cannot fit is refused before it starts with `memory_unavailable`.

The acceptance does not cover one known exception, #173: the separate historical notebook scoring peaks at about 14.5 GB and is not refused. It stays open.

**Problem:** the descriptive journey over the full native and prepared BPIC19 sources does not fit the local service. In a supervised run, the service and its harness worker peaked at 8.89 GB RSS while importing the 527 MB native source and settled at 6.4–6.7 GB. After the 640 MB prepared source was uploaded, memory grew to 15.1 GB in about 20 seconds and the run was stopped at its 14 GiB limit. The receipt does not record whether inspection or preparation of the prepared source was running.

The cause is the shape of prepared data and of source reading, not the source size. Each source row becomes an object graph: one string per cell, a second tuple of context wrappers around the same strings, its identity and its times. On rows shaped like the prepared source this retains about 4,800 bytes per record, about thirteen times the raw CSV, before the raw bytes the preparation also keeps. That projects to about 6.4 GB for the native preparation and 8.3 GB for the prepared one. Reading adds whole-file copies: the upload body, the stored bytes, the decoded text, and a string buffer at four bytes per character. Inspection without a separator hint parses the whole file once per candidate separator, and every parse copies each record's line text. Caches are bounded by entry counts. The design already requires measured budgets and states that a count-based cache limit alone is insufficient; the implementation does not meet that requirement yet.

**Decision:** prepared data is held compactly behind the existing record interface. Repeated values are held once, mostly distinct columns are not shared, and values derivable from a record's cells are computed when read without making common reads materially slower. Inspection and preparation each read a stored source in one streamed pass. They keep no per-record structure their answer does not return, and only excluded records keep their exact text. Uploads stream into the workspace while hashing. Retained prepared data and each admitted operation's estimated peak share one byte budget. An operation that would not fit is refused before it reads, with its estimate and the budget, rather than being killed or silently sampled. Capacity is a tested property: per-record retained and peak costs are asserted with tracemalloc at the reading and preparation seams on synthetic rows shaped like the target source, and their conversion to service memory is measured on the whole journey.

**Alternatives:** raising the memory limit would hide the defect and fail on smaller machines. Sampling would break complete-case analytical authority. A columnar analytical file or a query engine remains the next step if a measured tier needs it, adopted only after exact semantic parity, as for every execution adapter.

**Consequences:** analytical meaning, identities and reply bytes are unchanged; the capacity refusal is a deliberate contract change. Synthetic fixtures must keep the target source's kind of value repetition, because value sharing saves little on unique columns. Rebuilding an evicted preparation costs time, not correctness. A later columnar store changes the record implementation, not this interface or its budget tests. Full-source receipts come from one owner-run qualification tool in the repository.
