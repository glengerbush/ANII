#!/usr/bin/env python3
"""Create a unique, verified SQLite snapshot, including committed WAL data."""
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
from contextlib import closing
from datetime import datetime, timezone


def backup(source: Path, directory: Path) -> Path:
    if not source.is_file():
        raise FileNotFoundError(source)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    fd, name = tempfile.mkstemp(prefix=f"life-{stamp}-", suffix=".db", dir=directory)
    os.close(fd)
    target = Path(name)
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(target)) as dst:
                src.backup(dst)
                if dst.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise RuntimeError("Backup integrity check failed")
                if dst.execute("PRAGMA foreign_key_check").fetchone() is not None:
                    raise RuntimeError("Backup foreign key check failed")
        with target.open("rb") as handle:
            os.fsync(handle.fileno())
        return target
    except BaseException:
        target.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: backup.py DATABASE BACKUP_DIRECTORY")
    print(backup(Path(sys.argv[1]), Path(sys.argv[2])))
