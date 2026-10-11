import sqlite3
import tempfile
import unittest
from pathlib import Path

from backup import backup


class BackupTests(unittest.TestCase):
    def test_snapshot_includes_wal_and_is_unique_and_private(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "life.db"
            connection = sqlite3.connect(source)
            self.addCleanup(connection.close)
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)")
            connection.execute("INSERT INTO tasks VALUES (1, 'Keep my task')")
            connection.commit()
            self.assertTrue(Path(str(source) + "-wal").exists())
            first = backup(source, root / "backups")
            second = backup(source, root / "backups")
            self.assertNotEqual(first, second)
            self.assertEqual(first.stat().st_mode & 0o777, 0o600)
            restored = sqlite3.connect(first)
            self.addCleanup(restored.close)
            self.assertEqual(restored.execute("SELECT title FROM tasks").fetchall(), [("Keep my task",)])

    def test_invalid_database_leaves_no_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "broken.db"
            source.write_text("not a database")
            with self.assertRaises(sqlite3.DatabaseError):
                backup(source, root / "backups")
            self.assertEqual(list((root / "backups").iterdir()), [])

    def test_missing_database_is_not_created(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "missing.db"
            with self.assertRaises(FileNotFoundError):
                backup(source, root / "backups")
            self.assertFalse(source.exists())


if __name__ == "__main__":
    unittest.main()
