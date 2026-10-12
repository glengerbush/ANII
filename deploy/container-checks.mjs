import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotBeforeStartup } from './container-backup.mjs';

test('first boot does not create a database before server migration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'life-start-'));
  try {
    assert.equal(await snapshotBeforeStartup(join(directory, 'life.db')), null);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('snapshots include committed WAL, preserve source, and never overwrite backups', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'life-start-'));
  const path = join(directory, 'life.db');
  const source = new Database(path);
  try {
    source.pragma('journal_mode = WAL');
    source.exec('CREATE TABLE example (value TEXT); INSERT INTO example VALUES (\'keep me\')');
    const first = await snapshotBeforeStartup(path);
    const second = await snapshotBeforeStartup(path);
    assert.notEqual(first, second);
    assert.equal(statSync(first).mode & 0o777, 0o600);
    const snapshot = new Database(first, { readonly: true });
    try { assert.equal(snapshot.prepare('SELECT value FROM example').pluck().get(), 'keep me'); }
    finally { snapshot.close(); }
    assert.equal(source.prepare('SELECT value FROM example').pluck().get(), 'keep me');
  } finally { source.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('corruption blocks startup and removes incomplete snapshot, preserving source', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'life-start-'));
  const path = join(directory, 'life.db');
  try {
    writeFileSync(path, 'not a database');
    await assert.rejects(snapshotBeforeStartup(path));
    assert.equal(readFileSync(path, 'utf8'), 'not a database');
    assert.deepEqual(readdirSync(join(directory, 'deploy-backups')), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('production build includes branding, manifest, and every declared app icon', () => {
  const client = join(process.cwd(), 'build', 'client');
  const manifest = JSON.parse(readFileSync(join(client, 'site.webmanifest'), 'utf8'));
  const assets = ['icons/brand.svg', 'favicon.ico', 'favicon-32x32.png', 'apple-touch-icon.png', ...manifest.icons.map(icon => icon.src)];
  assert.ok(manifest.name, 'Manifest must name the app');
  for (const asset of assets) assert.ok(statSync(join(client, asset)).size > 0, `Missing built asset: ${asset}`);
});
