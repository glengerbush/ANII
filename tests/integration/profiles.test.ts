import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, database } from '../../src/lib/server/db';
import { activeProfileId, mutationProfileId } from '../../src/lib/server/profiles';
import { addToPlan, createAndPlan, createProfile, createProject, createTask, deleteProfile, exportData, getProfile, getNow, listProfiles, renameProfile } from '../../src/lib/server/repository';
import { actions as settingsActions } from '../../src/routes/settings/+page.server';
import { actions as todayActions } from '../../src/routes/now/+page.server';
import { actions as backlogActions } from '../../src/routes/backlog/+page.server';
const open:ReturnType<typeof createDatabase>[]=[];
const fresh=()=>{const db=createDatabase(':memory:');open.push(db);return db.sqlite;};
afterEach(()=>{for(const db of open.splice(0))db.sqlite.close();});

describe('profile lifecycle',()=>{
  test('rename preserves identity and plans; validates names case-insensitively',()=>{
    const db=fresh();const id=createProfile('Work',db);const task=createTask({title:'Shared task'},db);addToPlan(task,'2026-10-11','focus',db,id);
    expect(renameProfile(id,'  Office  ',db)).toBe('Office');expect(getProfile(id,db)?.name).toBe('Office');expect(getNow('2026-10-11',db,id).map(t=>t.id)).toEqual([task]);
    for(const invalid of ['','  ','x'.repeat(81),'DEFAULT'])expect(()=>renameProfile(id,invalid,db)).toThrow();
    expect(renameProfile(id,'office',db)).toBe('office');expect(()=>renameProfile(999,'Missing',db)).toThrow(/no longer exists/);
    expect(db.prepare(`SELECT count(*) n FROM events WHERE entity_type='profile' AND entity_id=? AND event_type='renamed'`).get(id)).toEqual({n:2});
  });
  test('delete cascades only profile plans and schedules, preserving shared data and audit history',()=>{
    const db=fresh();const id=createProfile('Work',db);const project=createProject('Shared project',db);const task=createTask({title:'Shared task',projectId:project},db);
    addToPlan(task,'2026-10-11','focus',db,id);addToPlan(task,'2026-10-11','also',db,1);
    const before=exportData(db).tables;
    expect(()=>deleteProfile(id,'Wrong',db)).toThrow(/exactly/);expect(exportData(db).tables).toEqual(before);
    expect(deleteProfile(id,'Work',db)).toEqual({name:'Work',fallbackId:1});
    for(const table of ['task_placements','task_day_hides','task_completions'])expect(db.prepare(`SELECT count(*) n FROM ${table} WHERE profile_id=?`).get(id)).toEqual({n:0});
    const after=exportData(db).tables;
    for(const table of ['tasks','projects','task_projects','messages','ai_proposals','dependencies','settings'] as const)expect(after[table]).toEqual(before[table]);
    expect(getNow('2026-10-11',db,1).map(t=>t.id)).toEqual([task]);
    expect(after.events.length).toBe(before.events.length+1);
    expect(()=>deleteProfile(id,'Work',db)).toThrow(/no longer exists/);
  });
  test('last profile is protected, including after deleting Default; repository defaults follow fallback',()=>{
    const db=fresh();const before=exportData(db).tables;
    expect(()=>deleteProfile(1,'Default',db)).toThrow(/at least one/);expect(exportData(db).tables).toEqual(before);
    const next=createProfile('Personal',db);deleteProfile(1,'Default',db);
    const cookies={get:()=> '1'} as any;expect(activeProfileId(cookies,db)).toBe(next);
    const task=createAndPlan('After Default deletion',undefined,db);expect(getNow(undefined,db).map(t=>t.id)).toEqual([task]);
    expect(()=>deleteProfile(next,'Personal',db)).toThrow(/at least one/);
  });
  test('Default stays deleted across reopening the database',()=>{
    const dir=mkdtempSync(join(tmpdir(),'anii-profile-'));let db=createDatabase(join(dir,'life.db'));
    try{const next=createProfile('Personal',db.sqlite);deleteProfile(1,'Default',db.sqlite);db.sqlite.close();db=createDatabase(join(dir,'life.db'));expect(listProfiles(db.sqlite).map(p=>p.id)).toEqual([next]);}
    finally{db.sqlite.close();rmSync(dir,{recursive:true,force:true});}
  });
  test('stale forms cannot mutate a deleted or different profile; refreshed pages can use fallback',()=>{
    const db=fresh();const id=createProfile('Temporary',db);const form=new FormData();form.set('profileId',String(id));
    const staleCookie={get:()=>String(id)} as any;
    expect(mutationProfileId(staleCookie,form,db)).toBe(id);deleteProfile(id,'Temporary',db);
    expect(()=>mutationProfileId(staleCookie,form,db)).toThrow(/Reload/);
    expect(()=>mutationProfileId({get:()=> '1'} as any,form,db)).toThrow(/Reload/);
    form.set('profileId','1');expect(mutationProfileId(staleCookie,form,db)).toBe(1);
  });
});

const request=(fields:Record<string,string>)=>{const body=new FormData();for(const [key,value] of Object.entries(fields))body.set(key,value);return new Request('http://localhost/settings',{method:'POST',body});};
describe('profile routes',()=>{
  test('rename and inactive deletion preserve selection; active deletion switches selection',async()=>{
    const first=createProfile(`First ${crypto.randomUUID()}`);const secondName=`Second ${crypto.randomUUID()}`;const second=createProfile(secondName);const cookies={get:()=>String(first),set:vi.fn()};
    try{
      const renamed=`Renamed ${crypto.randomUUID()}`;
      await expect((settingsActions.renameProfile as any)({request:request({profileId:String(first),name:renamed}),cookies})).resolves.toEqual({profileRenamed:renamed});expect(cookies.set).not.toHaveBeenCalled();
      await expect((settingsActions.deleteProfile as any)({request:request({profileId:String(second),confirmation:'wrong'}),cookies})).resolves.toMatchObject({status:400});expect(getProfile(second)).toBeDefined();
      await expect((settingsActions.deleteProfile as any)({request:request({profileId:String(second),confirmation:secondName}),cookies})).resolves.toEqual({profileDeleted:secondName});expect(cookies.set).not.toHaveBeenCalled();
      await expect((settingsActions.deleteProfile as any)({request:request({profileId:String(first),confirmation:renamed}),cookies})).resolves.toEqual({profileDeleted:renamed});expect(cookies.set).toHaveBeenCalledWith('life_profile','1',expect.objectContaining({path:'/',httpOnly:true}));
    }finally{database.sqlite.prepare('DELETE FROM profiles WHERE id IN (?,?)').run(first,second);}
  });
  test('Now and Backlog reject stale forms without any data changes',async()=>{
    const name=`Stale ${crypto.randomUUID()}`;const id=createProfile(name);deleteProfile(id,name);
    const before=exportData().tables;
    for(const action of [todayActions.quickAdd,todayActions.section,todayActions.remove,todayActions.reorder,todayActions.move,todayActions.concern,backlogActions.plan]){
      // Simulates another tab having already switched the browser cookie after deletion.
      const result=await (action as any)({request:request({profileId:String(id),title:'Must not be created',id:'1',taskId:'1'}),cookies:{get:()=> '1'}});
      expect(result).toMatchObject({status:400,data:{error:expect.stringContaining('Reload')}});
      expect(exportData().tables).toEqual(before);
    }
  });
});
