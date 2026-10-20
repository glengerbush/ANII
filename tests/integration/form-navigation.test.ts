import { describe, expect, test } from 'vitest';
import { actions as todayActions } from '../../src/routes/now/+page.server';
import { actions as backlogActions } from '../../src/routes/backlog/+page.server';
import { actions as projectActions } from '../../src/routes/projects/+page.server';
import { actions as projectDetailActions } from '../../src/routes/projects/[id]/+page.server';
import { actions as settingsActions } from '../../src/routes/settings/+page.server';
import { createProject, createTask, getBacklog, getTask, listProjects } from '../../src/lib/server/repository';

function event(path:string,fields:Record<string,string>,enhanced=false){
  return {request:new Request(`http://localhost${path}`,{method:'POST',headers:{accept:enhanced?'application/json':'text/html'},body:new URLSearchParams(fields)}),cookies:{get:()=>undefined}};
}

describe('form navigation',()=>{
  test('native task creation redirects to GET instead of leaving a resubmittable POST page',async()=>{
    const title=`Refresh ${crypto.randomUUID()}`;
    await expect(todayActions.quickAdd(event('/now?/quickAdd',{title}) as any)).rejects.toMatchObject({status:303,location:'/now'});
    expect(getBacklog().filter(task=>task.title===title)).toHaveLength(1);
  });
  test('completion redirects preserve filters and expanded completed tasks, removing only the action',async()=>{
    const id=createTask({title:'Refresh completion'});
    await expect(backlogActions.state(event('/backlog?/state&q=Refresh&showCompleted=1',{id:String(id),state:'completed'}) as any)).rejects.toMatchObject({status:303,location:'/backlog?q=Refresh&showCompleted=1'});
    expect(getTask(id)?.state).toBe('completed');
  });
  test('project creation and project task creation both end with GET redirects',async()=>{
    const name=`Refresh project ${crypto.randomUUID()}`;
    await expect(projectActions.create(event('/projects?/create',{name}) as any)).rejects.toMatchObject({status:303,location:'/projects'});
    expect(listProjects().some(project=>project.name===name)).toBe(true);
    const id=createProject(`Detail ${crypto.randomUUID()}`);
    await expect(projectDetailActions.create({...event(`/projects/${id}?/create`,{title:'Detail refresh'}),params:{id:String(id)}} as any)).rejects.toMatchObject({status:303,location:`/projects/${id}`});
  });
  test('native settings saves and profile creation also redirect',async()=>{
    await expect(settingsActions.save(event('/settings?/save',{}) as any)).rejects.toMatchObject({status:303,location:'/settings'});
    await expect(settingsActions.createProfile(event('/settings?/createProfile',{name:`Refresh ${crypto.randomUUID()}`}) as any)).rejects.toMatchObject({status:303,location:'/settings'});
  });
  test('enhanced submissions keep their result data and validation failures stay visible',async()=>{
    await expect(backlogActions.create(event('/backlog?/create',{title:'Enhanced refresh'},true) as any)).resolves.toEqual({success:true});
    await expect(settingsActions.save(event('/settings?/save',{},true) as any)).resolves.toEqual({saved:true});
    await expect(backlogActions.create(event('/backlog?/create',{title:''}) as any)).resolves.toMatchObject({status:400,data:{error:expect.any(String)}});
  });
});
