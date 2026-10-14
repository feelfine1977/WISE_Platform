# Durable revisions and publication

**Status:** selected target; storage implementation pending.

**Problem:** a useful investigation must survive reopening without silently changing evidence or mixing asynchronous answers.

**Decision:** persist immutable source/preparation/investigation revisions and exact membership/evidence references. Norm and score references are optional. Keep presentation convenience state separate. Use local transactional metadata with immutable artifacts behind qualified adapters. Fence publication by task/request/revision identity; reject stale success, error and page responses.

**Alternatives:** saving only viewport/filter strings is insufficient. Mutating source interpretation under an existing finding is rejected. Copying a live database main file without matching artifacts is not a backup strategy.

**Consequences:** atomic publication, interrupted operations, restart, freshness, relocation, schema refusal and database-aware restoration need explicit tests. Source refresh creates a new revision. Old workspace databases need not migrate into the fresh platform.
