import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createDatabase, database } from '../../src/lib/server/db';
import { restoreDatabaseBytes } from '../../src/lib/server/database-restore';
import { actions as todayActions } from '../../src/routes/today/+page.server';
import { actions as backlogActions } from '../../src/routes/backlog/+page.server';
import { actions as projectActions } from '../../src/routes/projects/[id]/+page.server';
import { addToPlan, applySanityChoice, buildSanityContext, createProfile, createTask, exportData, getSettings, getStartWarnings, getTask, getToday, importData, saveSettings, updateTask } from '../../src/lib/server/repository';

const date='2026-08-05';const open:Array<ReturnType<typeof createDatabase>>=[];const directories:string[]=[];
function fresh(path=':memory:'){const db=createDatabase(path);open.push(db);return db;}
function temp(){const dir=mkdtempSync(join(tmpdir(),'life-deadlines-'));directories.push(dir);return dir;}
function legacy(path:string){const db=new Database(path);for(const name of ['0000_initial','0001_profiles','0002_review_sessions','0003_task_projects'])db.exec(readFileSync(`drizzle/${name}.sql`,'utf8'));return db;}
afterEach(()=>{
  vi.unstubAllGlobals();vi.useRealTimers();for(const db of open.splice(0))if(db.sqlite.open)db.sqlite.close();
  for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});
  database.sqlite.exec('DELETE FROM tasks; DELETE FROM profiles WHERE id<>1;');
});

describe('deadline estimates and recovery',()=>{
  test('upgrades an existing database once without changing task or setting data',()=>{
    const path=join(temp(),'legacy.db');const old=legacy(path);old.prepare("INSERT INTO tasks(title) VALUES('Existing')").run();old.close();
    const migrated=fresh(path);expect(getTask(1,migrated.sqlite)).toMatchObject({title:'Existing',remaining_effort_minutes:null,lead_time_days:0});
    updateTask(1,{remainingEffortMinutes:120,leadTimeDays:7},migrated.sqlite);saveSettings({deadline_buffer_days:'3'},migrated.sqlite);migrated.sqlite.close();
    const reopened=fresh(path);expect(getTask(1,reopened.sqlite)).toMatchObject({remaining_effort_minutes:120,lead_time_days:7});expect(getSettings(reopened.sqlite).deadline_buffer_days).toBe('3');
  });
  test('round-trips estimates and buffer in v2 JSON and upgrades v1 exports',()=>{
    const {sqlite}=fresh();const id=createTask({title:'Estimate',remainingEffortMinutes:3360,leadTimeDays:2},sqlite);saveSettings({deadline_buffer_days:'4'},sqlite);
    const snapshot=exportData(sqlite);expect(snapshot.version).toBe(2);importData(snapshot,sqlite);
    expect(getTask(id,sqlite)).toMatchObject({remaining_effort_minutes:3360,lead_time_days:2});expect(getSettings(sqlite).deadline_buffer_days).toBe('4');
    const old=structuredClone(snapshot) as any;old.version=1;for(const row of old.tables.tasks){delete row.remaining_effort_minutes;delete row.lead_time_days;}old.tables.settings=old.tables.settings.filter((row:any)=>row.key!=='deadline_buffer_days');
    importData(old,sqlite);expect(getTask(id,sqlite)).toMatchObject({remaining_effort_minutes:null,lead_time_days:0});expect(getSettings(sqlite).deadline_buffer_days).toBe('2');
    const invalid=structuredClone(snapshot) as any;invalid.tables.tasks[0].lead_time_days=-1;expect(()=>importData(invalid,sqlite)).toThrow();expect(getTask(id,sqlite)?.lead_time_days).toBe(0);
  });
  test('restores a pre-estimate SQLite backup through the current connection',async()=>{
    const dir=temp();const path=join(dir,'old.db');const old=legacy(path);old.prepare("INSERT INTO tasks(title) VALUES('Legacy backup')").run();old.close();
    const livePath=join(dir,'live.db');const live=fresh(livePath);createTask({title:'Before'},live.sqlite);
    await restoreDatabaseBytes(readFileSync(path),{liveDatabase:live,livePath});
    expect(getTask(1,live.sqlite)).toMatchObject({title:'Legacy backup',remaining_effort_minutes:null,lead_time_days:0});expect(getSettings(live.sqlite).deadline_buffer_days).toBe('2');
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
    expect(getToday(date,sqlite)).toMatchObject([{id,section:'also'}]);expect(getToday(date,sqlite,other)).toMatchObject([{id,section:'focus'}]);
    expect(()=>applySanityChoice(id,'Start',date,sqlite)).toThrow(/already/);
  });
});

describe('deadline forms and sanity flow',()=>{
  test.each([['Today',todayActions],['Backlog',backlogActions],['Project',projectActions]])('%s task editor saves and clears estimates',async(_name,actions)=>{
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
    const offline=await (todayActions.sanity as any)({cookies,request:new Request('http://localhost/today?/sanity',{method:'POST',body:new URLSearchParams({profileId:String(profile)})})});expect(offline).toMatchObject({offline:true,dueTasks:[],startWarnings:[{taskId:id,startBy:date,planned:false}]});
    let sent:any;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{sent=JSON.parse(JSON.parse(init.body).messages[0].content.split('\n\n').at(-1));return Response.json({message:{content:'{"concerns":[]}'},done:true});}));
    await (todayActions.sanity as any)({cookies,request:new Request('http://localhost/today?/sanity',{method:'POST',body:new URLSearchParams({profileId:String(profile)})})});expect(sent.startWarnings).toMatchObject([{taskId:id,effortMinutes:3360}]);
    const body=new FormData();body.set('taskId',String(id));body.set('profileId',String(profile));body.set('planDate',date);body.set('choice','Start');
    expect(await (todayActions.concern as any)({cookies,request:new Request('http://localhost/today?/concern',{method:'POST',body})})).toMatchObject({startWarnings:[{taskId:id,planned:true}]});
    expect(getToday(date,undefined,profile)).toMatchObject([{id,section:'also'}]);
  });
});
