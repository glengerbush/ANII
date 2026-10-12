"""Validate release metadata and detect version bumps without registry access."""
import json
import os
import re
import subprocess
from pathlib import Path


def version_number(value):
    if not isinstance(value, str) or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', value):
        raise ValueError('Version must be MAJOR.MINOR.PATCH (stable releases only)')
    return tuple(map(int, value.split('.')))


def release_version(package, lock, previous=None):
    version = package['version']
    number = version_number(version)
    if lock['version'] != version or lock['packages']['']['version'] != version:
        raise ValueError('Update package-lock.json to match package.json before releasing')
    if previous is not None:
        previous_number = version_number(previous['version'])
        if number == previous_number:
            return None
        if number < previous_number:
            raise ValueError('Release versions must increase')
    return version


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    previous = None
    if os.environ['GITHUB_EVENT_NAME'] == 'push':
        before = event['before']
        if before != '0' * 40:
            previous = json.loads(git('show', f'{before}:package.json'))
    version = release_version(
        json.loads(Path('package.json').read_text()),
        json.loads(Path('package-lock.json').read_text()),
        previous,
    )
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'publish={str(version is not None).lower()}\n')
        if version is None:
            print('Version unchanged; no release needed.')
            return
        revision = git('rev-parse', 'HEAD')
        tag = f'v{version}'
        existing = subprocess.run(['git', 'rev-parse', '--verify', f'refs/tags/{tag}^{{commit}}'], capture_output=True, text=True)
        if existing.returncode == 0 and existing.stdout.strip() != revision:
            if os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch':
                # Repair publication using the original release, never newer code
                # under an already-published version.
                revision = existing.stdout.strip()
            else:
                raise ValueError(f'{tag} already belongs to another commit; bump the version')
        output.write(f'version={version}\ntag={tag}\nrevision={revision}\n')
        output.write(f'image=ghcr.io/{os.environ["GITHUB_REPOSITORY"].lower()}\n')


if __name__ == '__main__':
    main()
