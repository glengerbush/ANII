"""Exercise the workflow's publication shell with disposable registry/CLI doubles."""
import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / '.github/workflows/release.yml'


def promotion_script():
    step = WORKFLOW.read_text().split('      - name: Advance latest without rolling it back on an older retry\n', 1)[1]
    return textwrap.dedent(step.split('        run: |\n', 1)[1].split('\n      - ', 1)[0])


class ReleasePublicationTests(unittest.TestCase):
    def promote(self, tags, version='0.4.0'):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stub = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
with open(os.environ['CALL_LOG'], 'a') as output:
    output.write(json.dumps([name, *sys.argv[1:]]) + '\\n')
if name == 'gh' and sys.argv[1] == 'api':
    print(os.environ['RELEASE_TAGS'])
'''
            for name in ['gh', 'docker']:
                executable = root / name
                executable.write_text(stub)
                executable.chmod(0o755)
            log = root / 'calls.jsonl'
            result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', promotion_script()], cwd=root,
                capture_output=True, text=True, env={**os.environ,
                    'PATH': f'{root}:{os.environ["PATH"]}', 'CALL_LOG': str(log),
                    'GITHUB_STEP_SUMMARY': str(root / 'summary'), 'GITHUB_REPOSITORY': 'example/anii',
                    'IMAGE': 'ghcr.io/example/anii', 'VERSION': version, 'TAG': f'v{version}',
                    'RELEASE_TAGS': '\n'.join(tags)})
            self.assertEqual(result.returncode, 0, result.stderr)
            return [json.loads(line) for line in log.read_text().splitlines()]

    def test_new_release_missing_from_api_list_still_publishes_latest(self):
        calls = self.promote(['v0.3.1', 'v0.3.0'])
        self.assertIn(['docker', 'push', 'ghcr.io/example/anii:latest'], calls)
        self.assertIn(['gh', 'release', 'edit', 'v0.4.0', '--latest'], calls)

    def test_first_release_with_an_empty_api_list_publishes_latest(self):
        calls = self.promote([])
        self.assertIn(['docker', 'push', 'ghcr.io/example/anii:latest'], calls)

    def test_older_retry_never_replaces_a_newer_stable_release(self):
        calls = self.promote(['v0.4.10', 'v0.4.9', 'v0.5.0-beta.1'], '0.4.9')
        self.assertFalse(any(call[0] == 'docker' for call in calls))

    def test_prereleases_and_nonversion_tags_do_not_block_latest(self):
        calls = self.promote(['v0.5.0-beta.1', 'nightly', 'v0.3.1'])
        self.assertIn(['docker', 'push', 'ghcr.io/example/anii:latest'], calls)
