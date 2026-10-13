import { afterEach, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../src/lib/server/db';
import { addDependency, createTask, exportData, getDependencies, getTask, importData, replaceDependency } from '../../src/lib/server/repository';
import { taskDependencyAction } from '../../src/lib/server/task-actions';
import { restoreDatabaseBytes } from '../../src/lib/server/database-restore';

const connections:Database.Database[]=[];
const directories:string[]=[];
afterEach(()=>{for(const db of connections.splice(0))if(db.open)db.close();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
function directory(){const dir=mkdtempSync(join(tmpdir(),'anii-dependencies-'));directories.push(dir);return dir;}
function legacy(path:string){
  const db=new Database(path);connections.push(db);
  for(const migration of ['0000_initial','0001_profiles','0002_review_sessions','0003_task_projects','0004_deadline_estimates'])db.exec(readFileSync(`drizzle/${migration}.sql`,'utf8'));
  db.exec("INSERT INTO tasks(id,title) VALUES(1,'Required task'),(2,'Prerequisite'),(3,'Suggested task'); INSERT INTO messages(id,role,content) VALUES(1,'user','Source'); INSERT INTO dependencies(task_id,prerequisite_task_id,kind,source_message_id,confidence,created_at) VALUES(1,2,'hard',1,0.8,'2026-08-05 12:00:00'),(3,2,'soft',1,0.5,'2026-08-05 12:00:00');");
  return db;
}
function expectRequiredOnly(db:Database.Database){
  expect(db.prepare('SELECT task_id,prerequisite_task_id FROM dependencies').all()).toEqual([{task_id:1,prerequisite_task_id:2}]);
  expect(db.pragma('table_info(dependencies)')).not.toEqual(expect.arrayContaining([expect.objectContaining({name:'kind'})]));
  expect(getTask(1,db)?.blocked).toBe(1);expect(getTask(3,db)?.blocked).toBe(0);
  expect(getDependencies(1,db).prerequisites[0]).toMatchObject({source_message_id:1,confidence:0.8,created_at:'2026-08-05 12:00:00'});
  expect(db.pragma('foreign_key_check')).toEqual([]);
}

test('startup discards better-after links and preserves required links and cycle guards',()=>{
  const path=join(directory(),'legacy.db');legacy(path).close();
  const db=createDatabase(path).sqlite;connections.push(db);expectRequiredOnly(db);
  expect(()=>db.prepare('INSERT INTO dependencies(task_id,prerequisite_task_id) VALUES(2,1)').run()).toThrow(/cycle/i);
  db.close();const reopened=createDatabase(path).sqlite;connections.push(reopened);expectRequiredOnly(reopened);
});

test('JSON and SQLite legacy imports discard suggestions without changing the source',async()=>{
  const dir=directory();const legacyPath=join(dir,'legacy.db');const old=legacy(legacyPath);
  const snapshot=exportData(old);old.close();
  const current=createDatabase(join(dir,'current.db'));connections.push(current.sqlite);
  importData(snapshot,current.sqlite);expectRequiredOnly(current.sqlite);
  expect(snapshot.tables.dependencies).toHaveLength(2);
  expect(snapshot.tables.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({kind:'soft'})]));
  await restoreDatabaseBytes(readFileSync(legacyPath),{liveDatabase:current,livePath:join(dir,'current.db'),stagingRoot:dir});expectRequiredOnly(current.sqlite);
});

test('replacing a dependency is atomic on cycle and duplicate failures',()=>{
  const db=createDatabase(':memory:').sqlite;connections.push(db);
  const task=createTask({title:'Task'},db),first=createTask({title:'First'},db),second=createTask({title:'Second'},db),dependent=createTask({title:'Dependent'},db);
  addDependency(task,first,db);addDependency(task,second,db);addDependency(dependent,task,db);
  const before=()=>getDependencies(task,db).prerequisites.map((item:any)=>item.prerequisite_task_id).sort();
  expect(()=>replaceDependency(task,first,dependent,db)).toThrow(/cycle/i);expect(before()).toEqual([first,second]);
  expect(()=>replaceDependency(task,first,second,db)).toThrow(/already exists/i);expect(before()).toEqual([first,second]);
  expect(()=>replaceDependency(task,first,task,db)).toThrow(/itself/);expect(before()).toEqual([first,second]);
  const replacement=createTask({title:'Replacement'},db);replaceDependency(task,first,replacement,db);
  expect(before()).toEqual([second,replacement]);
});

test('legacy dependency kind submissions are rejected instead of creating blockers',async()=>{
  const body=new FormData();body.set('taskId','1');body.set('prerequisiteId','2');body.set('kind','soft');
  await expect(taskDependencyAction(new Request('http://localhost/backlog?/dependency',{method:'POST',body}))).resolves.toMatchObject({status:400,data:{error:expect.stringContaining('no longer supported')}});
});
