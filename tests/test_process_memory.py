"""Process-tree measurements include descendants and use real resident memory on each CI OS."""

from pathlib import Path
import subprocess
import sys
import time

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import process_memory  # noqa: E402


def test_windows_tree_counts_only_the_root_and_its_descendants(monkeypatch):
    monkeypatch.setattr(process_memory, "_windows_parents", lambda: {10: 1, 11: 10, 12: 11, 20: 1})
    monkeypatch.setattr(process_memory, "_windows_working_set", {10: 100, 11: 200, 12: 300, 20: 9000}.__getitem__)
    assert process_memory._windows_tree_rss(10) == 600


@pytest.mark.parametrize("missing", [10, 11])
def test_windows_tree_handles_a_departed_child_but_requires_its_root(monkeypatch, missing):
    monkeypatch.setattr(process_memory, "_windows_parents", lambda: {10: 1, 11: 10})

    def memory(pid):
        if pid == missing:
            raise ProcessLookupError(pid)
        return 100

    monkeypatch.setattr(process_memory, "_windows_working_set", memory)
    if missing == 10:
        with pytest.raises(ProcessLookupError):
            process_memory._windows_tree_rss(10)
    else:
        assert process_memory._windows_tree_rss(10) == 100


def test_windows_permission_failure_does_not_become_a_partial_measurement(monkeypatch):
    monkeypatch.setattr(process_memory, "_windows_parents", lambda: {10: 1, 11: 10})

    def memory(pid):
        if pid == 11:
            raise PermissionError(pid)
        return 100

    monkeypatch.setattr(process_memory, "_windows_working_set", memory)
    with pytest.raises(PermissionError):
        process_memory._windows_tree_rss(10)


def test_real_tree_memory_includes_parent_and_child_on_the_current_os(tmp_path):
    ready = tmp_path / "ready"
    child_code = "import time; data = bytearray(b'x' * (24 * 1024 * 1024)); print('ready', flush=True); time.sleep(60)"
    parent_code = """
import subprocess, sys
from pathlib import Path
data = bytearray(b'x' * (24 * 1024 * 1024))
child = subprocess.Popen([sys.executable, '-c', sys.argv[2]], stdout=subprocess.PIPE, text=True)
try:
    assert child.stdout.readline().strip() == 'ready'
    ready = Path(sys.argv[1])
    pending = ready.with_suffix('.tmp')
    pending.write_text(str(child.pid))
    pending.replace(ready)
    sys.stdin.readline()
finally:
    child.terminate()
    child.wait(timeout=10)
"""
    parent = subprocess.Popen([sys.executable, "-c", parent_code, str(ready), child_code], stdin=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 15
        while not ready.exists() and parent.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        assert ready.exists(), "The test process tree did not become ready."
        child_rss = process_memory.tree_rss(int(ready.read_text()))
        tree_rss = process_memory.tree_rss(parent.pid)
        assert child_rss > 16 * 1024 * 1024
        assert tree_rss > child_rss + 16 * 1024 * 1024
    finally:
        try:
            parent.communicate("\n", timeout=15)
        except subprocess.TimeoutExpired:
            parent.kill()
            parent.wait(timeout=5)
    assert parent.returncode == 0
