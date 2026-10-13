import { afterEach, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from '../../src/lib/server/db';
import { restoreDatabaseBytes } from '../../src/lib/server/database-restore';
import { closeOutToday, createTask, exportData, getTask, getToday, importData, reviewDecision, setTaskState } from '../../src/lib/server/repository';

const connections:Database.Database[]=[];
const directories:string[]=[];
afterEach(()=>{
  for(const db of connections.splice(0))if(db.open)db.close();
  for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});
});
function directory(){const dir=mkdtempSync(join(tmpdir(),'anii-waiting-'));directories.push(dir);return dir;}
function legacy(path:string){
  const db=new Database(path);connections.push(db);
  for(const migration of ['0000_initial','0001_profiles','0002_review_sessions','0003_task_projects','0004_deadline_estimates'])db.exec(readFileSync(`drizzle/${migration}.sql`,'utf8'));
  db.exec(`
    INSERT INTO projects(id,name) VALUES(1,'Project');
    INSERT INTO tasks(id,title,state) VALUES(1,'Former waiting task','waiting'),(2,'Prerequisite','open'),(10,'Deleted task','open');
    DELETE FROM tasks WHERE id=10;
    INSERT INTO task_projects(task_id,project_id) VALUES(1,1);
    INSERT INTO dependencies(task_id,prerequisite_task_id,kind) VALUES(1,2,'hard');
    INSERT INTO daily_plans(profile_id,plan_date,task_id,section,position,review_outcome) VALUES(1,'2026-08-05',1,'focus',0,'waiting');
  `);
  return db;
}
function expectNormalized(db:Database.Database){
  expect(getTask(1,db)).toMatchObject({title:'Former waiting task',state:'open',project_ids:[1],blocked:1});
  expect(getToday('2026-08-05',db)).toMatchObject([{id:1,section:'focus',review_outcome:'backlog'}]);
  expect(db.pragma('foreign_key_check')).toEqual([]);
}

test('startup migrates Waiting once while preserving plans, dependencies, labels and task identity',()=>{
  const path=join(directory(),'legacy.db');legacy(path).close();
  const first=createDatabase(path).sqlite;connections.push(first);expectNormalized(first);
  expect(createTask({title:'New task'},first)).toBeGreaterThan(10);
  expect(()=>first.prepare("UPDATE tasks SET state='waiting' WHERE id=1").run()).toThrow(/CHECK/);
  expect(()=>first.prepare("UPDATE daily_plans SET review_outcome='waiting' WHERE task_id=1").run()).toThrow(/CHECK/);
  first.close();
  const reopened=createDatabase(path).sqlite;connections.push(reopened);expectNormalized(reopened);
});

test('legacy JSON snapshots normalize Waiting without changing their source data',()=>{
  const source=legacy(':memory:');const snapshot=exportData(source);
  const current=createDatabase(':memory:').sqlite;connections.push(current);
  importData(snapshot,current);expectNormalized(current);
  expect((snapshot.tables.tasks as {state:string}[])[0].state).toBe('waiting');
  expect((exportData(current).tables.tasks as {state:string}[]).some(task=>task.state==='waiting')).toBe(false);
});

test('legacy SQLite backups restore and normalize Waiting through the regular restore path',async()=>{
  const dir=directory();const incomingPath=join(dir,'incoming.db');legacy(incomingPath).close();
  const livePath=join(dir,'current.db');const current=createDatabase(livePath);connections.push(current.sqlite);
  createTask({title:'Replaced by restore'},current.sqlite);
  await restoreDatabaseBytes(readFileSync(incomingPath),{liveDatabase:current,livePath,stagingRoot:dir});
  expectNormalized(current.sqlite);
});

test('removed Waiting API values fail without mutating tasks or reviews',()=>{
  const source=legacy(':memory:');const current=createDatabase(':memory:').sqlite;connections.push(current);importData(exportData(source),current);
  expect(()=>setTaskState(1,'waiting' as any,current)).toThrow(/Unsupported/);
  expect(()=>reviewDecision(1,'waiting' as any,'2026-08-05',current)).toThrow(/Invalid/);
  expect(()=>closeOutToday([{taskId:1,outcome:'waiting' as any}],'2026-08-05',current)).toThrow(/Invalid/);
  expectNormalized(current);
});
