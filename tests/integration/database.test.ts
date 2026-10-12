import { afterEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import Database from 'better-sqlite3';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, backupDatabase } from '../../src/lib/server/db';
import { restoreDatabaseBytes } from '../../src/lib/server/database-restore';
import { RequestGate, requestGateMode } from '../../src/lib/server/request-gate';
import { cleanupStaleRestoreDirectories } from '../../src/lib/server/restore-staging';
import { activeProfileId } from '../../src/lib/server/profiles';
import { acceptProposal, addDependency, addToPlan, applySanityChoice, buildSanityContext, closeOutToday, closeReview, completeReviewFocus, createProfile, createProject, createProjectForTask, createTask, deleteProject, deleteTask, deterministicWarnings, exportData, getBacklog, getCurrentReviewSession, getReviewSession, getTask, getToday, importData, listProjects, movePlan, planReviewTomorrow, recordMessage, recordProposal, removeTaskProject, renameProject, reorderPlan, reviewDecision, setFocus, setPlanFocus, setPlanTasks, setTaskState, tomorrow, updateTask } from '../../src/lib/server/repository';
import { sanityResponse } from '../../src/lib/server/ai';

const open:Array<ReturnType<typeof createDatabase>>=[];
function fresh(){const db=createDatabase(':memory:');open.push(db);return db;}
afterEach(()=>{for(const db of open.splice(0))db.sqlite.close();});

describe('planning invariants',()=>{
  test('profiles isolate daily plans and Focus while completion stays shared',()=>{
    const {sqlite}=fresh();const second=createProfile('Jordan',sqlite);const ids=[1,2,3,4].map(n=>createTask({title:`Shared ${n}`},sqlite));
    ids.slice(0,3).forEach(id=>addToPlan(id,'2026-08-05','focus',sqlite));
    addToPlan(ids[0],'2026-08-05','also',sqlite,second);addToPlan(ids[3],'2026-08-05','focus',sqlite,second);
    expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual(ids.slice(0,3));
    expect(getToday('2026-08-05',sqlite,second).map(t=>[t.id,t.section])).toEqual([[ids[3],'focus'],[ids[0],'also']]);
    expect(()=>addToPlan(ids[3],'2026-08-05','focus',sqlite)).toThrow(/three/);
    setTaskState(ids[0],'completed',sqlite);
    expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual(ids.slice(1,3));
    expect(getToday('2026-08-05',sqlite,second).map(t=>t.id)).toEqual([ids[3]]);
  });

  test('reviews are profile-specific',()=>{
    const {sqlite}=fresh();const second=createProfile('Taylor',sqlite);const task=createTask({title:'Shared review'},sqlite);addToPlan(task,'2026-08-05','also',sqlite);addToPlan(task,'2026-08-05','also',sqlite,second);
    reviewDecision(task,'today','2026-08-05',sqlite);expect(()=>closeReview('2026-08-05',sqlite)).not.toThrow();expect(()=>closeReview('2026-08-05',sqlite,second)).toThrow(/Every unfinished/);
    reviewDecision(task,'today','2026-08-05',sqlite,second);expect(()=>closeReview('2026-08-05',sqlite,second)).not.toThrow();
    expect(sqlite.prepare(`SELECT profile_id,count(*) count FROM reviews GROUP BY profile_id ORDER BY profile_id`).all()).toEqual([{profile_id:1,count:1},{profile_id:second,count:1}]);
  });

  test('profile migration preserves existing daily plans',()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-profile-migration-'));const path=join(dir,'life.db');const legacy=new Database(path);legacy.exec(readFileSync('drizzle/0000_initial.sql','utf8'));legacy.prepare(`INSERT INTO tasks(title) VALUES('Existing')`).run();legacy.prepare(`INSERT INTO daily_plans(plan_date,task_id,section,position) VALUES('2026-08-05',1,'also',0)`).run();legacy.close();
    const migrated=createDatabase(path);open.push(migrated);expect(getToday('2026-08-05',migrated.sqlite)).toMatchObject([{title:'Existing',section:'also'}]);expect(migrated.sqlite.prepare(`SELECT name FROM profiles WHERE id=1`).get()).toEqual({name:'Default'});migrated.sqlite.close();open.splice(open.indexOf(migrated),1);rmSync(dir,{recursive:true});
  });

  test('legacy project assignments migrate to labels once',()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-project-migration-'));const path=join(dir,'life.db');const legacy=new Database(path);legacy.exec(readFileSync('drizzle/0000_initial.sql','utf8'));legacy.prepare(`INSERT INTO projects(name) VALUES('Legacy')`).run();legacy.prepare(`INSERT INTO tasks(title,project_id) VALUES('Existing',1)`).run();legacy.close();
    const migrated=createDatabase(path);open.push(migrated);expect(getTask(1,migrated.sqlite)?.project_ids).toEqual([1]);expect(migrated.sqlite.prepare(`SELECT project_id FROM tasks WHERE id=1`).get()).toEqual({project_id:null});migrated.sqlite.close();open.splice(open.indexOf(migrated),1);
    const reopened=createDatabase(path);open.push(reopened);expect(reopened.sqlite.prepare(`SELECT count(*) n FROM task_projects WHERE task_id=1 AND project_id=1`).get()).toEqual({n:1});reopened.sqlite.close();open.splice(open.indexOf(reopened),1);rmSync(dir,{recursive:true});
  });

  test('tasks can carry, change, filter, and remove multiple project labels',()=>{
    const {sqlite}=fresh();const work=createProject('Work',sqlite);const home=createProject('Home',sqlite);const task=createTask({title:'Shared task',projectIds:[work,home]},sqlite);
    expect(getTask(task,sqlite)).toMatchObject({project_ids:[home,work],project_names:['Home','Work']});expect(getBacklog({project:work},sqlite).map((item)=>item.id)).toEqual([task]);expect(getBacklog({project:home},sqlite).map((item)=>item.id)).toEqual([task]);expect(listProjects(sqlite).map((project)=>[project.name,project.open_count])).toEqual([['Home',1],['Work',1]]);
    removeTaskProject(task,work,sqlite);expect(getTask(task,sqlite)?.project_ids).toEqual([home]);updateTask(task,{projectIds:[work]},sqlite);expect(getTask(task,sqlite)?.project_ids).toEqual([work]);expect(getBacklog({project:home},sqlite)).toEqual([]);
  });

  test('project tags can be created on a task and project deletion only removes its tags',()=>{
    const {sqlite}=fresh();const task=createTask({title:'Keep me'},sqlite);const first=createProjectForTask(task,'First',sqlite);const second=createProjectForTask(task,'Second',sqlite);expect(getTask(task,sqlite)?.project_ids).toEqual([first,second]);
    deleteProject(first,sqlite);expect(getTask(task,sqlite)).toMatchObject({id:task,title:'Keep me',project_ids:[second]});expect(listProjects(sqlite).map((project)=>project.name)).toEqual(['Second']);expect(sqlite.prepare(`SELECT count(*) n FROM tasks WHERE id=?`).get(task)).toEqual({n:1});
  });

  test('project summaries report useful remaining work and rename safely',()=>{
    const {sqlite}=fresh();const project=createProject('Before',sqlite),other=createProject('Taken',sqlite);const prerequisite=createTask({title:'Prerequisite'},sqlite);
    const estimated=createTask({title:'Estimated',projectIds:[project],duration:'30m',dueAt:'2026-08-01'},sqlite);createTask({title:'Open ended',projectIds:[project],duration:'2h+'},sqlite);createTask({title:'Unestimated',projectIds:[project]},sqlite);const waiting=createTask({title:'Waiting',projectIds:[project]},sqlite);setTaskState(waiting,'waiting',sqlite);const completed=createTask({title:'Completed',projectIds:[project],duration:'1h'},sqlite);setTaskState(completed,'completed',sqlite);addDependency(estimated,prerequisite,'hard',undefined,sqlite);
    expect(listProjects(sqlite,'2026-08-05').find((item)=>item.id===project)).toMatchObject({active_count:4,remaining_minutes:150,remaining_open_ended:1,needs_attention_count:1,waiting_count:1,completed_count:1,unestimated_count:2});
    renameProject(project,'  After  ',sqlite);expect(listProjects(sqlite).find((item)=>item.id===project)?.name).toBe('After');expect(()=>renameProject(project,'Taken',sqlite)).toThrow();expect(()=>renameProject(other,' ',sqlite)).toThrow(/required/i);
  });

  test('hard deletion removes every task relationship while preserving audit history',()=>{
    const {sqlite}=fresh();const profile=createProfile('Second',sqlite),project=createProject('Delete test',sqlite),message=recordMessage('Delete accepted result',sqlite),proposal=recordProposal(message,{title:'Delete me',details:'source remains'}, {},sqlite),task=acceptProposal(proposal,sqlite),prerequisite=createTask({title:'Prerequisite'},sqlite),dependent=createTask({title:'Dependent'},sqlite);updateTask(task,{projectIds:[project]},sqlite);addToPlan(task,'2026-08-05','also',sqlite);addToPlan(task,'2026-08-05','focus',sqlite,profile);addDependency(task,prerequisite,'hard',undefined,sqlite);addDependency(dependent,task,'soft',undefined,sqlite);
    deleteTask(task,sqlite);
    expect(getTask(task,sqlite)).toBeUndefined();expect(getToday('2026-08-05',sqlite)).toEqual([]);expect(getToday('2026-08-05',sqlite,profile)).toEqual([]);expect(listProjects(sqlite).find((item)=>item.id===project)?.active_count).toBe(0);expect(sqlite.prepare(`SELECT count(*) n FROM dependencies WHERE task_id=? OR prerequisite_task_id=?`).get(task,task)).toEqual({n:0});expect(sqlite.prepare(`SELECT result_type,result_id FROM ai_proposals WHERE id=?`).get(proposal)).toEqual({result_type:'task',result_id:task});expect(sqlite.prepare(`SELECT count(*) n FROM events WHERE entity_type='task' AND entity_id=? AND event_type='deleted'`).get(task)).toEqual({n:1});
  });

  test('review Delete hard-deletes atomically',()=>{
    const {sqlite}=fresh();const remove=createTask({title:'Remove'},sqlite),keep=createTask({title:'Keep'},sqlite);addToPlan(remove,'2026-08-05','also',sqlite);addToPlan(keep,'2026-08-05','also',sqlite);
    expect(()=>closeOutToday([{taskId:remove,outcome:'delete'},{taskId:keep,outcome:'invalid' as any}],'2026-08-05',sqlite)).toThrow(/Invalid/);expect(getTask(remove,sqlite)).toBeDefined();
    closeOutToday([{taskId:remove,outcome:'delete'},{taskId:keep,outcome:'backlog'}],'2026-08-05',sqlite);expect(getTask(remove,sqlite)).toBeUndefined();expect(getTask(keep,sqlite)).toBeDefined();
  });

  test('review-session migration backfills duplicate legacy reviews deterministically',()=>{const dir=mkdtempSync(join(tmpdir(),'life-review-migration-'));const path=join(dir,'life.db');const legacy=new Database(path);legacy.exec(readFileSync('drizzle/0000_initial.sql','utf8'));legacy.exec(readFileSync('drizzle/0001_profiles.sql','utf8'));legacy.prepare(`INSERT INTO reviews(review_date,profile_id,closed_at) VALUES('2026-08-04',1,'2026-08-04 20:00:00'),('2026-08-04',1,'2026-08-04 21:00:00')`).run();legacy.close();const migrated=createDatabase(path);open.push(migrated);expect(migrated.sqlite.prepare(`SELECT profile_id,review_date,tomorrow_date,stage,started_at,completed_at FROM review_sessions`).all()).toEqual([{profile_id:1,review_date:'2026-08-04',tomorrow_date:'2026-08-05',stage:'done',started_at:'2026-08-04 20:00:00',completed_at:'2026-08-04 21:00:00'}]);expect(getCurrentReviewSession('2026-08-04',migrated.sqlite).stage).toBe('done');migrated.sqlite.close();open.splice(open.indexOf(migrated),1);rmSync(dir,{recursive:true});});

  test('Focus cannot exceed three through operations or direct date updates',()=>{
    const {sqlite}=fresh();const ids=[1,2,3,4].map(n=>createTask({title:`T${n}`},sqlite));
    ids.slice(0,3).forEach(id=>addToPlan(id,'2026-08-05','focus',sqlite));
    expect(()=>addToPlan(ids[3],'2026-08-05','focus',sqlite)).toThrow(/three/);
    addToPlan(ids[3],'2026-08-06','focus',sqlite);
    expect(()=>sqlite.prepare(`UPDATE daily_plans SET plan_date='2026-08-05' WHERE task_id=?`).run(ids[3])).toThrow(/three/);
    expect(getToday('2026-08-05',sqlite).map(t=>t.section)).toEqual(['focus','focus','focus']);
    setTaskState(ids[0],'completed',sqlite);expect(()=>addToPlan(ids[3],'2026-08-05','focus',sqlite)).not.toThrow();expect(()=>setTaskState(ids[0],'open',sqlite)).toThrow(/three/);const extra=createTask({title:'Extra'},sqlite);expect(()=>sqlite.prepare(`UPDATE daily_plans SET task_id=? WHERE plan_date='2026-08-05' AND task_id=?`).run(extra,ids[0])).toThrow(/immutable|three/i);
  });

  test('due date is independent and unfinished work never rolls over',()=>{
    const {sqlite}=fresh();const id=createTask({title:'Deadline',dueAt:'2026-08-06'},sqlite);addToPlan(id,'2026-08-05','also',sqlite);
    expect((sqlite.prepare(`SELECT created_at FROM tasks WHERE id=?`).get(id) as {created_at:string}).created_at).not.toBe('CURRENT_TIMESTAMP');
    expect(getToday('2026-08-05',sqlite)[0]).toMatchObject({due_at:'2026-08-06',section:'also'});
    expect(getToday('2026-08-06',sqlite)).toEqual([]);
    reviewDecision(id,'tomorrow','2026-08-05',sqlite);
    expect(getToday('2026-08-06',sqlite)).toHaveLength(1);
  });

  test('review closes only after explicit outcomes and permits reviewed Today',()=>{
    const {sqlite}=fresh();const stay=createTask({title:'Stay'},sqlite);const backlog=createTask({title:'Backlog'},sqlite);addToPlan(stay,'2026-08-05','also',sqlite);addToPlan(backlog,'2026-08-05','also',sqlite);
    expect(()=>closeReview('2026-08-05',sqlite)).toThrow(/Every unfinished/);
    reviewDecision(stay,'today','2026-08-05',sqlite);reviewDecision(backlog,'backlog','2026-08-05',sqlite);setFocus([stay],'2026-08-05',sqlite);
    expect(()=>closeReview('2026-08-05',sqlite)).not.toThrow();expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual([stay]);
  });

  test('staged review plans every Tomorrow task then Focus for only the active profile',()=>{const {sqlite}=fresh();const second=createProfile('Second',sqlite);const carry=createTask({title:'Carry'},sqlite),added=createTask({title:'Added'},sqlite);addToPlan(carry,'2026-08-05','also',sqlite);addToPlan(carry,'2026-08-05','focus',sqlite,second);closeOutToday([{taskId:carry,outcome:'tomorrow'}],'2026-08-05',sqlite);expect(getReviewSession('2026-08-05',sqlite)).toMatchObject({stage:'plan',tomorrowDate:'2026-08-06'});expect(sqlite.prepare(`SELECT count(*) n FROM reviews`).get()).toEqual({n:0});expect(getToday('2026-08-05',sqlite)).toEqual([]);expect(getToday('2026-08-05',sqlite,second).map(t=>t.id)).toEqual([carry]);planReviewTomorrow([carry,added],'2026-08-05',sqlite);expect(getReviewSession('2026-08-05',sqlite).stage).toBe('focus');expect(getToday('2026-08-06',sqlite).map(t=>[t.id,t.section])).toEqual([[carry,'also'],[added,'also']]);expect(getToday('2026-08-06',sqlite,second)).toEqual([]);completeReviewFocus([added],'2026-08-05',sqlite);expect(getReviewSession('2026-08-05',sqlite).stage).toBe('done');expect(getToday('2026-08-06',sqlite).map(t=>[t.id,t.section])).toEqual([[added,'focus'],[carry,'also']]);expect(sqlite.prepare(`SELECT profile_id FROM reviews`).all()).toEqual([{profile_id:1}]);});

  test('review stage survives reload semantics and rejects skips or repeats',()=>{const {sqlite}=fresh();const task=createTask({title:'Stage'},sqlite);addToPlan(task,'2026-08-05','also',sqlite);expect(getReviewSession('2026-08-05',sqlite).stage).toBe('close');expect(()=>planReviewTomorrow([task],'2026-08-05',sqlite)).toThrow(/Close Out/);expect(()=>completeReviewFocus([],'2026-08-05',sqlite)).toThrow(/Plan Tomorrow/);closeOutToday([{taskId:task,outcome:'tomorrow'}],'2026-08-05',sqlite);expect(getReviewSession('2026-08-05',sqlite).stage).toBe('plan');expect(()=>closeOutToday([],'2026-08-05',sqlite)).toThrow(/already/);expect(()=>completeReviewFocus([],'2026-08-05',sqlite)).toThrow(/Plan Tomorrow/);planReviewTomorrow([task],'2026-08-05',sqlite);expect(getReviewSession('2026-08-05',sqlite).stage).toBe('focus');expect(()=>planReviewTomorrow([],'2026-08-05',sqlite)).toThrow(/Close Out/);completeReviewFocus([task],'2026-08-05',sqlite);expect(getReviewSession('2026-08-05',sqlite).stage).toBe('done');expect(()=>completeReviewFocus([],'2026-08-05',sqlite)).toThrow(/Plan Tomorrow/);expect(sqlite.prepare(`SELECT count(*) n FROM reviews`).get()).toEqual({n:1});});

  test('unfinished review resumes across midnight before a new day starts',()=>{const {sqlite}=fresh();const task=createTask({title:'Midnight'},sqlite);addToPlan(task,'2026-08-05','also',sqlite);closeOutToday([{taskId:task,outcome:'tomorrow'}],'2026-08-05',sqlite);expect(getCurrentReviewSession('2026-08-06',sqlite)).toEqual({stage:'plan',reviewDate:'2026-08-05',tomorrowDate:'2026-08-06'});planReviewTomorrow([task],'2026-08-05',sqlite);expect(getCurrentReviewSession('2026-08-07',sqlite).stage).toBe('focus');completeReviewFocus([task],'2026-08-05',sqlite);expect(getCurrentReviewSession('2026-08-05',sqlite).stage).toBe('done');expect(getCurrentReviewSession('2026-08-06',sqlite)).toEqual({stage:'close',reviewDate:'2026-08-06',tomorrowDate:'2026-08-07'});});

  test('Plan Tomorrow replaces active selection while preserving hidden rows',()=>{const {sqlite}=fresh();const a=createTask({title:'A'},sqlite),b=createTask({title:'B'},sqlite),c=createTask({title:'C'},sqlite),hidden=createTask({title:'Done'},sqlite);addToPlan(a,'2026-08-06','focus',sqlite);addToPlan(b,'2026-08-06','also',sqlite);addToPlan(c,'2026-08-06','also',sqlite);addToPlan(hidden,'2026-08-06','also',sqlite);setTaskState(hidden,'completed',sqlite);setPlanTasks([c,a],'2026-08-06',sqlite);expect(getToday('2026-08-06',sqlite).map(t=>[t.id,t.section])).toEqual([[c,'also'],[a,'also']]);expect(sqlite.prepare(`SELECT section FROM daily_plans WHERE task_id=?`).get(hidden)).toEqual({section:'also'});expect(sqlite.prepare(`SELECT count(*) n FROM daily_plans WHERE task_id=?`).get(b)).toEqual({n:0});});

  test('Tomorrow Focus is a capped subset and preserves Also order',()=>{const {sqlite}=fresh();const ids=['A','B','C','D'].map(title=>createTask({title},sqlite));setPlanTasks(ids,'2026-08-06',sqlite);setPlanFocus([ids[2],ids[0]],'2026-08-06',sqlite);expect(getToday('2026-08-06',sqlite).map(t=>[t.id,t.section])).toEqual([[ids[2],'focus'],[ids[0],'focus'],[ids[1],'also'],[ids[3],'also']]);const before=getToday('2026-08-06',sqlite).map(t=>[t.id,t.section]);expect(()=>setPlanFocus(ids,'2026-08-06',sqlite)).toThrow(/three/);const outside=createTask({title:'Outside'},sqlite);expect(()=>setPlanFocus([outside],'2026-08-06',sqlite)).toThrow(/Tomorrow/);expect(getToday('2026-08-06',sqlite).map(t=>[t.id,t.section])).toEqual(before);});

  test('Close Out is atomic and shared completion removes a task for every profile',()=>{const {sqlite}=fresh();const second=createProfile('Other',sqlite);const complete=createTask({title:'Complete'},sqlite),keep=createTask({title:'Keep'},sqlite);for(const id of [complete,keep])addToPlan(id,'2026-08-05','also',sqlite);addToPlan(complete,'2026-08-05','also',sqlite,second);expect(()=>closeOutToday([{taskId:complete,outcome:'completed'},{taskId:keep,outcome:'invalid' as any}],'2026-08-05',sqlite)).toThrow(/Invalid/);expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual([complete,keep]);closeOutToday([{taskId:complete,outcome:'completed'},{taskId:keep,outcome:'backlog'}],'2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite)).toEqual([]);expect(getToday('2026-08-05',sqlite,second)).toEqual([]);expect(sqlite.prepare(`SELECT state FROM tasks WHERE id=?`).get(complete)).toEqual({state:'completed'});});

  test('Focus selection replaces the prior set atomically',()=>{const {sqlite}=fresh();const ids=[1,2,3,4].map(n=>createTask({title:`F${n}`},sqlite));ids.slice(0,3).forEach(id=>addToPlan(id,'2026-08-05','focus',sqlite));setFocus([ids[3]],'2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).filter(t=>t.section==='focus').map(t=>t.id)).toEqual([ids[3]]);});

  test('drag moves reorder and cross sections without bypassing Focus capacity',()=>{const {sqlite}=fresh();const ids=[1,2,3,4].map(n=>createTask({title:`D${n}`},sqlite));addToPlan(ids[0],'2026-08-05','focus',sqlite);ids.slice(1).forEach(id=>addToPlan(id,'2026-08-05','also',sqlite));movePlan(ids[3],'also',0,'2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual([ids[0],ids[3],ids[1],ids[2]]);movePlan(ids[1],'focus',1,'2026-08-05',sqlite);movePlan(ids[2],'focus',1,'2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).filter(t=>t.section==='focus').map(t=>t.id)).toEqual([ids[0],ids[2],ids[1]]);expect(()=>movePlan(ids[3],'focus',0,'2026-08-05',sqlite)).toThrow(/three/);});

  test('drag positions are exact in both directions and clamp to section bounds',()=>{const {sqlite}=fresh();const ids=['A','B','C'].map(title=>createTask({title},sqlite));ids.forEach(id=>addToPlan(id,'2026-08-05','also',sqlite));movePlan(ids[2],'also',0,'2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual([ids[2],ids[0],ids[1]]);movePlan(ids[2],'also',99,'2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual([ids[0],ids[1],ids[2]]);movePlan(ids[1],'also',-9,'2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual([ids[1],ids[0],ids[2]]);});

  test('hidden completed and legacy dropped rows never absorb visible drag positions',()=>{const {sqlite}=fresh();const hiddenSource=createTask({title:'Hidden source'},sqlite),moving=createTask({title:'Moving'},sqlite),hiddenTarget=createTask({title:'Hidden target'},sqlite),a=createTask({title:'A'},sqlite),b=createTask({title:'B'},sqlite);addToPlan(hiddenSource,'2026-08-05','focus',sqlite);addToPlan(moving,'2026-08-05','focus',sqlite);addToPlan(hiddenTarget,'2026-08-05','also',sqlite);addToPlan(a,'2026-08-05','also',sqlite);addToPlan(b,'2026-08-05','also',sqlite);setTaskState(hiddenSource,'completed',sqlite);expect(()=>setTaskState(hiddenTarget,'dropped',sqlite)).toThrow(/legacy/i);sqlite.prepare(`UPDATE tasks SET state='dropped' WHERE id=?`).run(hiddenTarget);movePlan(moving,'also',1,'2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).filter(t=>t.section==='also').map(t=>t.id)).toEqual([a,moving,b]);expect(sqlite.prepare(`SELECT task_id,section FROM daily_plans WHERE task_id IN (?,?) ORDER BY task_id`).all(hiddenSource,hiddenTarget)).toEqual([{task_id:hiddenSource,section:'focus'},{task_id:hiddenTarget,section:'also'}]);});

  test('fallback arrows skip hidden rows and no-op drops do not rewrite or audit',()=>{const {sqlite}=fresh();const hidden=createTask({title:'Hidden'},sqlite),a=createTask({title:'A'},sqlite),b=createTask({title:'B'},sqlite);[hidden,a,b].forEach(id=>addToPlan(id,'2026-08-05','also',sqlite));setTaskState(hidden,'completed',sqlite);const before=sqlite.prepare(`SELECT task_id,position FROM daily_plans ORDER BY task_id`).all();movePlan(a,'also',0,'2026-08-05',sqlite);expect(sqlite.prepare(`SELECT task_id,position FROM daily_plans ORDER BY task_id`).all()).toEqual(before);expect(sqlite.prepare(`SELECT count(*) n FROM events WHERE event_type='moved'`).get()).toEqual({n:0});reorderPlan(a,'down','2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual([b,a]);expect(sqlite.prepare(`SELECT count(*) n FROM daily_plans WHERE task_id=?`).get(hidden)).toEqual({n:1});});

  test.each(['today','tomorrow','backlog','waiting','delete'] as const)('review records %s explicitly',(decision)=>{
    const {sqlite}=fresh();const id=createTask({title:decision},sqlite);addToPlan(id,'2026-08-05','also',sqlite);reviewDecision(id,decision,'2026-08-05',sqlite);
    const audit=sqlite.prepare(`SELECT data FROM events WHERE entity_type='review' AND entity_id=? AND event_type='decision'`).get(id) as {data:string};expect(JSON.parse(audit.data).decision).toBe(decision);
    if(decision==='today')expect(getToday('2026-08-05',sqlite)).toHaveLength(1);if(decision==='tomorrow')expect(getToday('2026-08-06',sqlite)).toHaveLength(1);if(['backlog','waiting','delete'].includes(decision))expect(getToday('2026-08-05',sqlite)).toHaveLength(0);if(decision==='delete')expect(getTask(id,sqlite)).toBeUndefined();
  });
});

describe('dependency integrity',()=>{
  test('hard prerequisite blocks until completed, including when dropped',()=>{
    const {sqlite}=fresh();const task=createTask({title:'Ship'},sqlite);const pre=createTask({title:'Approve'},sqlite);addDependency(task,pre,'hard',undefined,sqlite);
    expect(getBacklog({},sqlite).find(t=>t.id===task)?.blocked).toBe(1);sqlite.prepare(`UPDATE tasks SET state='dropped' WHERE id=?`).run(pre);expect(getBacklog({},sqlite).find(t=>t.id===task)?.blocked).toBe(1);
    sqlite.prepare(`UPDATE tasks SET state='completed' WHERE id=?`).run(pre);expect(getBacklog({},sqlite).find(t=>t.id===task)?.blocked).toBe(0);
  });

  test('soft dependencies never derive blocked state',()=>{const {sqlite}=fresh();const task=createTask({title:'Draft'},sqlite);const pre=createTask({title:'Read'},sqlite);addDependency(task,pre,'soft',undefined,sqlite);expect(getBacklog({},sqlite).find(t=>t.id===task)?.blocked).toBe(0);});

  test('cycles are impossible through inserts and edge updates',()=>{
    const {sqlite}=fresh();const a=createTask({title:'A'},sqlite),b=createTask({title:'B'},sqlite),c=createTask({title:'C'},sqlite);addDependency(a,b,'hard',undefined,sqlite);addDependency(b,c,'soft',undefined,sqlite);
    expect(()=>addDependency(c,a,'hard',undefined,sqlite)).toThrow(/cycle/i);
    expect(()=>sqlite.prepare(`INSERT INTO dependencies(task_id,prerequisite_task_id,kind) VALUES(?,?,'hard')`).run(c,a)).toThrow(/cycle/i);
    expect(()=>sqlite.prepare(`UPDATE dependencies SET prerequisite_task_id=? WHERE task_id=?`).run(a,b)).toThrow(/immutable/i);
  });

  test('dependency source message is a real nullable foreign key',()=>{const {sqlite}=fresh();const task=createTask({title:'Task'},sqlite),pre=createTask({title:'Pre'},sqlite),message=recordMessage('source',sqlite);addDependency(task,pre,'hard',message,sqlite);sqlite.prepare(`DELETE FROM messages WHERE id=?`).run(message);expect(sqlite.prepare(`SELECT source_message_id FROM dependencies WHERE task_id=?`).get(task)).toEqual({source_message_id:null});});

  test('sanity context includes priorities, capacity, and prerequisite chains',()=>{
    const {sqlite}=fresh();sqlite.prepare(`UPDATE settings SET value='Health first' WHERE key='current_priorities'`).run();const a=createTask({title:'A'},sqlite),b=createTask({title:'B'},sqlite);addToPlan(a,'2026-08-05','also',sqlite);addDependency(a,b,'hard',undefined,sqlite);
    expect(buildSanityContext('2026-08-05',sqlite)).toMatchObject({currentPriorities:'Health first',dailyCapacityMinutes:480,prerequisiteChains:[{task_id:a,prerequisite_id:b}]});
  });

  test('sanity contract rejects more than three concerns',()=>{const concern={taskId:1,observation:'x',reason:'y',choices:['Keep']};expect(sanityResponse.safeParse({concerns:[concern,concern,concern]}).success).toBe(true);expect(sanityResponse.safeParse({concerns:[concern,concern,concern,concern]}).success).toBe(false);});
  test('every advertised sanity choice has behavior',()=>{const {sqlite}=fresh();const keep=createTask({title:'Keep'},sqlite),move=createTask({title:'Move'},sqlite);addToPlan(keep,'2026-08-05','also',sqlite);addToPlan(move,'2026-08-05','also',sqlite);applySanityChoice(keep,'Keep','2026-08-05',sqlite);applySanityChoice(move,'Move','2026-08-05',sqlite);expect(getToday('2026-08-05',sqlite).map(t=>t.id)).toEqual([keep]);expect(sqlite.prepare(`SELECT count(*) n FROM events WHERE event_type='sanity_choice'`).get()).toEqual({n:2});expect(()=>applySanityChoice(keep,'Explain' as any,'2026-08-05',sqlite)).toThrow(/Unsupported/);});
  test('deterministic warnings catch overdue and over-capacity plans',()=>{const {sqlite}=fresh();sqlite.prepare(`UPDATE settings SET value='30' WHERE key='daily_capacity_minutes'`).run();const id=createTask({title:'Large overdue task',dueAt:'2026-08-04',duration:'1h'},sqlite);addToPlan(id,'2026-08-05','also',sqlite);expect(deterministicWarnings('2026-08-05',sqlite).map(w=>w.kind)).toEqual(['overdue','capacity']);});
});

describe('proposal safety and recovery',()=>{
  test('AI output cannot mutate without recorded acceptance and remains traceable',()=>{
    const {sqlite}=fresh();const message=recordMessage('Need to call Sam',sqlite);const proposal=recordProposal(message,{title:'Call Sam',details:''},{model:'test'},sqlite);
    expect(getBacklog({},sqlite)).toEqual([]);const task=acceptProposal(proposal,sqlite);expect(getBacklog({},sqlite).map(t=>t.title)).toEqual(['Call Sam']);
    expect(sqlite.prepare(`SELECT message_id,status,result_id FROM ai_proposals WHERE id=?`).get(proposal)).toEqual({message_id:message,status:'accepted',result_id:task});
    expect(sqlite.prepare(`SELECT count(*) n FROM events WHERE entity_type='proposal' AND entity_id=? AND event_type='accepted'`).get(proposal)).toEqual({n:1});
  });

  test('malformed proposal cannot create a task',()=>{const {sqlite}=fresh();const m=recordMessage('x',sqlite);expect(()=>recordProposal(m,{title:''},{},sqlite)).toThrow();expect(getBacklog({},sqlite)).toEqual([]);});

  test('export/import round trips and malformed restore rolls back',()=>{
    const {sqlite}=fresh();createTask({title:'Safe'},sqlite);const snapshot=exportData(sqlite);createTask({title:'Extra'},sqlite);importData(snapshot,sqlite);expect(getBacklog({},sqlite).map(t=>t.title)).toEqual(['Safe']);
    const bad=structuredClone(snapshot) as any;bad.tables.tasks[0].unknown='bad';expect(()=>importData(bad,sqlite)).toThrow(/Invalid columns/);expect(getBacklog({},sqlite).map(t=>t.title)).toEqual(['Safe']);
    const noProfiles=structuredClone(snapshot) as any;noProfiles.tables.profiles=[];expect(()=>importData(noProfiles,sqlite)).toThrow(/profile/i);const missingSetting=structuredClone(snapshot) as any;missingSetting.tables.settings=missingSetting.tables.settings.filter((row:any)=>row.key!=='theme');expect(()=>importData(missingSetting,sqlite)).toThrow(/required settings/i);expect(getBacklog({},sqlite).map(t=>t.title)).toEqual(['Safe']);
  });

  test('legacy v1 export without review sessions imports and backfills completion',()=>{const {sqlite}=fresh();sqlite.prepare(`INSERT INTO reviews(review_date,profile_id,closed_at) VALUES('2026-08-03',1,'2026-08-03 22:00:00')`).run();const legacy=exportData(sqlite) as any;delete legacy.tables.review_sessions;expect(()=>importData(legacy,sqlite)).not.toThrow();expect(sqlite.prepare(`SELECT review_date,tomorrow_date,stage,completed_at FROM review_sessions`).all()).toEqual([{review_date:'2026-08-03',tomorrow_date:'2026-08-04',stage:'done',completed_at:'2026-08-03 22:00:00'}]);});

  test('SQLite backup is a consistent readable snapshot',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-mvp-'));const path=join(dir,'life.db');const source=createDatabase(path);open.push(source);createTask({title:'Backed up'},source.sqlite);const target=await backupDatabase(path,source);expect(target).not.toBeNull();expect(readFileSync(target!).length).toBeGreaterThan(0);expect(statSync(dirname(target!)).mode&0o777).toBe(0o700);expect(statSync(target!).mode&0o777).toBe(0o600);createTask({title:'Latest'},source.sqlite);await backupDatabase(path,source);const restored=createDatabase(target!);open.push(restored);expect(getBacklog({},restored.sqlite).map(t=>t.title).sort()).toEqual(['Backed up','Latest']);for(const db of open.splice(0))db.sqlite.close();rmSync(dir,{recursive:true});
  });

  test('SQLite restore replaces data through the live connection and retains a verified pre-restore backup',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-db-restore-'));const livePath=join(dir,'live.db'),incomingPath=join(dir,'incoming.db'),uploadPath=join(dir,'upload.db'),stagingRoot=join(dir,'staging');mkdirSync(stagingRoot);const live=createDatabase(livePath),incoming=createDatabase(incomingPath);open.push(live,incoming);const staleProfile=createProfile('Removed by restore',live.sqlite);createTask({title:'Before restore'},live.sqlite);createTask({title:'From backup'},incoming.sqlite);incoming.sqlite.prepare(`DELETE FROM profiles`).run();incoming.sqlite.prepare(`INSERT INTO profiles(id,name) VALUES(7,'Restored profile')`).run();await incoming.sqlite.backup(uploadPath);const sameConnection=live.sqlite;
    const result=await restoreDatabaseBytes(readFileSync(uploadPath),{liveDatabase:live,livePath,stagingRoot});
    expect(live.sqlite).toBe(sameConnection);expect(getBacklog({},live.sqlite).map((task)=>task.title)).toEqual(['From backup']);expect(activeProfileId({get:()=>String(staleProfile)} as any,live.sqlite)).toBe(7);expect(result.recoveryBackupName).toMatch(/^life-pre-restore-.*\.db$/);expect(readdirSync(stagingRoot)).toEqual([]);expect(statSync(dirname(result.recoveryBackupPath)).mode&0o777).toBe(0o700);expect(statSync(result.recoveryBackupPath).mode&0o777).toBe(0o600);
    const recovery=new Database(result.recoveryBackupPath,{readonly:true,fileMustExist:true});expect(recovery.prepare(`SELECT title FROM tasks ORDER BY id`).all()).toEqual([{title:'Before restore'}]);recovery.close();for(const db of open.splice(0))db.sqlite.close();rmSync(dir,{recursive:true});
  });

  test('SQLite restore rejects malformed, incompatible, and foreign-key-invalid files before mutation',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-db-reject-'));const livePath=join(dir,'live.db'),otherPath=join(dir,'other.db'),invalidPath=join(dir,'invalid.db'),stagingRoot=join(dir,'staging');mkdirSync(stagingRoot);const live=createDatabase(livePath);open.push(live);createTask({title:'Keep safe'},live.sqlite);const other=new Database(otherPath);other.exec(`CREATE TABLE unrelated(id INTEGER PRIMARY KEY)`);other.close();
    await expect(restoreDatabaseBytes(Buffer.from('not sqlite'),{liveDatabase:live,livePath,stagingRoot})).rejects.toThrow(/SQLite backup/i);await expect(restoreDatabaseBytes(readFileSync(otherPath),{liveDatabase:live,livePath,stagingRoot})).rejects.toThrow(/supported ANII database/i);
    const invalid=createDatabase(invalidPath);open.push(invalid);invalid.sqlite.pragma('foreign_keys = OFF');invalid.sqlite.prepare(`INSERT INTO daily_plans(profile_id,plan_date,task_id,section,position) VALUES(1,'2026-08-05',999,'also',0)`).run();const invalidUpload=join(dir,'invalid-upload.db');await invalid.sqlite.backup(invalidUpload);await expect(restoreDatabaseBytes(readFileSync(invalidUpload),{liveDatabase:live,livePath,stagingRoot})).rejects.toThrow(/foreign key/i);
    expect(getBacklog({},live.sqlite).map((task)=>task.title)).toEqual(['Keep safe']);expect(readdirSync(stagingRoot)).toEqual([]);expect(readdirSync(dir).filter((name)=>name.startsWith('backups'))).toEqual([]);for(const db of open.splice(0))db.sqlite.close();rmSync(dir,{recursive:true});
  });

  test('SQLite restore rejects a structurally valid database without a usable profile before backup',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-db-unusable-'));const livePath=join(dir,'live.db'),incomingPath=join(dir,'incoming.db'),uploadPath=join(dir,'upload.db'),stagingRoot=join(dir,'staging');mkdirSync(stagingRoot);const live=createDatabase(livePath),incoming=createDatabase(incomingPath);open.push(live,incoming);createTask({title:'Keep current'},live.sqlite);incoming.sqlite.prepare(`DELETE FROM profiles`).run();await incoming.sqlite.backup(uploadPath);await expect(restoreDatabaseBytes(readFileSync(uploadPath),{liveDatabase:live,livePath,stagingRoot})).rejects.toThrow(/supported ANII database/i);expect(getBacklog({},live.sqlite).map((task)=>task.title)).toEqual(['Keep current']);expect(readdirSync(dir).includes('backups')).toBe(false);for(const db of open.splice(0))db.sqlite.close();rmSync(dir,{recursive:true});
  });

  test('failed SQLite import rolls back live data and cleans staging while retaining recovery backup',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-db-rollback-'));const livePath=join(dir,'live.db'),incomingPath=join(dir,'incoming.db'),uploadPath=join(dir,'upload.db'),stagingRoot=join(dir,'staging');mkdirSync(stagingRoot);const live=createDatabase(livePath),incoming=createDatabase(incomingPath);open.push(live,incoming);createTask({title:'Rollback survivor'},live.sqlite);createTask({title:'Cannot import'},incoming.sqlite);await incoming.sqlite.backup(uploadPath);live.sqlite.exec(`CREATE TRIGGER reject_restored_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'forced restore failure'); END;`);
    await expect(restoreDatabaseBytes(readFileSync(uploadPath),{liveDatabase:live,livePath,stagingRoot})).rejects.toThrow(/Current data was not changed/i);expect(getBacklog({},live.sqlite).map((task)=>task.title)).toEqual(['Rollback survivor']);expect(readdirSync(stagingRoot)).toEqual([]);expect(readdirSync(join(dir,'backups')).filter((name)=>name.startsWith('life-pre-restore-'))).toHaveLength(1);for(const db of open.splice(0))db.sqlite.close();rmSync(dir,{recursive:true});
  });

  test('post-commit staging cleanup failure returns success with a warning',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-db-cleanup-warning-'));const livePath=join(dir,'live.db'),incomingPath=join(dir,'incoming.db'),uploadPath=join(dir,'upload.db'),stagingRoot=join(dir,'staging');mkdirSync(stagingRoot);const live=createDatabase(livePath),incoming=createDatabase(incomingPath);open.push(live,incoming);createTask({title:'Before'},live.sqlite);createTask({title:'Restored despite cleanup'},incoming.sqlite);await incoming.sqlite.backup(uploadPath);const result=await restoreDatabaseBytes(readFileSync(uploadPath),{liveDatabase:live,livePath,stagingRoot,cleanupStaging:async()=>{throw new Error('cleanup failed')}});expect(result.warning).toMatch(/temporary-file cleanup/i);expect(getBacklog({},live.sqlite).map((task)=>task.title)).toEqual(['Restored despite cleanup']);rmSync(stagingRoot,{recursive:true,force:true});for(const db of open.splice(0))db.sqlite.close();rmSync(dir,{recursive:true});
  });

  test('recovery-directory setup failure reports backup failure and preserves live data',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'life-db-backup-setup-'));const livePath=join(dir,'live.db'),incomingPath=join(dir,'incoming.db'),uploadPath=join(dir,'upload.db'),stagingRoot=join(dir,'staging');mkdirSync(stagingRoot);const live=createDatabase(livePath),incoming=createDatabase(incomingPath);open.push(live,incoming);createTask({title:'Still current'},live.sqlite);createTask({title:'Incoming'},incoming.sqlite);await incoming.sqlite.backup(uploadPath);await expect(restoreDatabaseBytes(readFileSync(uploadPath),{liveDatabase:live,livePath,stagingRoot,prepareRecoveryDirectory:async()=>{throw new Error('disk denied')},cleanupRecoveryArtifact:async()=>{throw new Error('cleanup denied')}})).rejects.toThrow(/Could not create and verify the recovery backup.*Current data was not changed/i);expect(getBacklog({},live.sqlite).map((task)=>task.title)).toEqual(['Still current']);expect(readdirSync(stagingRoot)).toEqual([]);for(const db of open.splice(0))db.sqlite.close();rmSync(dir,{recursive:true});
  });

  test('startup cleanup removes only stale app-owned restore directories',()=>{
    const root=mkdtempSync(join(tmpdir(),'life-cleanup-scope-'));const stale=join(root,'life-restore-stale'),freshDir=join(root,'life-restore-fresh'),unrelated=join(root,'other-work'),target=join(root,'target'),link=join(root,'life-restore-link');for(const path of [stale,freshDir,unrelated,target])mkdirSync(path);symlinkSync(target,link);const now=Date.now();utimesSync(stale,new Date(now-48*60*60*1000),new Date(now-48*60*60*1000));cleanupStaleRestoreDirectories(root,now);expect(readdirSync(root).sort()).toEqual(['life-restore-fresh','life-restore-link','other-work','target']);rmSync(root,{recursive:true});
  });

  test('request gate gives a queued restore priority over later requests and spans async work',async()=>{
    const gate=new RequestGate();const order:string[]=[];let resume!:()=>void;const pause=new Promise<void>((resolve)=>resume=resolve);const chat=gate.withShared(async()=>{order.push('chat-start');await pause;order.push('chat-resume');});await Promise.resolve();let finishRestore!:()=>void;const restorePause=new Promise<void>((resolve)=>finishRestore=resolve);const restore=gate.withExclusive(async()=>{order.push('restore-start');await restorePause;order.push('restore-end');});const later=gate.withShared(()=>{order.push('later-request');});await Promise.resolve();expect(order).toEqual(['chat-start']);resume();await chat;await Promise.resolve();expect(order).toEqual(['chat-start','chat-resume','restore-start']);finishRestore();await restore;await later;expect(order).toEqual(['chat-start','chat-resume','restore-start','restore-end','later-request']);
  });

  test.each([
    ['POST','http://life.local/settings?/restoreDatabase','exclusive'],
    ['POST','http://life.local/settings?/restoreDatabase=value&extra=1','exclusive'],
    ['POST','http://life.local/settings?extra=1&/restoreDatabase=value','exclusive'],
    ['POST','http://life.local/settings?extra=1&/import=json','exclusive'],
    ['POST','http://life.local/settings?/save','shared'],
    ['GET','http://life.local/settings?/restoreDatabase','shared'],
    ['POST','http://life.local/today?/restoreDatabase','shared'],
    ['POST','http://life.local/settings?/save&/restoreDatabase','shared']
  ] as const)('classifies %s %s as %s',(method,url,mode)=>expect(requestGateMode(method,new URL(url))).toBe(mode));
});
