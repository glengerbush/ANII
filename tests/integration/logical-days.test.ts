import {afterEach,describe,expect,test,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {createDatabase,database} from '../../src/lib/server/db';
import {restoreDatabaseBytes} from '../../src/lib/server/database-restore';
import {actions as todayActions} from '../../src/routes/today/+page.server';
import {actions as reviewActions,load as reviewLoad} from '../../src/routes/review/+page.server';
import {addToPlan,assertActiveDay,buildSanityContext,closeOutToday,completeReviewFocus,createAndPlan,createProfile,createTask,deterministicWarnings,editReviewPlan,exportData,getActiveDay,getCompletedHistory,getCompletedToday,getCurrentReviewSession,getToday,importData,planReviewTomorrow,setTaskState} from '../../src/lib/server/repository';

const opened:ReturnType<typeof createDatabase>[]=[];const dirs:string[]=[];
function fresh(path=':memory:'){const db=createDatabase(path);opened.push(db);return db.sqlite;}
function clock(date:string){vi.useFakeTimers();vi.setSystemTime(new Date(`${date}T12:00:00`));}
afterEach(()=>{vi.useRealTimers();for(const db of opened.splice(0))if(db.sqlite.open)db.sqlite.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const first='2026-08-05',next='2026-08-06';

describe('logical user days',()=>{
  test('midnight and weeks passing preserve current day, unfinished plan, and review',()=>{
    clock(first);const db=fresh();const id=createAndPlan('Persistent day',undefined,db);expect(getActiveDay(db)).toBe(first);
    clock('2026-08-20');expect(getActiveDay(db)).toBe(first);expect(getToday(undefined,db).map(task=>task.id)).toEqual([id]);
    expect(getCurrentReviewSession(undefined,db)).toMatchObject({stage:'close',reviewDate:first});
    closeOutToday([{taskId:id,outcome:'tomorrow'}],undefined,db);clock('2026-09-01');expect(getCurrentReviewSession(undefined,db)).toMatchObject({stage:'plan',reviewDate:first,tomorrowDate:next});
  });
  test('finished review immediately activates next plan without advancing other profiles',()=>{
    clock(first);const db=fresh();const other=createProfile('Other',db);const id=createAndPlan('Carry',undefined,db);expect(getActiveDay(db,other)).toBe(first);
    closeOutToday([{taskId:id,outcome:'tomorrow'}],undefined,db);planReviewTomorrow([id],undefined,db);expect(getActiveDay(db)).toBe(first);
    completeReviewFocus([id],undefined,db);expect(getActiveDay(db)).toBe(next);expect(getToday(undefined,db)).toMatchObject([{id,section:'focus'}]);expect(getActiveDay(db,other)).toBe(first);
    expect(getCurrentReviewSession(undefined,db)).toMatchObject({stage:'close',reviewDate:next});expect(()=>assertActiveDay(first,db)).toThrow(/day changed/);
  });
  test('correcting last review changes the current plan without advancing twice or rolling back',()=>{
    clock(first);const db=fresh();const id=createAndPlan('Original',undefined,db);closeOutToday([{taskId:id,outcome:'tomorrow'}],first,db);planReviewTomorrow([id],first,db);completeReviewFocus([id],first,db);
    editReviewPlan(first,undefined,db);expect(getActiveDay(db)).toBe(next);expect(getCurrentReviewSession(undefined,db)).toMatchObject({stage:'plan',reviewDate:first});
    planReviewTomorrow([id],first,db);completeReviewFocus([],first,db);expect(getActiveDay(db)).toBe(next);expect(getToday(undefined,db)[0].section).toBe('also');
    closeOutToday([{taskId:id,outcome:'backlog'}],next,db);planReviewTomorrow([],next,db);completeReviewFocus([],next,db);expect(()=>editReviewPlan(first,undefined,db)).toThrow(/earlier day/);
  });
  test('tasks added during review and legacy Keep Today cannot be stranded',()=>{
    clock(first);const db=fresh();const id=createAndPlan('Legacy keep',undefined,db);closeOutToday([{taskId:id,outcome:'today'}],first,db);planReviewTomorrow([id],first,db);
    const late=createAndPlan('Added during review',undefined,db);completeReviewFocus([id],first,db);expect(getToday(undefined,db).map(task=>task.id)).toEqual([id,late]);
  });
  test('completions belong to completion day, including shared profiles, never prior plan membership',()=>{
    clock(first);const db=fresh();const other=createProfile('Other',db);getActiveDay(db,other);const finished=createAndPlan('Finished',undefined,db);const carried=createAndPlan('Carried',undefined,db);addToPlan(carried,first,'also',db,other);
    setTaskState(finished,'completed',db);expect(getCompletedToday(undefined,db).map(task=>task.id)).toEqual([finished]);
    closeOutToday([{taskId:carried,outcome:'tomorrow'}],first,db);planReviewTomorrow([carried],first,db);completeReviewFocus([],first,db);expect(getCompletedToday(undefined,db)).toEqual([]);
    clock('2026-08-20');setTaskState(finished,'completed',db);expect(getCompletedToday(first,db).map(task=>task.id)).toEqual([finished]);expect(getCompletedToday(next,db)).toEqual([]);setTaskState(carried,'completed',db);
    expect(getCompletedToday(next,db).map(task=>task.id)).toEqual([carried]);expect(getCompletedToday(first,db).map(task=>task.id)).toEqual([finished]);expect(getCompletedToday(first,db,other).map(task=>task.id)).toEqual([carried]);
    expect(getCompletedHistory({q:'Carried'},db)).toMatchObject([{id:carried,completion_day:next}]);
    setTaskState(carried,'open',db);expect(getCompletedToday(next,db)).toEqual([]);expect(getCompletedToday(first,db,other)).toEqual([]);setTaskState(carried,'completed',db);expect(getCompletedToday(next,db).map(task=>task.id)).toEqual([carried]);
  });
  test('deadline checks use actual calendar date while checking the logical plan',()=>{
    clock(first);const db=fresh();const id=createTask({title:'Overdue',dueAt:'2026-08-10'},db);addToPlan(id,undefined,'also',db);getActiveDay(db);
    clock('2026-08-20');const date=getActiveDay(db);expect(deterministicWarnings(date,db,1,'2026-08-20')).toMatchObject([{kind:'overdue',taskId:id}]);
    expect(buildSanityContext(date,db,1,'2026-08-20')).toMatchObject({date:first,calendarDate:'2026-08-20',tasks:[{id}]});
  });
  test('JSON roundtrip retains logical days and completion associations; legacy snapshots import',()=>{
    clock(first);const db=fresh();const id=createAndPlan('JSON complete',undefined,db);setTaskState(id,'completed',db);closeOutToday([],first,db);planReviewTomorrow([],first,db);completeReviewFocus([],first,db);
    const snapshot=exportData(db);const restored=fresh();importData(snapshot,restored);expect(getActiveDay(restored)).toBe(next);expect(getCompletedHistory({date:first},restored).map(task=>task.id)).toEqual([id]);
    const legacy=structuredClone(snapshot);delete legacy.tables.profile_days;delete legacy.tables.task_completions;importData(legacy,restored);expect(getActiveDay(restored)).toBe(next);expect(getCompletedHistory({},restored).map(task=>task.id)).toEqual([id]);
  });
  test('old SQLite backups restore and attribute historic completion by timestamp, not plan date',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'anii-days-'));dirs.push(dir);const sourcePath=join(dir,'old.db');const source=new Database(sourcePath);
    for(const migration of ['0000_initial','0001_profiles','0002_review_sessions','0003_task_projects','0004_deadline_estimates'])source.exec(readFileSync(`drizzle/${migration}.sql`,'utf8'));
    source.exec(`INSERT INTO tasks(id,title,state,completed_at) VALUES(1,'Old finished','completed','2026-08-06 12:00:00');INSERT INTO daily_plans(profile_id,plan_date,task_id,section,position) VALUES(1,'2026-08-05',1,'also',0);`);source.close();
    const live=createDatabase(join(dir,'live.db'));opened.push(live);await restoreDatabaseBytes(readFileSync(sourcePath),{liveDatabase:live,livePath:live.sqlite.name});
    expect(getCompletedToday(first,live.sqlite)).toEqual([]);expect(getCompletedToday(next,live.sqlite)).toMatchObject([{id:1}]);
  });
  test('route mutations reject stale day forms and review completion renders summary of just-closed day',async()=>{
    clock(first);const profile=createProfile(`Day route ${crypto.randomUUID()}`);const cookies={get:()=>String(profile)};const id=createAndPlan('Route',undefined,undefined,profile);
    closeOutToday([{taskId:id,outcome:'tomorrow'}],first,undefined,profile);planReviewTomorrow([id],first,undefined,profile);
    const event=(fields:Record<string,string>)=>({cookies,request:new Request('http://localhost/review',{method:'POST',headers:{accept:'application/json'},body:new URLSearchParams({profileId:String(profile),...fields})})} as any);
    await expect(reviewActions.focusTomorrow(event({reviewDate:first}))).rejects.toMatchObject({status:303,location:`/review?completed=${first}`});
    expect(reviewLoad({cookies,url:new URL(`http://localhost/review?completed=${first}`)} as any)).toMatchObject({step:'done',activeDate:next});
    expect(await todayActions.quickAdd(event({title:'Stale',planDate:first}))).toMatchObject({status:400});expect(await todayActions.move(event({id:String(id),section:'focus',position:'0',planDate:first}))).toMatchObject({status:400});
    expect(getToday(undefined,undefined,profile).map(task=>task.id)).toEqual([id]);database.sqlite.prepare('DELETE FROM profiles WHERE id=?').run(profile);database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(id);
  });
});
