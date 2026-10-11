import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

export async function snapshotBeforeStartup(path) {
  if (!statSync(path, { throwIfNoEntry: false })) return null;
  const directory = join(dirname(path), 'deploy-backups');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const target = join(directory, `life-${stamp}-${randomUUID()}.db`);
  closeSync(openSync(target, 'wx', 0o600));
  let source;
  try {
    source = new Database(path, { readonly: true, fileMustExist: true });
    await source.backup(target);
    const snapshot = new Database(target, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok' ||
          snapshot.pragma('foreign_key_check').length > 0) {
        throw new Error('Pre-start database snapshot failed validation');
      }
    } finally {
      snapshot.close();
    }
    chmodSync(target, 0o600);
    const fd = openSync(target, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    return target;
  } catch (error) {
    unlinkSync(target);
    throw error;
  } finally {
    source?.close();
  }
}
