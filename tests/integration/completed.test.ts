import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { actions, load } from '../../src/routes/completed/+page.server';
import { database } from '../../src/lib/server/db';
import { createProfile, createProject, createTask, getTask, setTaskState } from '../../src/lib/server/repository';

const profiles:number[]=[];const tasks:number[]=[];const projects:number[]=[];
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,7,6,12));});
afterEach(()=>{
  vi.useRealTimers();
  for(const id of profiles.splice(0))database.sqlite.prepare('DELETE FROM profiles WHERE id=?').run(id);
  for(const id of tasks.splice(0))database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(id);
  for(const id of projects.splice(0))database.sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
});
function profile(){const id=createProfile(`Completed ${crypto.randomUUID()}`);profiles.push(id);return id;}
function task(title:string,details='',projectId?:number){const id=createTask({title,details,projectIds:projectId?[projectId]:[]});tasks.push(id);return id;}
const cookies=(id:number)=>({get:()=>String(id)});
function view(profileId:number,query=''){return (load as any)({cookies:cookies(profileId),url:new URL(`http://localhost/completed${query}`)});}

test('Completed defaults to the current calendar date, validates dates and isolates profiles',()=>{
  const owner=profile(),other=profile();const prior=task('Prior'),current=task('Current'),privateTask=task('Other profile');
  setTaskState(prior,'completed',undefined,owner,'2026-08-05');setTaskState(current,'completed',undefined,owner,'2026-08-06');setTaskState(privateTask,'completed',undefined,other,'2026-08-06');
  expect(view(owner)).toMatchObject({mode:'day',date:'2026-08-06',activeDate:'2026-08-06',previousDate:'2026-08-05',nextDate:'2026-08-07',tasks:[{id:current}]});
  expect(view(owner,'?date=2026-08-05').tasks.map((item:any)=>item.id)).toEqual([prior]);
  expect(view(other,'?mode=all').tasks.map((item:any)=>item.id)).toEqual([privateTask]);
  for(const date of ['2026-02-30','2025-02-29','2026-13-01','08-06-2026','0000-01-01','bad',''])expect(()=>view(owner,`?date=${date}`)).toThrow();
  expect(view(owner,'?date=2024-02-29')).toMatchObject({previousDate:'2024-02-28',nextDate:'2024-03-01'});
  expect(view(owner,'?date=0001-01-01').previousDate).toBeNull();expect(view(owner,'?date=9999-12-31').nextDate).toBeNull();
});

test('all-days search matches title or notes and combines project filtering',()=>{
  const owner=profile();const project=createProject(`Completed project ${crypto.randomUUID()}`);projects.push(project);
  const title=task('Launch report','',project),notes=task('Retrospective','Launch lessons',project),unrelated=task('Launch elsewhere'),unfinished=task('Launch draft','',project);
  setTaskState(title,'completed',undefined,owner,'2026-08-05');setTaskState(notes,'completed',undefined,owner,'2026-08-06');setTaskState(unrelated,'completed',undefined,owner,'2026-08-06');
  const filtered=view(owner,`?mode=all&q=Launch&project=${project}&date=2026-08-06`);
  expect(filtered.tasks.map((item:any)=>item.id)).toEqual([notes,title]);
  expect(filtered.tasks.map((item:any)=>item.completion_day)).toEqual(['2026-08-06','2026-08-05']);
  expect(filtered.allTasks.some((item:any)=>item.id===unfinished)).toBe(true);
  expect(view(owner,'?mode=all&q=no-match').tasks).toEqual([]);
  expect(()=>view(owner,'?mode=all&project=invalid')).toThrow();
});

test('editing and reopening a completed task preserve filters and guard the active day',async()=>{
  const owner=profile();const id=task('Finished');setTaskState(id,'completed',undefined,owner,'2026-08-05');
  const query='mode=all&q=Finished&date=2026-08-05';
  const submit=(name:'edit'|'state',fields:Record<string,string>)=>{
    const body=new FormData();for(const [key,value] of Object.entries({id:String(id),profileId:String(owner),...fields}))body.set(key,value);
    return (actions[name] as any)({cookies:cookies(owner),request:new Request(`http://localhost/completed?/${name}&${query}`,{method:'POST',headers:{accept:'text/html'},body})});
  };
  await expect(submit('edit',{title:'Finished revised',details:'Notes',duration:'',dueAt:''})).rejects.toMatchObject({status:303,location:`/completed?${query}`});
  expect(getTask(id)?.title).toBe('Finished revised');
  await expect(submit('state',{state:'open',planDate:'2026-08-05'})).resolves.toMatchObject({status:400});expect(getTask(id)?.state).toBe('completed');
  await expect(submit('state',{state:'open',planDate:'2026-08-06'})).rejects.toMatchObject({status:303,location:`/completed?${query}`});
  expect(getTask(id)?.state).toBe('open');expect(view(owner,'?mode=all').tasks).toEqual([]);
});
