import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('release-version.py').resolve()
spec = importlib.util.spec_from_file_location('release_version', SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def manifests(version):
    return {'version': version}, {'version': version, 'packages': {'': {'version': version}}}


class ReleaseVersionTests(unittest.TestCase):
    def test_unchanged_version_skips(self):
        self.assertIsNone(release.release_version(*manifests('0.3.1'), {'version': '0.3.1'}))

    def test_patch_minor_major_and_numeric_order(self):
        for previous, current in [('0.3.1', '0.3.2'), ('0.3.9', '0.3.10'), ('0.3.1', '0.4.0'), ('0.3.1', '1.0.0')]:
            with self.subTest(current=current):
                self.assertEqual(release.release_version(*manifests(current), {'version': previous}), current)

    def test_downgrades_and_invalid_versions_fail(self):
        with self.assertRaises(ValueError):
            release.release_version(*manifests('0.3.0'), {'version': '0.3.1'})
        for version in ['v0.3.1', '0.3.01', '0.3.2-beta.1', '0.3', '0.3.2\n', 123]:
            with self.subTest(version=version), self.assertRaises(ValueError):
                release.release_version(*manifests(version))

    def test_both_lock_versions_must_match_even_without_a_bump(self):
        for field in ['top', 'root']:
            package, lock = manifests('0.3.1')
            if field == 'top':
                lock['version'] = '0.3.0'
            else:
                lock['packages']['']['version'] = '0.3.0'
            with self.subTest(field=field), self.assertRaises(ValueError):
                release.release_version(package, lock, {'version': '0.3.1'})

    def test_push_range_dispatch_and_tag_collision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()

            def commit(version):
                package, lock = manifests(version)
                (root / 'package.json').write_text(json.dumps(package))
                (root / 'package-lock.json').write_text(json.dumps(lock))
                git('add', 'package.json', 'package-lock.json')
                git('commit', '-qm', version)
                return git('rev-parse', 'HEAD')

            def detect(before, event_name='push', forced=False):
                event = root / 'event.json'
                event.write_text(json.dumps({'before': before, 'forced': forced}))
                output = root / 'output'
                output.write_text('')
                result = subprocess.run(['python3', str(SCRIPT)], cwd=root, text=True, capture_output=True, env={
                    **os.environ, 'GITHUB_EVENT_PATH': str(event), 'GITHUB_OUTPUT': str(output),
                    'GITHUB_EVENT_NAME': event_name, 'GITHUB_REPOSITORY': 'Example/ANII',
                })
                return result, dict(line.split('=', 1) for line in output.read_text().splitlines())

            git('init', '-q')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'user.name', 'Release test')
            before = commit('0.3.1')
            result, output = detect(before)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output, {'publish': 'false'})
            commit('0.3.2')
            git('commit', '--allow-empty', '-qm', 'Another commit in the same push')
            head = git('rev-parse', 'HEAD')
            result, output = detect(before)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output, {
                'publish': 'true', 'version': '0.3.2', 'tag': 'v0.3.2',
                'revision': head, 'image': 'ghcr.io/example/anii',
            })
            git('tag', 'v0.3.2')
            result, output = detect(before)  # Retry the same commit safely.
            self.assertEqual(result.returncode, 0, result.stderr)
            result, output = detect(head, 'workflow_dispatch')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output['publish'], 'true')
            git('commit', '--allow-empty', '-qm', 'Later code under the same version')
            result, output = detect(head, 'workflow_dispatch')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output['revision'], head)  # Repair the original release image.
            result, output = detect(before)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('already belongs to another commit', result.stderr)
            result, output = detect('0' * 40)
            self.assertNotEqual(result.returncode, 0)

            # Correct an unpublished major bump by rewriting its commit.
            retained = commit('0.6.0')
            discarded = commit('1.0.0')
            git('reset', '--hard', retained)
            corrected = commit('0.7.0')
            result, output = detect(discarded, forced=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output['version'], '0.7.0')
            self.assertEqual(output['revision'], corrected)
            # Ordinary pushes still reject a version decrease.
            result, output = detect(discarded)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Release versions must increase', result.stderr)


if __name__ == '__main__':
    unittest.main()
