# Installing WISE Platform on Windows from the download

This guide is for the Windows bundle: one folder that holds everything the application needs. Nothing else is downloaded during the installation, and neither Node.js nor Git is needed. The bundle is for Windows on a 64-bit Intel or AMD processor.

The bundle is a candidate build, not a release. `manifest.json` in the folder names the commit it was built from and the checks it passed. The process map and the scoring use library versions that have not been released yet; the application says so where it shows them.

## What the folder holds

| Path | What it is |
| --- | --- |
| `runtime\python-3.13.16-amd64.exe` | The official installer of Python 3.13.16 for 64-bit Windows, unchanged |
| `runtime\PYTHON-LICENSE.txt` | The licence of Python |
| `wheelhouse\` | The application, the method library and every package they need, as wheel files |
| `install-runtime.lock` | The exact list of those files with their checksums |
| `synthetic-inputs\` | Two small fictional CSV files to try the import with |
| `LICENSE`, `NOTICE`, `notices\` | The licence of the application and the notices of the packages it contains |
| `manifest.json`, `SHA256SUMS` | What was built and checked, and the checksum of every file |

## 1. Download and unpack

1. Sign in to GitHub in the browser and open the repository.
2. Open **Actions**, then the latest successful run of **Foundation checks** for the branch you were given.
3. At the bottom of the run's page, under **Artifacts**, download `wise-platform-windows-x64-cp313-…`. It arrives as a ZIP file.
4. Unpack it to a folder you may write to, for example `C:\wise\bundle`. Use a short path without special characters.

All commands below are typed in the **Command Prompt** (`cmd`), started in that folder:

```bat
cd /d C:\wise\bundle
```

## 2. Python 3.13

If Python 3.13 for 64 bit is already on the machine, check it and go to step 3:

```bat
py -3.13 -c "import platform, struct; print(platform.python_version(), struct.calcsize('P') * 8)"
```

The answer must begin with `3.13` and end with `64`. The bundle was checked with 3.13.16.

Otherwise install the Python that comes with the bundle, for your user only and without changing the system's settings:

```bat
runtime\python-3.13.16-amd64.exe /quiet InstallAllUsers=0 Include_launcher=0 PrependPath=0 AssociateFiles=0 Shortcuts=0 Include_test=0 Include_doc=0 Include_tcltk=0 TargetDir=%LOCALAPPDATA%\WISE\python313
```

This takes about a minute and shows no window. It needs no administrator rights. When it has finished, this prints `3.13.16`:

```bat
%LOCALAPPDATA%\WISE\python313\python.exe --version
```

## 3. Install the application

Create an environment of its own for the application and install from the folder. Use the first line if you installed Python in step 2, the second if Python 3.13 was already there:

```bat
%LOCALAPPDATA%\WISE\python313\python.exe -m venv C:\wise\env
```

```bat
py -3.13 -m venv C:\wise\env
```

Then:

```bat
C:\wise\env\Scripts\python.exe -m pip install --no-index --find-links wheelhouse --only-binary=:all: --require-hashes -r install-runtime.lock
```

`--no-index` means that nothing is fetched from the internet; `--require-hashes` means that every file must have the checksum the list names. The last line of the output begins with `Successfully installed`.

## 4. Start

```bat
C:\wise\env\Scripts\python.exe -m wise_platform_api --port 8765
```

Leave this window open and open <http://127.0.0.1:8765> in the browser. Ctrl+C in the window stops the application.

The application listens on this computer only (`127.0.0.1`). It sends nothing anywhere and fetches nothing.

## 5. First use

1. Create an empty folder for your work, outside the bundle and outside `C:\wise\env`, for example `C:\wise\workspace`.
2. In the application open **Data**, enter that folder's full path and choose **Open workspace**.
3. Add a CSV file. To try it first, use `synthetic-inputs\B4-ties-out-of-order.csv` from the bundle, or load one of the built-in examples.
4. Confirm how the file is read: separator and encoding, which column is the incident id, the activity and the time, the time format, and the cutoff. The report then says how many rows were read, which were left out and why.
5. Open the incidents. From there: the process map, the selection of whole incidents, the comparison, the expectation, and saving.

Your CSV file is not changed. A copy of its bytes is kept in the workspace folder together with how it was read, so that the work can be opened again later.

## If something does not work

- **`py` is not recognised.** Python is not installed for the launcher; use step 2.
- **The installer line does nothing visible.** That is expected; check with the `--version` line. If it prints nothing, start `runtime\python-3.13.16-amd64.exe` by double click, choose **Customize installation**, clear "for all users", and set the folder to `%LOCALAPPDATA%\WISE\python313`.
- **`pip` reports a hash mismatch or a missing file.** The folder is incomplete or was changed. Download and unpack it again. `certutil -hashfile <file> SHA256` prints a file's checksum for comparison with `SHA256SUMS`.
- **The port is in use.** Start with another one, for example `--port 8766`, and open that address.
- **The browser shows "Local service: Unavailable".** The window from step 4 was closed or stopped; start it again.

## Removing it

Close the window from step 4, then delete `C:\wise\env` and the bundle folder. If you installed Python in step 2, remove it under **Settings, Apps, Installed apps**. Your workspace folder is yours; delete it only if you no longer need the work in it.

## The other way: from the source

With Git, Python 3.13 and Node.js 24, and with access to the Python and npm package registries, the application can also be built from a checkout of the repository. The README of the repository describes that way.
