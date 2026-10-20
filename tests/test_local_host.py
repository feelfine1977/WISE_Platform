"""Actual local foundation process start/stop/restart; no import or persistence qualification."""
from pathlib import Path
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import wise_platform_api

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
VALID = {'status': 'ok', 'stage': 'foundation', 'version': '0.1.0'}


def response(url: str) -> tuple[int, bytes]:
    try:
        with OPENER.open(url, timeout=1) as result:
            return result.status, result.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def ready(process: subprocess.Popen, base: str, log: Path) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError('Local host exited before readiness: ' + log.read_text(encoding='utf-8', errors='replace'))
        try:
            status, payload = response(base + '/api/health')
            if status == 200:
                assert {key: value for key, value in json.loads(payload).items() if key != 'memory_budget_bytes'} == VALID
                return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            pass
        time.sleep(0.1)
    raise AssertionError('Local host did not become ready within 20 seconds: ' + log.read_text(encoding='utf-8', errors='replace'))


def stop(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def test_actual_cli_stops_and_restarts_on_the_same_loopback_port(tmp_path):
    # Reserve an available loopback port briefly; readiness must belong to our owned PID.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    assets = Path(wise_platform_api.__file__).resolve().parent / 'static'
    index = assets / 'index.html'
    for attempt in (1, 2):
        log = tmp_path / f'host-{attempt}.log'
        with log.open('wb') as stream:
            process = subprocess.Popen(
                [sys.executable, '-m', 'wise_platform_api', '--host', '127.0.0.1', '--port', str(port)],
                stdout=stream, stderr=subprocess.STDOUT,
            )
            try:
                ready(process, base, log)
                assert process.poll() is None
                assert {key: value for key, value in json.loads(response(base + '/api/health')[1]).items() if key != 'memory_budget_bytes'} == VALID
                assert response(base + '/api/unknown')[0] == 404
                status, body = response(base + '/')
                if index.is_file():
                    assert status == 200
                    assert body == index.read_bytes()
                    bundled = sorted((assets / 'assets').glob('*.js'))
                    assert bundled, 'A built browser index needs its local JavaScript assets.'
                    asset = bundled[0]
                    asset_status, asset_body = response(base + '/assets/' + asset.name)
                    assert asset_status == 200
                    assert asset_body == asset.read_bytes()
                else:
                    assert status == 503
                    assert b'browser assets are not built' in body.lower()
            finally:
                stop(process)
        assert process.poll() is not None
