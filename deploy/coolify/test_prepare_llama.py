import hashlib
import importlib.util
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare_llama', Path(__file__).with_name('prepare-llama.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'models').mkdir()
        (self.root / 'models/35b.gguf').write_bytes(b'test model')
        self.image_id = 'sha256:' + 'a' * 64
        self.selected = dict(configuration='35b-stock-mtp-off', context=8192,
                             model=dict(path='models/35b.gguf', sha256=hashlib.sha256(b'test model').hexdigest()),
                             image=dict(id=self.image_id), gpu='GPU-1234-abcd')
        (self.root / 'selected.json').write_text(json.dumps(self.selected))
        self.args = ['-m', '/models/35b.gguf', '--host', '0.0.0.0', '--port', '8080',
                     '--spec-type', 'none', '--parallel', '1', '--ctx-size', '8192',
                     '--chat-template-kwargs', '{"enable_thinking": false}']
        (self.root / 'start-selected.sh').write_text('exec ' + shlex.join(['docker', 'run', self.image_id, *self.args]))
        self.networks = {'coolify': {}, 'app-network': {}}
        self.tagged = []

    def docker(self, *args):
        if args[:2] == ('image', 'inspect'):
            return json.dumps([{'Id': self.image_id, 'Config': {'Labels': {'org.anii.ai-bench': 'owner'}}}])
        if args[0] == 'inspect':
            return json.dumps([{'NetworkSettings': {'Networks': self.networks}}])
        if args[0] == 'tag':
            self.tagged.append(args)
        return '[]'

    def prepare(self, network=None):
        with patch.object(module, 'docker', self.docker), patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', '')):
            return module.prepare(self.root, 'anii', network)

    def test_repeat_preserves_selected_settings_and_does_not_launch(self):
        first = self.prepare()
        self.assertEqual(first, self.prepare())
        self.assertIn('pull_policy: never', first[0])
        self.assertNotIn('    ports:', first[0])
        self.assertIn('"11434"', first[0])
        self.assertIn('"8192"', first[0])
        self.assertIn('$$status', first[0])
        self.assertEqual(len(self.tagged), 2)
        self.assertEqual(json.loads((self.root / 'selected.json').read_text()), self.selected)

    def test_changed_model_refuses_before_tagging(self):
        (self.root / 'models/35b.gguf').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.prepare()
        self.assertEqual(self.tagged, [])

    def test_ambiguous_network_requires_explicit_choice(self):
        self.networks = {'first': {}, 'second': {}}
        with self.assertRaisesRegex(ValueError, '--network'):
            self.prepare()
        self.assertIn('name: "second"', self.prepare('second')[0])

    def test_changed_launcher_refuses_before_tagging(self):
        (self.root / 'start-selected.sh').write_text('exec docker run wrong-image')
        with self.assertRaisesRegex(ValueError, 'selected image'):
            self.prepare()
        self.assertEqual(self.tagged, [])

    @unittest.skipUnless(shutil.which('docker'), 'Docker Compose unavailable')
    def test_compose_accepts_file_and_preserves_healthcheck_variable(self):
        compose, tag = self.prepare()
        path = self.root / 'compose.yaml'
        path.write_text(compose)
        result = subprocess.run(['docker', 'compose', '-f', str(path), 'config', '--format', 'json'], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        service = json.loads(result.stdout)['services']['llama']
        self.assertEqual(service['image'], tag)
        self.assertEqual(service['deploy']['resources']['reservations']['devices'][0]['device_ids'], ['GPU-1234-abcd'])
        self.assertIn('status', service['healthcheck']['test'][-1])
        self.assertNotIn('ports', service)


if __name__ == '__main__':
    unittest.main()
