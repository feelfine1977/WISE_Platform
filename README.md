# WISE_Platform

WISE_Platform is a local web application for investigating event histories with linked data charts and process mining. The first complete release targets Windows 11: import an incident CSV locally, compare groups and periods, explore a process map, transition matrix and variants, inspect full records, optionally apply WISE expectations, and save the investigation.

**Current status: M0 application foundation.** The foundation provides a local host, live health status and a generated contract boundary. It does not yet provide CSV import, incident analytics, process visuals, scoring or saved investigations. A successful start is not completion of the first analysis release. See the [roadmap](docs/roadmap.md) for the M1 qualification gates.

## Development setup

For the Windows source setup, use **Python 3.13.16**, **Node.js 24.19.0 LTS**, and the **npm 11.17.0 bundled with that Node release**. Download matching Windows installers from the official [Python release](https://www.python.org/downloads/release/python-31316/) and [Node release](https://nodejs.org/en/blog/release/v24.19.0). Use the installer matching your CPU. The first CI tier is Windows x64; ARM still needs separate qualification.

Reopen the terminal after installing and check before creating the environment:

```powershell
py -3.13 --version
node --version
npm --version
```

Expected versions are `Python 3.13.16`, `v24.19.0` and `11.17.0`. This is the recommended qualification combination configured in CI; Windows qualification is complete only after its actual checks and human journey pass. Other Python 3.11–3.14 and Node 22/24 compatibility lanes are secondary, not a request to choose your own initial combination.

Node is required to develop and build the browser application. A future analyst release carrying built browser assets is intended to run with its documented Python runtime and native dependencies; no executable is required.

Run from the repository root. Windows PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -c requirements-dev.lock -e ".[dev]"
npm ci
npm run generate
npm run check
npm test
npm run build
python -m wise_platform_api --port 8765
```

`npm test` runs the Python foundation suite. If your environment restricts PowerShell activation, use the approved environment/setup route; do not change company policy for this project. See [development](docs/development.md) for the browser development loop and module rules.

Open `http://127.0.0.1:8765`. Health is exposed at `/api/health`. Stop the host with Ctrl+C. The host serves built browser files and the API from one local process; a browser-development server is a developer convenience, not the analyst deployment.

## Target investigation workflow

1. Choose an external local workspace and import an event-history CSV.
2. Review field roles, time/order, quality and original source rows.
3. Open an unscored question; select categories, periods or duration tails through linked views.
4. Compare target/comparator context within a frozen eligible parent; inspect exact support and missingness.
5. Explore map, transition matrix and actual variants, retaining full incident histories.
6. Add a local reviewed expectation when useful; inspect applicability, scores and witnesses.
7. Save, stop and reopen the same investigation and evidence.

This workflow is the M1 target, not a list of currently available controls. Company data and runtime state belong in a selected workspace outside the repository and remain on the local computer. Synthetic fixtures support development and release qualification.

## Project guide

- [Architecture](docs/architecture.md): module ownership, contracts, state and local deployment.
- [Requirements](docs/requirements.md), [design perspectives](docs/design.md), [decisions](docs/adr/README.md) and [glossary](GLOSSARY.md).
- [Goal authoring](docs/goal-authoring.md): capability scope, review and scoring boundaries.
- [Roadmap](docs/roadmap.md): 48 capabilities, priorities and completion gates.
- [Development](docs/development.md): setup, generation, build and module rules.
- [Testing](docs/testing.md): exact analytical fixtures, recovery and Windows acceptance.

The application uses PolyForm Noncommercial 1.0.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Independently licensed dependencies retain their scoped terms and required notices.
