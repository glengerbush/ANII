import { afterEach, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import {rmSync} from 'node:fs';
import { createDatabase } from '../../src/lib/server/db';
import { addDependency, createTask, getDependencies, replaceDependency } from '../../src/lib/server/repository';
import { taskDependencyAction } from '../../src/lib/server/task-actions';

const connections:Database.Database[]=[];
const directories:string[]=[];
afterEach(()=>{for(const db of connections.splice(0))if(db.open)db.close();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
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
