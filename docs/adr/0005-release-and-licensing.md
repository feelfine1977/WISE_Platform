# Release, dependencies and licensing

**Status:** selected.

**Problem:** a download must compose compatible local parts and state what rights and runtime it supplies.

**Decision:** WISE Platform application code and documentation use the unchanged PolyForm Noncommercial License 1.0.0 and the root required notice. Independently licensed dependencies retain their scoped licence terms and notices. Exact external Method/Flow artifacts are qualified before integration. Application/assets/schema/runtime versions form a release manifest.

The source checkout requires Python and a supported Node build environment. An analyst release containing built assets serves them with the documented Python/native runtime, without a Node development server. Runtime records/state remain in an external local workspace. A measured Windows tier and offline journey are release gates.

**Alternatives:** a broad application licence cannot erase dependency grants. Unversioned sibling-source imports and assumed compatibility are rejected. Merely configuring CI does not qualify Windows.

**Consequences:** preserve actual notices, reproducible dependency constraints and built-asset manifests. State tested runtime/capacity limits and incomplete capabilities. Verify clean product publication and restoration before release.

**Initial delivery form:** qualify the locked source checkout/download on a Windows machine with compatible Python and Node. Confirm installed versions and approved setup early. A wheel with built assets/offline dependencies or an installer-free runtime for a nondeveloper machine is a later, separately qualified packaging choice.
