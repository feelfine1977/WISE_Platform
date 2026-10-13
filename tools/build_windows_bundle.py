"""Build and qualify one Windows x64 CPython 3.13 analyst artifact."""
from __future__ import annotations

import argparse
from email.parser import BytesParser
from hashlib import sha256
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import sysconfig
import urllib.request
from zipfile import ZipFile

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.tags import cpython_tags, compatible_tags
from packaging.utils import canonicalize_name, parse_wheel_filename

PYTHON_VERSION = '3.13.16'
BUILD_PINS = {'pip': '26.2.1', 'setuptools': '84.0.0', 'wheel': '0.48.0',
              'build': '1.6.1', 'packaging': '26.3', 'pyproject-hooks': '1.3.3',
              'colorama': '0.4.6'}
PRIVATE_PATH = re.compile(rb'(?:[A-Za-z]:)?[\\/](?:users|home|tmp|temp|(?:private|var)[\\/]tmp)[\\/][A-Za-z0-9_. -]+[\\/]', re.IGNORECASE)
METHOD_SHA = '7329b7929bb8a3e40c596b359f352aace23cc233d8f29322ee063612733aecc3'
INSTALLER = {
    'url': 'https://www.python.org/ftp/python/3.13.16/python-3.13.16-amd64.exe',
    'sha256': 'fb4f9f5d438b2396da0086dc70b935c530cb578e37adc6d354f7ad2037fee83b',
    'release_page': 'https://www.python.org/downloads/release/python-31316/',
    'license_url': 'https://raw.githubusercontent.com/python/cpython/cbc944f4bc59639a444dd971c737788ba2283a91/LICENSE',
    'license_sha256': '78b12c3a81360b357002334f0e70ea0e92eebf7a9b358805c03c48484945f3bb',
    'source_commit': 'cbc944f4bc59639a444dd971c737788ba2283a91',
}
FEATURES = {'examples', 'import', 'selection', 'comparison', 'saving', 'scoring'}


def digest(path):
    return sha256(Path(path).read_bytes()).hexdigest()


def run(args, cwd, env=None):
    subprocess.run([str(a) for a in args], cwd=cwd, env=env, check=True)


def exact_constraints(path):
    result = {}
    for raw in Path(path).read_text(encoding='utf8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        try:
            req = Requirement(line)
        except Exception as error:
            raise ValueError('Runtime constraints must use exact name==version pins.') from error
        specifiers = list(req.specifier)
        if req.url or req.extras or len(specifiers) != 1 or specifiers[0].operator != '==' or '*' in specifiers[0].version:
            raise ValueError('Runtime constraints must use exact name==version pins.')
        if req.marker and not req.marker.evaluate(windows_markers()):
            continue
        name = canonicalize_name(req.name)
        if name in result:
            raise ValueError('Duplicate runtime constraint: ' + name)
        result[name] = next(iter(req.specifier)).version
    return result


def windows_markers():
    return {**default_environment(), 'os_name': 'nt', 'sys_platform': 'win32',
            'platform_system': 'Windows', 'platform_machine': 'AMD64',
            'platform_python_implementation': 'CPython', 'implementation_name': 'cpython',
            'implementation_version': PYTHON_VERSION, 'python_version': '3.13',
            'python_full_version': PYTHON_VERSION, 'extra': ''}


def wheel_record(path):
    path = Path(path)
    name, version, _, tags = parse_wheel_filename(path.name)
    accepted = set(cpython_tags((3, 13), abis=['cp313'], platforms=['win_amd64']))
    accepted.update(compatible_tags((3, 13), interpreter='cp313', platforms=['win_amd64']))
    if not tags.intersection(accepted):
        raise ValueError('Wheel is incompatible with Windows x64 cp313: ' + path.name)
    with ZipFile(path) as archive:
        metadata_names = [n for n in archive.namelist() if n.endswith('.dist-info/METADATA') and len(PurePosixPath(n).parts) == 2]
        if len(metadata_names) != 1:
            raise ValueError('Wheel has no unique metadata: ' + path.name)
        metadata = BytesParser().parsebytes(archive.read(metadata_names[0]))
        if canonicalize_name(metadata['Name']) != name or metadata['Version'] != str(version):
            raise ValueError('Wheel filename differs from metadata: ' + path.name)
        requirements = [Requirement(r) for r in metadata.get_all('Requires-Dist', [])]
    return {'name': str(name), 'version': str(version), 'file': path.name,
            'sha256': digest(path), 'byte_count': path.stat().st_size,
            'tags': sorted(map(str, tags)), 'requirements': requirements}


def audit_closure(directory, constraints):
    records = [wheel_record(p) for p in sorted(Path(directory).iterdir())]
    by_name = {}
    for record in records:
        name = record['name']
        if name in by_name:
            raise ValueError('Multiple wheels for one runtime distribution: ' + name)
        if name not in {'wise-platform', 'wise-pm'} and constraints.get(name) != record['version']:
            raise ValueError('Resolved runtime name/version has no exact reviewed constraint: ' + name)
        by_name[name] = record
    if set(by_name).intersection({'wise-platform', 'wise-pm'}) != {'wise-platform', 'wise-pm'}:
        raise ValueError('Platform and exact Method wheels are both required.')
    if by_name['wise-pm']['sha256'] != METHOD_SHA:
        raise ValueError('Method artifact hash differs from the exact supplied candidate.')
    reached, pending = set(), ['wise-platform', 'wise-pm']
    while pending:
        name = pending.pop()
        if name in reached:
            continue
        reached.add(name)
        for requirement in by_name[name]['requirements']:
            if requirement.marker and not requirement.marker.evaluate(windows_markers()):
                continue
            dependency = canonicalize_name(requirement.name)
            actual = by_name.get(dependency)
            if actual is None or actual['version'] not in requirement.specifier:
                raise ValueError('Missing or incompatible Windows runtime dependency: ' + str(requirement))
            if requirement.extras:
                raise ValueError('Runtime extras need an explicit expanded closure review: ' + str(requirement))
            pending.append(dependency)
    if reached != set(by_name):
        raise ValueError('Bundle contains non-runtime distributions: ' + ', '.join(sorted(set(by_name) - reached)))
    return [{k: v for k, v in r.items() if k != 'requirements'} for r in records]


def inspect_platform(path, root):
    root = Path(root)
    with ZipFile(path) as archive:
        names = archive.namelist()
        for name in names:
            p = PurePosixPath(name)
            if p.is_absolute() or '..' in p.parts:
                raise ValueError('Wheel member escapes its archive.')
        for module in ('wise_platform_api/__main__.py', 'wise_platform_analytics/__init__.py'):
            if module not in names:
                raise ValueError('Installed package module is absent: ' + module)
        for name in ('S0', 'S1', 'S2', 'S3'):
            if archive.read('wise_platform_api/examples/' + name + '.csv') != (root / 'apps/api/src/wise_platform_api/examples' / (name + '.csv')).read_bytes():
                raise ValueError('Packaged example differs from source: ' + name)
        for name in ('LICENSE', 'NOTICE'):
            candidates = [n for n in names if '.dist-info/licenses/' in n and n.endswith('/' + name)]
            if len(candidates) != 1 or archive.read(candidates[0]) != (root / name).read_bytes():
                raise ValueError('Root legal file is missing or changed: ' + name)
        static = 'wise_platform_api/static/'
        index = archive.read(static + 'index.html')
        for reference in re.findall(rb'(?:src|href)="(/[^\"]+)"', index):
            archive.read(static + reference.decode().lstrip('/'))
        manifest = json.loads(archive.read(static + 'THIRD-PARTY-NOTICES.json'))
        text = archive.read(static + 'THIRD-PARTY-NOTICES.txt')
        if sha256(text).hexdigest() != manifest['text_sha256']:
            raise ValueError('Browser notice digest differs from manifest.')
        for package in manifest['packages']:
            for file in package['files']:
                p = PurePosixPath(file['path'])
                if p.is_absolute() or '..' in p.parts:
                    raise ValueError('Browser notice manifest path is not project-relative.')
                data = text[file['text_byte_offset']:file['text_byte_offset'] + file['byte_count']]
                if sha256(data).hexdigest() != file['sha256']:
                    raise ValueError('Browser notice source bytes differ from hash.')
        for name in names:
            if name.endswith(('.py', '.json', '.html', '.js', '.css', '.txt', '.md')):
                data = archive.read(name)
                if PRIVATE_PATH.search(data):
                    raise ValueError('Private source path leaked into Platform wheel: ' + name)
        assets = {n[len(static):]: sha256(archive.read(n)).hexdigest() for n in names if n.startswith(static) and not n.endswith('/')}
    return {'static_sha256': assets, 'browser_legal_packages': len(manifest['packages'])}


def download_checked(url, expected, destination):
    request = urllib.request.Request(url, headers={'User-Agent': 'WISE-Platform-bundle-build'})
    data = urllib.request.urlopen(request, timeout=120).read()
    if sha256(data).hexdigest() != expected:
        raise ValueError('Downloaded source hash differs from primary verified pin.')
    Path(destination).write_bytes(data)


def install_official_python(installer, work):
    if sys.platform != 'win32':
        raise ValueError('Official installer execution is allowed only in the Windows runner.')
    if digest(installer) != INSTALLER['sha256']:
        raise ValueError('Installer bytes differ from the official verified artifact.')
    target = Path(work) / 'official-python'
    if target.exists():
        raise ValueError('Official interpreter target must be a fresh external directory.')
    flags = {'InstallAllUsers': 0, 'Include_launcher': 0, 'InstallLauncherAllUsers': 0,
             'PrependPath': 0, 'AppendPath': 0, 'AssociateFiles': 0, 'Shortcuts': 0,
             'Include_exe': 1, 'Include_lib': 1, 'Include_dev': 1, 'Include_pip': 1,
             'Include_test': 0, 'Include_doc': 0, 'Include_tcltk': 0, 'Include_tools': 0,
             'Include_debug': 0, 'Include_symbols': 0, 'Include_freethreaded': 0}
    environment = {k: v for k, v in os.environ.items() if k not in {'PYTHONPATH', 'PYTHONHOME'}}
    command = [str(installer), '/quiet', '/norestart', '/log', str(Path(work) / 'official-python-install.log'),
               'TargetDir=' + str(target), *[f'{key}={value}' for key, value in flags.items()]]
    installed = subprocess.run(command, cwd=work, env=environment, timeout=600, check=False)
    if installed.returncode != 0:
        raise ValueError(f'Official per-user installer did not complete without reboot: {installed.returncode}.')
    python = target / 'python.exe'
    probe_code = "import json,platform,struct,sys,sysconfig;print(json.dumps({'version':platform.python_version(),'platform':sys.platform,'bits':struct.calcsize('P')*8,'machine':platform.machine(),'free_threaded':bool(sysconfig.get_config_var('Py_GIL_DISABLED')),'prefix':sys.prefix,'executable':sys.executable}))"
    probe = json.loads(subprocess.check_output([str(python), '-I', '-c', probe_code], cwd=work, env=environment, text=True))
    if (probe['version'] != PYTHON_VERSION or probe['platform'] != 'win32' or probe['bits'] != 64 or
            probe['machine'].lower() not in {'amd64', 'x86_64'} or probe['free_threaded'] or
            Path(probe['prefix']).resolve() != target.resolve() or Path(probe['executable']).resolve() != python.resolve()):
        raise ValueError('The newly installed official interpreter does not match the required runtime.')
    # ensurepip consumes the interpreter's bundled wheel payload without an index.
    run([python, '-I', '-m', 'ensurepip', '--upgrade'], work, environment)
    pip_code = "import ensurepip,json,pip;print(json.dumps({'ensurepip_version':ensurepip.version(),'bundled_pip_version':pip.__version__,'pip_file':pip.__file__}))"
    pip_probe = json.loads(subprocess.check_output([str(python), '-I', '-c', pip_code], cwd=work, env=environment, text=True))
    if not Path(pip_probe.pop('pip_file')).resolve().is_relative_to(target.resolve()):
        raise ValueError('Installer pip did not resolve inside the new official interpreter.')
    receipt = {'installer_sha256': digest(installer), 'installer_exit_code': installed.returncode,
               'installed_from_bundled_installer': True, 'scope': 'ephemeral Windows runner per-user external target',
               'version': probe['version'], 'architecture': 'x64', 'ordinary_abi': True,
               'official_interpreter_prefix_verified': True, 'install_options': flags,
               'installer_reboot_required': False, **pip_probe}
    return python, receipt


def ensure_allowlist(bundle):
    fixed = {'install-runtime.lock', 'manifest.json', 'SHA256SUMS', 'INSTALL-WINDOWS.md', 'LICENSE', 'NOTICE',
             'notices/THIRD-PARTY-NOTICES.txt', 'notices/THIRD-PARTY-NOTICES.json',
             'runtime/python-3.13.16-amd64.exe', 'runtime/PYTHON-LICENSE.txt',
             'synthetic-inputs/B4-ties-out-of-order.csv', 'synthetic-inputs/first-resolution.csv'}
    for path in Path(bundle).rglob('*'):
        if path.is_symlink():
            raise ValueError('Symlink is not an allowlisted bundle payload.')
        if not path.is_file():
            continue
        relative = path.relative_to(bundle).as_posix()
        if relative not in fixed and not (len(PurePosixPath(relative).parts) == 2 and relative.startswith('wheelhouse/') and path.suffix == '.whl'):
            raise ValueError('Non-allowlisted bundle payload: ' + relative)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--constraints', type=Path)
    parser.add_argument('--npm-cli', type=Path)
    parser.add_argument('--features', default='examples,import,selection,comparison,saving,scoring')
    options = parser.parse_args()
    root, work, bundle = options.root.resolve(), options.work.resolve(), options.out.resolve()
    features = set(options.features.split(','))
    if not {'examples', 'import', 'selection'} <= features or not features <= FEATURES or ('saving' in features and 'comparison' not in features):
        raise ValueError('Explicit qualification features must include examples/import/selection; saving also needs comparison.')
    if sys.platform != 'win32' or platform.machine().lower() not in ('amd64', 'x86_64') or platform.python_version() != PYTHON_VERSION or sysconfig.get_config_var('Py_GIL_DISABLED'):
        raise ValueError('Packaging requires ordinary CPython 3.13.16 Windows x64, not ARM64 or cp313t.')
    for name, version in BUILD_PINS.items():
        if importlib.metadata.version(name) != version:
            raise ValueError('Build tool version differs from exact proof pin: ' + name)
    if work.is_relative_to(root) or bundle.is_relative_to(root) or work == bundle or bundle.exists():
        raise ValueError('Use fresh external work and artifact directories, never a source or existing artifact directory.')
    work.mkdir(parents=True, exist_ok=False)
    bundle.mkdir(parents=True)
    source_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if source_sha != options.source_sha or not re.fullmatch('[0-9a-f]{40}', source_sha):
        raise ValueError('Checked-out source differs from the reviewed workflow SHA.')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip():
        raise ValueError('Tracked source must be clean before packaging.')
    node = Path(shutil.which('node') or '')
    candidates = [options.npm_cli, node.parent / 'node_modules/npm/bin/npm-cli.js', node.parent.parent / 'lib/node_modules/npm/bin/npm-cli.js']
    npm = next((p for p in candidates if p and p.is_file()), None)
    if not npm or subprocess.check_output([str(node), '--version'], text=True).strip() != 'v24.19.0' or subprocess.check_output([str(node), str(npm), '--version'], text=True).strip() != '11.17.0':
        raise ValueError('Node 24.19.0 and npm 11.17.0 are required.')
    constraints_path = options.constraints or root / 'requirements-dev.lock'
    constraints = exact_constraints(constraints_path)
    run([node, npm, 'ci'], root)
    run([node, npm, 'run', 'build'], root)
    build_script = json.loads((root / 'package.json').read_text())['scripts']['build']
    if 'collect-browser-notices.mjs' not in build_script:
        run([node, root / 'tools/collect-browser-notices.mjs', '--root', root, '--npm-cli', npm], root)
    run(['git', 'diff', '--exit-code'], root)
    dist = work / 'dist'
    run([sys.executable, '-I', '-m', 'build', '--wheel', '--no-isolation', '--outdir', dist, root], work)
    platform_wheels = list(dist.glob('*.whl'))
    if len(platform_wheels) != 1:
        raise ValueError('Build must emit one Platform wheel.')
    platform_wheel = platform_wheels[0]
    inspection = inspect_platform(platform_wheel, root)
    method = root / 'vendor/wise_pm-0.2.0-py3-none-any.whl'
    if digest(method) != METHOD_SHA:
        raise ValueError('Vendored Method bytes differ from reviewed exact artifact.')
    wheelhouse = bundle / 'wheelhouse'; wheelhouse.mkdir()
    roots = [platform_wheel, method]
    seeds = []
    for path in roots:
        for req in wheel_record(path)['requirements']:
            if not req.marker or req.marker.evaluate(windows_markers()):
                name = canonicalize_name(req.name)
                if name == 'wise-pm':
                    continue
                if name not in constraints:
                    raise ValueError('Runtime seed has no exact reviewed pin: ' + name)
                seeds.append(name + '==' + constraints[name])
    seed_file = work / 'runtime-seeds.txt'; seed_file.write_text('\n'.join(sorted(set(seeds))) + '\n', encoding='utf8')
    run([sys.executable, '-I', '-m', 'pip', '--disable-pip-version-check', 'download', '--no-cache-dir', '--only-binary=:all:', '--dest', wheelhouse, '-c', constraints_path, '-r', seed_file], work)
    for path in roots:
        shutil.copyfile(path, wheelhouse / path.name)
    wheels = audit_closure(wheelhouse, constraints)
    lock = ''.join(f"{w['name']}=={w['version']} --hash=sha256:{w['sha256']}\n" for w in sorted(wheels, key=lambda w: w['name']))
    (bundle / 'install-runtime.lock').write_text(lock, encoding='utf8', newline='\n')
    for name in ('LICENSE', 'NOTICE'):
        shutil.copyfile(root / name, bundle / name)
    notices = bundle / 'notices'; notices.mkdir()
    for name in ('THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-NOTICES.json'):
        shutil.copyfile(root / 'apps/api/src/wise_platform_api/static' / name, notices / name)
    runtime = bundle / 'runtime'; runtime.mkdir()
    download_checked(INSTALLER['url'], INSTALLER['sha256'], runtime / 'python-3.13.16-amd64.exe')
    download_checked(INSTALLER['license_url'], INSTALLER['license_sha256'], runtime / 'PYTHON-LICENSE.txt')
    synthetic = bundle / 'synthetic-inputs'; synthetic.mkdir()
    shutil.copyfile(root / 'tests/fixtures/imports/B4-ties-out-of-order.csv', synthetic / 'B4-ties-out-of-order.csv')
    if 'scoring' in features:
        shutil.copyfile(root / 'tests/fixtures/expectations/first-resolution.csv', synthetic / 'first-resolution.csv')
    official_python, installer_receipt = install_official_python(runtime / 'python-3.13.16-amd64.exe', work)
    runtime_env = work / 'installed-runtime'
    clean_env = {k: v for k, v in os.environ.items() if k not in {'PYTHONPATH', 'PYTHONHOME'}}
    run([official_python, '-I', '-m', 'venv', runtime_env], work, clean_env)
    python = runtime_env / 'Scripts/python.exe'
    run([python, '-I', '-m', 'pip', '--disable-pip-version-check', 'install', '--no-index', '--no-cache-dir', '--only-binary=:all:', '--find-links', wheelhouse, '--require-hashes', '-r', bundle / 'install-runtime.lock'], work)
    run([python, '-I', '-m', 'pip', 'check'], work)
    spec = {'features': sorted(features), 'bundle': str(bundle), 'runtime_env': str(runtime_env),
            'example_policies': json.loads((root / 'tests/fixtures/incidents/policies.v1.json').read_text()),
            'example_literals': json.loads((root / 'tests/fixtures/incidents/expected.json').read_text())['fixtures']}
    if 'scoring' in features:
        spec['scoring_definition'] = json.loads((root / 'tests/fixtures/expectations/contract-examples.json').read_text())['validate-expectation.request']['definition']
    spec_path = work / 'qualification-spec.json'; spec_path.write_text(json.dumps(spec), encoding='utf8')
    run([python, '-I', root / 'tools/qualify_installed_bundle.py', '--spec', spec_path, '--receipt', work / 'qualification.json'], work, clean_env)
    qualification = json.loads((work / 'qualification.json').read_text())
    if qualification['features'] != sorted(features) or qualification['all_passed'] is not True:
        raise ValueError('Artifact qualification is incomplete.')
    shutil.copyfile(root / 'docs/INSTALL-WINDOWS.md', bundle / 'INSTALL-WINDOWS.md')
    manifest = {'format_version': 1, 'source_commit': source_sha, 'candidate_release_pending': True,
                'platform': 'Windows x64 CPython 3.13.16 ordinary ABI', 'python_installer': INSTALLER,
                'installer_qualification': installer_receipt,
                'node': '24.19.0', 'npm': '11.17.0', 'build_tools': BUILD_PINS,
                'constraints_sha256': digest(constraints_path), 'wheels': wheels, **inspection,
                'qualification': qualification, 'workflow_run_id': os.environ.get('GITHUB_RUN_ID'),
                'workflow_run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT')}
    # Qualification receipts contain logical scope/results, never environment paths.
    (bundle / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    ensure_allowlist(bundle)
    files = [p for p in sorted(bundle.rglob('*')) if p.is_file()]
    sums = ''.join(digest(p) + '  ' + p.relative_to(bundle).as_posix() + '\n' for p in files)
    (bundle / 'SHA256SUMS').write_text(sums, encoding='utf8', newline='\n')
    ensure_allowlist(bundle)
    print(json.dumps({'source_commit': source_sha, 'wheel_count': len(wheels), 'qualified_features': sorted(features), 'bundled_installer_qualified_in_windows_runner': True}))


if __name__ == '__main__':
    main()
