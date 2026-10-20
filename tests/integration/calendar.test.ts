import {afterEach,expect,test,vi} from 'vitest';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDatabase,database} from '../../src/lib/server/db';
import {addToPlan,assertCurrentDate,createProfile,createTask,exportData,getCompletedNow,getNow,getScheduledTasks,getTask,importData,removeFromPlan,saveSettings,scheduleTask,setTaskState,today,unscheduleTask} from '../../src/lib/server/repository';
import {actions,load} from '../../src/routes/calendar/+page.server';
import {calendarRange,shiftDate} from '../../src/lib/calendar';
const opened:ReturnType<typeof createDatabase>[]=[];
const directories:string[]=[];
const fresh=()=>{const db=createDatabase(':memory:');opened.push(db);return db.sqlite;};
afterEach(()=>{vi.useRealTimers();for(const db of opened.splice(0))if(db.sqlite.open)db.sqlite.close();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});

test('scheduled tasks enter on start date, repeat until complete, and hide only for one user/day',()=>{
  const db=fresh();const other=createProfile('Other',db);const personal=createTask({title:'Personal'},db),shared=createTask({title:'Shared'},db);
  scheduleTask(personal,'2026-10-20',1,db);scheduleTask(shared,'2026-10-20',null,db);
  expect(getNow('2026-10-19',db)).toEqual([]);
  expect(getNow('2026-10-20',db).map(t=>t.id)).toEqual([personal,shared]);
  expect(getNow('2026-10-20',db,other).map(t=>t.id)).toEqual([shared]);
  removeFromPlan(shared,'2026-10-20',db);
  expect(getNow('2026-10-20',db).map(t=>t.id)).toEqual([personal]);
  expect(getNow('2026-10-20',db,other).map(t=>t.id)).toEqual([shared]);
  expect(getNow('2026-10-21',db).map(t=>t.id)).toEqual([personal,shared]);
  setTaskState(shared,'completed',db,1,'2026-10-21');
  expect(getNow('2026-10-22',db,other)).toEqual([]);
  expect(getCompletedNow('2026-10-21',db,other).map(t=>t.id)).toEqual([shared]);
  setTaskState(shared,'open',db);expect(getNow('2026-10-22',db,other).map(t=>t.id)).toEqual([shared]);
});

test('rescheduling replaces date and assignment; unscheduling preserves the task',()=>{
  const db=fresh();const other=createProfile('Other',db);const id=createTask({title:'Move me'},db);
  scheduleTask(id,'2026-10-20',null,db);getNow('2026-10-20',db);getNow('2026-10-20',db,other);
  scheduleTask(id,'2026-10-23',other,db);
  expect(getNow('2026-10-20',db)).toEqual([]);expect(getNow('2026-10-22',db,other)).toEqual([]);
  expect(getNow('2026-10-23',db)).toEqual([]);expect(getNow('2026-10-23',db,other).map(t=>t.id)).toEqual([id]);
  expect(getScheduledTasks('2026-10-20','2026-10-22',null,db)).toEqual([]);
  expect(getScheduledTasks('2026-10-23','2026-10-23',other,db)).toMatchObject([{id,start_date:'2026-10-23',assignee_id:other}]);
  unscheduleTask(id,db);expect(getNow('2026-10-24',db,other)).toEqual([]);expect(getTask(id,db)?.state).toBe('open');
});

test('manual adds persist, Focus/order carry over, and actual timezone controls rollover',()=>{
  const db=fresh();saveSettings({timezone:'America/New_York'},db);vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-21T03:59:00Z'));
  expect(today(db)).toBe('2026-10-20');
  const first=createTask({title:'First'},db),second=createTask({title:'Second'},db);
  addToPlan(first,undefined,'focus',db);addToPlan(second,undefined,'also',db);
  expect(getTask(first,db)).toMatchObject({start_date:'2026-10-20',assignee_id:1});
  removeFromPlan(second,undefined,db);expect(getNow(undefined,db).map(t=>t.id)).toEqual([first]);
  vi.setSystemTime(new Date('2026-10-21T04:01:00Z'));
  expect(()=>assertCurrentDate('2026-10-20',db)).toThrow(/date changed/i);
  expect(getNow(undefined,db).map(t=>[t.id,t.section])).toEqual([[first,'focus'],[second,'also']]);
  expect(()=>saveSettings({timezone:'not-a-zone'},db)).toThrow(/timezone/);
});

test('calendar filters include Everyone assignments, show start dates only, and validate actions',async()=>{
  const owner=createProfile(`Calendar ${crypto.randomUUID()}`),other=createProfile(`Other ${crypto.randomUUID()}`);
  const ids=['Mine','Theirs','Everyone'].map(title=>createTask({title}));
  const cookies={get:()=>String(owner)};
  const view=(profile=String(owner))=>(load as any)({cookies,url:new URL(`http://localhost/calendar?view=week&date=2026-10-20&profile=${profile}`)});
  const submit=(fields:Record<string,string>)=>(actions.schedule as any)({cookies,request:new Request('http://localhost/calendar?/schedule',{method:'POST',body:new URLSearchParams({profileId:String(owner),taskId:String(ids[0]),startDate:'2026-10-20',assigneeId:String(owner),...fields})})});
  try{
    await expect(submit({})).resolves.toMatchObject({success:true});scheduleTask(ids[1],'2026-10-20',other);scheduleTask(ids[2],'2026-10-20',null);
    expect(view().tasks.map((t:any)=>t.id).sort()).toEqual([ids[0],ids[2]]);
    expect(view(String(other)).tasks.map((t:any)=>t.id).sort()).toEqual([ids[1],ids[2]]);
    expect(view('all').tasks.map((t:any)=>t.id).sort()).toEqual(ids);
    for(const fields of [{startDate:'2026-02-30'},{assigneeId:'bad'},{profileId:String(other)}] as Record<string,string>[])await expect(submit(fields)).resolves.toMatchObject({status:400});
    await expect(submit({assigneeId:'everyone',startDate:'2026-10-21'})).resolves.toMatchObject({success:true});
    expect(getTask(ids[0])).toMatchObject({start_date:'2026-10-21',assignee_id:null});
  }finally{for(const id of ids)database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(id);database.sqlite.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(owner,other);}
});

test('current snapshots round-trip schedules, hides and completion history; old snapshots are rejected',()=>{
  const db=fresh();const id=createTask({title:'Saved'},db);scheduleTask(id,'2026-10-20',null,db);removeFromPlan(id,'2026-10-20',db);
  const snapshot=exportData(db);expect(snapshot.version).toBe(4);unscheduleTask(id,db);importData(snapshot,db);
  expect(getNow('2026-10-20',db)).toEqual([]);expect(getNow('2026-10-21',db).map(t=>t.id)).toEqual([id]);
  expect(()=>importData({...snapshot,version:2},db)).toThrow();
});

test('one-time migration retains active/future work and completed history, removes Review, and backs up before changing disk',()=>{
  const directory=mkdtempSync(join(tmpdir(),'anii-calendar-migration-'));directories.push(directory);const path=join(directory,'life.db');
  const old=createDatabase(path);const db=old.sqlite;
  const other=createProfile('Other',db);const active=createTask({title:'Active'},db),future=createTask({title:'Future'},db),abandoned=createTask({title:'Old plan only'},db),done=createTask({title:'Done'},db);
  db.exec(`DROP TABLE task_schedules; DROP TABLE task_day_hides; DROP TABLE task_placements;
    CREATE TABLE daily_plans(profile_id INTEGER,plan_date TEXT,task_id INTEGER,section TEXT,position INTEGER,review_outcome TEXT);
    CREATE TABLE profile_days(profile_id INTEGER PRIMARY KEY,active_date TEXT);
    CREATE TABLE reviews(id INTEGER PRIMARY KEY,review_date TEXT);
    CREATE TABLE review_sessions(id INTEGER PRIMARY KEY,review_date TEXT);`);
  db.prepare('INSERT INTO profile_days VALUES(?,?)').run(1,'2026-10-20');db.prepare('INSERT INTO profile_days VALUES(?,?)').run(other,'2026-10-20');
  const plan=db.prepare('INSERT INTO daily_plans(profile_id,plan_date,task_id,section,position) VALUES(?,?,?,?,?)');
  plan.run(1,'2026-10-20',active,'focus',0);plan.run(other,'2026-10-20',active,'also',0);plan.run(1,'2026-10-25',future,'also',0);plan.run(1,'2026-10-19',abandoned,'also',0);
  db.prepare("UPDATE tasks SET state='completed',completed_at='2026-10-19 12:00:00' WHERE id=?").run(done);db.prepare("INSERT INTO task_completions(profile_id,day_date,task_id) VALUES(1,'2026-10-19',?)").run(done);db.close();
  const migrated=createDatabase(path);opened.push(migrated);
  expect(getTask(active,migrated.sqlite)).toMatchObject({start_date:'2026-10-20',assignee_id:null});
  expect(getTask(future,migrated.sqlite)).toMatchObject({start_date:'2026-10-25',assignee_id:1});expect(getTask(abandoned,migrated.sqlite)?.start_date).toBeNull();
  expect(getCompletedNow('2026-10-19',migrated.sqlite).map(t=>t.id)).toEqual([done]);
  expect(migrated.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name IN ('reviews','review_sessions','profile_days')").all()).toEqual([]);
  expect(readdirSync(join(directory,'backups')).filter(name=>name.startsWith('life-before-calendar-'))).toHaveLength(1);
  const before=exportData(migrated.sqlite).tables;migrated.sqlite.close();const reopened=createDatabase(path);opened.push(reopened);expect(exportData(reopened.sqlite).tables).toEqual(before);
});

test('calendar ranges handle leap months and year boundaries without shifting dates',()=>{
  expect(calendarRange('2024-02-29','month').days).toContain('2024-02-29');
  expect(calendarRange('2026-01-01','week')).toMatchObject({rangeStart:'2025-12-29',rangeEnd:'2026-01-04'});
  expect(shiftDate('2026-03-08',1)).toBe('2026-03-09');
});
