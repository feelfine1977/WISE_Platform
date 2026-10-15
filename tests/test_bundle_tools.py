"""Package admission must reject incomplete, incompatible or private payloads."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
HELPER = Path(os.environ.get('WISE_BUNDLE_HELPER', ROOT / 'tools/build_windows_bundle.py'))
SPEC = importlib.util.spec_from_file_location('bundle_tools', HELPER)
b = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(b)


def synthetic_wheel(directory, name, version='1.0', dependencies=(), tag='py3-none-any'):
    stem = name.replace('-', '_') + '-' + version
    path = directory / (stem + '-' + tag + '.whl')
    metadata = 'Metadata-Version: 2.1\nName: ' + name + '\nVersion: ' + version + '\n'
    metadata += ''.join('Requires-Dist: ' + d + '\n' for d in dependencies)
    with ZipFile(path, 'w') as archive:
        archive.writestr(stem + '.dist-info/METADATA', metadata)
        archive.writestr('vendor/other-9.0.dist-info/METADATA', 'Synthetic vendored metadata, not the wheel distribution.')
    return path


class BundleAdmissionTests(unittest.TestCase):
    def test_windows_markers_select_exact_constraint_without_foreign_platform(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'versions.lock'
            path.write_text('colorama==0.4.6; os_name == "nt"\nforeign==1.0; sys_platform == "linux"\n')
            self.assertEqual(b.exact_constraints(path), {'colorama': '0.4.6'})

    def test_constraints_refuse_ranges_duplicate_active_pins_and_includes(self):
        for text in ('dependency>=1\n', 'dependency==1\ndependency==2\n', '-r other.lock\n'):
            with self.subTest(text=text), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'versions.lock'; path.write_text(text)
                with self.assertRaises(ValueError):
                    b.exact_constraints(path)

    def test_primary_metadata_and_windows_only_transitive_dependency(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            synthetic_wheel(root, 'wise-platform', dependencies=['fixture-dependency>=1'])
            method = synthetic_wheel(root, 'wise-pm', '0.2.0')
            synthetic_wheel(root, 'fixture-dependency', dependencies=['fixture-windows; os_name == "nt"'])
            windows = synthetic_wheel(root, 'fixture-windows')
            constraints = {'fixture-dependency': '1.0', 'fixture-windows': '1.0'}
            with patch.object(b, 'METHOD_SHA', b.digest(method)):
                self.assertEqual(len(b.audit_closure(root, constraints)), 4)
                windows.unlink()
                with self.assertRaisesRegex(ValueError, 'Missing or incompatible Windows runtime dependency'):
                    b.audit_closure(root, constraints)

    def test_nonruntime_wheel_refuses_even_when_pinned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            synthetic_wheel(root, 'wise-platform')
            method = synthetic_wheel(root, 'wise-pm', '0.2.0')
            synthetic_wheel(root, 'fixture-build-tool')
            with patch.object(b, 'METHOD_SHA', b.digest(method)):
                with self.assertRaisesRegex(ValueError, 'non-runtime distributions'):
                    b.audit_closure(root, {'fixture-build-tool': '1.0'})

    def test_wrong_native_abi_refuses_before_archive_load(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture-1.0-cp314-cp314-win_amd64.whl'
            path.write_bytes(b'Synthetic incompatible artifact')
            with self.assertRaisesRegex(ValueError, 'incompatible with Windows x64 cp313'):
                b.wheel_record(path)

    def test_payload_allowlist_excludes_unwanted_source_and_nested_wheels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'LICENSE').write_text('Synthetic fixture licence')
            b.ensure_allowlist(root)
            (root / 'unexpected-source.txt').write_text('Synthetic unwanted file')
            with self.assertRaisesRegex(ValueError, 'Non-allowlisted bundle payload'):
                b.ensure_allowlist(root)
            (root / 'unexpected-source.txt').unlink()
            nested = root / 'wheelhouse/nested'; nested.mkdir(parents=True)
            (nested / 'fixture-1.0-py3-none-any.whl').write_bytes(b'Synthetic nested payload')
            with self.assertRaisesRegex(ValueError, 'Non-allowlisted bundle payload'):
                b.ensure_allowlist(root)

    def test_neutral_private_path_scan_handles_platforms_without_machine_names(self):
        roots = [b'\\'.join([b'C:', b'Users', b'fixture', b'source', b'module.py']),
                 b'/'.join([b'', b'Users', b'fixture', b'source', b'module.py']),
                 b'/'.join([b'', b'home', b'fixture', b'source', b'module.py']),
                 b'/'.join([b'', b'var', b'tmp', b'fixture', b'module.py'])]
        for path in roots:
            with self.subTest(path=path):
                self.assertIsNotNone(b.PRIVATE_PATH.search(path))
        self.assertIsNone(b.PRIVATE_PATH.search(b'https://example.invalid/api/health'))

    def test_shipped_historical_catalogue_excludes_private_source_defaults(self):
        reference = ROOT / 'apps/api/src/wise_platform_api/bpic19_reference/historical-notebook-norm.json'
        # Exercise the actual packaged data with the release guard. Never echo
        # the matched value into a failure or public qualification log.
        self.assertTrue(b.PRIVATE_PATH.search(reference.read_bytes()) is None,
                        'The shipped historical catalogue contains a private source path.')

    def test_unverified_installer_is_never_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / 'fixture-installer.exe'
            path.write_bytes(b'Synthetic invalid installer')
            with patch.object(b.sys, 'platform', 'win32'), patch.object(b.subprocess, 'run') as process:
                with self.assertRaises(ValueError):
                    b.install_official_python(path, root)
                process.assert_not_called()


if __name__ == '__main__':
    unittest.main()
