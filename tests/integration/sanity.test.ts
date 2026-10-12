import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDatabase, database } from '../../src/lib/server/db';
import { actions } from '../../src/routes/today/+page.server';
import {
  addDependency, addToPlan, applySanityChoice, buildSanityContext, createProfile, createTask,
  getDueOutsidePlan, getTask, getToday, setTaskState, updateTask
} from '../../src/lib/server/repository';

const date='2026-08-05';
const open:Array<ReturnType<typeof createDatabase>>=[];
function fresh(){const db=createDatabase(':memory:');open.push(db);return db.sqlite;}
afterEach(()=>{
  vi.unstubAllGlobals();vi.useRealTimers();
  for(const db of open.splice(0))db.sqlite.close();
  database.sqlite.exec('DELETE FROM tasks; DELETE FROM profiles WHERE id<>1;');
});

describe('due tasks outside Today',()=>{
  test('finds every unfinished deadline outside this profile and date, oldest first',()=>{
    const db=fresh();const other=createProfile('Other',db);
    const task=(title:string,dueAt?:string)=>createTask({title,dueAt},db);
    const overdue=task('Overdue','2026-08-01'),due=task('Due',date),waiting=task('Waiting',date);
    setTaskState(waiting,'waiting',db);
    const otherPlan=task('Other profile',date),tomorrowPlan=task('Tomorrow',date);
    addToPlan(otherPlan,date,'focus',db,other);addToPlan(tomorrowPlan,'2026-08-06','also',db);
    const focus=task('Focus',date),also=task('Also',date);
    addToPlan(focus,date,'focus',db);addToPlan(also,date,'also',db);
    const done=task('Done',date),dropped=task('Legacy dropped',date);
    setTaskState(done,'completed',db);db.prepare("UPDATE tasks SET state='dropped' WHERE id=?").run(dropped);
    task('Future','2026-08-06');task('No deadline');
    expect(getDueOutsidePlan(date,db).map(t=>t.id)).toEqual([overdue,due,waiting,otherPlan,tomorrowPlan]);
    expect(getDueOutsidePlan(date,db,other).map(t=>t.id)).toContain(focus);
    expect(getDueOutsidePlan(date,db,other).map(t=>t.id)).not.toContain(otherPlan);
    expect(getToday(date,db).map(t=>t.id)).toEqual([focus,also]);
  });

  test('includes missing-task status and prerequisite chains in AI context',()=>{
    const db=fresh();const missing=createTask({title:'Due and blocked',dueAt:date,duration:'1h'},db);
    const pre=createTask({title:'Prerequisite'},db),root=createTask({title:'First step'},db);
    addDependency(missing,pre,'hard',undefined,db);addDependency(pre,root,'hard',undefined,db);
    setTaskState(missing,'waiting',db);
    const planned=createTask({title:'Planned'},db);addToPlan(planned,date,'focus',db);
    const context=buildSanityContext(date,db);
    expect(context.tasks).toMatchObject([{id:planned,section:'focus'}]);
    expect(context.dueOutsidePlan).toMatchObject([{id:missing,title:'Due and blocked',state:'waiting',dueAt:date,duration:'1h',blocked:true,section:null}]);
    expect(context.prerequisiteChains).toEqual(expect.arrayContaining([
      expect.objectContaining({task_id:missing,prerequisite_id:pre,depth:1}),
      expect.objectContaining({task_id:missing,prerequisite_id:root,depth:2})
    ]));
    expect(buildSanityContext(date,fresh())).toMatchObject({tasks:[],dueOutsidePlan:[],prerequisiteChains:[]});
  });

  test('Add preserves Focus, task state, and other plans and records one decision',()=>{
    const db=fresh();const other=createProfile('Other',db);
    const focus=[1,2,3].map(n=>createTask({title:`Focus ${n}`},db));
    for(const id of focus)addToPlan(id,date,'focus',db);
    const due=createTask({title:'Waiting deadline',dueAt:date},db),pre=createTask({title:'Blocker'},db);
    setTaskState(due,'waiting',db);addDependency(due,pre,'hard',undefined,db);addToPlan(due,date,'focus',db,other);
    applySanityChoice(due,'Add',date,db);
    expect(getToday(date,db).filter(t=>t.section==='focus').map(t=>t.id)).toEqual(focus);
    expect(getToday(date,db).find(t=>t.id===due)).toMatchObject({section:'also',state:'waiting',blocked:1});
    expect(getToday(date,db,other)).toMatchObject([{id:due,section:'focus'}]);
    expect(getTask(due,db)?.due_at).toBe(date);
    expect(()=>applySanityChoice(due,'Add',date,db)).toThrow(/already/);
    expect(db.prepare("SELECT count(*) n FROM events WHERE event_type='sanity_choice'").get()).toEqual({n:1});
    expect(getDueOutsidePlan(date,db)).toEqual([]);
  });

  test('rechecks changed deadlines, completed tasks, and plan membership before acting',()=>{
    const db=fresh();const due=createTask({title:'Changed',dueAt:date},db);
    updateTask(due,{dueAt:'2026-08-06'},db);
    expect(()=>applySanityChoice(due,'Add',date,db)).toThrow(/no longer due/);
    updateTask(due,{dueAt:date},db);setTaskState(due,'completed',db);
    expect(()=>applySanityChoice(due,'Add',date,db)).toThrow(/no longer active/);
    const elsewhere=createTask({title:'Elsewhere'},db);const other=createProfile('Other',db);addToPlan(elsewhere,date,'also',db,other);
    for(const choice of ['Keep','Move'] as const)expect(()=>applySanityChoice(elsewhere,choice,date,db)).toThrow(/no longer in Today/);
    expect(getToday(date,db)).toEqual([]);expect(getToday(date,db,other).map(t=>t.id)).toEqual([elsewhere]);
    expect(db.prepare("SELECT count(*) n FROM events WHERE event_type='sanity_choice'").get()).toEqual({n:0});
  });
});

function routeFixture(){
  vi.useFakeTimers();vi.setSystemTime(new Date(2026,7,5,12));
  const profile=createProfile('Route profile');
  return {profile,cookies:{get:()=>String(profile)}};
}
function concernRequest(taskId:number,profile:number,planDate=date){
  const body=new FormData();body.set('taskId',String(taskId));body.set('choice','Add');
  body.set('profileId',String(profile));body.set('planDate',planDate);
  return new Request('http://localhost/today?/concern',{method:'POST',body});
}

describe('sanity check actions',()=>{
  test('offline checks retain the full due list and adding refreshes the remaining list',async()=>{
    const {profile,cookies}=routeFixture();
    const ids=[1,2,3,4].map(n=>createTask({title:`Due ${n}`,dueAt:date}));
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
    const result=await (actions.sanity as any)({cookies,request:new Request('http://localhost/today?/sanity',{method:'POST',body:new URLSearchParams({profileId:String(profile)})})});
    expect(result.offline).toBe(true);expect(result.dueTasks.map((t:any)=>t.id)).toEqual(ids);
    expect(getToday(date,undefined,profile)).toEqual([]);
    const added=await (actions.concern as any)({cookies,request:concernRequest(ids[0],profile)});
    expect(added.dueTasks.map((t:any)=>t.id)).toEqual(ids.slice(1));
    expect(getToday(date,undefined,profile)).toMatchObject([{id:ids[0],section:'also'}]);
  });

  test('AI sees omitted deadlines but cannot supply actions for tasks outside the plan',async()=>{
    const {profile,cookies}=routeFixture();
    const due=createTask({title:'Forgotten deadline',dueAt:date});const planned=createTask({title:'Current plan'});
    addToPlan(planned,date,'also',undefined,profile);
    let sentContext:any;
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      sentContext=JSON.parse(JSON.parse(init.body).prompt.split('\n\n').at(-1));
      const concern=(taskId:number)=>({taskId,observation:'Reconsider this task',reason:'Make room for the deadline',choices:['Keep','Move']});
      return new Response(JSON.stringify({response:JSON.stringify({concerns:[concern(due),concern(planned),concern(planned)]})}));
    }));
    const result=await (actions.sanity as any)({cookies,request:new Request('http://localhost/today?/sanity',{method:'POST',body:new URLSearchParams({profileId:String(profile)})})});
    expect(sentContext.dueOutsidePlan).toMatchObject([{id:due,title:'Forgotten deadline'}]);
    expect(result.concerns).toMatchObject([{taskId:planned}]);expect(result.concerns).toHaveLength(1);
    expect(result.dueTasks.map((t:any)=>t.id)).toEqual([due]);
    expect(getToday(date,undefined,profile).map(t=>t.id)).toEqual([planned]);
  });

  test('malformed model output cannot hide omitted deadlines',async()=>{
    const {profile,cookies}=routeFixture();const due=createTask({title:'Due',dueAt:date});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({response:'not json'}))));
    const result=await (actions.sanity as any)({cookies,request:new Request('http://localhost/today?/sanity',{method:'POST',body:new URLSearchParams({profileId:String(profile)})})});
    expect(result).toMatchObject({offline:true,concerns:[],dueTasks:[{id:due}]});
  });

  test('stale dates and switched profiles cannot apply an old Add action',async()=>{
    const {profile,cookies}=routeFixture();const due=createTask({title:'Due',dueAt:date});
    for(const request of [concernRequest(due,profile,'2026-08-04'),concernRequest(due,1)]){
      expect(await (actions.concern as any)({cookies,request})).toMatchObject({status:400});
    }
    expect(getToday(date,undefined,profile)).toEqual([]);
  });
});
