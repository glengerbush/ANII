import { afterEach, expect, test, vi } from 'vitest';
import { checkOllamaConnection } from '../../src/lib/server/ai';
import { actions as chatActions } from '../../src/routes/chat/+page.server';
import { actions as settingsActions } from '../../src/routes/settings/+page.server';
import { database } from '../../src/lib/server/db';
import { captureAgent } from '../../src/lib/server/capture-agent';
import { recordMessage, getSettings } from '../../src/lib/server/repository';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const send=()=>{const body=new FormData();body.set('content','Call the plumber');return (chatActions.send as any)({request:new Request('http://localhost/chat?/send',{method:'POST',headers:{'x-sveltekit-action':'true'},body})});};
test('reachable Ollama can still reject Capture with a missing model',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url)=>String(url).endsWith('/api/tags')?Response.json({models:[{name:'installed:4b'}]}):Response.json({error:'model "missing:4b" not found'},{status:404})));
  expect(await checkOllamaConnection('http://localhost:11434')).toMatchObject({ok:true,models:['installed:4b']});
  expect(await send()).toMatchObject({saved:true,aiError:{code:'model_missing',message:expect.stringContaining('Settings')}});
});
test('Capture retains actionable Ollama errors without forwarding HTML error pages',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'model requires more system memory'},{status:500})));
  expect(await send()).toMatchObject({saved:true,aiError:{code:'http',message:expect.stringContaining('model requires more system memory')}});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<html>proxy secret</html>',{status:502})));
  const result=await send();expect(result.aiError.message).toContain('502');expect(result.aiError.message).not.toContain('proxy secret');
});
test('Capture distinguishes malformed structured output from connection failures',async()=>{
  for(const response of ['not JSON',JSON.stringify({proposals:[{title:''}]})]){
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({message:{content:response},done:true})));
    expect(await send()).toMatchObject({saved:true,aiError:{code:'invalid_response'}});
  }
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('fetch failed',{cause:{code:'ECONNREFUSED'}})));
  expect(await send()).toMatchObject({saved:true,aiError:{code:'connection',message:expect.stringContaining('refused')}});
});
test('Capture reports its real generation timeout',async()=>{
  vi.useFakeTimers();
  vi.stubGlobal('fetch',vi.fn((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))));
  const result=expect(captureAgent(recordMessage('Call the plumber'))).rejects.toMatchObject({code:'timeout',message:expect.stringContaining('120 seconds')});
  await vi.advanceTimersByTimeAsync(120_000);await result;
});
test('model discovery validates results and supports an empty installation',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({models:[]})));
  expect(await checkOllamaConnection('http://localhost:11434')).toMatchObject({ok:true,models:[]});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({models:[{name:'b:4b'},{name:'a:4b'},{name:'b:4b'}]})));
  expect(await checkOllamaConnection('http://localhost:11434')).toMatchObject({ok:true,models:['a:4b','b:4b']});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({models:[{}]})));
  expect(await checkOllamaConnection('http://localhost:11434')).toMatchObject({ok:false,code:'invalid_response'});
  expect(await checkOllamaConnection('ftp://localhost')).toMatchObject({ok:false,code:'configuration'});
});
test('saving rejects an unavailable model atomically, while unrelated preferences work offline',async()=>{
  const before=getSettings();const body=new FormData();body.set('model','missing:model');body.set('currentPriorities','Must not persist');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({models:[{name:'installed:4b'}]})));
  const result=await (settingsActions.save as any)({request:new Request('http://localhost/settings?/save',{method:'POST',body})});
  expect(result).toMatchObject({status:400,data:{error:expect.stringContaining('not installed')}});expect(getSettings()).toEqual(before);
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
  const unchanged=new FormData();unchanged.set('model',before.model);unchanged.set('ollamaUrl',before.ollama_url);
  expect(await (settingsActions.save as any)({request:new Request('http://localhost/settings?/save',{method:'POST',body:unchanged})})).toEqual({saved:true});
  expect(fetch).not.toHaveBeenCalled();
});

test('saved timeout controls generation and invalid values do not alter preferences',async()=>{
  const before=getSettings();
  const submit=async(aiTimeout:string)=>{
    const body=new FormData();body.set('aiTimeout',aiTimeout);body.set('currentPriorities',before.current_priorities);
    return (settingsActions.save as any)({request:new Request('http://localhost/settings?/save',{method:'POST',body})});
  };
  try{
    expect(await submit('45')).toEqual({saved:true});
    expect(getSettings().ai_timeout_seconds).toBe('45');
    for(const value of ['', '0', '4', '601', '-5', '3.5', 'abc']){
      expect(await submit(value)).toMatchObject({status:400});
      expect(getSettings().ai_timeout_seconds).toBe('45');
    }
    vi.useFakeTimers();let aborted=false;
    vi.stubGlobal('fetch',vi.fn((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);}))));
    const result=expect(captureAgent(recordMessage('Call the plumber'))).rejects.toMatchObject({code:'timeout',message:expect.stringContaining('45 seconds')});
    await vi.advanceTimersByTimeAsync(15_000);expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);await result;
  }finally{database.sqlite.prepare("DELETE FROM settings WHERE key='ai_timeout_seconds'").run();}
});
