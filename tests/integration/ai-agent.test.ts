import {chatEvents, chatResponse} from '../fixtures/ai/stream';
import { afterEach, expect, test, vi } from 'vitest';
import { consumeAiStream, readJsonLines, type AiActivityEvent } from '../../src/lib/ai-stream';
import { database, createDatabase } from '../../src/lib/server/db';
import { captureAgent } from '../../src/lib/server/capture-agent';
import { runLookup, recentConversation } from '../../src/lib/server/ai-tools';
import { acceptAiProposal, saveAiResult, validateChangeSet } from '../../src/lib/server/ai-proposals';
import { acceptProposal, addDependency, createProject, createTask, getTask, recordMessage, recordProposal, getActiveDay } from '../../src/lib/server/repository';
import { POST as runChat } from '../../src/routes/chat/run/+server';
import { POST as checkPlan } from '../../src/routes/today/check/+server';
import { handle } from '../../src/hooks.server';
import { appRequestGate } from '../../src/lib/server/request-gate';

const open:Array<ReturnType<typeof createDatabase>>=[];
const fresh=()=>{const db=createDatabase(':memory:');open.push(db);return db.sqlite;};
afterEach(()=>{vi.unstubAllGlobals();for(const db of open.splice(0))db.sqlite.close();});
function stream(chunks:any[],split=0){
  const bytes=new TextEncoder().encode(chunks.map(value=>JSON.stringify(value)).join('\n')+'\n');
  return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=split||bytes.length)controller.enqueue(bytes.slice(i,i+(split||bytes.length)));controller.close();}}));
}
const answer=(plan:any)=>chatResponse(JSON.stringify(plan));

test('NDJSON handles split UTF-8 and truncated transport is rejected',async()=>{
  const values:any[]=[];await readJsonLines(stream([{message:'café ☕'},{done:true}],1),value=>values.push(value));expect(values).toEqual([{message:'café ☕'},{done:true}]);
  await expect(consumeAiStream(stream([{type:'status',message:'Running'}]),()=>{})).rejects.toThrow(/before completion/);
});

test('lexical search escapes literal patterns, filters projects/status and returns bounded snippets',()=>{
  const db=fresh(),project=createProject('House',db),first=createTask({title:'Buy 100% cotton_',details:'x'.repeat(900)+' literal needle '+ 'x'.repeat(900),projectId:project},db);
  createTask({title:'Buy 1000 cottonX'},db);
  expect((runLookup('search_tasks',{query:'100% cotton_',projectId:project},db) as any).tasks.map((task:any)=>task.id)).toEqual([first]);
  const found=(runLookup('search_tasks',{query:'needle'},db) as any).tasks[0];expect(found.snippet).toContain('needle');expect(found.snippet.length).toBeLessThan(245);
  db.prepare("UPDATE tasks SET state='completed' WHERE id=?").run(first);
  expect((runLookup('search_tasks',{query:'100%'},db) as any).tasks).toEqual([]);
  expect((runLookup('search_tasks',{query:'100%',state:'completed'},db) as any).tasks[0].id).toBe(first);
});

test('recent and older chat context includes proposal outcomes and bounded messages',()=>{
  const db=fresh();const old=recordMessage('Original plumber reference',db);const proposal=recordProposal(old,{title:'Call plumber'},{},db);const taskId=acceptProposal(proposal,db);
  for(let i=0;i<15;i++)recordMessage(`Later note ${i}`,db);
  const latest=recordMessage('Use that task',db);expect(recentConversation(latest,db)).toHaveLength(12);
  const result=runLookup('search_chat_history',{query:'plumber'},db) as any;
  expect(result.messages[0]).toMatchObject({id:old,proposalOutcomes:[{status:'accepted',result_id:taskId}]});
});

test('agent decides lookups, caches duplicates, streams thinking and verifies dependency IDs',async()=>{
  const task=createTask({title:'Agent lookup target'}),id=recordMessage('Create a follow-up blocked by Agent lookup target');let calls=0;const events:AiActivityEvent[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
    const body=JSON.parse(init.body);expect(body.stream).toBe(true);expect(String(_url)).toMatch(/\/v1\/chat\/completions$/);
    if(calls++===0)return chatEvents([{choices:[{delta:{reasoning_content:'Find the existing task.',tool_calls:[{index:0,id:'lookup1',function:{name:'search_tasks',arguments:JSON.stringify({query:'Agent lookup target'})}},{index:1,id:'lookup2',function:{name:'search_tasks',arguments:JSON.stringify({query:'Agent lookup target'})}}]},finish_reason:'tool_calls'}]}]);
    expect(body.messages.filter((message:any)=>message.role==='tool')).toHaveLength(2);
    return answer({tasks:[{ref:'new1',title:'Follow up'}],dependencies:[{task:'new1',prerequisite:task}],message:'Review the follow-up.'});
  }));
  const result=await captureAgent(id,event=>events.push(event));expect(result.plan.dependencies).toEqual([{task:'new1',prerequisite:task}]);
  expect(events.some(event=>event.type==='tool'&&event.cached)).toBe(true);expect(events.some(event=>event.type==='thinking')).toBe(true);
});

test('change sets apply both dependency directions and new-new links atomically',()=>{
  const db=fresh(),existing=createTask({title:'Existing'},db),other=createTask({title:'Other'},db),message=recordMessage('Add steps',db);
  const plan={tasks:[{ref:'first',title:'First'},{ref:'second',title:'Second'}],dependencies:[{task:'first',prerequisite:existing},{task:'second',prerequisite:'first'},{task:other,prerequisite:'second'}]};
  saveAiResult(message,plan,'test',db);const proposal=(db.prepare('SELECT id FROM ai_proposals WHERE message_id=?').get(message) as any).id;
  const result=acceptAiProposal(proposal,db) as Record<string,number>;
  expect(getTask(result.first,db)?.blocked).toBe(1);expect(getTask(other,db)?.blocked).toBe(1);
  expect(db.prepare('SELECT count(*) n FROM dependencies WHERE source_message_id=?').get(message)).toEqual({n:3});
  expect(()=>acceptAiProposal(proposal,db)).toThrow(/no longer pending/);
  expect(()=>validateChangeSet({tasks:[{ref:'a',title:'A'},{ref:'b',title:'B'}],dependencies:[{task:'a',prerequisite:'b'},{task:'b',prerequisite:'a'}]},db)).toThrow(/cycle/);
  expect(()=>validateChangeSet({dependencies:[{task:999999,prerequisite:existing}]},db)).toThrow(/no longer exists/);
  const laterA=createTask({title:'Later A'},db),laterB=createTask({title:'Later B'},db);
  const stale=recordMessage('Propose later edge',db);saveAiResult(stale,{tasks:[{ref:'new',title:'Must roll back'}],dependencies:[{task:laterA,prerequisite:laterB}]},'test',db);
  const staleProposal=(db.prepare('SELECT id FROM ai_proposals WHERE message_id=?').get(stale) as any).id;
  const count=db.prepare('SELECT count(*) n FROM tasks').get();
  db.exec(`CREATE TRIGGER reject_proposed_edge BEFORE INSERT ON dependencies WHEN NEW.task_id=${laterA} BEGIN SELECT RAISE(ABORT,'forced edge failure'); END;`);
  expect(()=>acceptAiProposal(staleProposal,db)).toThrow(/forced edge failure/);
  expect(db.prepare('SELECT count(*) n FROM tasks').get()).toEqual(count);
  expect(db.prepare('SELECT status FROM ai_proposals WHERE id=?').get(staleProposal)).toEqual({status:'pending'});
  db.exec('DROP TRIGGER reject_proposed_edge');addDependency(laterB,laterA,db);
  expect(()=>acceptAiProposal(staleProposal,db)).toThrow(/cycle/);

});

test('clarification saves an assistant answer without applying tasks',()=>{
  const db=fresh(),id=recordMessage('Use the ambiguous task',db);
  expect(saveAiResult(id,{message:'Which of the two tasks?',clarification:true,tasks:[],dependencies:[]},'test',db)).toMatchObject({proposalCount:0,clarification:true});
  expect(db.prepare('SELECT count(*) n FROM tasks').get()).toEqual({n:0});
  expect(()=>saveAiResult(id,{clarification:true,tasks:[{ref:'new',title:'Ambiguous'}]},'test',db)).toThrow(/Clarification/);
});

test('streamed failure saves the message and retry reuses it',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));const events:any[]=[];
  const request=(fields:Record<string,string>)=>({request:new Request('http://localhost/chat/run',{method:'POST',body:new URLSearchParams(fields)})} as any);
  await consumeAiStream(await runChat(request({content:'Stream retry fixture'})),event=>events.push(event));
  expect(events[0].type).toBe('saved');expect(events.at(-1)).toMatchObject({type:'error',error:{code:'connection'}});
  vi.stubGlobal('fetch',vi.fn(()=>answer({tasks:[{ref:'new1',title:'Retry task'}],dependencies:[]})));
  const retried:any[]=[];await consumeAiStream(await runChat(request({id:String(events[0].messageId)})),event=>retried.push(event));
  expect(retried.at(-1)).toMatchObject({type:'done',result:{proposalCount:1,messageId:events[0].messageId}});
  expect(database.sqlite.prepare("SELECT count(*) n FROM messages WHERE content='Stream retry fixture'").get()).toEqual({n:1});
});

test('zero-concern plan checks finish visibly and stale plans are rejected',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>answer({concerns:[]})));const date=getActiveDay();
  const request=(planDate:string)=>({cookies:{get:()=> '1'},request:new Request('http://localhost/today/check',{method:'POST',body:new URLSearchParams({profileId:'1',planDate})})} as any);
  const events:any[]=[];await consumeAiStream(await checkPlan(request(date)),event=>events.push(event));
  expect(events.at(-1)).toMatchObject({type:'done',result:{checked:true,concerns:[]}});
  expect((await checkPlan(request('1900-01-01'))).status).toBe(409);
});

test('request gate blocks restore through streamed work and releases on completion',async()=>{
  let complete!:()=>void;const work=new Promise<void>(resolve=>complete=resolve);
  const response=await handle({event:{request:new Request('http://localhost/chat/run',{method:'POST'}),url:new URL('http://localhost/chat/run')},resolve:async()=>new Response(new ReadableStream({async start(controller){controller.enqueue(new TextEncoder().encode('working'));await work;controller.close();}}))} as any);
  let restored=false;const restore=appRequestGate.withExclusive(()=>{restored=true;});
  await Promise.resolve();expect(restored).toBe(false);const consuming=response.text();complete();await consuming;await restore;expect(restored).toBe(true);
});

test('cancelling the AI stream aborts provider work before releasing the restore gate',async()=>{
  let started=false,aborted=false;
  vi.stubGlobal('fetch',vi.fn((_url,{signal})=>new Promise((_resolve,reject)=>{started=true;signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);});})));
  const event={request:new Request('http://localhost/chat/run',{method:'POST',body:new URLSearchParams({content:'Cancelled stream fixture'})}),url:new URL('http://localhost/chat/run')};
  const response=await handle({event,resolve:()=>runChat(event as any)} as any);
  const reader=response.body!.getReader();await reader.read();expect(started).toBe(true);
  let restored=false;const restore=appRequestGate.withExclusive(()=>{expect(aborted).toBe(true);restored=true;});
  expect(restored).toBe(false);await reader.cancel();await restore;expect(restored).toBe(true);
  const source=database.sqlite.prepare("SELECT id FROM messages WHERE content='Cancelled stream fixture'").get() as {id:number};
  expect(database.sqlite.prepare('SELECT id FROM ai_proposals WHERE message_id=?').all(source.id)).toEqual([]);
});

test('pending stream read does not release restore gate before cancellation cleanup settles',async()=>{
  let finishCleanup!:()=>void;const cleanup=new Promise<void>(resolve=>finishCleanup=resolve);
  const response=await handle({event:{request:new Request('http://localhost/chat/run'),url:new URL('http://localhost/chat/run')},resolve:async()=>new Response(new ReadableStream({cancel:()=>cleanup}))} as any);
  const reader=response.body!.getReader();const pending=reader.read();let restored=false;
  const restore=appRequestGate.withExclusive(()=>{restored=true;});const cancelling=reader.cancel();
  await pending;await new Promise(resolve=>setTimeout(resolve,0));expect(restored).toBe(false);
  finishCleanup();await cancelling;await restore;expect(restored).toBe(true);
});

test('lookup rounds are bounded and the final response can ask for clarification',async()=>{
  const id=recordMessage('Find the unclear old task');let requests=0;
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{requests++;const body=JSON.parse(init.body);return body.response_format?answer({message:'Which task do you mean?',clarification:true,tasks:[],dependencies:[]}):chatEvents([{choices:[{delta:{tool_calls:[{index:0,id:`lookup${requests}`,function:{name:'search_tasks',arguments:JSON.stringify({query:'unclear missing task'})}}]},finish_reason:'tool_calls'}]}]);}));
  expect((await captureAgent(id)).plan).toMatchObject({clarification:true,tasks:[],dependencies:[]});expect(requests).toBe(5);
});

test('model-supplied existing IDs require lookup even if the task exists',async()=>{
  const task=createTask({title:'Not looked up'}),id=recordMessage('Make a new task depend on an existing one');
  vi.stubGlobal('fetch',vi.fn(()=>answer({tasks:[{ref:'new1',title:'New'}],dependencies:[{task:'new1',prerequisite:task}]})));
  await expect(captureAgent(id)).rejects.toMatchObject({code:'invalid_response',message:expect.stringContaining('without looking it up')});
});
