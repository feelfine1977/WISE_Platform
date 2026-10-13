"""Choose and initialize the analyst's default local workspace."""

from collections.abc import Iterable, Mapping
import os
from pathlib import Path
import sys

from .workspace import Problem, Workspace


def default_workspace_path(
    *, platform: str | None = None, environment: Mapping[str, str] | None = None, home: Path | None = None
) -> Path:
    """A stable per-user data location, independent of the launch directory.

    Absolute operating-system data directory hints take precedence. Relative
    hints are ignored; they must never put runtime data under the current folder.
    This function only chooses a path and does not create it.
    """
    platform = sys.platform if platform is None else platform
    environment = os.environ if environment is None else environment
    home = Path.home() if home is None else home
    if platform == "darwin":
        base = home / "Library" / "Application Support"
    else:
        key = "LOCALAPPDATA" if platform == "win32" else "XDG_DATA_HOME"
        hint = environment.get(key, "")
        supplied = Path(hint) if hint else None
        if supplied is not None and supplied.is_absolute():
            base = supplied
        else:
            base = home / "AppData" / "Local" if platform == "win32" else home / ".local" / "share"
    return base / "WISE" / "workspace"


def open_default_workspace(path: Path | None, forbidden: Iterable[Path]) -> Workspace | Problem:
    """Create only the chosen external folder, then reuse normal workspace checks.

    A caller's explicit override is never replaced by another location. Existing
    foreign or damaged folders are refused by Workspace.open and kept untouched.
    """
    try:
        selected = default_workspace_path() if path is None else Path(path)
        if not selected.is_absolute():
            return Problem("workspace_unavailable", "The workspace override must be a full absolute folder path.", "path")
        folder = selected.resolve()
        programs = tuple(Path(program).resolve() for program in forbidden)
        if any(folder == program or program in folder.parents for program in programs):
            return Problem(
                "workspace_incompatible", "This folder belongs to the program. Choose a workspace outside the program.", "path"
            )
        if folder.exists() and not folder.is_dir():
            return Problem("workspace_unavailable", "The selected workspace path is a file, not a folder.", "path")
        folder.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        return Problem(
            "workspace_not_writable", "The local workspace folder cannot be created or reached. Choose a writable folder, "
            "or change its permissions and retry.", "path"
        )
    except (OSError, RuntimeError, ValueError):
        return Problem(
            "workspace_unavailable", "The selected local workspace folder cannot be reached or created. "
            "Check its path and drive, or choose another folder.", "path"
        )
    return Workspace.open(str(folder), programs)
