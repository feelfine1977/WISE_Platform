# WISE_Platform

WISE_Platform is a local web application for investigating event histories with linked data charts and process mining. The first complete release targets Windows 11: import an incident CSV locally, compare groups and periods, explore a process map, transition matrix and variants, inspect full records, optionally apply WISE expectations, and save the investigation.

**Current status: a first investigation candidate, not a release.** The application now does the following on this computer:

- imports an incident CSV into a workspace folder you choose: separator, encoding, the columns for incident, activity and time, the time format and clock, and a report of what was read and what was left out;
- lists the incidents and shows every original record of an incident;
- draws a process map and keeps or removes whole incidents from an activity or a path, with every step shown with its counts and undo;
- shows how the selected incidents were opened beside their parent, and their variants;
- compares two groups of incidents, or two periods of incident starts, with every share and what it is a share of;
- scores one expectation about the time from one activity to another with the method library, with the records behind each score;
- saves an investigation and reopens it after the application was stopped and started.

Each of these passes its contract tests through the real operations and has been used in a browser on synthetic data. **Not done yet:** qualification on Windows by a person; charts with brushing and the transition matrix; everything else the [roadmap](docs/roadmap.md) lists for the first release. The process map uses `wise-flow` 0.3.5 and the scoring uses `wise-pm` 0.2.0. Both are unreleased states of those libraries, kept as packed files under [`vendor/`](vendor/README.md); the application says so where it shows them, and their results are not those of a released library.

## Installing

- **On Windows, without Node.js or Git:** download the Windows bundle that the repository's workflow builds and follow [docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md). The bundle holds the Python installer, the application and every package it needs.
- **From the source:** the development setup below.

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
python -m pip install -c requirements-dev.lock vendor/wise_pm-0.2.0-py3-none-any.whl
python -m pip install -c requirements-dev.lock -e ".[dev]"
npm ci
npm run generate
npm run check
npm test
npm run build
python -m wise_platform_api --port 8765
```

macOS or Linux, in bash or zsh. Only the first two lines differ:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -c requirements-dev.lock vendor/wise_pm-0.2.0-py3-none-any.whl
python -m pip install -c requirements-dev.lock -e ".[dev]"
npm ci
npm run generate
npm run check
npm test
npm run build
python -m wise_platform_api --port 8765
```

The first `pip` line installs the packed method library that the scoring uses; without it the scoring tests cannot start and the application cannot score. If the last line reports that the address is already in use, another program holds that port: start with another one, for example `--port 8780`, and open that address. `npm run check` checks the types and runs the browser's component tests; `npm test` runs the Python tests, including the contract tests through the real operations. If your environment restricts PowerShell activation, use the approved environment/setup route; do not change company policy for this project. See [development](docs/development.md) for the browser development loop and module rules.

Open `http://127.0.0.1:8765`. Health is exposed at `/api/health`. Stop the host with Ctrl+C. The host serves built browser files and the API from one local process; a browser-development server is a developer convenience, not the analyst deployment.

## Target investigation workflow

1. Choose an external local workspace and import an event-history CSV.
2. Review field roles, time/order, quality and original source rows.
3. Open an unscored question; select categories, periods or duration tails through linked views.
4. Compare target/comparator context within a frozen eligible parent; inspect exact support and missingness.
5. Explore map, transition matrix and actual variants, retaining full incident histories.
6. Add a local reviewed expectation when useful; inspect applicability, scores and witnesses.
7. Save, stop and reopen the same investigation and evidence.

Steps 1, 2, 4 (for groups and periods), 5 (map and variants), 6 (one expectation about the time between two activities) and 7 are available in the current candidate in a first form. Linked charts with brushing in step 3, duration tails and the transition matrix are not built yet. Company data and runtime state belong in a selected workspace outside the repository and remain on the local computer. Synthetic fixtures support development and release qualification.

## Project guide

- [Architecture](docs/architecture.md): module ownership, contracts, state and local deployment.
- [Requirements](docs/requirements.md), [design perspectives](docs/design.md), [decisions](docs/adr/README.md) and [glossary](GLOSSARY.md).
- [Goal authoring](docs/goal-authoring.md): capability scope, review and scoring boundaries.
- [Roadmap](docs/roadmap.md): 48 capabilities, priorities and completion gates.
- [Development](docs/development.md): setup, generation, build and module rules.
- [Testing](docs/testing.md): exact analytical fixtures, recovery and Windows acceptance.

The application uses PolyForm Noncommercial 1.0.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Independently licensed dependencies retain their scoped terms and required notices.
