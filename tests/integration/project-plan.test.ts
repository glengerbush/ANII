import { expect, test } from 'vitest';
import { actions, load } from '../../src/routes/projects/[id]/+page.server';
import { database } from '../../src/lib/server/db';
import { addToPlan, createProfile, createProject, createTask, getActiveDay, getToday } from '../../src/lib/server/repository';

test('project tasks toggle Today for the selected profile and remain in the project',async()=>{
  const profile=createProfile(`Project plan ${crypto.randomUUID()}`);
  const otherProfile=createProfile(`Other ${crypto.randomUUID()}`);
  const project=createProject('Project Today toggle');
  const task=createTask({title:'Project task',projectIds:[project]});
  const cookies={get:()=>String(profile)};
  const params={id:String(project)};
  const date=getActiveDay(undefined,profile);
  const view=()=>(load as any)({cookies,params});
  const submit=(planned:string,planDate=date,profileId=profile,native=false)=>{
    const body=new FormData();
    for(const [key,value] of Object.entries({taskId:task,profileId,planDate,planned}))body.set(key,String(value));
    return (actions.plan as any)({cookies,params,request:new Request(`http://localhost/projects/${project}?/plan`,{method:'POST',headers:native?{accept:'text/html'}:{},body})});
  };
  try{
    addToPlan(task,date,'focus',undefined,otherProfile);
    expect(view().plannedTaskIds).toEqual([]);
    expect(view().date).toBe(date);
    await expect(submit('true','2000-01-01')).resolves.toMatchObject({status:400});
    await expect(submit('true',date,otherProfile)).resolves.toMatchObject({status:400});
    expect(view().plannedTaskIds).toEqual([]);
    await expect(submit('true')).resolves.toMatchObject({success:true,plannedTaskId:task});
    expect(view().plannedTaskIds).toEqual([task]);
    await expect(submit('false',date,profile,true)).rejects.toMatchObject({status:303,location:`/projects/${project}`});
    expect(view().plannedTaskIds).toEqual([]);
    expect(view().tasks.map((item:any)=>item.id)).toEqual([task]);
    expect(getToday(date,undefined,otherProfile).map(item=>({id:item.id,section:item.section}))).toEqual([{id:task,section:'focus'}]);
  }finally{
    database.sqlite.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(profile,otherProfile);
    database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(task);
    database.sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);
  }
});
