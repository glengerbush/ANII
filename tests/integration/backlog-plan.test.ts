import { expect, test } from 'vitest';
import { actions, load } from '../../src/routes/backlog/+page.server';
import { database } from '../../src/lib/server/db';
import { scheduleTask, addToPlan, createProfile, createTask, getNow, getTask, today, setTaskState } from '../../src/lib/server/repository';

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
    expect(getNow(undefined,undefined,profile).map(item=>({id:item.id,section:item.section}))).toEqual([{id:focus,section:'focus'},{id:task,section:'also'}]);
    expect(getNow(undefined,undefined,otherProfile)).toEqual([]);
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
    expect(getNow(undefined,undefined,profile)).toEqual([]);
    await expect(submit()).rejects.toMatchObject({status:303,location:'/backlog?q=deep+work&state=blocked&due=1'});
    setTaskState(task,'completed');
    await expect(submit()).resolves.toMatchObject({status:400});
  }finally{
    database.sqlite.prepare('DELETE FROM profiles WHERE id=?').run(profile);
    database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(task);
  }
});


test('Now toggle removes only the selected plan and supports repeated requests',async()=>{
  const profile=createProfile(`Toggle ${crypto.randomUUID()}`);
  const otherProfile=createProfile(`Other ${crypto.randomUUID()}`);
  const task=createTask({title:'Toggle Now'});
  const cookies={get:()=>String(profile)};
  const date=today();
  const submit=(planned:string,planDate=date,profileId=profile)=>{
    const body=new FormData();body.set('taskId',String(task));body.set('profileId',String(profileId));body.set('planDate',planDate);body.set('planned',planned);
    return (actions.plan as any)({cookies,request:new Request('http://localhost/backlog?/plan',{method:'POST',body})});
  };
  try{
    scheduleTask(task,date,null);
    addToPlan(task,date,'focus',undefined,profile);
    addToPlan(task,date,'focus',undefined,otherProfile);
    await expect(submit('false','2000-01-01')).resolves.toMatchObject({status:400});
    await expect(submit('false',date,otherProfile)).resolves.toMatchObject({status:400});
    await expect(submit('invalid')).resolves.toMatchObject({status:400});
    expect(getNow(date,undefined,profile).map(item=>item.id)).toEqual([task]);
    await expect(submit('false')).resolves.toMatchObject({success:true});
    await expect(submit('false')).resolves.toMatchObject({success:true});
    expect(getNow(date,undefined,profile)).toEqual([]);
    expect(getTask(task)?.state).toBe('open');
    expect(getNow(date,undefined,otherProfile).map(item=>item.id)).toEqual([task]);
    expect(getNow('2099-01-01',undefined,profile).map(item=>item.id)).toEqual([task]);
    await expect(submit('true')).resolves.toMatchObject({success:true});
    await expect(submit('true')).resolves.toMatchObject({success:true});
    expect(getNow(date,undefined,profile).map(item=>({id:item.id,section:item.section}))).toEqual([{id:task,section:'focus'}]);
  }finally{
    database.sqlite.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(profile,otherProfile);
    database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(task);
  }
});
