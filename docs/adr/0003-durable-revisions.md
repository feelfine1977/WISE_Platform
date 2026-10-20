# Durable revisions and publication

**Status:** selected; filesystem candidate implemented, broader release qualification pending.

**Problem:** a useful investigation must survive reopening without silently changing evidence or mixing asynchronous answers.

**Decision:** persist immutable source/preparation/investigation revisions and exact membership/evidence references. Norm and score references are optional. Keep presentation convenience state separate. Use local transactional metadata with immutable artifacts behind qualified adapters. Fence publication by task/request/revision identity; reject stale success, error and page responses.

**Alternatives:** saving only viewport/filter strings is insufficient. Mutating source interpretation under an existing finding is rejected. Copying a live database main file without matching artifacts is not a backup strategy.

**Consequences:** atomic publication, interrupted operations, restart, freshness, relocation, schema refusal and database-aware restoration need explicit tests. Source refresh creates a new revision. Old workspace databases need not migrate into the fresh platform.

**Current implementation:** `workspace.py` stores a versioned manifest, hashed source bytes, preparation recipes and immutable definitions/score runs. `saved_store.py` publishes immutable investigation revisions and head pointers using atomic replacement, cross-process locking and expected-revision checks. Metadata is JSON on the filesystem, not SQLite; transactional metadata in the decision remains a target rather than a second current store. Restart and malformed-state tests cover the candidate. The capacity CLI additionally checks a complete stopped-workspace copy restored into a new folder with the same selection, evidence and original score run.

**Remaining qualification:** Windows human recovery, supported capacity, interrupted/power-loss publication and live backup are not established by those tests. No workspace migration or source-refresh command exists. Browser-local stage definitions are not part of workspace persistence. See [current status](../status.md) and [release qualification](../release-qualification.md) before advertising continuity or upgrade guarantees.
