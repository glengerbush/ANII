import { test, expect } from 'vitest';
import { GET, POST } from '../../src/routes/api/mobile/[view]/+server';
import { createTask, createProfile, getTask, getNow, today } from '../../src/lib/server/repository';
function event(view:string, body?:unknown, profile=1, query='') {
  const url=new URL(`http://localhost/api/mobile/${view}${query?'?'+query:''}`);
  return {params:{view},url,cookies:{get:()=>String(profile)},request:new Request(url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-anii-client':'android-v1'},body:JSON.stringify(body)})} as any;
}
test('native queue and completion share web domain behavior and profile attribution',async()=>{
  const profile=createProfile(`Mobile ${crypto.randomUUID()}`),id=createTask({title:`Mobile task ${crypto.randomUUID()}`});
  const fields={profileId:String(profile),planDate:today(),taskId:String(id),planned:'true'};
  expect((await POST(event('backlog',{action:'plan',fields},profile))).status).toBe(200);
  expect(getNow(today(),undefined,profile).some(t=>t.id===id)).toBe(true);
  const view=await (await GET(event('now',undefined,profile))).json();
  expect(view).toMatchObject({apiVersion:1,activeProfile:{id:profile},data:{tasks:expect.arrayContaining([expect.objectContaining({id})])}});
  expect((await POST(event('now',{action:'state',fields:{...fields,id:String(id),state:'completed'}},profile))).status).toBe(200);
  expect(getTask(id)?.state).toBe('completed');
  expect(getNow(today(),undefined,profile).some(t=>t.id===id)).toBe(false);
});
test('native mutations retain profile, day and validation guards',async()=>{
  const profile=createProfile(`Mismatch ${crypto.randomUUID()}`),id=createTask({title:'Unchanged'});
  for(const fields of [{id:String(id),state:'completed',profileId:String(profile)},{id:String(id),state:'completed',profileId:'1',planDate:'2000-01-01'},{id:String(id),state:'unsupported',profileId:'1'}]){
    const response=await POST(event('backlog',{action:'state',fields}));expect(response.status).toBe(400);expect((await response.json()).error).toBeTruthy();
  }
  expect(getTask(id)?.state).toBe('open');
});
test('mobile transport rejects browser forms, malformed bodies, and unknown capabilities',async()=>{
  const form=event('backlog');form.request=new Request(form.url,{method:'POST',body:new URLSearchParams({action:'state'})});expect((await POST(form)).status).toBe(415);
  for(const body of [null,{action:'state',fields:null},{action:'state',fields:{id:3}},{action:'__proto__',fields:{}}])expect((await POST(event('backlog',body))).status).toBeGreaterThanOrEqual(400);
  expect((await POST(event('settings',{action:'restoreDatabase',fields:{}}))).status).toBe(404);
  expect((await GET(event('__proto__'))).status).toBe(404);
  expect((await GET(event('chat',undefined,1,'before=not-a-number'))).status).toBe(400);
});
test('mobile project completion preserves the task and exposes completed history',async()=>{
  const name=`Native project ${crypto.randomUUID()}`;
  expect((await POST(event('projects',{action:'create',fields:{name}}))).status).toBe(200);
  const projects=await (await GET(event('projects'))).json();const project=projects.data.projects.find((p:any)=>p.name===name);
  expect((await POST(event('project',{action:'create',fields:{title:'Keep this task'}},1,`id=${project.id}`))).status).toBe(200);
  expect((await POST(event('project',{action:'complete',fields:{completed:'true'}},1,`id=${project.id}`))).status).toBe(200);
  const result=await (await GET(event('project',undefined,1,`id=${project.id}`))).json();expect(result.data.project.state).toBe('archived');expect(result.data.tasks[0].state).toBe('open');
  const history=await (await GET(event('projects'))).json();expect(history.data.completedProjects.some((p:any)=>p.id===project.id)).toBe(true);
});
