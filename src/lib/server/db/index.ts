import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';
import {migrateChores} from './chores-migration';
import {migrateCalendar} from './calendar-migration';
import {migratePlacements} from './placement-migration';
import {migrateProjectOrder} from './project-order-migration';
import {appRequestGate} from '$lib/server/request-gate';
import {cleanupStaleRestoreDirectories} from '$lib/server/restore-staging';

export type AppDatabase = ReturnType<typeof createDatabase>;
export function createDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON'); sqlite.pragma('journal_mode = WAL');
  const existing=Boolean(sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='tasks'").get());
  if(!existing)sqlite.exec(readFileSync(resolve('drizzle/0000_initial.sql'),'utf8'));
  else {
    const needsPlanning=!sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='task_placements'").get();
    const needsProjectOrder=!(sqlite.pragma('table_info(task_projects)') as {name:string}[]).some(column=>column.name==='position');
    const needsProjectCompletion=!(sqlite.pragma('table_info(projects)') as {name:string}[]).some(column=>column.name==='completed_at');
    const needsChores=!sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='chores'").get();
    if(needsPlanning||needsProjectOrder||needsProjectCompletion||needsChores){
      if(path!==':memory:'){
        const backups=resolve(dirname(path),'backups');mkdirSync(backups,{recursive:true,mode:0o700});
        const backup=resolve(backups,`life-before-${needsPlanning?'calendar':needsProjectOrder?'project-order':needsProjectCompletion?'project-completion':'chores'}-${Date.now()}.db`);
        sqlite.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);
      }
      sqlite.transaction(()=>{
        if(needsPlanning){
          if(!sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name='task_schedules'").get())migrateCalendar(sqlite);
          migratePlacements(sqlite);
        }
        if(needsProjectOrder)migrateProjectOrder(sqlite);
        if(needsProjectCompletion)sqlite.exec('ALTER TABLE projects ADD COLUMN completed_at TEXT');
        if(needsChores)migrateChores(sqlite);
      })();
    }
  }
  if(!existing)migrateChores(sqlite);
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
