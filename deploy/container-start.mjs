import { snapshotBeforeStartup } from './container-backup.mjs';

const origin = process.env.ORIGIN;
if (!origin) throw new Error('Set ORIGIN to the browser address, e.g. http://localhost:3000');
const parsed = new URL(origin);
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
  throw new Error('ORIGIN must be an exact HTTP(S) origin, without a trailing slash');
}
const snapshot = await snapshotBeforeStartup(process.env.DATABASE_PATH);
if (snapshot) console.log(`Pre-start database snapshot: ${snapshot}`);
console.log(`Starting Life Management ${process.env.APP_VERSION ?? 'development'}`);
// Import only after a verified snapshot; loading the server applies migrations.
await import('../build/index.js');
