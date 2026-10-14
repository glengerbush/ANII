import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {database} from '../../src/lib/server/db';
import {checkAiConnection, sanityCheck} from '../../src/lib/server/ai';
import {aiRequestOptions, chatRound} from '../../src/lib/server/ai-chat';
import {captureAgent} from '../../src/lib/server/capture-agent';
import {buildSanityContext, createTask, getSettings, recordMessage, saveSettings} from '../../src/lib/server/repository';

const original=getSettings();
beforeEach(()=>saveSettings({ai_url:'http://anii-llama:11434',model:'qwen3.6-35b-a3b'}));
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();saveSettings(original);});
function stream(events:any[],done=true){
  const text=events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join('')+(done?'data: [DONE]\r\n\r\n':'');
  const bytes=new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}));
}
const event=(delta:any,finish_reason:string|null=null)=>({choices:[{index:0,delta,finish_reason}]});
const answer=(content:any)=>stream([event({content:JSON.stringify(content)},'stop')]);

test('llama discovery accepts root or /v1 and rejects invalid API responses',async()=>{
  const fetcher=vi.fn(async(_url:string)=>Response.json({data:[{id:'qwen3.6-35b-a3b'}]}));vi.stubGlobal('fetch',fetcher);
  for(const url of ['http://anii-llama:11434','http://anii-llama:11434/v1/']){
    expect(await checkAiConnection(url)).toMatchObject({ok:true,models:['qwen3.6-35b-a3b']});
    expect(fetcher.mock.lastCall?.[0]).toBe('http://anii-llama:11434/v1/models');
  }
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({unexpected:[]})));
  expect(await checkAiConnection('http://anii-llama:11434')).toMatchObject({ok:false,code:'invalid_response'});
});

test('split SSE tool calls search real tasks and link results to call IDs',async()=>{
  const task=createTask({title:'Llama desk delivery'}),id=recordMessage('Create assembly after Llama desk delivery');let rounds=0;const activity:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    expect(url).toBe('http://anii-llama:11434/v1/chat/completions');const body=JSON.parse(init.body);
    expect(body).toMatchObject({model:'qwen3.6-35b-a3b',stream:true,temperature:0,seed:42,cache_prompt:false});
    if(rounds++===0)return stream([
      event({reasoning_content:'Find café desk. '}),
      event({tool_calls:[{index:0,id:'lookup-desk',function:{name:'search_',arguments:'{"query":"Llama'}}]}),
      event({tool_calls:[{index:0,function:{name:'tasks',arguments:' desk delivery"}'}}]},'tool_calls')
    ]);
    const assistant=body.messages.find((message:any)=>message.tool_calls);
    expect(assistant).toMatchObject({reasoning_content:'Find café desk. ',tool_calls:[{id:'lookup-desk',type:'function',function:{name:'search_tasks',arguments:'{"query":"Llama desk delivery"}'}}]});
    const result=body.messages.find((message:any)=>message.role==='tool');expect(result.tool_call_id).toBe('lookup-desk');expect(JSON.parse(result.content).tasks.some((row:any)=>row.id===task)).toBe(true);
    return answer({message:'Review assembly.',tasks:[{ref:'assembly',title:'Assemble desk'}],dependencies:[{task:'assembly',prerequisite:task}]});
  }));
  expect((await captureAgent(id,event=>activity.push(event))).plan.dependencies).toEqual([{task:'assembly',prerequisite:task}]);
  expect(activity).toContainEqual({type:'thinking',text:'Find café desk. '});
  expect(database.sqlite.prepare("SELECT id FROM tasks WHERE title='Assemble desk'").get()).toBeUndefined();
});

test('plan review uses a JSON schema and returns validated concerns',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
    const body=JSON.parse(init.body);expect(body.response_format).toMatchObject({type:'json_schema',json_schema:{schema:{type:'object',properties:{concerns:expect.any(Object)}}}});expect(body.format).toBeUndefined();
    return answer({concerns:[]});
  }));
  expect(await sanityCheck(buildSanityContext())).toEqual({concerns:[]});
});

test.each(['missing-done','missing-finish','length','bad-json','huge-tools','server-error'])('rejects incomplete or unsafe streams: %s',async(kind)=>{
  const response=kind==='missing-done'?stream([event({content:'{}'},'stop')],false)
    :kind==='missing-finish'?stream([event({content:'{}'})])
    :kind==='length'?stream([event({content:'{}'},'length')])
    :kind==='bad-json'?new Response('data: broken\n\n')
    :kind==='server-error'?stream([{error:{message:'context full'}}])
    :stream([event({tool_calls:[{index:0,id:'huge',function:{name:'search_tasks',arguments:'x'.repeat(60_001)}}]},'tool_calls')]);
  vi.stubGlobal('fetch',vi.fn(async()=>response));const options=aiRequestOptions();
  try{await expect(chatRound([{role:'user',content:'hello'}],options,()=>{})).rejects.toMatchObject({code:'invalid_response'});}finally{options.dispose();}
});

test('llama HTTP errors preserve the diagnostic without leaking proxy HTML',async()=>{
  for(const response of [Response.json({error:{message:'exceeds context size'}},{status:400}),new Response('<html>secret</html>',{status:502})]){
    vi.stubGlobal('fetch',vi.fn(async()=>response));const options=aiRequestOptions();
    try{await expect(chatRound([],options,()=>{})).rejects.toMatchObject({code:'http',message:expect.not.stringContaining('secret')});}finally{options.dispose();}
  }
});

test('llama respects cancellation and releases the request timer',async()=>{
  vi.stubGlobal('fetch',vi.fn((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))));
  const controller=new AbortController(),options=aiRequestOptions(controller.signal);
  try{const result=expect(chatRound([],options,()=>{})).rejects.toMatchObject({code:'timeout'});controller.abort();await result;}finally{options.dispose();}
});
