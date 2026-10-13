import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';
import {backfillLegacyCompletions} from './legacy-completions';
import {appRequestGate} from '$lib/server/request-gate';
import {cleanupStaleRestoreDirectories} from '$lib/server/restore-staging';

export type AppDatabase = ReturnType<typeof createDatabase>;
export function createDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON'); sqlite.pragma('journal_mode = WAL');
  sqlite.exec(readFileSync(resolve('drizzle/0000_initial.sql'), 'utf8'));
  const hasProfile = (sqlite.prepare(`PRAGMA table_info(daily_plans)`).all() as {name:string}[]).some((column)=>column.name==='profile_id');
  if (!hasProfile) sqlite.exec(readFileSync(resolve('drizzle/0001_profiles.sql'), 'utf8'));
  sqlite.exec(readFileSync(resolve('drizzle/0002_review_sessions.sql'), 'utf8'));
  sqlite.exec(readFileSync(resolve('drizzle/0003_task_projects.sql'), 'utf8'));
  const hasEstimates=(sqlite.prepare('PRAGMA table_info(tasks)').all() as {name:string}[]).some(column=>column.name==='remaining_effort_minutes');
  if(!hasEstimates)sqlite.exec(readFileSync(resolve('drizzle/0004_deadline_estimates.sql'),'utf8'));
  const taskSql=(sqlite.prepare("SELECT sql FROM sqlite_schema WHERE name='tasks'").get() as {sql:string}).sql;
  if(taskSql.includes("'waiting'")){
    sqlite.pragma('foreign_keys = OFF');
    try{
      sqlite.transaction(()=>{
        sqlite.exec(readFileSync(resolve('drizzle/0005_remove_waiting.sql'),'utf8'));
        if((sqlite.pragma('foreign_key_check') as unknown[]).length)throw new Error('Task-state migration would break task relationships');
      })();
    }finally{sqlite.pragma('foreign_keys = ON');}
  }
  const hasLogicalDays=Boolean(sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='task_completions'").get());
  sqlite.exec(readFileSync(resolve('drizzle/0006_logical_days.sql'),'utf8'));
  if(!hasLogicalDays)backfillLegacyCompletions(sqlite);
  const hasDependencyKind=(sqlite.prepare('PRAGMA table_info(dependencies)').all() as {name:string}[]).some(column=>column.name==='kind');
  if(hasDependencyKind)sqlite.transaction(()=>sqlite.exec(readFileSync(resolve('drizzle/0007_required_dependencies.sql'),'utf8')))();
  return { sqlite, orm: drizzle(sqlite, { schema }) };
}

export const databasePath = process.env.DATABASE_PATH ?? resolve('data/life.db');
cleanupStaleRestoreDirectories();
export const database = createDatabase(databasePath);

export async function backupDatabase(path=databasePath, db=database): Promise<string | null> {
  if(path===':memory:') return null;
  const backups=resolve(dirname(path),'backups'); mkdirSync(backups,{recursive:true,mode:0o700});chmodSync(backups,0o700);
  const day=new Date().toISOString().slice(0,10); const target=resolve(backups,`life-${day}.db`);
  await db.sqlite.backup(target);chmodSync(target,0o600);
  return target;
}
if(databasePath!==':memory:') {
  void appRequestGate.withShared(()=>backupDatabase());
  const daily=setInterval(()=>void appRequestGate.withShared(()=>backupDatabase()),60*60*1000); daily.unref();
}
