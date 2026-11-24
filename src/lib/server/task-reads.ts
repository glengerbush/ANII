import type Database from 'better-sqlite3';
import {database} from './db';
import type {TaskState} from '$lib/domain/rules';

type Dependency = {
  task_id:number; prerequisite_task_id:number; source_message_id:number|null; confidence:number|null;
  created_at:string; title:string; state:TaskState;
};
type TaskEvent = {id:number; entity_type:string; entity_id:number; event_type:string; data:string; created_at:string};
export type TaskMetadata = {prerequisites:Dependency[]; dependents:Dependency[]; history:TaskEvent[]};

/** Hydrate the metadata of a Task selection in three reads, independent of selection size.
 * History is bounded per task, not across the selection. View selection/order remain with callers.
 */
export function taskMetadata(tasks:readonly {id:number}[],db:Database.Database=database.sqlite):Record<number,TaskMetadata> {
  const ids=[...new Set(tasks.map(task=>task.id))];
  const result:Record<number,TaskMetadata>=Object.fromEntries(ids.map(id=>[id,{prerequisites:[],dependents:[],history:[]}]));
  if (!ids.length) return result;
  const selected=JSON.stringify(ids);
  const prerequisites=db.prepare(`SELECT d.*,t.title,t.state FROM dependencies d JOIN tasks t ON t.id=d.prerequisite_task_id
    WHERE d.task_id IN (SELECT value FROM json_each(?)) ORDER BY d.task_id,d.prerequisite_task_id`).all(selected) as Dependency[];
  const dependents=db.prepare(`SELECT d.*,t.title,t.state FROM dependencies d JOIN tasks t ON t.id=d.task_id
    WHERE d.prerequisite_task_id IN (SELECT value FROM json_each(?)) ORDER BY d.task_id,d.prerequisite_task_id`).all(selected) as Dependency[];
  const history=db.prepare(`SELECT id,entity_type,entity_id,event_type,data,created_at FROM (
    SELECT e.*,row_number() OVER(PARTITION BY entity_id ORDER BY id DESC) AS task_rank
    FROM events e WHERE entity_type='task' AND entity_id IN (SELECT value FROM json_each(?))
  ) WHERE task_rank<=20 ORDER BY id DESC`).all(selected) as TaskEvent[];
  for (const row of prerequisites) result[row.task_id].prerequisites.push(row);
  for (const row of dependents) result[row.prerequisite_task_id].dependents.push(row);
  for (const row of history) result[row.entity_id].history.push(row);
  return result;
}
