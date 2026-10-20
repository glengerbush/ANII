import { expect, test, vi } from 'vitest';
import { actions as settingsActions } from '../../src/routes/settings/+page.server';
import { actions as todayActions } from '../../src/routes/now/+page.server';
import { load as layoutLoad } from '../../src/routes/+layout.server';
import { database } from '../../src/lib/server/db';
import { scheduleTask, addToPlan, createProfile, createTask, today, getSettings, getNow, saveSettings, setTaskState } from '../../src/lib/server/repository';

test('Focus layout defaults to equal and round trips through Settings without changing other preferences',async()=>{
  expect(getSettings().focus_layout).toBe('equal');
  const previous=getSettings();
  const submit=(values:Record<string,string>)=>(settingsActions.save as any)({request:new Request('http://localhost/settings?/save',{method:'POST',body:new URLSearchParams(values)})});
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
  try{
    await expect(submit({focusLayout:'now'})).resolves.toMatchObject({saved:true});
    expect(getSettings()).toMatchObject({...previous,focus_layout:'now'});
    expect((await (layoutLoad as any)({cookies:{get:()=>undefined},depends:vi.fn()})).settings.focus_layout).toBe('now');
    await submit({theme:'dark'});
    expect(getSettings().focus_layout).toBe('now');
    await expect(submit({focusLayout:'unknown',theme:'light'})).resolves.toMatchObject({status:400});
    expect(getSettings()).toMatchObject({focus_layout:'now',theme:'dark'});
    await expect(submit({focusLayout:'equal'})).resolves.toMatchObject({saved:true});
    expect(getSettings().focus_layout).toBe('equal');
  }finally{saveSettings({focus_layout:previous.focus_layout,theme:previous.theme});vi.unstubAllGlobals();}
});

test('Work on this persists the first Focus task, keeps Queue and other profiles, and advances on completion',async()=>{
  const profile=createProfile(`Focus ${crypto.randomUUID()}`),other=createProfile(`Other ${crypto.randomUUID()}`);
  const tasks=['First','Second','Third','Queue'].map(title=>createTask({title}));
  const date=today();
  const cookies={get:()=>String(profile)};
  const submit=(profileId=profile,planDate=date)=>(todayActions.move as any)({cookies,request:new Request('http://localhost/now?/move',{method:'POST',body:new URLSearchParams({id:String(tasks[2]),section:'focus',position:'0',profileId:String(profileId),planDate})})});
  try{
    scheduleTask(tasks[0],date,null);
    tasks.forEach((id,index)=>addToPlan(id,date,index<3?'focus':'also',undefined,profile));
    addToPlan(tasks[0],date,'focus',undefined,other);
    await expect(submit(other)).resolves.toMatchObject({status:400});
    await expect(submit(profile,'2000-01-01')).resolves.toMatchObject({status:400});
    await expect(submit()).resolves.toMatchObject({success:true});
    await expect(submit()).resolves.toMatchObject({success:true});
    expect(getNow(date,undefined,profile).map(task=>task.id)).toEqual([tasks[2],tasks[0],tasks[1],tasks[3]]);
    expect(getNow(date,undefined,other).map(task=>task.id)).toEqual([tasks[0]]);
    setTaskState(tasks[2],'completed');
    expect(getNow(date,undefined,profile).filter(task=>task.section==='focus').map(task=>task.id)).toEqual([tasks[0],tasks[1]]);
  }finally{
    database.sqlite.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(profile,other);
    for(const id of tasks)database.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(id);
  }
});

test('Appearance saves independently while AI is offline and rejects invalid choices atomically',async()=>{
  const previous=getSettings();
  const submit=(values:Record<string,string>)=>(settingsActions.appearance as any)({request:new Request('http://localhost/settings?/appearance',{method:'POST',body:new URLSearchParams(values)})});
  const fetch=vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch',fetch);
  try{
    await expect(submit({theme:'light',focusLayout:'now',currentPriorities:'Do not save this',aiUrl:'bad-url'})).resolves.toEqual({appearanceSaved:true});
    expect(getSettings()).toEqual({...previous,theme:'light',focus_layout:'now'});
    expect(fetch).not.toHaveBeenCalled();
    await expect(submit({theme:'dark',focusLayout:'invalid'})).resolves.toMatchObject({status:400});
    await expect(submit({theme:'invalid'})).resolves.toMatchObject({status:400});
    await expect(submit({})).resolves.toMatchObject({status:400});
    expect(getSettings()).toEqual({...previous,theme:'light',focus_layout:'now'});
    await expect(submit({theme:'system'})).resolves.toEqual({appearanceSaved:true});
    expect(getSettings().focus_layout).toBe('now');
  }finally{saveSettings({theme:previous.theme,focus_layout:previous.focus_layout});vi.unstubAllGlobals();}
});
