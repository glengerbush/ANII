import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createDatabase} from '../../src/lib/server/db';
import {Planning} from '../../src/lib/server/planning';
import {createTask,createProfile,exportData,importData,getTask} from '../../src/lib/server/repository';

let db:ReturnType<typeof createDatabase>['sqlite'];
let planning:Planning;
const day='2026-10-20';
const ids=(items:{taskId:number}[])=>items.map(t=>t.taskId);
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(`${day}T12:00:00Z`));db=createDatabase(':memory:').sqlite;planning=new Planning(db);});
afterEach(()=>{db.close();vi.useRealTimers();});
const tasks=(...names:string[])=>names.map(title=>createTask({title},db));

test('queue and unqueue promote into the correct group independently per profile',()=>{
  const [a,b,c]=tasks('A','B','C');const other=createProfile('Other',db);
  expect(ids(planning.view(1).backlog)).toEqual([c,b,a]);
  planning.queue(1,a);planning.queue(1,c);
  expect(ids(planning.view(1).backlog)).toEqual([a,c,b]);
  expect(planning.view(1).backlog.map(t=>t.queued)).toEqual([true,true,false]);
  expect(ids(planning.view(other).backlog)).toEqual([c,b,a]);
  planning.hide(1,a);expect(ids(planning.view(1).backlog)).toEqual([c,a,b]);
  planning.queue(1,a);expect(ids(planning.view(1).now)).toEqual([c,a]);
});

test('Backlog and Now share Queue order while Focus order is independent',()=>{
  const [a,b,c,d]=tasks('A','B','C','D');
  [a,b,c,d].forEach(id=>planning.queue(1,id));planning.moveNow(1,a,'focus',0);planning.moveNow(1,b,'focus',1);
  planning.moveBacklog(1,b,a,'before','queued');planning.moveBacklog(1,d,c,'before','queued');
  expect(ids(planning.view(1).backlog)).toEqual([b,a,d,c]);
  expect(ids(planning.view(1).now)).toEqual([a,b,d,c]);
  planning.moveNow(1,c,'also',0);expect(ids(planning.view(1).backlog)).toEqual([b,a,c,d]);
  planning.moveNow(1,b,'focus',0);expect(ids(planning.view(1).backlog)).toEqual([b,a,c,d]);
  expect(ids(planning.view(1).now)).toEqual([b,a,c,d]);
});

test('anchor moves retain relative order of filtered-out tasks and reject crossing groups',()=>{
  const [a,b,c,d]=tasks('A','B','C','D');[a,b,c,d].forEach(id=>planning.queue(1,id));
  // A and D are visible in a filter; B and C are not.
  planning.moveBacklog(1,d,a,'before','queued');expect(ids(planning.view(1).now)).toEqual([d,a,b,c]);
  planning.hide(1,b);expect(()=>planning.moveBacklog(1,a,b,'before','queued')).toThrow(/queue changed/i);
  expect(ids(planning.view(1).now)).toEqual([d,a,c]);
});

test('unchanged Schedule and repeated queue commands preserve Focus, hides, and order',()=>{
  const [a,b]=tasks('A','B');const other=createProfile('Other',db);
  planning.schedule(a,{startDate:day,assigneeId:null});planning.queue(1,a,{section:'focus'});planning.queue(1,b);
  planning.hide(other,a);
  planning.schedule(a,{startDate:day,assigneeId:null});planning.queue(1,a);
  expect(planning.view(1).now).toMatchObject([{taskId:a,section:'focus'},{taskId:b,section:'also'}]);
  expect(planning.view(other).now).toEqual([]);
});

test('first-day hide preserves Focus preference, returns next day, and appends new arrivals',()=>{
  const [a,b,c]=tasks('A','B','C');planning.queue(1,a,{section:'focus'});planning.queue(1,b);
  planning.hide(1,a);planning.schedule(c,{startDate:'2026-10-21',assigneeId:1});
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  expect(planning.view(1).now).toMatchObject([{taskId:a,section:'focus'},{taskId:b,section:'also'},{taskId:c,section:'also'}]);
  expect(ids(planning.view(1).backlog)).toEqual([b,a,c]);
});

test('reopen never consults historical Focus and respects current capacity',()=>{
  const [a,b,c,d]=tasks('A','B','C','D');[a,b,c].forEach(id=>planning.queue(1,id,{section:'focus'}));
  planning.setState(a,'completed',1);planning.queue(1,d,{section:'focus'});
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  for(const id of [b,c,d])planning.moveNow(1,id,'also',0);
  expect(()=>planning.setState(a,'open',1)).not.toThrow();
  expect(planning.view(1).now.find(t=>t.taskId===a)?.section).toBe('focus');
  planning.setState(a,'completed',1);[b,c,d].forEach(id=>planning.moveNow(1,id,'focus',0));
  planning.setState(a,'open',1);
  expect(planning.view(1).now.filter(t=>t.section==='focus')).toHaveLength(3);
  expect(planning.view(1).now.find(t=>t.taskId===a)?.section).toBe('also');
});

test('valid snapshots round-trip after rotating completed Focus tasks',()=>{
  const [a,b,c,d]=tasks('A','B','C','D');[a,b,c].forEach(id=>planning.queue(1,id,{section:'focus'}));
  planning.setState(a,'completed',1);planning.queue(1,d,{section:'focus'});planning.setState(d,'completed',1);planning.setState(a,'open',1);
  const before=planning.view(1);const snapshot=exportData(db);
  expect(()=>importData(snapshot,db)).not.toThrow();expect(planning.view(1)).toEqual(before);
  expect(getTask(d,db)?.state).toBe('completed');
});

test('commands establish placement themselves and failed Focus commands roll back schedules',()=>{
  const [a,b,c,d]=tasks('A','B','C','D');
  [a,b,c].forEach(id=>planning.queue(1,id,{section:'focus'}));
  expect(()=>planning.queue(1,d,{section:'focus'})).toThrow(/three/);
  expect(getTask(d,db)?.start_date).toBeNull();
  planning.schedule(d,{startDate:day,assigneeId:1});
  planning.moveNow(1,d,'also',0);expect(ids(planning.view(1).now)).toEqual([a,b,c,d]);
});

test('the calendar preview migrates placement once and removes historical Focus constraints',async()=>{
  const {mkdtempSync,rmSync,readdirSync}=await import('node:fs');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
  const dir=mkdtempSync(join(tmpdir(),'anii-placement-'));const path=join(dir,'life.db');
  let disk:ReturnType<typeof createDatabase>|undefined;
  try{
    disk=createDatabase(path);const old=disk.sqlite;const [a,b,c,d]=['A','B','C','D'].map(title=>createTask({title},old));
    old.exec(`DROP TABLE task_placements;
      CREATE TABLE daily_plans(profile_id INTEGER,plan_date TEXT,task_id INTEGER,section TEXT,position INTEGER);
      CREATE TRIGGER focus_capacity_task_reopen BEFORE UPDATE OF state ON tasks WHEN NEW.state='open'
      BEGIN SELECT RAISE(ABORT,'Old historical capacity check'); END;`);
    for(const [index,id] of [a,b,c,d].entries()){
      old.prepare('INSERT INTO daily_plans VALUES(?,?,?,?,?)').run(1,day,id,'focus',index);
      old.prepare('INSERT INTO task_schedules VALUES(?,?,?)').run(id,day,1);
    }
    old.prepare("UPDATE tasks SET state='completed' WHERE id=?").run(d);old.close();
    disk=createDatabase(path);const module=new Planning(disk.sqlite);
    expect(ids(module.view(1).now)).toEqual([a,b,c]);
    expect(()=>module.setState(d,'open',1)).not.toThrow();
    expect(module.view(1).now.find(t=>t.taskId===d)?.section).toBe('also');
    expect(disk.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name IN ('daily_plans','focus_capacity_task_reopen')").all()).toEqual([]);
    expect(readdirSync(join(dir,'backups')).filter(name=>name.startsWith('life-before-calendar-'))).toHaveLength(1);
    const snapshot=exportData(disk.sqlite);expect(()=>importData(snapshot,disk!.sqlite)).not.toThrow();
    const before=module.view(1);disk.sqlite.close();disk=createDatabase(path);expect(new Planning(disk.sqlite).view(1)).toEqual(before);
    expect(readdirSync(join(dir,'backups')).filter(name=>name.startsWith('life-before-calendar-'))).toHaveLength(1);
  }finally{if(disk?.sqlite.open)disk.sqlite.close();rmSync(dir,{recursive:true,force:true});}
});
