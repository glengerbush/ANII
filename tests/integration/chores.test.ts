import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../src/lib/server/db';
import { Chores } from '../../src/lib/server/chores';
import { restoreDatabaseBytes } from '../../src/lib/server/database-restore';
import { createProfile, createTask, deleteProfile, exportData, importData } from '../../src/lib/server/repository';
import { occurrenceDates, nextChoreDate, choreRuleSchema, type ChoreRule } from '../../src/lib/domain/chores';
const databases:ReturnType<typeof createDatabase>[]=[];
const fresh=()=>{const db=createDatabase(':memory:');databases.push(db);return db.sqlite;};
afterEach(()=>databases.splice(0).forEach(db=>db.sqlite.close()));
const rule=(extra:Partial<ChoreRule>={}):ChoreRule=>({startDate:'2026-10-01',frequency:'daily',interval:1,weekdays:[],monthDays:[],months:[],...extra});
const input=(extra:Partial<ChoreRule>={},assigneeIds:number[]=[1])=>({title:'Dishes',notes:'Kitchen',rule:rule(extra),assigneeIds});
const dates=(extra:Partial<ChoreRule>,end:string)=>[...occurrenceDates(rule(extra),extra.startDate??'2026-10-01',end)];

test('daily interval and weekday/month filters use calendar dates across DST',()=>{
  expect(dates({startDate:'2026-10-30',interval:2},'2026-11-05')).toEqual(['2026-10-30','2026-11-01','2026-11-03','2026-11-05']);
  expect(dates({startDate:'2026-10-28',weekdays:[1,3,5],months:[11]},'2026-11-07')).toEqual(['2026-11-02','2026-11-04','2026-11-06']);
});
test('fortnightly schedules anchor Monday weeks and support multiple weekdays',()=>{
  expect(dates({startDate:'2026-10-07',frequency:'weekly',interval:2,weekdays:[1,5]},'2026-10-23')).toEqual(['2026-10-09','2026-10-19','2026-10-23']);
});
test('month ends, semimonthly, quarterly and leap years are explicit',()=>{
  expect(dates({startDate:'2026-01-31',frequency:'monthly'},'2026-04-30')).toEqual(['2026-01-31','2026-03-31']);
  expect(dates({startDate:'2026-01-31',frequency:'monthly',monthDays:[-1,31]},'2026-04-30')).toEqual(['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
  expect(dates({startDate:'2026-01-01',frequency:'monthly',monthDays:[1,15]},'2026-02-16')).toEqual(['2026-01-01','2026-01-15','2026-02-01','2026-02-15']);
  expect(dates({startDate:'2026-01-01',frequency:'monthly',interval:3},'2026-12-31')).toEqual(['2026-01-01','2026-04-01','2026-07-01','2026-10-01']);
  expect(dates({startDate:'2024-02-29',frequency:'yearly'},'2028-03-01')).toEqual(['2024-02-29','2028-02-29']);
  expect(dates({startDate:'2026-01-01',frequency:'yearly',months:[3,9],monthDays:[15]},'2027-09-30')).toEqual(['2026-03-15','2026-09-15','2027-03-15','2027-09-15']);
  expect(nextChoreDate(rule({startDate:'2026-02-01',frequency:'yearly',monthDays:[30]}),'2026-02-01')).toBeNull();
  expect(nextChoreDate(rule({startDate:'2000-01-01',frequency:'yearly',interval:999,weekdays:[3]}),'2000-01-01')).toBe('9992-01-01');
  expect(nextChoreDate(rule({startDate:'3500-01-01'}),'2026-01-01')).toBe('3500-01-01');
});
test('invalid intervals, dates and duplicate selectors are rejected',()=>{
  for(const extra of [{interval:0},{interval:1.2},{startDate:'2026-02-30'},{weekdays:[7]},{months:[1,1]},{monthDays:[0]}])expect(()=>choreRuleSchema.parse(rule(extra))).toThrow();
});
test('one outstanding chore accrues dates, keeps its owner, and rotates only on completion',()=>{
  const db=fresh(),other=createProfile('Partner',db),chores=new Chores(db);
  chores.create(input({},[1,other]),'2026-10-01');
  const [due]=chores.due(1,'2026-10-03');expect(due).toMatchObject({due_date:'2026-10-01',last_due_date:'2026-10-03',occurrence_count:3,assignee_id:1});
  expect(chores.due(other,'2026-10-03')).toEqual([]);expect(chores.due(1,'2026-10-03')).toEqual([due]);
  chores.complete(due.id,due.revision,true,1,'2026-10-03');expect(chores.due(1,'2026-10-03')).toEqual([]);
  expect(chores.view('2026-10-03').completedChores[0]).toMatchObject({occurrence_count:3,completed_by:1});
  expect(chores.due(other,'2026-10-04')[0]).toMatchObject({occurrence_count:1,assignee_id:other,due_date:'2026-10-04'});
  expect(chores.due(other,'2026-10-06')[0]).toMatchObject({occurrence_count:3,assignee_id:other});
  expect(()=>chores.complete(due.id,due.revision,true,1,'2026-10-06')).toThrow(/changed/);
});
test('reassignment moves the accrued chore immediately and stale actions cannot complete it',()=>{
  const db=fresh(),other=createProfile('Partner',db),chores=new Chores(db);chores.create(input({},[1,other]),'2026-10-03');
  const due=chores.due(1,'2026-10-03')[0];chores.assign(due.id,due.revision,other,1,'2026-10-03');
  expect(chores.due(1,'2026-10-03')).toEqual([]);const assigned=chores.due(other,'2026-10-03')[0];expect(assigned.occurrence_count).toBe(3);
  expect(()=>chores.complete(due.id,due.revision,true,1,'2026-10-03')).toThrow(/changed/);
  chores.complete(assigned.id,assigned.revision,true,other,'2026-10-03');expect(chores.due(other,'2026-10-04')).toHaveLength(1);
});
test('Everyone is shared; deleted assignees do not lose overdue chores',()=>{
  const db=fresh(),other=createProfile('Partner',db),chores=new Chores(db);chores.create(input({},[]),'2026-10-01');
  expect(chores.due(1,'2026-10-01')[0].id).toBe(chores.due(other,'2026-10-01')[0].id);
  const id=chores.create({...input({},[other]),title:'Laundry'},'2026-10-01');deleteProfile(other,'Partner',db);
  expect(chores.due(1,'2026-10-02').find(row=>row.chore_id===id)).toMatchObject({assignee_id:null,occurrence_count:2});
});
test('pause preserves outstanding work; resume skips paused dates and cannot double-count today',()=>{
  const db=fresh(),chores=new Chores(db),id=chores.create(input(),'2026-10-01');
  chores.setActive(id,0,false,'2026-10-02');expect(chores.due(1,'2026-10-20')[0].occurrence_count).toBe(2);
  chores.setActive(id,1,true,'2026-10-20');expect(chores.due(1,'2026-10-20')[0].occurrence_count).toBe(3);
  chores.setActive(id,2,true,'2026-10-20');expect(chores.due(1,'2026-10-20')[0].occurrence_count).toBe(3);
});
test('schedule edits preserve due work and apply future recurrence without duplication',()=>{
  const db=fresh(),chores=new Chores(db),other=createProfile('Partner',db),id=chores.create(input(),'2026-10-01');
  chores.edit(id,0,input({frequency:'monthly',monthDays:[1]},[other]),'2026-10-03');
  expect(chores.due(1,'2026-10-31')[0]).toMatchObject({occurrence_count:3,assignee_id:1});
  const due=chores.due(1,'2026-10-31')[0];chores.complete(due.id,due.revision,true,1,'2026-10-31');
  expect(chores.due(other,'2026-11-01')[0]).toMatchObject({due_date:'2026-11-01',occurrence_count:1,assignee_id:other});
  expect(()=>chores.edit(id,0,input(),'2026-11-01')).toThrow(/changed/);
});
test('undo restores count and turn, but refuses undo after the next occurrence exists',()=>{
  const db=fresh(),chores=new Chores(db),other=createProfile('Partner',db);chores.create(input({},[1,other]),'2026-10-01');
  let due=chores.due(1,'2026-10-01')[0];chores.complete(due.id,due.revision,true,1,'2026-10-01');
  let done=chores.view('2026-10-01').completedChores[0];chores.complete(done.id,done.revision,false,1,'2026-10-01');
  due=chores.due(1,'2026-10-01')[0];chores.complete(due.id,due.revision,true,1,'2026-10-01');
  done=chores.view('2026-10-01').completedChores[0];expect(chores.due(other,'2026-10-02')).toHaveLength(1);
  expect(()=>chores.complete(done.id,done.revision,false,1,'2026-10-02')).toThrow(/newer occurrence/);
});
test('exports preserve recurrence/count/rotation and old JSON backups import with empty chores',()=>{
  const db=fresh(),chores=new Chores(db);createTask({title:'Existing task'},db);chores.create(input(),'2026-10-03');
  const snapshot=exportData(db),other=fresh();importData(snapshot,other);
  expect(new Chores(other).due(1,'2026-10-03')[0]).toMatchObject({occurrence_count:3,due_date:'2026-10-01'});
  const old=structuredClone(snapshot);for(const key of ['chores','chore_assignees','chore_occurrences'])delete old.tables[key];
  importData(old,other);expect(new Chores(other).view('2026-10-03').chores).toEqual([]);expect(exportData(other).tables.tasks).toEqual(snapshot.tables.tasks);
});
test('additive migration keeps existing tasks and can be reopened without changing counts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'anii-chores-')),path=join(dir,'life.db');let db=createDatabase(path);
  try{
    createTask({title:'Keep me'},db.sqlite);db.sqlite.exec('DROP TABLE chore_occurrences; DROP TABLE chore_assignees; DROP TABLE chores');db.sqlite.close();
    db=createDatabase(path);expect(db.sqlite.prepare('SELECT title FROM tasks').all()).toEqual([{title:'Keep me'}]);
    new Chores(db.sqlite).create(input(),'2026-10-03');db.sqlite.close();db=createDatabase(path);
    expect(new Chores(db.sqlite).due(1,'2026-10-03')[0].occurrence_count).toBe(3);
  }finally{db.sqlite.close();rmSync(dir,{recursive:true,force:true});}
});
test('SQLite backups made before chores still restore safely',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'anii-chores-restore-')),livePath=join(dir,'live.db'),upload=join(dir,'old.db');
  const live=createDatabase(livePath),source=createDatabase(':memory:');
  try{
    createTask({title:'Old backup task'},source.sqlite);source.sqlite.exec('DROP TABLE chore_occurrences; DROP TABLE chore_assignees; DROP TABLE chores');
    await source.sqlite.backup(upload);new Chores(live.sqlite).create(input(),'2026-10-03');
    await restoreDatabaseBytes(readFileSync(upload),{liveDatabase:live,livePath});
    expect(live.sqlite.prepare('SELECT title FROM tasks').all()).toEqual([{title:'Old backup task'}]);
    expect(new Chores(live.sqlite).view('2026-10-03').chores).toEqual([]);
  }finally{live.sqlite.close();source.sqlite.close();rmSync(dir,{recursive:true,force:true});}
});
