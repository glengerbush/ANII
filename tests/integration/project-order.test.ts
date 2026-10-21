import {expect,test} from 'vitest';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDatabase,database} from '../../src/lib/server/db';
import {Planning} from '../../src/lib/server/planning';
import {addTaskProject,createProfile,createProject,createTask,exportData,getOrderedBacklog,getProject,getProjectTasks,importData,moveProjectTask,removeTaskProject,setTaskProjects} from '../../src/lib/server/repository';
import {actions,load} from '../../src/routes/projects/[id]/+page.server';

const ids=(tasks:{id:number}[])=>tasks.map(task=>task.id);
test('project order is independent of other projects and personal queues, survives edits and restore',()=>{
 const db=createDatabase(':memory:').sqlite;
 try{
  const project=createProject('Shared order',db),other=createProject('Other project',db);
  const [a,b,c]=['A','B','C'].map(title=>createTask({title,projectIds:[project,other]},db));
  const planning=new Planning(db);for(const id of [b,a,c])planning.queue(1,id);
  const personal=ids(getOrderedBacklog({},db,1));
  moveProjectTask(project,c,a,'before',db);
  expect(ids(getProjectTasks(project,db))).toEqual([c,a,b]);
  expect(ids(getProjectTasks(other,db))).toEqual([a,b,c]);
  expect(ids(getOrderedBacklog({},db,1))).toEqual(personal);
  expect(getProject(project,db)?.next_task).toBe('C');
  setTaskProjects(c,[project,other],db);expect(ids(getProjectTasks(project,db))).toEqual([c,a,b]);
  const d=createTask({title:'D',projectIds:[project]},db);expect(ids(getProjectTasks(project,db))).toEqual([c,a,b,d]);
  removeTaskProject(c,project,db);addTaskProject(c,project,db);expect(ids(getProjectTasks(project,db))).toEqual([a,b,d,c]);
  const snapshot=exportData(db);importData(snapshot,db);expect(ids(getProjectTasks(project,db))).toEqual([a,b,d,c]);
 }finally{db.close();}
});

test('project moves reject stale members and completed tasks without changing order',()=>{
 const db=createDatabase(':memory:').sqlite;
 try{
  const p=createProject('Project',db);const [a,b,c]=['A','B','C'].map(title=>createTask({title,projectIds:[p]},db));const outsider=createTask({title:'Outside'},db);
  const planning=new Planning(db);planning.setState(b,'completed',1);
  for(const [task,anchor,edge] of [[outsider,a,'before'],[a,b,'before'],[a,c,'sideways']] as const)expect(()=>moveProjectTask(p,task,anchor,edge as 'before',db)).toThrow();
  expect(ids(getProjectTasks(p,db))).toEqual([a,c,b]);
  moveProjectTask(p,c,a,'before',db);planning.setState(b,'open',1);
  expect(ids(getProjectTasks(p,db))).toEqual([c,b,a]);
 }finally{db.close();}
});

test('startup migrates existing project membership once and older snapshots retain their order',()=>{
 const dir=mkdtempSync(join(tmpdir(),'anii-project-order-')),path=join(dir,'life.db');let db=createDatabase(path).sqlite;
 try{
  const p=createProject('Migrated',db);const [a,b]=['A','B'].map(title=>createTask({title,projectIds:[p]},db));
  db.prepare('UPDATE tasks SET created_at=? WHERE id=?').run('2026-01-01',a);db.prepare('UPDATE tasks SET created_at=? WHERE id=?').run('2026-01-02',b);
  db.exec('ALTER TABLE task_projects DROP COLUMN position');db.close();db=createDatabase(path).sqlite;
  expect(ids(getProjectTasks(p,db))).toEqual([b,a]);
  expect(readdirSync(join(dir,'backups')).filter(name=>name.startsWith('life-before-project-order-'))).toHaveLength(1);
  moveProjectTask(p,a,b,'before',db);db.close();db=createDatabase(path).sqlite;expect(ids(getProjectTasks(p,db))).toEqual([a,b]);
  expect(readdirSync(join(dir,'backups')).filter(name=>name.startsWith('life-before-project-order-'))).toHaveLength(1);
  const snapshot=exportData(db) as any;for(const row of snapshot.tables.task_projects)delete row.position;
  importData(snapshot,db);expect(ids(getProjectTasks(p,db))).toEqual([b,a]);
  expect(db.pragma('foreign_key_check')).toEqual([]);
 }finally{if(db.open)db.close();rmSync(dir,{recursive:true,force:true});}
});

test('project move endpoint shares the order across profiles and scopes moves to its project',async()=>{
 const p=createProject('Route order'),other=createProject('Route other'),profile=createProfile('Order viewer');
 const a=createTask({title:'A',projectIds:[p]}),b=createTask({title:'B',projectIds:[p]}),c=createTask({title:'C',projectIds:[other]});
 const submit=(taskId:number,anchorId:number)=>(actions.move as any)({params:{id:String(p)},request:new Request(`http://localhost/projects/${p}?/move`,{method:'POST',body:new URLSearchParams({taskId:String(taskId),anchorId:String(anchorId),edge:'before'})})});
 try{
  await expect(submit(c,a)).resolves.toMatchObject({status:400});await expect(submit(b,a)).resolves.toMatchObject({success:true});
  for(const id of [1,profile])expect(ids((load as any)({params:{id:String(p)},cookies:{get:()=>String(id)}}).tasks)).toEqual([b,a]);
 }finally{
  for(const id of [a,b,c])database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(id);
  for(const id of [p,other])database.sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
  database.sqlite.prepare('DELETE FROM profiles WHERE id=?').run(profile);
 }
});
