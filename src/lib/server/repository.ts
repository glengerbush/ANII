import { DEFAULT_AI_TIMEOUT_SECONDS, validAiTimeout } from '$lib/ollama';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { tasks as tasksTable } from './db/schema';
import { database } from './db';
import { backfillLegacyCompletions } from './db/legacy-completions';
import { assertFocusCapacity, durationMinutes, transitionTask, type TaskState } from '$lib/domain/rules';
import { z } from 'zod';
import { forecastDeadlines, type DeadlineEdge } from '$lib/domain/deadlines';

export type Sqlite = Database.Database;
export type TaskView = {
  id: number; title: string; details: string; state: TaskState; project_id: number | null; project_name: string | null;
  project_ids: number[]; project_names: string[];
  remaining_effort_minutes:number|null; lead_time_days:number;
  duration_bucket: string | null; due_at: string | null; created_at: string; updated_at: string; completed_at: string | null;
  blocked: number; section?: 'focus' | 'also'; position?: number; review_outcome?: string | null;
};
const sqlite = database.sqlite;
export const DEFAULT_PROFILE_ID = 1;
export type Profile = { id:number; name:string; color:string|null; created_at:string };
export function listProfiles(db:Sqlite=sqlite):Profile[]{return db.prepare(`SELECT * FROM profiles ORDER BY name COLLATE NOCASE,id`).all() as Profile[];}
export function getProfile(id:number,db:Sqlite=sqlite):Profile|undefined{return db.prepare(`SELECT * FROM profiles WHERE id=?`).get(id) as Profile|undefined;}
function profileName(name:string,db:Sqlite,exceptId?:number){
  const clean=name.trim();
  if(!clean)throw new Error('Profile name is required');
  if(clean.length>80)throw new Error('Profile name must be 80 characters or fewer');
  if(db.prepare(`SELECT 1 FROM profiles WHERE name=? COLLATE NOCASE AND id<>?`).get(clean,exceptId??-1))throw new Error('Profile name already exists');
  return clean;
}
export function fallbackProfileId(db:Sqlite=sqlite):number{
  const profile=getProfile(DEFAULT_PROFILE_ID,db)??listProfiles(db)[0];
  if(!profile)throw new Error('At least one profile is required');
  return profile.id;
}
export function createProfile(name:string,db:Sqlite=sqlite):number{return db.transaction(()=>{
  const clean=profileName(name,db);const result=db.prepare(`INSERT INTO profiles(name) VALUES(?)`).run(clean);
  const id=Number(result.lastInsertRowid);event(db,'profile',id,'created',{name:clean});return id;
})();}
export function renameProfile(id:number,name:string,db:Sqlite=sqlite){return db.transaction(()=>{
  const profile=getProfile(id,db);if(!profile)throw new Error('Profile no longer exists. Reload and try again.');
  const clean=profileName(name,db,id);
  if(clean!==profile.name){db.prepare(`UPDATE profiles SET name=? WHERE id=?`).run(clean,id);event(db,'profile',id,'renamed',{from:profile.name,to:clean});}
  return clean;
}).immediate();}
export function deleteProfile(id:number,confirmation:string,db:Sqlite=sqlite){return db.transaction(()=>{
  const profile=getProfile(id,db);if(!profile)throw new Error('Profile no longer exists. Reload and try again.');
  if(confirmation!==profile.name)throw new Error('Type the profile name exactly to confirm deletion.');
  if(listProfiles(db).length<=1)throw new Error('Keep at least one profile. Create another before deleting this one.');
  db.prepare(`DELETE FROM profiles WHERE id=?`).run(id);
  event(db,'profile',id,'deleted',{name:profile.name});
  return {name:profile.name,fallbackId:fallbackProfileId(db)};
}).immediate();}
export function today(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function tomorrow(date = today()): string { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()+1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
// A plan date identifies a user day; wall-clock dates are only used for deadlines.
export function getActiveDay(db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=today()):string{
  const saved=db.prepare('SELECT active_date FROM profile_days WHERE profile_id=?').get(profileId) as {active_date:string}|undefined;
  if(saved)return saved.active_date;
  if(!getProfile(profileId,db))throw new Error('Profile not found');
  const pending=db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM reviews r WHERE r.profile_id=s.profile_id AND r.review_date=s.review_date) THEN tomorrow_date ELSE review_date END date FROM review_sessions s WHERE profile_id=? AND stage<>'done' ORDER BY review_date DESC LIMIT 1`).get(profileId) as {date:string}|undefined;
  const finished=db.prepare(`SELECT tomorrow_date date FROM review_sessions WHERE profile_id=? AND stage='done' ORDER BY review_date DESC LIMIT 1`).get(profileId) as {date:string}|undefined;
  const planned=db.prepare(`SELECT max(dp.plan_date) date FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date<=? AND t.state='open'`).get(profileId,calendarDate) as {date:string|null};
  const date=pending?.date??[finished?.date,planned.date].filter((value):value is string=>Boolean(value)).sort().at(-1)??calendarDate;
  db.prepare('INSERT OR IGNORE INTO profile_days(profile_id,active_date) VALUES(?,?)').run(profileId,date);
  return (db.prepare('SELECT active_date FROM profile_days WHERE profile_id=?').get(profileId) as {active_date:string}).active_date;
}
export function assertActiveDay(date:string|undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){
  const active=getActiveDay(db,profileId);
  if(date!==undefined&&date!==active)throw new Error('Your day changed. Reload before making changes.');
  return active;
}
const taskSelect = `SELECT t.*,
  (SELECT json_group_array(id) FROM (SELECT tp.project_id id FROM task_projects tp JOIN projects p ON p.id=tp.project_id WHERE tp.task_id=t.id ORDER BY p.name COLLATE NOCASE,p.id)) project_ids,
  (SELECT json_group_array(name) FROM (SELECT p.name FROM task_projects tp JOIN projects p ON p.id=tp.project_id WHERE tp.task_id=t.id ORDER BY p.name COLLATE NOCASE,p.id)) project_names,
  (SELECT group_concat(name,' · ') FROM (SELECT p.name FROM task_projects tp JOIN projects p ON p.id=tp.project_id WHERE tp.task_id=t.id ORDER BY p.name COLLATE NOCASE,p.id)) project_name,
  EXISTS(
  SELECT 1 FROM dependencies d JOIN tasks pre ON pre.id=d.prerequisite_task_id
  WHERE d.task_id=t.id AND pre.state <> 'completed'
) blocked FROM tasks t`;
type TaskRow=Omit<TaskView,'project_ids'|'project_names'>&{project_ids:string;project_names:string};
function taskView(row:TaskRow):TaskView{return {...row,project_ids:JSON.parse(row.project_ids||'[]'),project_names:JSON.parse(row.project_names||'[]')};}
function taskViews(rows:TaskRow[]):TaskView[]{return rows.map(taskView);}
export function getToday(date:string|undefined=undefined, db: Sqlite = sqlite, profileId=fallbackProfileId(db)): TaskView[] {
  date??=getActiveDay(db,profileId);
  return taskViews(db.prepare(`${taskSelect.replace(' FROM tasks t',' , dp.section, dp.position, dp.review_outcome FROM tasks t')} JOIN daily_plans dp ON dp.task_id=t.id WHERE dp.profile_id=? AND dp.plan_date=? AND t.state NOT IN ('completed','dropped') ORDER BY CASE dp.section WHEN 'focus' THEN 0 ELSE 1 END, dp.position`).all(profileId,date) as TaskRow[]);
}
export function getCompletedToday(date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)):TaskView[]{
  date??=getActiveDay(db,profileId);
  return taskViews(db.prepare(`${taskSelect} JOIN task_completions c ON c.task_id=t.id WHERE c.profile_id=? AND c.day_date=? AND t.state='completed' ORDER BY c.completed_at DESC,t.id DESC`).all(profileId,date) as TaskRow[]);
}
export type CompletedHistoryTask=TaskView&{completion_day:string;day_completed_at:string};
export function getCompletedHistory(filters:{date?:string;q?:string;project?:number}={},db:Sqlite=sqlite,profileId=fallbackProfileId(db)):CompletedHistoryTask[]{
  const where=["t.state='completed'",'c.profile_id=?'];const values:unknown[]=[profileId];
  if(filters.date){where.push('c.day_date=?');values.push(filters.date);}
  if(filters.q){where.push('(t.title LIKE ? OR t.details LIKE ?)');values.push(`%${filters.q}%`,`%${filters.q}%`);}
  if(filters.project){where.push('EXISTS(SELECT 1 FROM task_projects tp WHERE tp.task_id=t.id AND tp.project_id=?)');values.push(filters.project);}
  const select=taskSelect.replace('SELECT t.*','SELECT t.*,c.day_date completion_day,c.completed_at day_completed_at');
  return taskViews(db.prepare(`${select} JOIN task_completions c ON c.task_id=t.id WHERE ${where.join(' AND ')} ORDER BY c.day_date DESC,c.completed_at DESC,t.id DESC`).all(...values) as TaskRow[]) as CompletedHistoryTask[];
}
export function getBacklog(filters: {q?:string; project?:number; state?:string; due?:boolean} = {}, db: Sqlite = sqlite): TaskView[] {
  const completed=filters.state==='completed';
  const where = [completed?`t.state='completed'`:`t.state NOT IN ('completed','dropped')`]; const args: unknown[] = [];
  if (filters.q) { where.push(`(t.title LIKE ? OR t.details LIKE ?)`); args.push(`%${filters.q}%`,`%${filters.q}%`); }
  if (filters.project) { where.push(`EXISTS(SELECT 1 FROM task_projects filter_tp WHERE filter_tp.task_id=t.id AND filter_tp.project_id=?)`); args.push(filters.project); }
  if (filters.state === 'blocked') where.push(`EXISTS(SELECT 1 FROM dependencies d JOIN tasks pre ON pre.id=d.prerequisite_task_id WHERE d.task_id=t.id AND pre.state <> 'completed')`);
  if (filters.due) where.push(`t.due_at IS NOT NULL`);
  return taskViews(db.prepare(`${taskSelect} WHERE ${where.join(' AND ')} ORDER BY ${completed?'t.completed_at DESC,t.id DESC':'t.created_at DESC'}`).all(...args) as TaskRow[]);
}
export function getProjectTasks(projectId:number,db:Sqlite=sqlite):TaskView[]{return taskViews(db.prepare(`${taskSelect} WHERE EXISTS(SELECT 1 FROM task_projects project_tp WHERE project_tp.task_id=t.id AND project_tp.project_id=?) ORDER BY CASE t.state WHEN 'open' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,t.created_at DESC`).all(projectId) as TaskRow[]);}
export function getTask(id:number, db: Sqlite=sqlite): TaskView | undefined { const row=db.prepare(`${taskSelect} WHERE t.id=?`).get(id) as TaskRow|undefined;return row?taskView(row):undefined; }
function event(db:Sqlite, entityType:string, entityId:number|null, eventType:string, data:unknown={}) { db.prepare(`INSERT INTO events(entity_type,entity_id,event_type,data) VALUES(?,?,?,?)`).run(entityType,entityId,eventType,JSON.stringify(data)); }
function normalizeProjectIds(projectIds:number[]){const ids=[...new Set(projectIds)];if(ids.some((id)=>!Number.isInteger(id)||id<=0))throw new Error('Invalid project');return ids;}
export function setTaskProjects(taskId:number,projectIds:number[],db:Sqlite=sqlite){
  const ids=normalizeProjectIds(projectIds);db.transaction(()=>{if(!getTask(taskId,db))throw new Error('Task not found');if(ids.length){const marks=ids.map(()=>'?').join(',');const count=(db.prepare(`SELECT count(*) n FROM projects WHERE id IN (${marks})`).get(...ids) as {n:number}).n;if(count!==ids.length)throw new Error('Project not found');}db.prepare(`DELETE FROM task_projects WHERE task_id=?`).run(taskId);const insert=db.prepare(`INSERT INTO task_projects(task_id,project_id) VALUES(?,?)`);for(const id of ids)insert.run(taskId,id);event(db,'task',taskId,'projects_changed',{projectIds:ids});})();
}
export function addTaskProject(taskId:number,projectId:number,db:Sqlite=sqlite){db.transaction(()=>{if(!getTask(taskId,db))throw new Error('Task not found');if(!getProject(projectId,db))throw new Error('Project not found');const result=db.prepare(`INSERT OR IGNORE INTO task_projects(task_id,project_id) VALUES(?,?)`).run(taskId,projectId);if(!result.changes)throw new Error('Task already has this project');event(db,'task',taskId,'project_added',{projectId});})();}
export function removeTaskProject(taskId:number,projectId:number,db:Sqlite=sqlite){db.transaction(()=>{const result=db.prepare(`DELETE FROM task_projects WHERE task_id=? AND project_id=?`).run(taskId,projectId);if(result.changes!==1)throw new Error('Task is not in this project');event(db,'task',taskId,'project_removed',{projectId});})();}
const effortEstimate=z.number().int().min(0).max(525600).nullable();
const leadEstimate=z.number().int().min(0).max(3650);
type TaskEstimates={remainingEffortMinutes?:number|null;leadTimeDays?:number};
export function createTask(input:TaskEstimates & {title:string;details?:string;projectIds?:number[];projectId?:number|null;duration?:string|null;dueAt?:string|null}, db:Sqlite=sqlite):number {
  return db.transaction(()=>{const title=input.title.trim(); if(!title) throw new Error('Title is required');
  const duration=input.duration&&['15m','30m','1h','2h+'].includes(input.duration)?input.duration as '15m'|'30m'|'1h'|'2h+':null;
  const result=drizzle(db).insert(tasksTable).values({title,details:input.details?.trim()??'',durationBucket:duration,dueAt:input.dueAt||null,remainingEffortMinutes:effortEstimate.parse(input.remainingEffortMinutes??null),leadTimeDays:leadEstimate.parse(input.leadTimeDays??0)}).run();
  const id=Number(result.lastInsertRowid);const projectIds=input.projectIds??(input.projectId?[input.projectId]:[]);if(projectIds.length)setTaskProjects(id,projectIds,db);event(db,'task',id,'created',input); return id;})();
}
export function updateTask(id:number,input:TaskEstimates & {title?:string;details?:string;projectIds?:number[];projectId?:number|null;duration?:string|null;dueAt?:string|null},db:Sqlite=sqlite){
  db.transaction(()=>{const old=getTask(id,db); if(!old) throw new Error('Task not found');
  const title=input.title?.trim() ?? old.title; if(!title) throw new Error('Title is required');
  db.prepare(`UPDATE tasks SET title=?,details=?,duration_bucket=?,due_at=?,remaining_effort_minutes=?,lead_time_days=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(title,input.details??old.details,input.duration===undefined?old.duration_bucket:(input.duration||null),input.dueAt===undefined?old.due_at:(input.dueAt||null),effortEstimate.parse(input.remainingEffortMinutes===undefined?old.remaining_effort_minutes:input.remainingEffortMinutes),leadEstimate.parse(input.leadTimeDays??old.lead_time_days),id);
  if(input.projectIds!==undefined)setTaskProjects(id,input.projectIds,db);else if(input.projectId!==undefined)setTaskProjects(id,input.projectId?[input.projectId]:[],db);
  event(db,'task',id,'updated',input);})();
}
export function setTaskState(id:number,to:TaskState,db:Sqlite=sqlite,profileId=fallbackProfileId(db),completionDay?:string){
  if(to==='dropped')throw new Error('This state is legacy-only');
  db.transaction(()=>{
    const row=getTask(id,db);if(!row)throw new Error('Task not found');if(row.state===to)return;transitionTask(row.state,to);
    const days=to==='completed'?listProfiles(db).map(profile=>({profileId:profile.id,date:profile.id===profileId&&completionDay?completionDay:getActiveDay(db,profile.id)})):[];
    db.prepare(`UPDATE tasks SET state=?,completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(to,to,id);
    db.prepare('DELETE FROM task_completions WHERE task_id=?').run(id);
    if(to==='completed'){
      const record=db.prepare(`INSERT INTO task_completions(profile_id,day_date,task_id) VALUES(?,?,?)`);
      for(const day of days){
        if(day.profileId===profileId||db.prepare('SELECT 1 FROM daily_plans WHERE profile_id=? AND plan_date=? AND task_id=?').get(day.profileId,day.date,id))record.run(day.profileId,day.date,id);
      }
    }
    event(db,'task',id,'state_changed',{from:row.state,to,profileId});
  })();
}
export function deleteTask(id:number,db:Sqlite=sqlite){db.transaction(()=>{const task=getTask(id,db);if(!task)throw new Error('Task not found');db.prepare(`DELETE FROM tasks WHERE id=?`).run(id);event(db,'task',id,'deleted',{title:task.title,projectIds:task.project_ids});})();}
export function addToPlan(taskId:number,date:string|undefined=undefined,section:'focus'|'also'='also',db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);
  db.transaction(()=>{ const exists=db.prepare(`SELECT section FROM daily_plans WHERE profile_id=? AND plan_date=? AND task_id=?`).get(profileId,date,taskId) as {section:string}|undefined; if(exists){ if(section==='focus'&&exists.section!=='focus'){const n=(db.prepare(`SELECT count(*) n FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? AND dp.section='focus' AND t.state NOT IN ('completed','dropped')`).get(profileId,date) as {n:number}).n; assertFocusCapacity(n); } if(exists.section!==section){const pos=(db.prepare(`SELECT COALESCE(max(position),-1)+1 n FROM daily_plans WHERE profile_id=? AND plan_date=? AND section=?`).get(profileId,date,section) as {n:number}).n;db.prepare(`UPDATE daily_plans SET section=?,position=?,review_outcome=NULL WHERE profile_id=? AND plan_date=? AND task_id=?`).run(section,pos,profileId,date,taskId);}else db.prepare(`UPDATE daily_plans SET review_outcome=NULL WHERE profile_id=? AND plan_date=? AND task_id=?`).run(profileId,date,taskId); } else { if(section==='focus'){const n=(db.prepare(`SELECT count(*) n FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? AND dp.section='focus' AND t.state NOT IN ('completed','dropped')`).get(profileId,date) as {n:number}).n; assertFocusCapacity(n); } const pos=(db.prepare(`SELECT COALESCE(max(position),-1)+1 n FROM daily_plans WHERE profile_id=? AND plan_date=? AND section=?`).get(profileId,date,section) as {n:number}).n; db.prepare(`INSERT INTO daily_plans(profile_id,plan_date,task_id,section,position) VALUES(?,?,?,?,?)`).run(profileId,date,taskId,section,pos); } event(db,'plan',taskId,'planned',{profileId,date,section}); })();
}
export function reorderPlan(taskId:number,direction:'up'|'down',date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);
  if(direction!=='up'&&direction!=='down')throw new Error('Invalid direction');
  const row=db.prepare(`SELECT dp.section,t.state FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? AND dp.task_id=?`).get(profileId,date,taskId) as {section:'focus'|'also';state:TaskState}|undefined;
  if(!row)throw new Error('Task is not planned');
  if(row.state==='completed'||row.state==='dropped')throw new Error('Only active tasks can be reordered');
  const visible=db.prepare(`SELECT dp.task_id FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? AND dp.section=? AND t.state NOT IN ('completed','dropped') ORDER BY dp.position`).all(profileId,date,row.section) as {task_id:number}[];
  const index=visible.findIndex((item)=>item.task_id===taskId);const position=Math.max(0,Math.min(index+(direction==='up'?-1:1),visible.length-1));
  if(index===position)return;
  movePlan(taskId,row.section,position,date,db,profileId);
}
export function movePlan(taskId:number,targetSection:'focus'|'also',targetPosition:number,date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);
  if(targetSection!=='focus'&&targetSection!=='also')throw new Error('Invalid Today section');
  if(!Number.isInteger(targetPosition))throw new Error('Invalid position');
  db.transaction(()=>{
    const current=db.prepare(`SELECT dp.section,t.state FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? AND dp.task_id=?`).get(profileId,date,taskId) as {section:'focus'|'also';state:TaskState}|undefined;
    if(!current)throw new Error('Task is not planned');
    if(current.state==='completed'||current.state==='dropped')throw new Error('Only active tasks can be moved');
    if(targetSection==='focus'&&current.section!=='focus'){
      const count=(db.prepare(`SELECT count(*) count FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? AND dp.section='focus' AND t.state NOT IN ('completed','dropped')`).get(profileId,date) as {count:number}).count;
      assertFocusCapacity(count);
    }
    const rows=db.prepare(`SELECT dp.task_id,dp.section,t.state FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? ORDER BY CASE dp.section WHEN 'focus' THEN 0 ELSE 1 END,dp.position`).all(profileId,date) as {task_id:number;section:'focus'|'also';state:TaskState}[];
    const active:{focus:number[];also:number[]}={focus:[],also:[]};const hidden:{focus:number[];also:number[]}={focus:[],also:[]};
    for(const row of rows)(row.state==='completed'||row.state==='dropped'?hidden:active)[row.section].push(row.task_id);
    const currentPosition=active[current.section].indexOf(taskId);
    active[current.section]=active[current.section].filter((id)=>id!==taskId);
    const position=Math.max(0,Math.min(targetPosition,active[targetSection].length));
    if(targetSection===current.section&&position===currentPosition)return;
    active[targetSection].splice(position,0,taskId);
    db.prepare(`UPDATE daily_plans SET position=-1000000-task_id WHERE profile_id=? AND plan_date=?`).run(profileId,date);
    db.prepare(`UPDATE daily_plans SET section=? WHERE profile_id=? AND plan_date=? AND task_id=?`).run(targetSection,profileId,date,taskId);
    const setPosition=db.prepare(`UPDATE daily_plans SET position=? WHERE profile_id=? AND plan_date=? AND task_id=?`);
    for(const section of ['focus','also'] as const)[...active[section],...hidden[section]].forEach((id,index)=>setPosition.run(index,profileId,date,id));
    event(db,'plan',taskId,'moved',{profileId,date,section:targetSection,position});
  })();
}
export function setFocus(taskIds:number[],date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);const unique=[...new Set(taskIds)];if(unique.length>3)throw new Error('Choose no more than three Focus tasks');db.transaction(()=>{const reviewed=db.prepare(`SELECT task_id,review_outcome FROM daily_plans WHERE profile_id=? AND plan_date=? AND review_outcome IS NOT NULL`).all(profileId,date) as {task_id:number;review_outcome:string}[];const current=db.prepare(`SELECT task_id FROM daily_plans WHERE profile_id=? AND plan_date=? AND section='focus'`).all(profileId,date) as {task_id:number}[];for(const {task_id} of current)if(!unique.includes(task_id))addToPlan(task_id,date,'also',db,profileId);for(const id of unique){addToPlan(id,date,'focus',db,profileId);db.prepare(`UPDATE daily_plans SET review_outcome=COALESCE(review_outcome,'today') WHERE profile_id=? AND plan_date=? AND task_id=?`).run(profileId,date,id);}for(const item of reviewed)db.prepare(`UPDATE daily_plans SET review_outcome=? WHERE profile_id=? AND plan_date=? AND task_id=?`).run(item.review_outcome,profileId,date,item.task_id);event(db,'plan',null,'focus_selected',{profileId,date,taskIds:unique});})();}
export function removeFromPlan(taskId:number,date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId); db.transaction(()=>{const r=db.prepare(`DELETE FROM daily_plans WHERE profile_id=? AND plan_date=? AND task_id=?`).run(profileId,date,taskId);if(r.changes)event(db,'plan',taskId,'removed',{profileId,date});})(); }
export function createAndPlan(title:string,section:'focus'|'also'='also',db:Sqlite=sqlite,profileId=fallbackProfileId(db)){ return db.transaction(()=>{const id=createTask({title},db); addToPlan(id,getActiveDay(db,profileId),section,db,profileId); return id;})(); }
export type ProjectView={id:number;name:string;color:string|null;state:'active'|'archived';created_at:string;open_count:number;blocked_count:number;completed_count:number;unestimated_count:number;remaining_minutes:number;remaining_open_ended:number;next_task:string|null};
export function listProjects(db:Sqlite=sqlite):ProjectView[]{return db.prepare(`SELECT p.*,
  coalesce(sum(CASE WHEN t.state='open' THEN 1 ELSE 0 END),0) open_count,
  coalesce(sum(CASE WHEN t.state='open' AND EXISTS(SELECT 1 FROM dependencies d JOIN tasks pre ON pre.id=d.prerequisite_task_id WHERE d.task_id=t.id AND pre.state <> 'completed') THEN 1 ELSE 0 END),0) blocked_count,
  coalesce(sum(CASE WHEN t.state='completed' THEN 1 ELSE 0 END),0) completed_count,
  coalesce(sum(CASE WHEN t.state='open' AND t.duration_bucket IS NULL THEN 1 ELSE 0 END),0) unestimated_count,
  coalesce(sum(CASE WHEN t.state='open' THEN CASE t.duration_bucket WHEN '15m' THEN 15 WHEN '30m' THEN 30 WHEN '1h' THEN 60 WHEN '2h+' THEN 120 ELSE 0 END ELSE 0 END),0) remaining_minutes,
  coalesce(sum(CASE WHEN t.state='open' AND t.duration_bucket='2h+' THEN 1 ELSE 0 END),0) remaining_open_ended,
  (SELECT n.title FROM task_projects ntp JOIN tasks n ON n.id=ntp.task_id WHERE ntp.project_id=p.id AND n.state='open' AND NOT EXISTS(SELECT 1 FROM dependencies d JOIN tasks pre ON pre.id=d.prerequisite_task_id WHERE d.task_id=n.id AND pre.state <> 'completed') ORDER BY n.due_at IS NULL,n.due_at,n.created_at LIMIT 1) next_task
  FROM projects p LEFT JOIN task_projects tp ON tp.project_id=p.id LEFT JOIN tasks t ON t.id=tp.task_id AND t.state<>'dropped' GROUP BY p.id ORDER BY p.name COLLATE NOCASE,p.id`).all() as ProjectView[];}
export function getProject(id:number,db:Sqlite=sqlite):ProjectView|undefined{return listProjects(db).find((project)=>project.id===id);}
export function createProject(name:string,db:Sqlite=sqlite):number{return db.transaction(()=>{if(!name.trim())throw new Error('Name required'); const r=db.prepare(`INSERT INTO projects(name) VALUES(?)`).run(name.trim());const id=Number(r.lastInsertRowid);event(db,'project',id,'created',{name});return id;})();}
export function renameProject(id:number,name:string,db:Sqlite=sqlite){db.transaction(()=>{const project=getProject(id,db);if(!project)throw new Error('Project not found');const clean=name.trim();if(!clean)throw new Error('Project name is required');if(db.prepare(`SELECT 1 FROM projects WHERE id<>? AND name=? COLLATE NOCASE`).get(id,clean))throw new Error('Project name already exists');db.prepare(`UPDATE projects SET name=? WHERE id=?`).run(clean,id);event(db,'project',id,'renamed',{from:project.name,to:clean});})();}
export function createProjectForTask(taskId:number,name:string,db:Sqlite=sqlite):number{return db.transaction(()=>{if(!getTask(taskId,db))throw new Error('Task not found');const id=createProject(name,db);addTaskProject(taskId,id,db);return id;})();}
export function deleteProject(id:number,db:Sqlite=sqlite){db.transaction(()=>{const project=getProject(id,db);if(!project)throw new Error('Project not found');const labels=(db.prepare(`SELECT count(*) n FROM task_projects WHERE project_id=?`).get(id) as {n:number}).n;db.prepare(`DELETE FROM projects WHERE id=?`).run(id);event(db,'project',id,'deleted',{name:project.name,labelsRemoved:labels});})();}
export function getDependencies(taskId:number,db:Sqlite=sqlite){return { prerequisites:db.prepare(`SELECT d.*,t.title,t.state FROM dependencies d JOIN tasks t ON t.id=d.prerequisite_task_id WHERE d.task_id=?`).all(taskId),dependents:db.prepare(`SELECT d.*,t.title,t.state FROM dependencies d JOIN tasks t ON t.id=d.task_id WHERE d.prerequisite_task_id=?`).all(taskId)};}
export function addDependency(taskId:number,preId:number,db:Sqlite=sqlite,sourceMessageId?:number){db.transaction(()=>{
  if(!getTask(taskId,db)||!getTask(preId,db))throw new Error('Dependency task not found');
  if(taskId===preId)throw new Error('A task cannot depend on itself');
  const cycle=db.prepare(`WITH RECURSIVE reachable(id) AS (SELECT prerequisite_task_id FROM dependencies WHERE task_id=? UNION SELECT d.prerequisite_task_id FROM dependencies d JOIN reachable r ON d.task_id=r.id) SELECT 1 FROM reachable WHERE id=?`).get(preId,taskId);
  if(cycle)throw new Error('Dependency would create a cycle');
  if(db.prepare('SELECT 1 FROM dependencies WHERE task_id=? AND prerequisite_task_id=?').get(taskId,preId))throw new Error('This dependency already exists');
  db.prepare(`INSERT INTO dependencies(task_id,prerequisite_task_id,source_message_id) VALUES(?,?,?)`).run(taskId,preId,sourceMessageId??null);event(db,'dependency',taskId,'created',{preId,sourceMessageId});})();
}
export function replaceDependency(taskId:number,previousPreId:number,preId:number,db:Sqlite=sqlite){db.transaction(()=>{
  if(!db.prepare('SELECT 1 FROM dependencies WHERE task_id=? AND prerequisite_task_id=?').get(taskId,previousPreId))throw new Error('This dependency changed. Reopen the task and try again.');
  if(previousPreId===preId)return;
  removeDependency(taskId,previousPreId,db);addDependency(taskId,preId,db);
})();}
export function removeDependency(taskId:number,preId:number,db:Sqlite=sqlite){db.transaction(()=>{const r=db.prepare(`DELETE FROM dependencies WHERE task_id=? AND prerequisite_task_id=?`).run(taskId,preId);if(r.changes)event(db,'dependency',taskId,'removed',{preId});})();}
export function reviewDecision(taskId:number,decision:'today'|'tomorrow'|'backlog'|'delete',date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);if(!['today','tomorrow','backlog','delete'].includes(decision))throw new Error('Invalid review outcome');db.transaction(()=>{const planned=db.prepare(`SELECT 1 FROM daily_plans WHERE profile_id=? AND plan_date=? AND task_id=?`).get(profileId,date,taskId);if(!planned)throw new Error('Task is not in this review');if(decision==='delete'){event(db,'review',taskId,'decision',{profileId,date,decision});deleteTask(taskId,db);return;}if(decision==='today'){db.prepare(`UPDATE daily_plans SET review_outcome='today' WHERE profile_id=? AND plan_date=? AND task_id=?`).run(profileId,date,taskId);addToPlan(taskId,tomorrow(date),'also',db,profileId);}else{removeFromPlan(taskId,date,db,profileId);if(decision==='tomorrow')addToPlan(taskId,tomorrow(date),'also',db,profileId);}event(db,'review',taskId,'decision',{profileId,date,decision});})();}
export function closeReview(date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);db.transaction(()=>{const pending=db.prepare(`SELECT 1 FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? AND t.state NOT IN ('completed','dropped') AND dp.review_outcome IS NULL LIMIT 1`).get(profileId,date);if(pending)throw new Error('Every unfinished task needs a decision');db.prepare(`INSERT INTO reviews(review_date,profile_id) VALUES(?,?)`).run(date,profileId);event(db,'review',null,'closed',{profileId,date});})();}
export type CloseOutOutcome='completed'|'today'|'tomorrow'|'backlog'|'delete';
export type CloseOutDecision={taskId:number;outcome:CloseOutOutcome};
const closeOutOutcomes=new Set<CloseOutOutcome>(['completed','today','tomorrow','backlog','delete']);
export function previewCloseOut(decisions:CloseOutDecision[],plannedTaskIds:number[]){
  const ids=decisions.map((item)=>item.taskId);const sortedIds=[...ids].sort((a,b)=>a-b);const sortedPlanned=[...plannedTaskIds].sort((a,b)=>a-b);
  if(new Set(ids).size!==ids.length||ids.some((id)=>!Number.isInteger(id))||JSON.stringify(sortedIds)!==JSON.stringify(sortedPlanned))throw new Error('Choose one outcome for every unfinished Today task');
  if(decisions.some((decision)=>!closeOutOutcomes.has(decision.outcome)))throw new Error('Invalid close-out outcome');
  return {deleteTaskIds:decisions.filter((decision)=>decision.outcome==='delete').map((decision)=>decision.taskId)};
}
export type ReviewStage='close'|'plan'|'focus'|'done';
export function getReviewSession(date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)):{stage:ReviewStage;tomorrowDate:string}{date??=getActiveDay(db,profileId);const row=db.prepare(`SELECT stage,tomorrow_date FROM review_sessions WHERE profile_id=? AND review_date=?`).get(profileId,date) as {stage:'plan'|'focus'|'done';tomorrow_date:string}|undefined;return row?{stage:row.stage,tomorrowDate:row.tomorrow_date}:{stage:'close',tomorrowDate:tomorrow(date)};}
export function getCurrentReviewSession(currentDate:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)):{stage:ReviewStage;reviewDate:string;tomorrowDate:string}{
  const date=getActiveDay(db,profileId,currentDate??today());
  const active=db.prepare(`SELECT review_date,tomorrow_date,stage FROM review_sessions WHERE profile_id=? AND stage<>'done' AND (review_date=? OR tomorrow_date=?) ORDER BY review_date DESC,id DESC LIMIT 1`).get(profileId,date,date) as {review_date:string;tomorrow_date:string;stage:'plan'|'focus'}|undefined;
  return active?{stage:active.stage,reviewDate:active.review_date,tomorrowDate:active.tomorrow_date}:{stage:'close',reviewDate:date,tomorrowDate:tomorrow(date)};
}
export function closeOutToday(decisions:CloseOutDecision[],date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);
  db.transaction(()=>{
    if(getReviewSession(date,db,profileId).stage!=='close')throw new Error('Today has already been closed out');
    previewCloseOut(decisions,getToday(date,db,profileId).map((task)=>task.id));
    for(const decision of decisions){if(decision.outcome==='completed'){setTaskState(decision.taskId,'completed',db,profileId,date);event(db,'review',decision.taskId,'decision',{profileId,date,decision:'completed'});}else reviewDecision(decision.taskId,decision.outcome,date,db,profileId);}
    const pending=db.prepare(`SELECT 1 FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? AND t.state NOT IN ('completed','dropped') AND dp.review_outcome IS NULL LIMIT 1`).get(profileId,date);if(pending)throw new Error('Every unfinished task needs a decision');
    db.prepare(`INSERT INTO review_sessions(profile_id,review_date,tomorrow_date,stage) VALUES(?,?,?,'plan')`).run(profileId,date,tomorrow(date));event(db,'review',null,'stage_advanced',{profileId,date,stage:'plan'});
  })();
}
export function setPlanTasks(taskIds:number[],date:string,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){
  const unique=[...new Set(taskIds)];if(unique.length!==taskIds.length||unique.some((id)=>!Number.isInteger(id)||id<=0))throw new Error('Invalid Tomorrow selection');
  db.transaction(()=>{
    if(unique.length){const marks=unique.map(()=>'?').join(',');const found=(db.prepare(`SELECT id FROM tasks WHERE id IN (${marks}) AND state NOT IN ('completed','dropped')`).all(...unique) as {id:number}[]).map((row)=>row.id);if(found.length!==unique.length)throw new Error('Tomorrow tasks must be active');}
    const rows=db.prepare(`SELECT dp.task_id,dp.section,t.state FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? ORDER BY CASE dp.section WHEN 'focus' THEN 0 ELSE 1 END,dp.position`).all(profileId,date) as {task_id:number;section:'focus'|'also';state:TaskState}[];
    const hidden={focus:[] as number[],also:[] as number[]};for(const row of rows)if(row.state==='completed'||row.state==='dropped')hidden[row.section].push(row.task_id);
    const remove=db.prepare(`DELETE FROM daily_plans WHERE profile_id=? AND plan_date=? AND task_id=?`);for(const row of rows)if(row.state!=='completed'&&row.state!=='dropped'&&!unique.includes(row.task_id))remove.run(profileId,date,row.task_id);
    db.prepare(`UPDATE daily_plans SET position=-1000000-task_id WHERE profile_id=? AND plan_date=?`).run(profileId,date);
    const existing=db.prepare(`SELECT 1 FROM daily_plans WHERE profile_id=? AND plan_date=? AND task_id=?`);const update=db.prepare(`UPDATE daily_plans SET section='also',position=?,review_outcome=NULL WHERE profile_id=? AND plan_date=? AND task_id=?`);const insert=db.prepare(`INSERT INTO daily_plans(profile_id,plan_date,task_id,section,position) VALUES(?,?,?,'also',?)`);
    unique.forEach((id,index)=>existing.get(profileId,date,id)?update.run(index,profileId,date,id):insert.run(profileId,date,id,index));
    const setPosition=db.prepare(`UPDATE daily_plans SET position=? WHERE profile_id=? AND plan_date=? AND task_id=?`);hidden.focus.forEach((id,index)=>setPosition.run(index,profileId,date,id));hidden.also.forEach((id,index)=>setPosition.run(unique.length+index,profileId,date,id));
    event(db,'plan',null,'tasks_selected',{profileId,date,taskIds:unique});
  })();
}
export function setPlanFocus(taskIds:number[],date:string,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){
  const unique=[...new Set(taskIds)];if(unique.length!==taskIds.length||unique.length>3||unique.some((id)=>!Number.isInteger(id)||id<=0))throw new Error('Choose up to three Tomorrow Focus tasks');
  db.transaction(()=>{
    const rows=db.prepare(`SELECT dp.task_id,dp.section,t.state FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id=? AND dp.plan_date=? ORDER BY CASE dp.section WHEN 'focus' THEN 0 ELSE 1 END,dp.position`).all(profileId,date) as {task_id:number;section:'focus'|'also';state:TaskState}[];
    const active=rows.filter((row)=>row.state!=='completed'&&row.state!=='dropped').map((row)=>row.task_id);if(unique.some((id)=>!active.includes(id)))throw new Error('Focus must be selected from Tomorrow tasks');
    const hidden={focus:[] as number[],also:[] as number[]};for(const row of rows)if(row.state==='completed'||row.state==='dropped')hidden[row.section].push(row.task_id);
    db.prepare(`UPDATE daily_plans SET position=-1000000-task_id WHERE profile_id=? AND plan_date=?`).run(profileId,date);
    if(active.length){const marks=active.map(()=>'?').join(',');db.prepare(`UPDATE daily_plans SET section='also' WHERE profile_id=? AND plan_date=? AND task_id IN (${marks})`).run(profileId,date,...active);}
    const update=db.prepare(`UPDATE daily_plans SET section=?,position=? WHERE profile_id=? AND plan_date=? AND task_id=?`);unique.forEach((id,index)=>update.run('focus',index,profileId,date,id));active.filter((id)=>!unique.includes(id)).forEach((id,index)=>update.run('also',index,profileId,date,id));
    const setPosition=db.prepare(`UPDATE daily_plans SET position=? WHERE profile_id=? AND plan_date=? AND task_id=?`);hidden.focus.forEach((id,index)=>setPosition.run(unique.length+index,profileId,date,id));hidden.also.forEach((id,index)=>setPosition.run(active.length-unique.length+index,profileId,date,id));
    event(db,'plan',null,'focus_selected',{profileId,date,taskIds:unique});
  })();
}
export function planReviewTomorrow(taskIds:number[],date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);db.transaction(()=>{const session=getReviewSession(date,db,profileId);if(session.stage!=='plan')throw new Error('Close Out Today before planning Tomorrow');const focus=getToday(session.tomorrowDate,db,profileId).filter(task=>task.section==='focus'&&taskIds.includes(task.id)).map(task=>task.id);setPlanTasks(taskIds,session.tomorrowDate,db,profileId);setPlanFocus(focus,session.tomorrowDate,db,profileId);db.prepare(`UPDATE review_sessions SET stage='focus' WHERE profile_id=? AND review_date=? AND stage='plan'`).run(profileId,date);event(db,'review',null,'stage_advanced',{profileId,date,stage:'focus'});})();}
export function completeReviewFocus(taskIds:number[],date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);db.transaction(()=>{const session=getReviewSession(date,db,profileId);if(session.stage!=='focus')throw new Error('Plan Tomorrow before setting Focus');setPlanFocus(taskIds,session.tomorrowDate,db,profileId);const changed=db.prepare(`UPDATE review_sessions SET stage='done',completed_at=CURRENT_TIMESTAMP WHERE profile_id=? AND review_date=? AND stage='focus'`).run(profileId,date);if(changed.changes!==1)throw new Error('Review stage changed; reload and try again');db.prepare(`INSERT INTO reviews(review_date,profile_id) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM reviews WHERE review_date=? AND profile_id=?)`).run(date,profileId,date,profileId);for(const task of getToday(date,db,profileId)){if(!db.prepare('SELECT 1 FROM daily_plans WHERE profile_id=? AND plan_date=? AND task_id=?').get(profileId,session.tomorrowDate,task.id))addToPlan(task.id,session.tomorrowDate,'also',db,profileId);}const active=getActiveDay(db,profileId,date);if(active!==date&&active!==session.tomorrowDate)throw new Error('Your day changed; reload before finishing this review');db.prepare('UPDATE profile_days SET active_date=? WHERE profile_id=?').run(session.tomorrowDate,profileId);event(db,'review',null,'completed',{profileId,date,tomorrowDate:session.tomorrowDate});})();}
export function editReviewPlan(date:string|undefined=undefined,focusIds:number[]|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){date??=getActiveDay(db,profileId);
  db.transaction(()=>{
    const session=getReviewSession(date,db,profileId);
    if(session.stage!=='focus'&&session.stage!=='done')throw new Error('Plan Tomorrow before editing the plan');
    if(session.stage==='done'&&getActiveDay(db,profileId)!==session.tomorrowDate)throw new Error('This review belongs to an earlier day and can no longer be edited');
    if(focusIds!==undefined)setPlanFocus(focusIds,session.tomorrowDate,db,profileId);
    db.prepare(`UPDATE review_sessions SET stage='plan',completed_at=NULL WHERE profile_id=? AND review_date=?`).run(profileId,date);
    event(db,'review',null,'plan_reopened',{profileId,date});
  })();
}
export function listReviews(db:Sqlite=sqlite,profileId=fallbackProfileId(db)){return db.prepare(`SELECT * FROM reviews WHERE profile_id=? ORDER BY review_date DESC, id DESC`).all(profileId) as {id:number;review_date:string;profile_id:number;closed_at:string}[];}
export function getMessages(db:Sqlite=sqlite){return db.prepare(`SELECT m.*,p.id proposal_id,p.kind,p.payload,p.status,p.rationale,p.result_type,p.result_id FROM messages m LEFT JOIN ai_proposals p ON p.message_id=m.id ORDER BY m.id`).all() as any[];}
export const proposalPayload=z.object({title:z.string().min(1).max(300),details:z.string().max(5000).default(''),projectId:z.number().int().positive().nullable().optional(),duration:z.enum(['15m','30m','1h','2h+']).nullable().optional(),dueAt:z.string().nullable().optional()});
export function recordMessage(content:string,db:Sqlite=sqlite){if(!content.trim())throw new Error('Message cannot be empty');const r=db.prepare(`INSERT INTO messages(role,content) VALUES('user',?)`).run(content.trim());return Number(r.lastInsertRowid);}
export function deleteMessage(id:number,db:Sqlite=sqlite){
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Invalid message');
  db.transaction(()=>{
    const result=db.prepare(`DELETE FROM messages WHERE id=?`).run(id);
    if(result.changes!==1)throw new Error('Message no longer exists. Refresh history.');
    event(db,'message',id,'deleted');
  })();
}
export function recordProposal(messageId:number,payload:unknown,metadata:{model?:string;rationale?:string}={},db:Sqlite=sqlite){const valid=proposalPayload.parse(payload);const r=db.prepare(`INSERT INTO ai_proposals(message_id,kind,payload,confidence,rationale,model,prompt_version) VALUES(?,'create_task',?,1,?,?,?)`).run(messageId,JSON.stringify(valid),metadata.rationale??null,metadata.model??null,'capture-v1');return Number(r.lastInsertRowid);}
export function messageForCapture(id:number,db:Sqlite=sqlite){
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Invalid message');
  const message=db.prepare(`SELECT id,content FROM messages WHERE id=? AND role='user'`).get(id) as {id:number;content:string}|undefined;
  if(!message)throw new Error('Message no longer exists. Refresh history.');
  if(db.prepare(`SELECT id FROM ai_proposals WHERE message_id=? LIMIT 1`).get(id))throw new Error('This message already has suggestions. Refresh history to review them.');
  return message;
}
export function saveCaptureProposals(id:number,proposals:unknown[],db:Sqlite=sqlite){
  return db.transaction(()=>{
    messageForCapture(id,db);
    for(const proposal of proposals)recordProposal(id,proposal,{rationale:'Extracted from source message'},db);
    return db.prepare(`SELECT m.*,p.id proposal_id,p.kind,p.payload,p.status,p.rationale,p.result_type,p.result_id FROM messages m LEFT JOIN ai_proposals p ON p.message_id=m.id WHERE m.id=? ORDER BY p.id`).all(id) as any[];
  })();
}
export function acceptProposal(id:number,db:Sqlite=sqlite){return db.transaction(()=>{const p=db.prepare(`SELECT * FROM ai_proposals WHERE id=?`).get(id) as any;if(!p||p.status!=='pending')throw new Error('Proposal is no longer pending');const payload=proposalPayload.parse(JSON.parse(p.payload));const taskId=createTask({title:payload.title,details:payload.details,projectId:payload.projectId,duration:payload.duration,dueAt:payload.dueAt},db);db.prepare(`UPDATE ai_proposals SET status='accepted',resolved_at=CURRENT_TIMESTAMP,result_type='task',result_id=? WHERE id=?`).run(taskId,id);event(db,'proposal',id,'accepted',{taskId,messageId:p.message_id});return taskId;})();}
export function rejectProposal(id:number,db:Sqlite=sqlite){db.transaction(()=>{const result=db.prepare(`UPDATE ai_proposals SET status='rejected',resolved_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`).run(id);if(result.changes!==1)throw new Error('Proposal is no longer pending');event(db,'proposal',id,'rejected');})();}
export function getSettings(db:Sqlite=sqlite):Record<string,string>{return {ai_timeout_seconds:String(DEFAULT_AI_TIMEOUT_SECONDS),...Object.fromEntries((db.prepare(`SELECT key,value FROM settings`).all() as {key:string;value:string}[]).map(x=>[x.key,x.value]))};}
export function normalizeOllamaUrl(value:string){
  let url:URL;try{url=new URL(value.trim());}catch{throw new Error('Enter a valid Ollama URL, such as http://127.0.0.1:11434');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Ollama URL must use HTTP or HTTPS without credentials, a query, or a fragment');
  return url.toString().replace(/\/+$/,'');
}
export function saveSettings(values:Record<string,string>,db:Sqlite=sqlite){const allowed=new Set(['ai_timeout_seconds','theme','timezone','current_priorities','model','ollama_url','keep_alive','daily_capacity_minutes','deadline_buffer_days']);const stmt=db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`);db.transaction(()=>{for(const [k,v] of Object.entries(values)){if(!allowed.has(k))throw new Error(`Unsupported setting: ${k}`);if(k==='ai_timeout_seconds'&&!validAiTimeout(v))throw new Error('AI request timeout must be a whole number from 5 to 600 seconds');if(k==='daily_capacity_minutes'||k==='deadline_buffer_days'){const max=k==='daily_capacity_minutes'?1440:365;if(!v.trim()||!Number.isInteger(Number(v))||Number(v)<0||Number(v)>max)throw new Error(`Invalid ${k}`);}stmt.run(k,k==='ollama_url'?normalizeOllamaUrl(v):v);}event(db,'settings',null,'updated',{keys:Object.keys(values)});})();}
export const SNAPSHOT_TABLES=['profiles','projects','tasks','task_projects','daily_plans','dependencies','messages','ai_proposals','events','settings','reviews','review_sessions','profile_days','task_completions'] as const;
export function exportData(db:Sqlite=sqlite){return db.transaction(()=>({version:2 as const,exportedAt:new Date().toISOString(),tables:Object.fromEntries(SNAPSHOT_TABLES.map(t=>[t,db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(t)?db.prepare(`SELECT * FROM ${t}`).all():[]]))}))();}
export function validateImportData(raw:unknown,db:Sqlite=sqlite){
  const envelope=z.object({version:z.union([z.literal(1),z.literal(2)]),exportedAt:z.string().datetime(),tables:z.record(z.string(),z.array(z.record(z.string(),z.union([z.string(),z.number(),z.null()]))))}).strict().parse(raw);
  const given=Object.keys(envelope.tables).sort();const expected=[...SNAPSHOT_TABLES].sort();const missing=expected.filter((table)=>!given.includes(table));const legacyMissing=missing.every((table)=>['review_sessions','task_projects','profile_days','task_completions'].includes(table));if(!legacyMissing||given.some((table)=>!expected.includes(table as typeof SNAPSHOT_TABLES[number])))throw new Error('Backup must contain exactly the supported tables');if(missing.includes('review_sessions'))envelope.tables.review_sessions=[];if(missing.includes('task_projects'))envelope.tables.task_projects=[];for(const table of ['profile_days','task_completions'] as const)if(missing.includes(table))envelope.tables[table]=[];
  if(envelope.version===1){for(const row of envelope.tables.tasks){if(!('remaining_effort_minutes' in row))row.remaining_effort_minutes=null;if(!('lead_time_days' in row))row.lead_time_days=0;}if(!envelope.tables.settings.some(row=>row.key==='deadline_buffer_days'))envelope.tables.settings.push({key:'deadline_buffer_days',value:'2',updated_at:envelope.exportedAt});}
  envelope.tables.dependencies=envelope.tables.dependencies.filter(row=>row.kind!=='soft').map(row=>{if('kind' in row){if(row.kind!=='hard')throw new Error('Unsupported dependency kind');const {kind,...dependency}=row;return dependency;}return row;});
  for(const table of SNAPSHOT_TABLES){const columns=db.prepare(`PRAGMA table_info(${table})`).all() as {name:string;type:string;notnull:number}[];const names=columns.map(c=>c.name).sort();for(const row of envelope.tables[table]){if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify(names))throw new Error(`Invalid columns in ${table}`);for(const column of columns){const value=row[column.name];if(value===null){if(column.notnull)throw new Error(`${table}.${column.name} cannot be null`);continue;}if(column.type==='INTEGER'&&(!Number.isInteger(value)||typeof value!=='number'))throw new Error(`${table}.${column.name} must be an integer`);if(column.type==='REAL'&&typeof value!=='number')throw new Error(`${table}.${column.name} must be a number`);if(column.type==='TEXT'&&typeof value!=='string')throw new Error(`${table}.${column.name} must be text`);}}}
  // Normalize supported legacy snapshots before applying the current constraints.
  for(const row of envelope.tables.tasks)if(row.state==='waiting')row.state='open';
  for(const row of envelope.tables.daily_plans)if(row.review_outcome==='waiting')row.review_outcome='backlog';
  if(!envelope.tables.profiles.length)throw new Error('Backup must contain at least one profile');
  const requiredSettings=['theme','timezone','current_priorities','model','ollama_url','keep_alive','daily_capacity_minutes','deadline_buffer_days'];const settingKeys=new Set(envelope.tables.settings.map((row)=>row.key));const missingSettings=requiredSettings.filter((key)=>!settingKeys.has(key));if(missingSettings.length)throw new Error(`Backup is missing required settings: ${missingSettings.join(', ')}`);
  for(const row of envelope.tables.tasks){effortEstimate.parse(row.remaining_effort_minutes);leadEstimate.parse(row.lead_time_days);}
  return envelope;
}
export type SnapshotEnvelope=ReturnType<typeof validateImportData>;
export function importData(raw:unknown,db:Sqlite=sqlite){
  const envelope=validateImportData(raw,db);
  db.transaction(()=>{db.pragma('defer_foreign_keys = ON');for(const t of [...SNAPSHOT_TABLES].reverse())db.prepare(`DELETE FROM ${t}`).run();for(const t of SNAPSHOT_TABLES){for(const row of envelope.tables[t]){const keys=Object.keys(row);db.prepare(`INSERT INTO ${t}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}}db.prepare(`INSERT OR IGNORE INTO task_projects(task_id,project_id) SELECT id,project_id FROM tasks WHERE project_id IS NOT NULL`).run();db.prepare(`UPDATE tasks SET project_id=NULL WHERE project_id IS NOT NULL`).run();db.prepare(`INSERT OR IGNORE INTO review_sessions(profile_id,review_date,tomorrow_date,stage,started_at,completed_at) SELECT profile_id,review_date,date(review_date,'+1 day'),'done',min(closed_at),max(closed_at) FROM reviews GROUP BY profile_id,review_date`).run();backfillLegacyCompletions(db);event(db,'import',null,'restored',{version:envelope.version});})();
}
export function eventsFor(taskId:number,db:Sqlite=sqlite){return db.prepare(`SELECT * FROM events WHERE entity_type='task' AND entity_id=? ORDER BY id DESC LIMIT 20`).all(taskId);}
export function getDueOutsidePlan(date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date):TaskView[]{
  return taskViews(db.prepare(`${taskSelect} WHERE t.state='open' AND t.due_at IS NOT NULL AND t.due_at<>'' AND t.due_at<?
    AND NOT EXISTS(SELECT 1 FROM daily_plans dp WHERE dp.task_id=t.id AND dp.profile_id=? AND dp.plan_date=?)
    ORDER BY t.due_at,t.id`).all(tomorrow(calendarDate),profileId,date) as TaskRow[]);
}
export function getStartWarnings(date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date){
  const settings=getSettings(db);const tasks=taskViews(db.prepare(taskSelect).all() as TaskRow[]);
  const edges=db.prepare('SELECT task_id,prerequisite_task_id FROM dependencies').all() as DeadlineEdge[];
  const plannedIds=new Set(getToday(date,db,profileId).map(task=>task.id));
  const capacity=Number(settings.daily_capacity_minutes??480);const buffer=Number(settings.deadline_buffer_days??2);
  return forecastDeadlines(tasks,edges,calendarDate,Number.isFinite(capacity)?Math.max(0,capacity):0,Number.isInteger(buffer)&&buffer>=0&&buffer<=365?buffer:2).map(warning=>({...warning,planned:plannedIds.has(warning.taskId)}));
}
export function buildSanityContext(date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date){
  const settings=getSettings(db);const plan=getToday(date,db,profileId);const dueOutsidePlan=getDueOutsidePlan(date,db,profileId,calendarDate);
  const startWarnings=getStartWarnings(date,db,profileId,calendarDate);
  const taskIds=[...new Set([...plan,...dueOutsidePlan].map(task=>task.id).concat(startWarnings.map(warning=>warning.taskId)))];
  const chains=db.prepare(`WITH RECURSIVE chain(task_id, prerequisite_id, depth) AS (
    SELECT task_id,prerequisite_task_id,1 FROM dependencies WHERE task_id IN (SELECT value FROM json_each(?))
    UNION ALL SELECT c.task_id,d.prerequisite_task_id,c.depth+1 FROM chain c JOIN dependencies d ON d.task_id=c.prerequisite_id WHERE c.depth<30
  ) SELECT c.*,t.title prerequisite_title,t.state prerequisite_state FROM chain c JOIN tasks t ON t.id=c.prerequisite_id`).all(JSON.stringify(taskIds));
  const facts=({id,title,state,due_at,duration_bucket,remaining_effort_minutes,lead_time_days,blocked,section}:TaskView)=>({id,title,state,dueAt:due_at,duration:duration_bucket,remainingEffortMinutes:remaining_effort_minutes,leadTimeDays:lead_time_days,blocked:Boolean(blocked),section:section??null});
  return {date,calendarDate,profileId,currentPriorities:settings.current_priorities??'',dailyCapacityMinutes:Number(settings.daily_capacity_minutes??480),startWarnings,tasks:plan.map(facts),dueOutsidePlan:dueOutsidePlan.map(facts),prerequisiteChains:chains};
}
export function applySanityChoice(taskId:number,choice:'Keep'|'Move'|'Add'|'Start',date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date){
  if(!Number.isInteger(taskId)||taskId<=0)throw new Error('Concern must reference a task');
  if(!['Keep','Move','Add','Start'].includes(choice))throw new Error('Unsupported sanity choice');
  db.transaction(()=>{
    const task=getTask(taskId,db);if(!task)throw new Error('Task not found');
    if(task.state==='completed'||task.state==='dropped')throw new Error('Task is no longer active');
    const planned=db.prepare(`SELECT 1 FROM daily_plans WHERE task_id=? AND profile_id=? AND plan_date=?`).get(taskId,profileId,date);
    if(choice==='Add'||choice==='Start'){
      if(planned)throw new Error('Task is already in Today');
      if(choice==='Add'&&(!task.due_at||task.due_at>=tomorrow(calendarDate)))throw new Error('Task is no longer due');
      if(choice==='Start'&&!getStartWarnings(date,db,profileId,calendarDate).some(warning=>warning.taskId===taskId))throw new Error('Task no longer needs an early start');
      addToPlan(taskId,date,'also',db,profileId);
    }else{
      if(!planned)throw new Error('Task is no longer in Today');
      if(choice==='Move')removeFromPlan(taskId,date,db,profileId);
    }
    event(db,'plan',taskId,'sanity_choice',{profileId,date,choice});
  })();
}
export function deterministicWarnings(date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date){const plan=getToday(date,db,profileId);const warnings=plan.flatMap(task=>[...(task.blocked?[{kind:'blocked',taskId:task.id,message:`${task.title} has an incomplete prerequisite`}]:[]),...(task.due_at&&task.due_at<calendarDate?[{kind:'overdue',taskId:task.id,message:`${task.title} is past due`}]:[])]);const capacity=Number(getSettings(db).daily_capacity_minutes??480);const planned=plan.reduce((sum,t)=>sum+(t.duration_bucket?durationMinutes[t.duration_bucket]??0:0),0);if(planned>capacity)warnings.push({kind:'capacity',taskId:0,message:`Planned duration (${planned}m) exceeds daily capacity (${capacity}m)`});return warnings;}
export function editProposal(id:number,payload:unknown,db:Sqlite=sqlite){const valid=proposalPayload.parse(payload);db.transaction(()=>{const r=db.prepare(`UPDATE ai_proposals SET payload=? WHERE id=? AND status='pending'`).run(JSON.stringify(valid),id);if(r.changes!==1)throw new Error('Proposal is no longer pending');event(db,'proposal',id,'edited');})();}

export function getMessagePage(before?:number,db:Sqlite=sqlite){
  const limit=30;
  const ids=db.prepare(`SELECT id FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?`).all(before??Number.MAX_SAFE_INTEGER,limit+1) as {id:number}[];
  const page=ids.slice(0,limit);if(!page.length)return {messages:[],nextCursor:null};
  const messages=db.prepare(`SELECT m.*,p.id proposal_id,p.kind,p.payload,p.status,p.rationale,p.result_type,p.result_id FROM messages m LEFT JOIN ai_proposals p ON p.message_id=m.id WHERE m.id IN (${page.map(()=>'?').join(',')}) ORDER BY m.id,p.id`).all(...page.map(row=>row.id)) as any[];
  return {messages,nextCursor:ids.length>limit?page[page.length-1].id:null};
}
