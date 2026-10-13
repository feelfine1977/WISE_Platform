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
4. Unpack it into a folder of your own user profile, so that no special rights are needed. This guide uses `%LOCALAPPDATA%\WISE\bundle`; `%LOCALAPPDATA%` is a folder inside your own user profile that you may always write to; typing it into the address bar of the file explorer opens it. After unpacking, `%LOCALAPPDATA%\WISE\bundle\install-runtime.lock` must exist.

All commands below are typed in the **Command Prompt** (`cmd`), started in that folder. The quotation marks matter, because the path of a user profile can contain spaces:

```bat
cd /d "%LOCALAPPDATA%\WISE\bundle"
```

## 2. Python 3.13

Install the Python that comes with the bundle, for your user only and without changing the system's settings. It needs no administrator rights:

```bat
start /wait "" "runtime\python-3.13.16-amd64.exe" /quiet /norestart /log installer.log InstallAllUsers=0 Include_launcher=0 PrependPath=0 AssociateFiles=0 Shortcuts=0 Include_test=0 Include_doc=0 Include_tcltk=0 TargetDir="%LOCALAPPDATA%\WISE\python313"
```

The line returns when the installer has finished, after about a minute, and shows no window. Check its result before going on:

```bat
echo %ERRORLEVEL%
```

`0` means installed. `3010` means installed, and Windows wants a restart at some time; you can go on without it. Any other number means that it failed: read `installer.log` in this folder. Then this prints `3.13.16`:

```bat
"%LOCALAPPDATA%\WISE\python313\python.exe" -I --version
```

The `-I` in this and the following commands makes Python ignore settings and packages of other Python installations on the machine.

**Using a Python that is already installed.** This is possible when it is Python 3.13 for 64 bit in its ordinary build. Check it:

```bat
py -3.13 -I -c "import platform, struct, sysconfig; print(platform.python_version(), struct.calcsize('P') * 8, sysconfig.get_config_var('Py_GIL_DISABLED'))"
```

The answer must begin with `3.13`, then `64`, and must not end with `1` (the free-threaded build cannot use these files). The bundle was checked with 3.13.16. If in doubt, use the installer above; it does not disturb another Python.

## 3. Install the application

Create an environment of its own for the application. Use the first line if you installed Python in step 2, the second if you use a Python that was already there:

```bat
"%LOCALAPPDATA%\WISE\python313\python.exe" -I -m venv "%LOCALAPPDATA%\WISE\env"
```

```bat
py -3.13 -I -m venv "%LOCALAPPDATA%\WISE\env"
```

Then install from the folder:

```bat
"%LOCALAPPDATA%\WISE\env\Scripts\python.exe" -I -m pip install --no-index --find-links wheelhouse --only-binary=:all: --require-hashes -r install-runtime.lock
```

`--no-index` means that nothing is fetched from the internet; `--require-hashes` means that every file must have the checksum the list names. The last line of the output begins with `Successfully installed`.

## 4. Start

```bat
"%LOCALAPPDATA%\WISE\env\Scripts\python.exe" -I -m wise_platform_api --port 8765
```

Leave this window open and open <http://127.0.0.1:8765> in the browser. Ctrl+C in the window stops the application.

The application listens on this computer only (`127.0.0.1`). It sends nothing anywhere and fetches nothing.

## 5. First use

1. Open the browser address from step 4. The application creates its working folder at `%LOCALAPPDATA%\WISE\workspace` automatically. With a new workspace, it loads the fictional incident example and opens its process map. No folder path needs to be entered.
2. Explore the map, switch to **Incidents** for complete histories, or open **Compare** and **Expectation**. The initial sample uses the same investigation as an imported CSV.
3. To use your own file, open **Data** and add a CSV. The workspace in use is shown there; **Use another folder** is an optional advanced choice. To try import first, use `synthetic-inputs\B4-ties-out-of-order.csv` from the bundle.
4. Confirm how the file is read: separator and encoding, which column is the incident id, the activity and the time, the time format, and the cutoff. The report then says how many rows were read, which were left out and why.
5. Open the incidents to see their map. Keep or remove whole incidents, compare groups or periods, optionally score an expectation, and save the investigation. After a restart the last reading opens again; saved investigations are available in **Saved**.

To create or reuse a different default working folder, start the service with an absolute path:

```bat
"%LOCALAPPDATA%\WISE\env\Scripts\python.exe" -I -m wise_platform_api --port 8765 --workspace "D:\Investigations\Incidents"
```

An incompatible folder is refused and its files are preserved. The app offers retry or choosing another folder.

Your CSV file is not changed. A copy of its bytes is kept in the workspace folder together with how it was read, so that the work can be opened again later.

## If something does not work

- **`py` is not recognised.** Python is not installed for the launcher; use step 2.
- **The installer line shows nothing.** That is expected; check with the `--version` line. If that prints nothing, read `installer.log` in the bundle folder, or start `runtime\python-3.13.16-amd64.exe` by double click, choose **Customize installation**, clear "for all users", and set the folder to `%LOCALAPPDATA%\WISE\python313`.
- **`pip` reports a hash mismatch or a missing file.** The folder is incomplete or was changed. Download and unpack it again. `certutil -hashfile <file> SHA256` prints a file's checksum for comparison with `SHA256SUMS`.
- **The port is in use.** Start with another one, for example `--port 8766`, and open that address.
- **The browser shows "Local service: Unavailable".** The window from step 4 was closed or stopped; start it again.

## Removing it

Close the window from step 4, then delete `%LOCALAPPDATA%\WISE\env` and `%LOCALAPPDATA%\WISE\bundle`. If you installed Python in step 2, remove it under **Settings, Apps, Installed apps**. Your workspace folder is yours; delete it only if you no longer need the work in it.

## The other way: from the source

With Git, Python 3.13 and Node.js 24, and with access to the Python and npm package registries, the application can also be built from a checkout of the repository. The README of the repository describes that way.
