import { expect, test } from 'vitest';
import { actions, load } from '../../src/routes/backlog/+page.server';
import { database } from '../../src/lib/server/db';
import { addToPlan, createProfile, createTask, getToday, setTaskState } from '../../src/lib/server/repository';

test('backlog adds one task to the selected profile without moving existing Focus',async()=>{
  const profile=createProfile(`Backlog ${crypto.randomUUID()}`);
  const otherProfile=createProfile(`Other ${crypto.randomUUID()}`);
  const focus=createTask({title:'Keep this Focus'});
  const task=createTask({title:'Add this task'});
  const cookies={get:()=>String(profile)};
  const submit=(id:number)=>{
    const body=new FormData();body.set('taskId',String(id));body.set('profileId',String(profile));
    return (actions.plan as any)({cookies,request:new Request('http://localhost/backlog?/plan&q=Add',{method:'POST',body})});
  };
  try{
    addToPlan(focus,undefined,'focus',undefined,profile);
    addToPlan(task,undefined,'focus',undefined,otherProfile);
    const view=()=>(load as any)({cookies,url:new URL('http://localhost/backlog?q=Add')});
    expect(view().plannedTaskIds).toEqual([focus]);
    await expect(submit(task)).resolves.toMatchObject({success:true,plannedTaskId:task});
    await expect(submit(focus)).resolves.toMatchObject({success:true});
    await expect(submit(task)).resolves.toMatchObject({success:true});
    expect(getToday(undefined,undefined,profile).map(item=>({id:item.id,section:item.section}))).toEqual([{id:focus,section:'focus'},{id:task,section:'also'}]);
    expect(getToday(undefined,undefined,otherProfile).map(item=>({id:item.id,section:item.section}))).toEqual([{id:task,section:'focus'}]);
    expect(view().plannedTaskIds).toEqual([focus,task]);
  }finally{
    database.sqlite.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(profile,otherProfile);
    database.sqlite.prepare('DELETE FROM tasks WHERE id IN (?,?)').run(focus,task);
  }
});

test('native backlog add preserves filters and rejects stale profile or completed task',async()=>{
  const profile=createProfile(`Filtered ${crypto.randomUUID()}`);
  const task=createTask({title:'Filtered task'});
  const cookies={get:()=>String(profile)};
  const submit=(profileId=profile)=>{
    const body=new FormData();body.set('taskId',String(task));body.set('profileId',String(profileId));
    return (actions.plan as any)({cookies,request:new Request('http://localhost/backlog?/plan&q=deep+work&state=blocked&due=1',{method:'POST',headers:{accept:'text/html'},body})});
  };
  try{
    await expect(submit(1)).resolves.toMatchObject({status:400});
    expect(getToday(undefined,undefined,profile)).toEqual([]);
    await expect(submit()).rejects.toMatchObject({status:303,location:'/backlog?q=deep+work&state=blocked&due=1'});
    setTaskState(task,'completed');
    await expect(submit()).resolves.toMatchObject({status:400});
  }finally{
    database.sqlite.prepare('DELETE FROM profiles WHERE id=?').run(profile);
    database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(task);
  }
});
