import {chatResponse} from '../fixtures/ai/stream';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createDatabase, database } from '../../src/lib/server/db';
import { restoreDatabaseBytes } from '../../src/lib/server/database-restore';
import { actions as todayActions } from '../../src/routes/now/+page.server';
import { actions as backlogActions } from '../../src/routes/backlog/+page.server';
import { actions as projectActions } from '../../src/routes/projects/[id]/+page.server';
import { addToPlan, applySanityChoice, buildSanityContext, createProfile, createTask, exportData, getSettings, getStartWarnings, getTask, getNow, importData, saveSettings, updateTask } from '../../src/lib/server/repository';

const date='2026-08-05';const open:Array<ReturnType<typeof createDatabase>>=[];const directories:string[]=[];
function fresh(path=':memory:'){const db=createDatabase(path);open.push(db);return db;}
function temp(){const dir=mkdtempSync(join(tmpdir(),'life-deadlines-'));directories.push(dir);return dir;}

afterEach(()=>{
  vi.unstubAllGlobals();vi.useRealTimers();for(const db of open.splice(0))if(db.sqlite.open)db.sqlite.close();
  for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});
  database.sqlite.exec('DELETE FROM tasks; DELETE FROM profiles WHERE id<>1;');
});

describe('deadline estimates and recovery',()=>{
  test('round-trips estimates and buffer in current JSON',()=>{
    const {sqlite}=fresh();const id=createTask({title:'Estimate',remainingEffortMinutes:3360,leadTimeDays:2},sqlite);saveSettings({deadline_buffer_days:'4'},sqlite);
    const snapshot=exportData(sqlite);expect(snapshot.version).toBe(4);importData(snapshot,sqlite);
    expect(getTask(id,sqlite)).toMatchObject({remaining_effort_minutes:3360,lead_time_days:2});expect(getSettings(sqlite).deadline_buffer_days).toBe('4');
    const invalid=structuredClone(snapshot) as any;invalid.tables.tasks[0].lead_time_days=-1;expect(()=>importData(invalid,sqlite)).toThrow();expect(getTask(id,sqlite)?.lead_time_days).toBe(2);
  });
  test('validates estimates and settings atomically and preserves omitted estimates',()=>{
    const {sqlite}=fresh();const id=createTask({title:'Keep',remainingEffortMinutes:120,leadTimeDays:7},sqlite);
    updateTask(id,{title:'Edited'},sqlite);expect(getTask(id,sqlite)).toMatchObject({remaining_effort_minutes:120,lead_time_days:7});
    for(const leadTimeDays of [-1,0.5,Infinity,3651])expect(()=>updateTask(id,{title:'Invalid',leadTimeDays},sqlite)).toThrow();
    for(const remainingEffortMinutes of [-1,0.5,Infinity,525601])expect(()=>updateTask(id,{remainingEffortMinutes},sqlite)).toThrow();
    expect(getTask(id,sqlite)?.title).toBe('Edited');
    expect(()=>saveSettings({deadline_buffer_days:'3',daily_capacity_minutes:'bad'},sqlite)).toThrow();expect(getSettings(sqlite).deadline_buffer_days).toBe('2');
  });
  test('warnings include scheduled tasks, and Start rechecks estimates before adding',()=>{
    const {sqlite}=fresh();const other=createProfile('Other',sqlite);const id=createTask({title:'Week of work',dueAt:'2026-08-14',remainingEffortMinutes:3360},sqlite);
    addToPlan(id,date,'focus',sqlite,other);
    expect(getStartWarnings(date,sqlite)[0]).toMatchObject({taskId:id,startBy:date,planned:false});expect(getStartWarnings(date,sqlite,other)[0].planned).toBe(true);
    expect(buildSanityContext(date,sqlite).startWarnings[0].taskId).toBe(id);
    updateTask(id,{remainingEffortMinutes:60},sqlite);expect(()=>applySanityChoice(id,'Start',date,sqlite)).toThrow(/no longer/);
    updateTask(id,{remainingEffortMinutes:3360},sqlite);applySanityChoice(id,'Start',date,sqlite);
    expect(getNow(date,sqlite)).toMatchObject([{id,section:'also'}]);expect(getNow(date,sqlite,other)).toEqual([]);
    expect(()=>applySanityChoice(id,'Start',date,sqlite)).toThrow(/already/);
  });
});

describe('deadline forms and sanity flow',()=>{
  test.each([['Now',todayActions],['Backlog',backlogActions],['Project',projectActions]])('%s task editor saves and clears estimates',async(_name,actions)=>{
    const id=createTask({title:'Edited task'});
    const body=new FormData();body.set('id',String(id));body.set('title','Edited task');body.set('remainingHours','56');body.set('leadTimeDays','2');body.set('dueAt','2026-08-14');
    const submit=()=> (actions.edit as any)({request:new Request('http://localhost/edit',{method:'POST',body})});
    expect(await submit()).toMatchObject({success:true});expect(getTask(id)).toMatchObject({remaining_effort_minutes:3360,lead_time_days:2});
    body.set('remainingHours','-0.001');expect(await submit()).toMatchObject({status:400});expect(getTask(id)?.remaining_effort_minutes).toBe(3360);
    body.set('remainingHours','');body.set('leadTimeDays','0');expect(await submit()).toMatchObject({success:true});expect(getTask(id)).toMatchObject({remaining_effort_minutes:null,lead_time_days:0});
  });
  test('future warnings work offline and reach the AI with an explicit Add action',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date(2026,7,5,12));const profile=createProfile('Planner');const cookies={get:()=>String(profile)};
    const id=createTask({title:'Future deadline',dueAt:'2026-08-14',remainingEffortMinutes:3360});
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
    const offline=await (todayActions.sanity as any)({cookies,request:new Request('http://localhost/now?/sanity',{method:'POST',body:new URLSearchParams({profileId:String(profile)})})});expect(offline).toMatchObject({offline:true,dueTasks:[],startWarnings:[{taskId:id,startBy:date,planned:false}]});
    let sent:any;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{sent=JSON.parse(JSON.parse(init.body).messages[0].content.split('\n\n').at(-1));return chatResponse('{"concerns":[]}');}));
    await (todayActions.sanity as any)({cookies,request:new Request('http://localhost/now?/sanity',{method:'POST',body:new URLSearchParams({profileId:String(profile)})})});expect(sent.startWarnings).toMatchObject([{taskId:id,effortMinutes:3360}]);
    const body=new FormData();body.set('taskId',String(id));body.set('profileId',String(profile));body.set('planDate',date);body.set('choice','Start');
    expect(await (todayActions.concern as any)({cookies,request:new Request('http://localhost/now?/concern',{method:'POST',body})})).toMatchObject({startWarnings:[{taskId:id,planned:true}]});
    expect(getNow(date,undefined,profile)).toMatchObject([{id,section:'also'}]);
  });
});
