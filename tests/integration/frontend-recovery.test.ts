import {afterEach, describe, expect, test, vi} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDatabase, database} from '../../src/lib/server/db';
import {restoreJsonData} from '../../src/lib/server/database-restore';
import {checkOllamaConnection} from '../../src/lib/server/ai';
import {actions as settingsActions} from '../../src/routes/settings/+page.server';
import {actions as chatActions} from '../../src/routes/chat/+page.server';
import {GET as messageHistory} from '../../src/routes/chat/messages/+server';
import {addToPlan, closeOutToday, completeReviewFocus, createTask, editReviewPlan, exportData, getMessagePage, getReviewSession, getSettings, getToday, planReviewTomorrow, recordMessage, recordProposal, saveSettings} from '../../src/lib/server/repository';

const opened:ReturnType<typeof createDatabase>[]=[];
const directories:string[]=[];
function fresh(disk=false){const directory=disk?mkdtempSync(join(tmpdir(),'life-ui-test-')):null;if(directory)directories.push(directory);const db=createDatabase(directory?join(directory,'life.db'):':memory:');opened.push(db);return db;}
afterEach(()=>{vi.unstubAllGlobals();for(const db of opened.splice(0))db.sqlite.close();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('frontend recovery',()=>{
  test('JSON restore retains a usable copy of replaced data',async()=>{
    const live=fresh(true);createTask({title:'Keep in recovery'},live.sqlite);
    const source=fresh();createTask({title:'Imported task'},source.sqlite);
    const result=await restoreJsonData(exportData(source.sqlite),{liveDatabase:live,livePath:live.sqlite.name});
    expect(live.sqlite.prepare('SELECT title FROM tasks').all()).toEqual([{title:'Imported task'}]);
    const backup=new Database(result.recoveryBackupPath,{readonly:true});
    try{expect(backup.prepare('SELECT title FROM tasks').all()).toEqual([{title:'Keep in recovery'}]);}finally{backup.close();}
  });

  test('JSON restore leaves data intact when the backup cannot be created',async()=>{
    const live=fresh(true);createTask({title:'Keep me'},live.sqlite);const source=fresh();
    await expect(restoreJsonData(exportData(source.sqlite),{liveDatabase:live,livePath:live.sqlite.name,prepareRecoveryDirectory:async()=>{throw new Error('disk full');}})).rejects.toThrow(/Current data was not changed/);
    expect(live.sqlite.prepare('SELECT title FROM tasks').all()).toEqual([{title:'Keep me'}]);
  });

  test('JSON restore rejects invalid imports without replacing live data',async()=>{
    const live=fresh(true);createTask({title:'Keep me'},live.sqlite);
    await expect(restoreJsonData({version:2,tables:{}},{liveDatabase:live,livePath:live.sqlite.name})).rejects.toThrow();
    expect(live.sqlite.prepare('SELECT title FROM tasks').all()).toEqual([{title:'Keep me'}]);
  });

  test('JSON route requires confirmation and bounds file size',async()=>{
    const submit=(confirmation:string,file?:File)=>{const body=new FormData();body.set('confirmation',confirmation);if(file)body.set('file',file);return settingsActions.import({request:new Request('http://localhost/settings?/import',{method:'POST',body})} as any);};
    expect(await submit('',new File(['{}'],'backup.json'))).toMatchObject({status:400});
    expect(await submit('RESTORE')).toMatchObject({status:400});
    expect(await submit('RESTORE',new File([new Uint8Array(10_000_001)],'large.json'))).toMatchObject({status:413});
  });

  test('Ollama settings validate atomically and normalize the endpoint',()=>{
    const {sqlite}=fresh();saveSettings({ollama_url:'http://host.docker.internal:11434/'},sqlite);
    expect(getSettings(sqlite).ollama_url).toBe('http://host.docker.internal:11434');
    const before=getSettings(sqlite);
    for(const url of ['not a url','file:///tmp/a','http://user:secret@host','http://host/?q=a'])expect(()=>saveSettings({model:'changed',ollama_url:url},sqlite)).toThrow();
    expect(getSettings(sqlite)).toEqual(before);
  });

  test('Ollama connection feedback checks API shape and handles offline',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({models:[{name:'local'}]}))));
    expect(await checkOllamaConnection('http://localhost:11434')).toMatchObject({ok:true,message:expect.stringContaining('1 installed model')});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}')));
    expect(await checkOllamaConnection('http://localhost:11434')).toMatchObject({ok:false});
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
    expect(await checkOllamaConnection('http://localhost:11434')).toMatchObject({ok:false,message:expect.stringContaining('Check the address')});
  });

  test('review corrections retain plan and Focus without replaying closeout',()=>{
    const {sqlite}=fresh();const date='2026-10-10';const next='2026-10-11';
    const task=createTask({title:'Tomorrow task'},sqlite);const completed=createTask({title:'Finished today'},sqlite);
    addToPlan(completed,date,'also',sqlite);
    closeOutToday([{taskId:completed,outcome:'completed'}],date,sqlite);
    planReviewTomorrow([task],date,sqlite);
    editReviewPlan(date,[task],sqlite);
    expect(getReviewSession(date,sqlite).stage).toBe('plan');
    expect(getToday(next,sqlite)).toMatchObject([{id:task,section:'focus'}]);
    planReviewTomorrow([task],date,sqlite);
    expect(getToday(next,sqlite)).toMatchObject([{id:task,section:'focus'}]);
    completeReviewFocus([task],date,sqlite);editReviewPlan(date,undefined,sqlite);planReviewTomorrow([task],date,sqlite);completeReviewFocus([task],date,sqlite);
    expect(sqlite.prepare('SELECT count(*) n FROM reviews').get()).toEqual({n:1});
    expect(sqlite.prepare('SELECT state FROM tasks WHERE id=?').get(completed)).toEqual({state:'completed'});
    expect(()=>editReviewPlan('2026-10-12',undefined,sqlite)).toThrow();
  });

  test('chat history pages include every proposal without gaps or duplicate notes',()=>{
    const {sqlite}=fresh();const ids=Array.from({length:65},(_,i)=>recordMessage(`Note ${i}`,sqlite));
    recordProposal(ids[35],{title:'First proposal'},{},sqlite);recordProposal(ids[35],{title:'Second proposal'},{},sqlite);
    const newest=getMessagePage(undefined,sqlite);expect(new Set(newest.messages.map(m=>m.id)).size).toBe(30);
    expect(newest.messages.filter(m=>m.id===ids[35])).toHaveLength(2);
    const middle=getMessagePage(newest.nextCursor!,sqlite);const oldest=getMessagePage(middle.nextCursor!,sqlite);
    expect(oldest.nextCursor).toBeNull();
    expect([...new Set([...oldest.messages,...middle.messages,...newest.messages].map(m=>m.id))]).toEqual(ids);
    expect(getMessagePage(ids[0],sqlite)).toEqual({messages:[],nextCursor:null});
  });

  test('history rejects invalid cursors',()=>{
    for(const cursor of ['0','-1','1.5','NaN'])expect(()=>messageHistory({url:new URL(`http://localhost/chat/messages?before=${cursor}`)} as any)).toThrow();
  });

  test('enhanced capture confirms note retention when AI is offline',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
    const content=`retained ${crypto.randomUUID()}`;const body=new FormData();body.set('content',content);
    const result=await chatActions.send({request:new Request('http://localhost/chat?/send',{method:'POST',body,headers:{'x-sveltekit-action':'true'}})} as any);
    expect(result).toEqual({saved:true,aiOffline:true});
    expect(database.sqlite.prepare('SELECT count(*) n FROM messages WHERE content=?').get(content)).toEqual({n:1});
  });
});
