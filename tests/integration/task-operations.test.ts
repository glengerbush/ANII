import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createDatabase} from '../../src/lib/server/db';
import {executeTask,taskOperation} from '../../src/lib/server/task-operations';
import {createProfile,createProject,createTask,getBacklog,getDependencies,getNow,getTask,today} from '../../src/lib/server/repository';

let db:ReturnType<typeof createDatabase>['sqlite'];
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));db=createDatabase(':memory:').sqlite;});
afterEach(()=>{db.close();vi.useRealTimers();});

test('shared task operations preserve assignment, daily hides and completion attribution',()=>{
  const other=createProfile('Other',db),task=createTask({title:'Shared work'},db);
  const run=(operation:Parameters<typeof executeTask>[0],fields:Record<string,string>,profileId=1)=>executeTask(operation,fields,{profileId},db);
  run('schedule',{taskId:String(task),assigneeId:String(other)});
  expect(getNow(undefined,db,1)).toEqual([]);
  expect(getNow(undefined,db,other).map(t=>t.id)).toEqual([task]);
  run('plan',{taskId:String(task),planned:'true'});
  expect(getTask(task,db)?.assignee_id).toBeNull();
  run('plan',{taskId:String(task),planned:'false'});
  expect(getNow(undefined,db,1)).toEqual([]);
  expect(getNow(undefined,db,other).map(t=>t.id)).toEqual([task]);
  run('state',{id:String(task),state:'completed'},other);
  expect(getNow(undefined,db,other)).toEqual([]);
  expect(db.prepare('SELECT profile_id FROM task_completions WHERE task_id=?').all(task)).toEqual([{profile_id:other}]);
  run('state',{id:String(task),state:'open'},other);
  run('schedule',{taskId:String(task),assigneeId:'none'});
  expect(getTask(task,db)?.start_date).toBeNull();
  expect(getNow(undefined,db,other)).toEqual([]);
});

test('shared context and duplicate-field checks reject changes before mutation',()=>{
  const other=createProfile('Other',db),task=createTask({title:'Untouched'},db);
  const fields={id:String(task),state:'completed'};
  for(const invalid of [{...fields,profileId:String(other)},{...fields,planDate:'2000-01-01'}]){
    expect(()=>executeTask('state',invalid,{profileId:1},db)).toThrow();
    expect(getTask(task,db)?.state).toBe('open');
  }
  expect(()=>executeTask('plan',{taskId:[String(task),String(task)]},{profileId:1},db)).toThrow(/one task/);
  expect(()=>executeTask('state',fields,{profileId:999},db)).toThrow(/profile/);
  expect(getNow(undefined,db,1)).toEqual([]);
  for(const [view,action] of [['calendar','deleteTask'],['completed','create'],['__proto__','state'],['backlog','constructor']]) expect(taskOperation(view,action)).toBeUndefined();
});

test('task creation and editing share project, effort and dependency behavior',()=>{
  const project=createProject('Home',db),creator=createProfile('Author',db);
  executeTask('createInProject',{title:'Paint'},{profileId:creator,projectId:project},db);
  const task=getBacklog({},db)[0];
  expect(task).toMatchObject({creator_id:creator,project_ids:[project]});
  executeTask('edit',{id:String(task.id),title:'Paint room',remainingHours:'1.25',leadTimeDays:'2'}, {},db);
  expect(getTask(task.id,db)).toMatchObject({title:'Paint room',remaining_effort_minutes:75,lead_time_days:2});
  const prerequisite=createTask({title:'Buy paint'},db);
  executeTask('dependency',{taskId:String(task.id),prerequisiteId:String(prerequisite)}, {},db);
  expect(getDependencies(task.id,db).prerequisites).toMatchObject([{prerequisite_task_id:prerequisite}]);
  expect(()=>executeTask('dependency',{taskId:String(prerequisite),prerequisiteId:String(task.id)}, {},db)).toThrow(/cycle/);
  const tag=executeTask('createProjectTag',{taskId:String(task.id),projectName:'  Weekend  '},{},db);
  expect(tag.project?.name).toBe('Weekend');
  expect(getTask(task.id,db)?.project_ids).toContain(tag.project!.id);
  executeTask('quickAdd',{title:'Immediate',planDate:today(db)},{profileId:creator},db);
  expect(getNow(undefined,db,creator).map(t=>t.title)).toEqual(['Immediate']);
});
