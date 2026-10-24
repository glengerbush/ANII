import {expect,test} from 'vitest';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDatabase} from '../../src/lib/server/db';
import {createProject,createTask,exportData,getBacklog,getOrderedBacklog,getProject,getProjectTasks,getTask,importData,setProjectCompleted,setTaskState} from '../../src/lib/server/repository';

test('completing and reopening a project preserves its tasks, order, and completion timestamp',()=>{
 const db=createDatabase(':memory:').sqlite;
 try{
  const p=createProject('Finish project',db),task=createTask({title:'Still open',projectIds:[p]},db);
  const before=getTask(task,db);setProjectCompleted(p,true,db);const completed=getProject(p,db);
  expect(completed).toMatchObject({state:'archived',completed_at:expect.any(String)});
  setProjectCompleted(p,true,db);expect(getProject(p,db)?.completed_at).toBe(completed?.completed_at);
  expect(getTask(task,db)).toEqual(before);expect(getProjectTasks(p,db).map(t=>t.id)).toEqual([task]);
  const snapshot=exportData(db);importData(snapshot,db);expect(getProject(p,db)).toEqual(completed);
  setProjectCompleted(p,false,db);expect(getProject(p,db)).toMatchObject({state:'active',completed_at:null});
  expect(()=>setProjectCompleted(999,true,db)).toThrow('Project not found');
 }finally{db.close();}
});

test('project None filters unassigned open and completed tasks without changing personal order',()=>{
 const db=createDatabase(':memory:').sqlite;
 try{
  const p=createProject('Project',db),a=createTask({title:'Unassigned'},db),b=createTask({title:'Assigned',projectIds:[p]},db);
  setProjectCompleted(p,true,db);
  expect(getOrderedBacklog({project:'none'},db,1).map(t=>t.id)).toEqual([a]);
  expect(getBacklog({project:p},db).map(t=>t.id)).toEqual([b]);
  setTaskState(a,'completed',db);setTaskState(b,'completed',db);
  expect(getBacklog({project:'none',state:'completed'},db).map(t=>t.id)).toEqual([a]);
 }finally{db.close();}
});

test('existing databases and older snapshots gain project completion dates without losing data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'anii-project-completion-')),path=join(dir,'life.db');let db=createDatabase(path).sqlite;
 try{
  const p=createProject('Existing project',db);const t=createTask({title:'Existing task',projectIds:[p]},db);
  db.exec('ALTER TABLE projects DROP COLUMN completed_at');db.close();db=createDatabase(path).sqlite;
  expect(getProject(p,db)).toMatchObject({state:'active',completed_at:null});expect(getTask(t,db)?.project_ids).toEqual([p]);
  expect(readdirSync(join(dir,'backups')).filter(n=>n.startsWith('life-before-project-completion-'))).toHaveLength(1);
  const snapshot=exportData(db) as any;for(const project of snapshot.tables.projects)delete project.completed_at;
  importData(snapshot,db);expect(getProject(p,db)?.completed_at).toBeNull();expect(db.pragma('foreign_key_check')).toEqual([]);
  db.close();db=createDatabase(path).sqlite;expect(readdirSync(join(dir,'backups')).filter(n=>n.startsWith('life-before-project-completion-'))).toHaveLength(1);
 }finally{if(db.open)db.close();rmSync(dir,{recursive:true,force:true});}
});
