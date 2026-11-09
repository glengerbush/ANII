import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createDatabase,database} from '../../src/lib/server/db';
import {Planning} from '../../src/lib/server/planning';
import {createProfile,createTask,getTask,getNow,scheduleTask,today} from '../../src/lib/server/repository';
import {taskScheduleAction} from '../../src/lib/server/task-actions';
let db:ReturnType<typeof createDatabase>['sqlite'];
let plan:Planning;
const day='2026-11-08';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(`${day}T12:00:00Z`));db=createDatabase(':memory:').sqlite;plan=new Planning(db);});
afterEach(()=>{db.close();vi.useRealTimers();});
const ids=(profile:number)=>plan.view(profile).now.map(t=>t.taskId);

test('queueing another person’s task shares it instead of taking it away',()=>{
 const other=createProfile('Other',db),third=createProfile('Third',db),id=createTask({title:'Shared work'},db);
 plan.queue(other,id);plan.queue(1,id);
 expect(getTask(id,db)?.assignee_id).toBeNull();
 for(const profile of [1,other,third])expect(ids(profile)).toEqual([id]);
 plan.hide(1,id);
 expect(ids(1)).toEqual([]);expect(ids(other)).toEqual([id]);expect(getTask(id,db)?.assignee_id).toBeNull();
});

test('changing assignment transfers queued work, Everyone shares, No one removes it',async()=>{
 const owner=createProfile('Assignment owner'),other=createProfile('Assignment other'),id=createTask({title:'Move across queues'});
 const cookies={get:()=>String(owner)} as any;
 const assign=(assigneeId:string)=>taskScheduleAction(new Request('http://localhost/backlog?/schedule',{method:'POST',body:new URLSearchParams({taskId:String(id),profileId:String(owner),assigneeId})}),cookies);
 try{
  scheduleTask(id,today(),owner);
  await expect(assign(String(other))).resolves.toMatchObject({success:true});
  expect(getNow(undefined,undefined,owner).some(t=>t.id===id)).toBe(false);
  expect(getNow(undefined,undefined,other).some(t=>t.id===id)).toBe(true);
  await expect(assign('everyone')).resolves.toMatchObject({success:true});
  for(const profile of [owner,other])expect(getNow(undefined,undefined,profile).some(t=>t.id===id)).toBe(true);
  await expect(assign('none')).resolves.toMatchObject({success:true});
  for(const profile of [owner,other])expect(getNow(undefined,undefined,profile).some(t=>t.id===id)).toBe(false);
 }finally{database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(id);database.sqlite.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(owner,other);}
});

test('assignment uses today for unscheduled work, preserves future dates, and restores recipients hidden today',()=>{
 const other=createProfile('Other',db),id=createTask({title:'Assign me'},db);
 plan.assign(id,other);
 expect(getTask(id,db)).toMatchObject({start_date:day,assignee_id:other});
 expect(ids(1)).toEqual([]);expect(ids(other)).toEqual([id]);
 plan.hide(other,id);expect(ids(other)).toEqual([]);expect(getTask(id,db)?.assignee_id).toBe(other);
 plan.assign(id,other);expect(ids(other)).toEqual([id]);
 plan.assign(id,null);plan.hide(1,id);plan.hide(other,id);plan.assign(id,null);
 expect(ids(1)).toEqual([id]);expect(ids(other)).toEqual([id]);
 const newcomer=createProfile('Newcomer',db);expect(ids(newcomer)).toEqual([id]);
 plan.assign(id,'none');
 for(const profile of [1,other,newcomer])expect(plan.view(profile,'2026-11-09').now).toEqual([]);
 plan.schedule(id,{startDate:'2026-12-01',assigneeId:1});plan.assign(id,other);
 expect(getTask(id,db)).toMatchObject({start_date:'2026-12-01',assignee_id:other});
 expect(ids(other)).toEqual([]);expect(plan.view(other,'2026-12-01').now.map(t=>t.taskId)).toEqual([id]);
});

test.each([null,'other'] as const)('queueing future work assigned to %s retains or creates Everyone',owner=>{
 const other=createProfile('Other',db),id=createTask({title:'Future work'},db);
 plan.schedule(id,{startDate:'2026-12-01',assigneeId:owner===null?null:other});plan.queue(1,id);
 expect(getTask(id,db)).toMatchObject({start_date:day,assignee_id:null});
 expect(ids(1)).toEqual([id]);expect(ids(other)).toEqual([id]);
});

test('queueing unassigned work claims it, and invalid assignments leave queues unchanged',()=>{
 const id=createTask({title:'Available'},db);plan.queue(1,id);
 expect(getTask(id,db)).toMatchObject({start_date:day,assignee_id:1});
 for(const assign of [()=>plan.assign(id,99999),()=>plan.assign(id,1,'bad-date')]){
  expect(assign).toThrow();expect(ids(1)).toEqual([id]);expect(getTask(id,db)?.assignee_id).toBe(1);
 }
 plan.hide(1,id);expect(getTask(id,db)?.assignee_id).toBe(1);
 plan.queue(1,id);expect(ids(1)).toEqual([id]);expect(getTask(id,db)?.assignee_id).toBe(1);
});
