#!/usr/bin/env python3
"""Add missing host components without upgrading or resetting existing ones."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

SOURCE = Path(__file__).resolve().parent.parent
BASE = Path('/opt/life-management')
STATE = Path('/var/lib/life-management')
ENV_FILE = Path('/etc/life-management.env')
SYSTEMD_DIR = Path('/etc/systemd/system')
LIBRARY = Path('/usr/local/lib/life-management')
PATH = '/opt/life-management/runtime/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
SOURCE_FILES = ('src', 'tests', 'drizzle', 'deploy', 'package.json', 'package-lock.json',
                'svelte.config.js', 'vite.config.ts', 'tsconfig.json', 'drizzle.config.ts')


def run(*args, check=True, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=check, **kwargs)


def capture(*args):
    return run(*args, stdout=subprocess.PIPE, text=True).stdout.strip()


def ensure_file(path, content, mode=0o644):
    """Publish a complete new file exclusively; never truncate an existing file."""
    if path.exists() or path.is_symlink():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(content if isinstance(content, bytes) else content.encode())
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), mode)
        try:
            os.link(temporary, path)
        except FileExistsError:
            return False
    finally:
        os.unlink(temporary)
    return True


def ensure_directory(path, owner=None, mode=0o700):
    if path.exists():
        if not path.is_dir():
            raise RuntimeError(f'Expected a directory: {path}')
        return
    path.mkdir(parents=True, mode=mode)
    if owner:
        shutil.chown(path, user=owner, group=owner)


def ensure_user(name, home):
    try:
        pwd.getpwnam(name)
    except KeyError:
        run('useradd', '--system', '--user-group', '--home-dir', home,
            '--shell', '/usr/sbin/nologin', name)
    ensure_directory(Path(home), name)


def validated_origin(value):
    parsed = urlsplit(value)
    if ('SERVER_LAN_IP' in value or 'REPLACE_WITH' in value or
            parsed.scheme not in ('http', 'https') or not parsed.hostname or
            parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or
            any(character.isspace() or character in "\"'\\" for character in value)):
        raise ValueError('Use an origin such as http://192.168.1.50:3000 (no trailing slash).')
    _ = parsed.port  # Reject invalid ports before making host changes.
    return value


def configure_origin(requested, path=ENV_FILE):
    if path.exists():
        for line in path.read_text().splitlines():
            if line.startswith('ORIGIN='):
                existing = line.split('=', 1)[1].strip().strip('"\'')
                if 'REPLACE_WITH' in existing:
                    raise RuntimeError(f'Replace the placeholder ORIGIN in {path}, then rerun.')
                validated_origin(existing)
                if requested and requested != existing:
                    raise RuntimeError(f'Existing origin is {existing}; edit {path} explicitly to change it.')
                return existing
        raise RuntimeError(f'Existing {path} has no ORIGIN; add it explicitly, then rerun.')
    if not requested:
        raise RuntimeError('First install requires --origin http://SERVER_LAN_IP:3000')
    validated_origin(requested)
    ensure_file(path, f'ORIGIN={requested}\n', 0o600)
    return requested


def install_packages():
    missing = []
    packages = (
        'ca-certificates', 'curl', 'git', 'python3', 'build-essential',
        'xz-utils', 'libatomic1', 'util-linux')
    for package in packages:
        result = run('dpkg-query', '-W', '-f=${Status}', package, check=False,
                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        if result.returncode or result.stdout.strip() != 'install ok installed':
            missing.append(package)
    if missing:
        run('apt-get', 'update')
        run('apt-get', 'install', '--yes', '--no-upgrade', *missing)


def ensure_runtime(name, spec):
    """Versioned downloads become visible only after checksum/extraction succeeds."""
    root = BASE / 'runtime'
    ensure_directory(root, mode=0o755)
    link = root / name
    binary = link / 'bin' / name
    if link.exists() or link.is_symlink():
        if not binary.is_file():
            raise RuntimeError(f'Incomplete existing runtime at {link}; retained for inspection.')
        return binary
    target = root / f'{name}-{spec["version"]}'
    if target.exists():
        if not (target / '.sha256').is_file() or (target / '.sha256').read_text() != spec['sha256']:
            raise RuntimeError(f'Unrecognized runtime directory {target}; refusing to replace it.')
    else:
        with tempfile.TemporaryDirectory(prefix=f'.{name}-', dir=root) as temporary:
            staging = Path(temporary)
            archive = staging / 'download'
            run('curl', '--fail', '--location', '--retry', '3', '--proto', '=https',
                '--output', archive, spec['url'])
            digest = hashlib.sha256()
            with archive.open('rb') as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b''):
                    digest.update(block)
            if digest.hexdigest() != spec['sha256']:
                raise RuntimeError(f'{name} download checksum mismatch')
            extracted = staging / 'extracted'
            extracted.mkdir(mode=0o755)
            run('tar', '-xf', archive, '--directory', extracted, '--no-same-owner',
                f'--strip-components={spec["strip_components"]}')
            if not (extracted / 'bin' / name).is_file():
                raise RuntimeError(f'{name} archive has no expected binary')
            (extracted / '.sha256').write_text(spec['sha256'])
            extracted.rename(target)
    link.symlink_to(target.name)
    return binary


def setup_node(spec):
    existing = shutil.which('node')
    if existing:
        version = capture(existing, '--version').lstrip('v')
        major, minor, *_ = (int(part) for part in version.split('.'))
        if not ((major == 20 and minor >= 19) or (major == 22 and minor >= 12) or major >= 24):
            raise RuntimeError(f'Existing Node {version} is too old; upgrade it explicitly, then rerun.')
        if not shutil.which('npm'):
            raise RuntimeError('Existing Node has no npm on the system PATH; repair it, then rerun.')
        print(f'Keeping installed Node {version}.')
        return
    ensure_runtime('node', spec)


def install_services():
    ensure_user('life-management', STATE)
    ensure_directory(STATE / 'backups', 'life-management')
    ensure_directory(STATE / 'deploy-backups')
    ensure_directory(BASE / 'releases', mode=0o755)
    library = LIBRARY
    ensure_directory(library, mode=0o755)
    ensure_file(library / 'backup.py', (SOURCE / 'deploy/backup.py').read_bytes(), 0o755)
    for name in ('life-management.service', 'life-management-backup.service', 'life-management-backup.timer'):
        ensure_file(SYSTEMD_DIR / name, (SOURCE / 'deploy' / name).read_bytes())
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', 'life-management.service')
    run('systemctl', 'enable', '--now', 'life-management-backup.timer')


def stage_source(destination):
    """Copy only source/build inputs, never local databases, credentials or build output."""
    digest = hashlib.sha1()  # Content identifier, not artifact verification.
    for name in SOURCE_FILES:
        source = SOURCE / name
        target = destination / name
        if source.is_dir():
            shutil.copytree(source, target, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        else:
            shutil.copy2(source, target)
    for file in sorted(destination.rglob('*')):
        if file.is_file():
            digest.update(str(file.relative_to(destination)).encode() + b'\0')
            digest.update(file.read_bytes())
    (destination / 'RELEASE').write_text(digest.hexdigest() + '\n')


def setup_app():
    current = BASE / 'current'
    if current.exists() or current.is_symlink():
        if not (current / 'build/index.js').is_file():
            raise RuntimeError('Existing release is incomplete; retained along with its database. Use release recovery.')
        if run('systemctl', 'is-active', '--quiet', 'life-management.service', check=False).returncode:
            run('systemctl', 'start', 'life-management.service')
        print('Keeping the installed app release. Setup does not deploy updates.')
        return
    if any(STATE.glob('life.db*')):
        raise RuntimeError('Database exists without an installed release. Restore the matching release explicitly; setup will not migrate orphaned data.')
    ensure_user('life-management-build', '/var/cache/life-management-build')
    with tempfile.TemporaryDirectory(prefix='life-first-install-', dir='/var/tmp') as temporary:
        staging = Path(temporary)
        stage_source(staging)
        run('chown', '-R', 'life-management-build:life-management-build', staging)
        environment = dict(PATH=PATH, DATABASE_PATH=':memory:',
                           HOME='/var/cache/life-management-build', NODE_ENV='development')
        # Dependency lifecycle scripts run under a separate user with no live-data access.
        for command in (('npm', 'ci'), ('npm', 'test'), ('npm', 'run', 'check'),
                        ('npm', 'run', 'build'), ('npm', 'prune', '--omit=dev')):
            run('runuser', '-u', 'life-management-build', '--', *command, cwd=staging, env=environment)
        run('bash', SOURCE / 'deploy/activate-release.sh', staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', type=validated_origin, help='Exact browser origin, e.g. http://192.168.1.50:3000')
    parser.add_argument('--services-only', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run with sudo.')
    os.environ['PATH'] = PATH
    with open('/run/lock/life-management-install.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another setup is running.')
        # Reject conflicts before package downloads or service changes.
        origin = configure_origin(args.origin)
        if args.services_only:
            install_services()
            return
        install_packages()
        versions = json.loads((SOURCE / 'deploy/runtime-versions.json').read_text())
        setup_node(versions['node'])
        install_services()
        setup_app()
        for _ in range(30):
            try:
                with urlopen('http://127.0.0.1:3000/today', timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Application health check failed; inspect journalctl -u life-management.')
        print(f'\nReady: {origin}\nRerunning setup preserves installed releases, settings and data.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f'Setup stopped: {error}\nFix the reported problem and rerun the same command. Existing data is retained.')
