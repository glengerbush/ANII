import { actions as backlogActions, load as backlogLoad } from '../../src/routes/backlog/+page.server';
import { describe, expect, test, vi } from 'vitest';
import { load as layoutLoad } from '../../src/routes/+layout.server';
import { actions as chatActions } from '../../src/routes/chat/+page.server';
import { actions as settingsActions } from '../../src/routes/settings/+page.server';
import { POST as selectProfile } from '../../src/routes/profile/+server';
import { backupDatabase, database, databasePath } from '../../src/lib/server/db';
import { addToPlan, createProfile, createTask, getTask, recordMessage, recordProposal } from '../../src/lib/server/repository';

describe('offline and progressive routes',()=>{
  test('Vitest never opens or backs up the live database',async()=>{expect(databasePath).toBe(':memory:');expect(database.sqlite.name).toBe(':memory:');await expect(backupDatabase()).resolves.toBeNull();});

  test('offline AI does not block layout load',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));const started=Date.now();const cookies={get:vi.fn().mockReturnValue(undefined)};const result=await (layoutLoad as any)({cookies,depends:vi.fn()});expect(result.aiOnline).toBe(false);expect(result.activeProfile.name).toBe('Default');expect(Date.now()-started).toBeLessThan(500);vi.unstubAllGlobals();});

  test('chat acceptance redirects after mutation and preserves trace',async()=>{const message=recordMessage(`route ${crypto.randomUUID()}`);const proposal=recordProposal(message,{title:`Accepted ${crypto.randomUUID()}`,details:''});const body=new FormData();body.set('id',String(proposal));const request=new Request('http://localhost/chat?/accept',{method:'POST',headers:{referer:'http://localhost/now'},body});await expect((chatActions.accept as any)({request})).rejects.toMatchObject({status:303,location:'/now'});expect(database.sqlite.prepare(`SELECT status,result_id FROM ai_proposals WHERE id=?`).get(proposal)).toMatchObject({status:'accepted',result_id:expect.any(Number)});expect(database.sqlite.prepare(`SELECT count(*) n FROM events WHERE entity_type='proposal' AND entity_id=? AND event_type='accepted'`).get(proposal)).toEqual({n:1});});

  test('chat send uses a named action and remains available offline',async()=>{expect((chatActions as any).default).toBeUndefined();vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));const content=`offline ${crypto.randomUUID()}`;const body=new FormData();body.set('content',content);const request=new Request('http://localhost/chat?/send',{method:'POST',headers:{referer:'http://localhost/now'},body});await expect((chatActions.send as any)({request})).rejects.toMatchObject({status:303,location:'/now'});expect(database.sqlite.prepare(`SELECT content FROM messages WHERE content=?`).get(content)).toEqual({content});vi.unstubAllGlobals();});

  test('profile creation preserves the current profile selection',async()=>{
    const body=new FormData();const name=`Profile ${crypto.randomUUID()}`;body.set('intent','create');body.set('name',name);body.set('returnTo','/backlog');const request=new Request('http://localhost/profile',{method:'POST',body});const set=vi.fn();
    try{await expect((selectProfile as any)({request,cookies:{set}})).rejects.toMatchObject({status:303,location:'/backlog'});expect(database.sqlite.prepare(`SELECT id FROM profiles WHERE name=?`).get(name)).toMatchObject({id:expect.any(Number)});expect(set).not.toHaveBeenCalled();}
    finally{database.sqlite.prepare(`DELETE FROM profiles WHERE name=?`).run(name);}
  });

  test('profile switching preserves safe local queries and rejects hostile return paths',async()=>{
    const profile=createProfile(`Redirect ${crypto.randomUUID()}`);const cookies={set:vi.fn()};
    const select=async(returnTo:string)=>{const body=new FormData();body.set('intent','switch');body.set('profileId',String(profile));body.set('returnTo',returnTo);return (selectProfile as any)({request:new Request('http://localhost/profile',{method:'POST',body}),cookies});};
    try{
      await expect(select('/backlog?q=deep%20work&state=blocked')).rejects.toMatchObject({status:303,location:'/backlog?q=deep%20work&state=blocked'});
      for(const hostile of [String.raw`/\evil.example`,'//','//evil.example','https://evil.example/pwn','/now\nLocation: https://evil.example'])await expect(select(hostile)).rejects.toMatchObject({status:303,location:'/now'});
    }finally{database.sqlite.prepare(`DELETE FROM profiles WHERE id=?`).run(profile);}
  });

  test('saving Preferences preserves settings absent from the submitted form',async()=>{
    const before=database.sqlite.prepare(`SELECT value FROM settings WHERE key='current_priorities'`).get() as {value:string};database.sqlite.prepare(`UPDATE settings SET value='Preserve me' WHERE key='current_priorities'`).run();const body=new FormData();body.set('theme','dark');
    try{await expect((settingsActions.save as any)({request:new Request('http://localhost/settings?/save',{method:'POST',body})})).resolves.toMatchObject({saved:true});expect(database.sqlite.prepare(`SELECT value FROM settings WHERE key='current_priorities'`).get()).toEqual({value:'Preserve me'});}
    finally{database.sqlite.prepare(`UPDATE settings SET value=? WHERE key='current_priorities'`).run(before.value);}
  });

  test('Settings creates a constrained unique profile without changing the active profile',async()=>{
    const name=`Settings ${crypto.randomUUID()}`;const cookies={set:vi.fn()};const submit=async(value:string)=>{const body=new FormData();body.set('name',value);return (settingsActions.createProfile as any)({request:new Request('http://localhost/settings?/createProfile',{method:'POST',body}),cookies});};
    try{await expect(submit(name)).resolves.toEqual({profileCreated:true});expect(database.sqlite.prepare(`SELECT id FROM profiles WHERE name=?`).get(name)).toMatchObject({id:expect.any(Number)});expect(cookies.set).not.toHaveBeenCalled();await expect(submit(name.toUpperCase())).resolves.toMatchObject({status:400});await expect(submit('x'.repeat(81))).resolves.toMatchObject({status:400});}
    finally{database.sqlite.prepare(`DELETE FROM profiles WHERE name=? COLLATE NOCASE`).run(name);}
  });

  test('Settings database restore requires explicit confirmation and enforces the 10 MB limit',async()=>{
    const submit=async(file:File|undefined,confirmation:string)=>{const body=new FormData();if(file)body.set('file',file);body.set('confirmation',confirmation);return (settingsActions.restoreDatabase as any)({request:new Request('http://localhost/settings?/restoreDatabase',{method:'POST',body})});};
    await expect(submit(new File([new Uint8Array(32)],'backup.db'),'wrong')).resolves.toMatchObject({status:400});await expect(submit(undefined,'RESTORE')).resolves.toMatchObject({status:400});await expect(submit(new File([new Uint8Array(10_000_001)],'backup.db'),'RESTORE')).resolves.toMatchObject({status:413});
  });
});

test('Backlog can reopen completed tasks without a project through its state action',async()=>{
  const id=createTask({title:`Accidental completion ${crypto.randomUUID()}`});
  const update=async(state:string)=>{const body=new FormData();body.set('id',String(id));body.set('state',state);return (backlogActions.state as any)({request:new Request('http://localhost/backlog?/state&state=completed',{method:'POST',body})});};
  const view=()=> (backlogLoad as any)({url:new URL('http://localhost/backlog?state=completed'),cookies:{get:()=>undefined}});
  expect(await update('completed')).toEqual({success:true});
  expect(view().completedTasks.some((task:any)=>task.id===id)).toBe(true);
  expect(view().tasks.some((task:any)=>task.id===id)).toBe(false);
  expect(view().showCompleted).toBe(true);
  expect(await update('open')).toEqual({success:true});
  expect(view().completedTasks.some((task:any)=>task.id===id)).toBe(false);
  expect(view().tasks.some((task:any)=>task.id===id)).toBe(true);
  expect(getTask(id)).toMatchObject({state:'open',completed_at:null,project_ids:[]});
});
