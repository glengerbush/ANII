import { DEFAULT_AI_TIMEOUT_SECONDS, validAiTimeout } from '$lib/ai';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { tasks as tasksTable } from './db/schema';
import { database } from './db';
import { calendarDate, validDate, shiftDate } from '$lib/calendar';
import {Planning,currentDate,type Placement} from './planning';
import { durationMinutes, type TaskState } from '$lib/domain/rules';
import { z } from 'zod';
import { forecastDeadlines, type DeadlineEdge } from '$lib/domain/deadlines';

export type Sqlite = Database.Database;
export type TaskView = {
  id: number; title: string; details: string; state: TaskState; project_id: number | null; project_name: string | null;
  project_ids: number[]; project_names: string[];
  remaining_effort_minutes:number|null; lead_time_days:number;
  duration_bucket: string | null; due_at: string | null; created_at: string; updated_at: string; completed_at: string | null;
  blocked: number; section?: 'focus' | 'also'; position?: number; start_date:string|null; assignee_id:number|null; assignee_name:string|null;
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
export function today(db:Sqlite=sqlite):string {return currentDate(db);}
export function assertCurrentDate(date:string|undefined,db:Sqlite=sqlite){
  const current=today(db);
  if(date!==undefined&&date!==current)throw new Error('The date changed. Reload before making changes.');
  return current;
}
const taskSelect = `SELECT t.*,s.start_date,s.assignee_id,assignee.name assignee_name,
  (SELECT json_group_array(id) FROM (SELECT tp.project_id id FROM task_projects tp JOIN projects p ON p.id=tp.project_id WHERE tp.task_id=t.id ORDER BY p.name COLLATE NOCASE,p.id)) project_ids,
  (SELECT json_group_array(name) FROM (SELECT p.name FROM task_projects tp JOIN projects p ON p.id=tp.project_id WHERE tp.task_id=t.id ORDER BY p.name COLLATE NOCASE,p.id)) project_names,
  (SELECT group_concat(name,' · ') FROM (SELECT p.name FROM task_projects tp JOIN projects p ON p.id=tp.project_id WHERE tp.task_id=t.id ORDER BY p.name COLLATE NOCASE,p.id)) project_name,
  EXISTS(
  SELECT 1 FROM dependencies d JOIN tasks pre ON pre.id=d.prerequisite_task_id
  WHERE d.task_id=t.id AND pre.state <> 'completed'
) blocked FROM tasks t LEFT JOIN task_schedules s ON s.task_id=t.id LEFT JOIN profiles assignee ON assignee.id=s.assignee_id`;
type TaskRow=Omit<TaskView,'project_ids'|'project_names'>&{project_ids:string;project_names:string};
function taskView(row:TaskRow):TaskView{return {...row,project_ids:JSON.parse(row.project_ids||'[]'),project_names:JSON.parse(row.project_names||'[]')};}
function taskViews(rows:TaskRow[]):TaskView[]{return rows.map(taskView);}
export function scheduleTask(taskId:number,startDate:string,assigneeId:number|null,db:Sqlite=sqlite){
  new Planning(db).schedule(taskId,{startDate,assigneeId});
}
export function unscheduleTask(taskId:number,db:Sqlite=sqlite){new Planning(db).schedule(taskId,null);}
export function getScheduledTasks(start:string,end:string,profileId:number|null,db:Sqlite=sqlite):TaskView[]{
  return taskViews(db.prepare(`${taskSelect} WHERE t.state<>'dropped' AND s.start_date BETWEEN ? AND ? ${profileId===null?'':'AND (s.assignee_id=? OR s.assignee_id IS NULL)'} ORDER BY s.start_date,t.title COLLATE NOCASE,t.id`).all(start,end,...(profileId===null?[]:[profileId])) as TaskRow[]);
}
function placementViews(placements:Placement[],db:Sqlite):Array<TaskView&{queued:boolean}> {
  const tasks=taskViews(db.prepare(`${taskSelect} WHERE t.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(placements.map(p=>p.taskId))) as TaskRow[]);
  const byId=new Map(tasks.map(task=>[task.id,task]));
  return placements.map(p=>({...byId.get(p.taskId)!,queued:p.queued,section:p.section,position:p.position}));
}
export function getNow(date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)):TaskView[]{
  return placementViews(new Planning(db).view(profileId,date).now,db);
}
export function getOrderedBacklog(filters:Parameters<typeof getBacklog>[0]={},db:Sqlite=sqlite,profileId=fallbackProfileId(db),date?:string){
  const visible=new Set(getBacklog(filters,db).map(task=>task.id));
  return placementViews(new Planning(db).view(profileId,date).backlog.filter(p=>visible.has(p.taskId)),db);
}
export function moveBacklog(taskId:number,anchorId:number,edge:'before'|'after',group:'queued'|'unqueued',date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){
  new Planning(db).moveBacklog(profileId,taskId,anchorId,edge,group,date);
}
export function getCompletedNow(date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)):TaskView[]{
  date??=today(db);
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
  new Planning(db).setState(id,to,profileId,completionDay);
}
export function deleteTask(id:number,db:Sqlite=sqlite){db.transaction(()=>{const task=getTask(id,db);if(!task)throw new Error('Task not found');db.prepare(`DELETE FROM tasks WHERE id=?`).run(id);event(db,'task',id,'deleted',{title:task.title,projectIds:task.project_ids});})();}
export function addToPlan(taskId:number,date:string|undefined=undefined,section:'focus'|'also'|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){
  new Planning(db).queue(profileId,taskId,{date,section});
}
export function reorderPlan(taskId:number,direction:'up'|'down',date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){
  new Planning(db).reorderNow(profileId,taskId,direction,date);
}
export function movePlan(taskId:number,targetSection:'focus'|'also',targetPosition:number,date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){
  new Planning(db).moveNow(profileId,taskId,targetSection,targetPosition,date);
}
export function removeFromPlan(taskId:number,date:string|undefined=undefined,db:Sqlite=sqlite,profileId=fallbackProfileId(db)){
  new Planning(db).hide(profileId,taskId,date);
}
export function createAndPlan(title:string,section:'focus'|'also'='also',db:Sqlite=sqlite,profileId=fallbackProfileId(db)){ return db.transaction(()=>{const id=createTask({title},db); addToPlan(id,today(db),section,db,profileId); return id;})(); }
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
export function getSettings(db:Sqlite=sqlite):Record<string,string>{return {focus_layout:'equal',ai_timeout_seconds:String(DEFAULT_AI_TIMEOUT_SECONDS),...Object.fromEntries((db.prepare(`SELECT key,value FROM settings`).all() as {key:string;value:string}[]).map(x=>[x.key,x.value]))};}
export function normalizeAiUrl(value:string){
  let url:URL;try{url=new URL(value.trim());}catch{throw new Error('Enter a valid AI server URL, such as http://127.0.0.1:11434');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('AI server URL must use HTTP or HTTPS without credentials, a query, or a fragment');
  return url.toString().replace(/\/+$/,'');
}
export function saveSettings(values:Record<string,string>,db:Sqlite=sqlite){const allowed=new Set(['focus_layout','ai_timeout_seconds','theme','timezone','current_priorities','model','ai_url','daily_capacity_minutes','deadline_buffer_days']);const stmt=db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`);db.transaction(()=>{for(const [k,v] of Object.entries(values)){if(!allowed.has(k))throw new Error(`Unsupported setting: ${k}`);if(k==='timezone'){try{calendarDate(v);}catch{throw new Error('Choose a valid timezone, such as America/New_York, or local.');}}if(k==='theme'&&!['system','light','dark'].includes(v))throw new Error('Choose System, Light, or Dark');if(k==='focus_layout'&&!['equal','now'].includes(v))throw new Error('Choose Three priorities or Now & on deck');if(k==='ai_timeout_seconds'&&!validAiTimeout(v))throw new Error('AI request timeout must be a whole number from 5 to 600 seconds');if(k==='daily_capacity_minutes'||k==='deadline_buffer_days'){const max=k==='daily_capacity_minutes'?1440:365;if(!v.trim()||!Number.isInteger(Number(v))||Number(v)<0||Number(v)>max)throw new Error(`Invalid ${k}`);}stmt.run(k,k==='ai_url'?normalizeAiUrl(v):v);}event(db,'settings',null,'updated',{keys:Object.keys(values)});})();}
export const SNAPSHOT_TABLES=['profiles','projects','tasks','task_projects','task_placements','dependencies','messages','ai_proposals','events','settings','task_completions','task_schedules','task_day_hides'] as const;
export function exportData(db:Sqlite=sqlite){return db.transaction(()=>({version:4 as const,exportedAt:new Date().toISOString(),tables:Object.fromEntries(SNAPSHOT_TABLES.map(t=>[t,db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(t)?db.prepare(`SELECT * FROM ${t}`).all():[]]))}))();}
export function validateImportData(raw:unknown,db:Sqlite=sqlite){
  const envelope=z.object({version:z.literal(4),exportedAt:z.string().datetime(),tables:z.record(z.string(),z.array(z.record(z.string(),z.union([z.string(),z.number(),z.null()]))))}).strict().parse(raw);
  const given=Object.keys(envelope.tables).sort();const expected=[...SNAPSHOT_TABLES].sort();
  if(JSON.stringify(given)!==JSON.stringify(expected))throw new Error('Backup must contain exactly the supported tables');
  for(const table of SNAPSHOT_TABLES){const columns=db.prepare(`PRAGMA table_info(${table})`).all() as {name:string;type:string;notnull:number}[];const names=columns.map(c=>c.name).sort();for(const row of envelope.tables[table]){if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify(names))throw new Error(`Invalid columns in ${table}`);for(const column of columns){const value=row[column.name];if(value===null){if(column.notnull)throw new Error(`${table}.${column.name} cannot be null`);continue;}if(column.type==='INTEGER'&&(!Number.isInteger(value)||typeof value!=='number'))throw new Error(`${table}.${column.name} must be an integer`);if(column.type==='REAL'&&typeof value!=='number')throw new Error(`${table}.${column.name} must be a number`);if(column.type==='TEXT'&&typeof value!=='string')throw new Error(`${table}.${column.name} must be text`);}}}
  if(!envelope.tables.profiles.length)throw new Error('Backup must contain at least one profile');
  const requiredSettings=['theme','timezone','current_priorities','model','ai_url','daily_capacity_minutes','deadline_buffer_days'];const settingKeys=new Set(envelope.tables.settings.map((row)=>row.key));const missingSettings=requiredSettings.filter((key)=>!settingKeys.has(key));if(missingSettings.length)throw new Error(`Backup is missing required settings: ${missingSettings.join(', ')}`);
  for(const row of envelope.tables.tasks){effortEstimate.parse(row.remaining_effort_minutes);leadEstimate.parse(row.lead_time_days);}
  for(const row of envelope.tables.task_schedules)if(!validDate(String(row.start_date)))throw new Error('Invalid schedule start date');
  for(const row of envelope.tables.task_day_hides)if(!validDate(String(row.hide_date)))throw new Error('Invalid hidden date');
  return envelope;
}
export type SnapshotEnvelope=ReturnType<typeof validateImportData>;
export function importData(raw:unknown,db:Sqlite=sqlite){
  const envelope=validateImportData(raw,db);
  db.transaction(()=>{db.pragma('defer_foreign_keys = ON');for(const t of [...SNAPSHOT_TABLES].reverse())db.prepare(`DELETE FROM ${t}`).run();for(const t of SNAPSHOT_TABLES){for(const row of envelope.tables[t]){const keys=Object.keys(row);db.prepare(`INSERT INTO ${t}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}}db.prepare(`INSERT OR IGNORE INTO task_projects(task_id,project_id) SELECT id,project_id FROM tasks WHERE project_id IS NOT NULL`).run();db.prepare(`UPDATE tasks SET project_id=NULL WHERE project_id IS NOT NULL`).run();event(db,'import',null,'restored',{version:envelope.version});})();
}
export function eventsFor(taskId:number,db:Sqlite=sqlite){return db.prepare(`SELECT * FROM events WHERE entity_type='task' AND entity_id=? ORDER BY id DESC LIMIT 20`).all(taskId);}
export function getDueOutsidePlan(date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date):TaskView[]{
  const plannedIds=getNow(date,db,profileId).map(task=>task.id);
  return taskViews(db.prepare(`${taskSelect} WHERE t.state='open' AND t.due_at IS NOT NULL AND t.due_at<>'' AND t.due_at<?
    AND t.id NOT IN (SELECT value FROM json_each(?)) ORDER BY t.due_at,t.id`).all(shiftDate(calendarDate,1),JSON.stringify(plannedIds)) as TaskRow[]);
}
export function getStartWarnings(date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date){
  const settings=getSettings(db);const tasks=taskViews(db.prepare(taskSelect).all() as TaskRow[]);
  const edges=db.prepare('SELECT task_id,prerequisite_task_id FROM dependencies').all() as DeadlineEdge[];
  const plannedIds=new Set(getNow(date,db,profileId).map(task=>task.id));
  const capacity=Number(settings.daily_capacity_minutes??480);const buffer=Number(settings.deadline_buffer_days??2);
  return forecastDeadlines(tasks,edges,calendarDate,Number.isFinite(capacity)?Math.max(0,capacity):0,Number.isInteger(buffer)&&buffer>=0&&buffer<=365?buffer:2).map(warning=>({...warning,planned:plannedIds.has(warning.taskId)}));
}
export function buildSanityContext(date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date){
  const settings=getSettings(db);const plan=getNow(date,db,profileId);const dueOutsidePlan=getDueOutsidePlan(date,db,profileId,calendarDate);
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
    const planned=getNow(date,db,profileId).some(task=>task.id===taskId);
    if(choice==='Add'||choice==='Start'){
      if(planned)throw new Error('Task is already in Now');
      if(choice==='Add'&&(!task.due_at||task.due_at>=shiftDate(calendarDate,1)))throw new Error('Task is no longer due');
      if(choice==='Start'&&!getStartWarnings(date,db,profileId,calendarDate).some(warning=>warning.taskId===taskId))throw new Error('Task no longer needs an early start');
      addToPlan(taskId,date,'also',db,profileId);
    }else{
      if(!planned)throw new Error('Task is no longer in Now');
      if(choice==='Move')removeFromPlan(taskId,date,db,profileId);
    }
    event(db,'plan',taskId,'sanity_choice',{profileId,date,choice});
  })();
}
export function deterministicWarnings(date=today(),db:Sqlite=sqlite,profileId=fallbackProfileId(db),calendarDate=date){const plan=getNow(date,db,profileId);const warnings=plan.flatMap(task=>[...(task.blocked?[{kind:'blocked',taskId:task.id,message:`${task.title} has an incomplete prerequisite`}]:[]),...(task.due_at&&task.due_at<calendarDate?[{kind:'overdue',taskId:task.id,message:`${task.title} is past due`}]:[])]);const capacity=Number(getSettings(db).daily_capacity_minutes??480);const planned=plan.reduce((sum,t)=>sum+(t.duration_bucket?durationMinutes[t.duration_bucket]??0:0),0);if(planned>capacity)warnings.push({kind:'capacity',taskId:0,message:`Planned duration (${planned}m) exceeds daily capacity (${capacity}m)`});return warnings;}
export function editProposal(id:number,payload:unknown,db:Sqlite=sqlite){const valid=proposalPayload.parse(payload);db.transaction(()=>{const r=db.prepare(`UPDATE ai_proposals SET payload=? WHERE id=? AND status='pending'`).run(JSON.stringify(valid),id);if(r.changes!==1)throw new Error('Proposal is no longer pending');event(db,'proposal',id,'edited');})();}

export function getMessagePage(before?:number,db:Sqlite=sqlite){
  const limit=30;
  const ids=db.prepare(`SELECT id FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?`).all(before??Number.MAX_SAFE_INTEGER,limit+1) as {id:number}[];
  const page=ids.slice(0,limit);if(!page.length)return {messages:[],nextCursor:null};
  const messages=db.prepare(`SELECT m.*,p.id proposal_id,p.kind,p.payload,p.status,p.rationale,p.result_type,p.result_id FROM messages m LEFT JOIN ai_proposals p ON p.message_id=m.id WHERE m.id IN (${page.map(()=>'?').join(',')}) ORDER BY m.id,p.id`).all(...page.map(row=>row.id)) as any[];
  return {messages,nextCursor:ids.length>limit?page[page.length-1].id:null};
}
