import { afterEach, expect, test, vi } from 'vitest';
import { database } from '../../src/lib/server/db';
import { deleteMessage, recordMessage, recordProposal, saveCaptureProposals, saveSettings, getSettings } from '../../src/lib/server/repository';
import { actions } from '../../src/routes/chat/+page.server';

afterEach(()=>vi.unstubAllGlobals());
const request=(action:string,fields:Record<string,string>)=>{
  const body=new FormData();for(const [key,value] of Object.entries(fields))body.set(key,value);
  return {request:new Request(`http://localhost/chat?/${action}`,{method:'POST',headers:{'x-sveltekit-action':'true'},body})};
};
const retry=(id:number)=> (actions.retry as any)(request('retry',{id:String(id)}));
const proposals=(id:number)=>database.sqlite.prepare('SELECT * FROM ai_proposals WHERE message_id=?').all(id);
const reply=()=>Response.json({message:{role:'assistant',content:JSON.stringify({tasks:[{ref:'new1',title:'Call plumber'}],dependencies:[]})},done:true});

test('retry uses the saved message and current model without duplicating the message',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
  const sent=await (actions.send as any)(request('send',{content:'Call plumber original'}));
  expect(sent).toMatchObject({saved:true,aiError:{code:'connection'}});
  const count=database.sqlite.prepare('SELECT count(*) n FROM messages').get();
  const model=getSettings().model;
  try{
    saveSettings({model:'changed:model'});
    const fetchMock=vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);expect(JSON.stringify(body.messages)).toContain('Call plumber original');expect(JSON.stringify(body.messages)).not.toContain('Replacement');expect(body.model).toBe('changed:model');return reply();});
    vi.stubGlobal('fetch',fetchMock);
    const result=await (actions.retry as any)(request('retry',{id:String(sent.messageId),content:'Replacement'}));
    expect(result).toMatchObject({saved:true,messageId:sent.messageId,aiError:null,proposalCount:1});
    expect(result.messages).toHaveLength(1);
    expect(proposals(sent.messageId)).toHaveLength(1);
    expect(database.sqlite.prepare('SELECT count(*) n FROM messages').get()).toEqual(count);
    expect(await retry(sent.messageId)).toMatchObject({status:400,data:{error:expect.stringContaining('already has suggestions')}});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }finally{saveSettings({model});}
});

test('failed and empty retries preserve the message and allow another attempt',async()=>{
  const id=recordMessage('Try again');
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
  expect(await retry(id)).toMatchObject({saved:true,aiError:{code:'connection'},proposalCount:0});
  expect(proposals(id)).toEqual([]);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({message:{content:JSON.stringify({tasks:[],dependencies:[]})},done:true})));
  expect(await retry(id)).toMatchObject({saved:true,aiError:null,proposalCount:0});
  vi.stubGlobal('fetch',vi.fn().mockImplementation(reply));
  expect(await retry(id)).toMatchObject({saved:true,aiError:null,proposalCount:1});
});

test('concurrent retries and retries during the original send do not duplicate generation',async()=>{
  let complete!:(response:Response)=>void;
  const fetchMock=vi.fn(()=>new Promise<Response>(resolve=>complete=resolve));vi.stubGlobal('fetch',fetchMock);
  const id=recordMessage('Concurrent retry');
  const pending=retry(id);await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(await retry(id)).toMatchObject({status:409});complete(reply());await pending;
  expect(proposals(id)).toHaveLength(1);
  const send=(actions.send as any)(request('send',{content:'Initial request still running'}));
  await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2));
  const original=database.sqlite.prepare("SELECT id FROM messages WHERE content='Initial request still running'").get() as {id:number};
  expect(await retry(original.id)).toMatchObject({status:409});complete(reply());await send;
  expect(proposals(original.id)).toHaveLength(1);
});

test('retry rejects invalid, deleted and already processed messages before requesting AI',async()=>{
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  for(const id of [0,-1,1.5,NaN])expect(await retry(id)).toMatchObject({status:400});
  const deleted=recordMessage('Deleted');deleteMessage(deleted);expect(await retry(deleted)).toMatchObject({status:400});
  const processed=recordMessage('Already processed');recordProposal(processed,{title:'Existing suggestion'});
  expect(await retry(processed)).toMatchObject({status:400});expect(fetchMock).not.toHaveBeenCalled();
});

test('saving suggestions is atomic and a deleted message is not resurrected by an in-flight retry',async()=>{
  const id=recordMessage('Atomic suggestions');
  expect(()=>saveCaptureProposals(id,[{title:'Valid'},{title:''}])).toThrow();expect(proposals(id)).toEqual([]);
  let complete!:(response:Response)=>void;
  const fetchMock=vi.fn(()=>new Promise<Response>(resolve=>complete=resolve));vi.stubGlobal('fetch',fetchMock);
  const pending=retry(id);await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalled());deleteMessage(id);complete(reply());
  expect(await pending).toMatchObject({aiError:{code:'storage'},proposalCount:0});
  expect(database.sqlite.prepare('SELECT id FROM messages WHERE id=?').get(id)).toBeUndefined();expect(proposals(id)).toEqual([]);
});
