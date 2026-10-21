"""Current resident bytes for a process tree on POSIX and Windows.

Windows working sets are already bytes; POSIX ``ps`` reports KiB. Both are
summed per process, so shared pages may be counted more than once.
"""

from __future__ import annotations

import ctypes
from functools import lru_cache
import subprocess
import sys


def _descendants(root_pid: int, parents: dict[int, int]) -> set[int]:
    children: dict[int, list[int]] = {}
    for pid, parent in parents.items():
        children.setdefault(parent, []).append(pid)
    found, pending = set(), [root_pid]
    while pending:
        pid = pending.pop()
        if pid not in found:
            found.add(pid)
            pending.extend(children.get(pid, ()))
    return found


@lru_cache(maxsize=1)
def _windows_api():
    # Loaded only on Windows; explicit pointer-sized fields preserve the x64 ABI.
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260),
        ]

    class MemoryCounters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
                "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage",
            )
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    for name in ("Process32FirstW", "Process32NextW"):
        function = getattr(kernel, name)
        function.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
        function.restype = wintypes.BOOL
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
    kernel.K32GetProcessMemoryInfo.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    return kernel, ProcessEntry, MemoryCounters


def _windows_parents() -> dict[int, int]:
    kernel, ProcessEntry, _ = _windows_api()
    snapshot = kernel.CreateToolhelp32Snapshot(0x00000002, 0)  # TH32CS_SNAPPROCESS
    if snapshot == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        found = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        parents = {}
        while found:
            parents[entry.th32ProcessID] = entry.th32ParentProcessID
            found = kernel.Process32NextW(snapshot, ctypes.byref(entry))
        error = ctypes.get_last_error()
        if error != 18:  # ERROR_NO_MORE_FILES is the successful end of the snapshot.
            raise ctypes.WinError(error)
        return parents
    finally:
        kernel.CloseHandle(snapshot)


def _windows_working_set(pid: int) -> int:
    kernel, _, MemoryCounters = _windows_api()
    handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        error = ctypes.get_last_error()
        if error == 87:  # ERROR_INVALID_PARAMETER: the process exited after the snapshot.
            raise ProcessLookupError(pid)
        raise ctypes.WinError(error)
    try:
        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        if not kernel.K32GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        return counters.WorkingSetSize
    finally:
        kernel.CloseHandle(handle)


def _windows_tree_rss(root_pid: int) -> int:
    pids = _descendants(root_pid, _windows_parents())
    total = 0
    for pid in pids:
        try:
            total += _windows_working_set(pid)
        except ProcessLookupError:
            if pid == root_pid:
                raise
            # A descendant can exit between enumeration and measurement.
    return total


def tree_rss(root_pid: int) -> int:
    """Current resident bytes of the root and every descendant, not lifetime peaks."""
    if sys.platform == "win32":
        return _windows_tree_rss(root_pid)
    table = subprocess.check_output(["ps", "-axo", "pid=,ppid=,rss="], text=True, timeout=5)
    parents, resident = {}, {}
    for line in table.splitlines():
        parts = line.split()
        if len(parts) == 3:
            pid, parent, kilobytes = map(int, parts)
            parents[pid] = parent
            resident[pid] = kilobytes * 1024
    return sum(resident.get(pid, 0) for pid in _descendants(root_pid, parents))
