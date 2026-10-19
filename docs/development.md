# Development

The source checkout develops the Python API and TypeScript/React browser application together. One Python host serves the built browser files and API. Node is a source development/build dependency; it is not intended as an analyst runtime for a complete release containing built assets.

## Setup and commands

For the Windows source setup, use **Python 3.13.16**, **Node.js 24.19.0 LTS**, and the **npm 11.17.0 bundled with that Node release**. Download matching Windows installers from the official [Python release](https://www.python.org/downloads/release/python-31316/) and [Node release](https://nodejs.org/en/blog/release/v24.19.0). Use the installer matching your CPU. The first CI tier is Windows x64; ARM still needs separate qualification.

Reopen the terminal after installing and check before creating the environment:

```powershell
py -3.13 --version
node --version
npm --version
```

Expected versions are `Python 3.13.16`, `v24.19.0` and `11.17.0`. This is the recommended qualification combination configured in CI; Windows qualification is complete only after its actual checks and human journey pass. Other Python 3.11–3.14 and Node 22/24 compatibility lanes are secondary, not a request to choose your own initial combination.

Run setup, generation, checks and builds from the repository root using the runtime versions in the manifests. Create an isolated Python environment and install the documented development dependencies before building. Do not use a global environment containing unrelated analytical packages.

The source browser toolchain supports Node 22.19 or 24.14 and later patches in those majors; consult the package manifest for the exact range. Python uses the range in `pyproject.toml`. From the repository root, create and activate an isolated environment first. On Windows PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If activation is restricted by company policy, invoke `.\.venv\Scripts\python.exe` directly and make that environment available to the build commands through an approved terminal configuration. On macOS/Linux use `python3 -m venv .venv` and `source .venv/bin/activate`. Python installation and company policy remain prerequisites; no administrator-free installation is assumed.

Then run:

```text
python -m pip install -c requirements-dev.lock vendor/wise_pm-0.2.0-py3-none-any.whl
python -m pip install -c requirements-dev.lock -e ".[dev]"
npm ci
npm run generate
npm run check
npm test
npm run build
python -m wise_platform_api --port 8765
```

The root Python project finds the API package under `apps/api/src`; there is no separate API-project install. The first line installs the packed method library from `vendor/`. `npm test` runs `python -m pytest`: the analytics package's tests, the API's tests and the contract acceptance tests through the real operations. `npm run check` checks the types and runs the browser's component tests. `npm run build` builds the browser files and collects the notices of the packages they contain. See [test groups](../tests/README.md). Open `http://127.0.0.1:8765` after the build. The health endpoint is `/api/health`; Ctrl+C stops the host. A health response is a foundation result, not an analytical result.

For the optional browser development loop, run the API host and `npm run dev` in separate terminals. The browser development server runs at `http://127.0.0.1:5173` and proxies API requests to port 8765. The finished local deployment still uses one Python host and built files. The document routes answer only the platform's own page; for the development loop, start the API host with `WISE_TRUSTED_WEB_ORIGINS=http://127.0.0.1:5173` so that the development server's page is trusted explicitly.

## Target responsibilities

- `apps/api` contains the local host, thin HTTP boundary, application use cases and adapters.
- `apps/web` contains routes, linked views and typed user intents. It displays supplied answers rather than recomputing analytical measures.
- `contracts` is the schema authority for platform envelopes and generated Python/TypeScript boundary types. Update the schema, regenerate and check generated outputs together; do not maintain divergent hand-written copies.
- `tests` contains synthetic cross-layer fixtures and acceptance checks.
- `docs` contains product/developer instructions matched to current status.

`packages/analytics` owns the tested canonical descriptive representations, selection, graph/variant/context/time queries and answers. No web/database/UI application imports belong in its core. A faster execution adapter must agree with canonical expected results before use. Add additional packages only when real responsibilities and reuse require them.

## Dependency and module discipline

Method owns supported norm validation, measurement, applicability and WISE scoring. Flow owns supplied-scene rendering and its public scene format. Both are external dependencies pinned exactly; eligible released pins remain an integration gate for the first release. Until those releases exist, the application uses the packed unreleased states under `vendor/` (see its README), names them where it shows their results, and does not present those results as results of a released library. It never simulates either library's results.

Shared platform contracts carry source/preparation/representation/population/definition identity, typed support and query revision. Application services own persistence, jobs and coherent publication; the browser owns convenient view state. A single descriptive definition must feed charts, profiles, matrix, variants and scenes. Nullable measures and unevaluable scores must never fall into a passed bucket.

Local expectation authoring is a workflow module, not a second analytical evaluator or mandatory service. Unscored investigations can be opened and saved without norm/score references.

## Local files and maintenance

Keep runtime CSVs, databases, artifacts, investigations, diagnostics, environments and credentials outside tracked source. Use a chosen external workspace for product state. Commit only appropriate source/configuration, synthetic fixtures, generated boundary artifacts and normal documentation. Preserve real dependency notices and scoped licence terms.

A program upgrade and workspace upgrade are separate operations. Refresh creates new source/result revisions; it does not silently reinterpret old findings. Qualification must cover incompatible schemas, stale or relocated sources, atomic publication and database-aware backup/restoration before those workflows are advertised.

The current filesystem adapter refuses unsupported workspace formats; it has no migration or source-refresh command. For this adapter, back up only a stopped workspace as a complete directory, not selected JSON files. The [release checklist](release-qualification.md) gives the safe operator procedure and exclusions. A future database adapter would require its own database-aware procedure.

Update the status and guide when a capability becomes available. A placeholder screen or type declaration is not a completed customer journey. See [testing](testing.md) and [roadmap](roadmap.md) for evidence required at each gate.

On Windows there are two ways in. The source setup above needs Python, Node.js and access to the package registries. The download that the workflow's Windows job builds needs none of them; [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) describes it. Neither has been qualified on Windows by a person yet.

For repeatable CLI/HTTP timing, disk usage and stopped-workspace restoration on synthetic input, run the [capacity benchmark](capacity.md). Its small real-process smoke test is part of `npm test`. Measurements never certify a release or a supported data size by themselves.
