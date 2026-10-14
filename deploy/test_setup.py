import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import setup


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_existing_file_keeps_custom_content_permissions_and_timestamp(self):
        target = self.root / 'service'
        self.assertTrue(setup.ensure_file(target, 'original', 0o600))
        target.write_text('custom service configuration')
        before = target.stat()
        self.assertFalse(setup.ensure_file(target, 'new defaults', 0o644))
        self.assertEqual(target.read_text(), 'custom service configuration')
        self.assertEqual(target.stat().st_mode, before.st_mode)
        self.assertEqual(target.stat().st_mtime_ns, before.st_mtime_ns)

    def test_service_rerun_preserves_data_and_custom_units_and_repairs_missing_timer(self):
        state = self.root / 'state'
        units = self.root / 'systemd'
        with patch.object(setup, 'STATE', state), patch.object(setup, 'BASE', self.root / 'app'), \
             patch.object(setup, 'SYSTEMD_DIR', units), patch.object(setup, 'LIBRARY', self.root / 'lib'), \
             patch.object(setup, 'ensure_user', side_effect=lambda name, home: Path(home).mkdir(exist_ok=True)), \
             patch.object(setup.shutil, 'chown'), patch.object(setup, 'run'):
            setup.install_services()
            (state / 'life.db').write_bytes(b'existing database')
            (state / 'backups/saved.db').write_bytes(b'existing backup')
            service = units / 'life-management.service'
            service.write_text('custom unit')
            service.chmod(0o600)
            modified = service.stat().st_mtime_ns
            (units / 'life-management-backup.timer').unlink()
            setup.install_services()
            setup.install_services()
            self.assertEqual(service.read_text(), 'custom unit')
            self.assertEqual(service.stat().st_mtime_ns, modified)
            self.assertEqual(service.stat().st_mode & 0o777, 0o600)
            self.assertEqual((state / 'life.db').read_bytes(), b'existing database')
            self.assertEqual((state / 'backups/saved.db').read_bytes(), b'existing backup')
            self.assertTrue((units / 'life-management-backup.timer').is_file())

    def test_configuration_survives_rerun_and_rejects_changed_origin(self):
        target = self.root / 'app.env'
        origin = 'http://192.168.1.50:3000'
        setup.configure_origin(origin, target)
        target.write_text(target.read_text() + 'BODY_SIZE_LIMIT=20M\n')
        before = target.read_bytes()
        self.assertEqual(setup.configure_origin(None, target), origin)
        self.assertEqual(setup.configure_origin(origin, target), origin)
        with self.assertRaises(RuntimeError):
            setup.configure_origin('http://192.168.1.51:3000', target)
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_invalid_origin_cannot_inject_environment_values(self):
        for value in ('http://host:3000\nHOST=0.0.0.0', 'http://user:pass@host',
                      'http://host/path', 'http://host/', 'http://host:invalid', 'http://host?x=y'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                setup.validated_origin(value)

    def test_healthy_existing_release_is_neither_rebuilt_nor_restarted(self):
        (self.root / 'current/build').mkdir(parents=True)
        (self.root / 'current/build/index.js').write_text('existing app')
        with patch.object(setup, 'BASE', self.root), patch.object(setup, 'run') as run:
            run.return_value.returncode = 0
            setup.setup_app()
            setup.setup_app()
        self.assertEqual([call.args for call in run.call_args_list], [
            ('systemctl', 'is-active', '--quiet', 'life-management.service')]*2)

    def test_orphaned_database_prevents_fresh_deployment(self):
        (self.root / 'life.db').write_bytes(b'valuable data')
        with patch.object(setup, 'BASE', self.root), patch.object(setup, 'STATE', self.root), patch.object(setup, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'Database exists'):
                setup.setup_app()
            run.assert_not_called()
        self.assertEqual((self.root / 'life.db').read_bytes(), b'valuable data')

    def test_completed_runtime_reused_after_interruption_before_symlink(self):
        target = self.root / 'runtime/node-24.21.0'
        (target / 'bin').mkdir(parents=True)
        (target / 'bin/node').write_text('binary')
        (target / '.sha256').write_text('verified-digest')
        spec = {'version': '24.21.0', 'sha256': 'verified-digest'}
        with patch.object(setup, 'BASE', self.root), patch.object(setup, 'run') as run:
            first = setup.ensure_runtime('node', spec)
            second = setup.ensure_runtime('node', {'version': '99', 'sha256': 'different'})
            self.assertEqual(first, second)
            run.assert_not_called()

    def test_checksum_failure_does_not_publish_runtime_and_retry_succeeds(self):
        archive_data = b'trusted archive bytes'
        spec = {'version': '24.21.0', 'url': 'https://example.invalid/node',
                'sha256': hashlib.sha256(archive_data).hexdigest(), 'strip_components': 1}
        corrupt = True

        def fake_run(*args, **kwargs):
            if args[0] == 'curl':
                Path(args[args.index('--output') + 1]).write_bytes(b'bad' if corrupt else archive_data)
            elif args[0] == 'tar':
                directory = Path(args[args.index('--directory') + 1])
                (directory / 'bin').mkdir()
                (directory / 'bin/node').write_text('binary')
            return subprocess.CompletedProcess(args, 0)

        with patch.object(setup, 'BASE', self.root), patch.object(setup, 'run', side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                setup.ensure_runtime('node', spec)
            self.assertFalse((self.root / 'runtime/node').exists())
            corrupt = False
            binary = setup.ensure_runtime('node', spec)
            self.assertTrue(binary.is_file())

    def test_existing_node_is_preserved(self):
        with patch.object(setup.shutil, 'which', return_value='/usr/bin/node'), \
             patch.object(setup, 'capture', return_value='v22.18.0'), \
             patch.object(setup, 'ensure_runtime') as install:
            setup.setup_node({})
            install.assert_not_called()

    def test_installed_os_packages_are_not_upgraded(self):
        with patch.object(setup, 'run', return_value=subprocess.CompletedProcess([], 0, 'install ok installed')) as run:
            setup.install_packages()
            self.assertTrue(run.call_args_list)
            self.assertTrue(all(call.args[0] == 'dpkg-query' for call in run.call_args_list))

    def test_source_package_excludes_local_data_and_credentials(self):
        staged = self.root / 'staged'
        staged.mkdir()
        setup.stage_source(staged)
        self.assertFalse((staged / 'data').exists())
        self.assertFalse((staged / '.env').exists())
        self.assertFalse((staged / '.git').exists())
        self.assertTrue((staged / 'drizzle/0000_initial.sql').is_file())
        self.assertTrue((staged / 'src/app.html').is_file())
        self.assertEqual(len((staged / 'RELEASE').read_text().strip()), 40)


if __name__ == '__main__':
    unittest.main()
