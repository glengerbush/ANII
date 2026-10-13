import type Database from 'better-sqlite3';

// Before logical days existed, only the completion timestamp is authoritative.
// Do not infer completion from old plan membership: tasks can span many plans.
export function backfillLegacyCompletions(db:Database.Database){
  db.exec(`INSERT OR IGNORE INTO task_completions(profile_id,day_date,task_id,completed_at)
    SELECT DISTINCT dp.profile_id,substr(t.completed_at,1,10),t.id,t.completed_at
    FROM tasks t JOIN daily_plans dp ON dp.task_id=t.id
    WHERE t.state='completed' AND t.completed_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM task_completions c WHERE c.task_id=t.id);
    INSERT OR IGNORE INTO task_completions(profile_id,day_date,task_id,completed_at)
    SELECT COALESCE((SELECT id FROM profiles WHERE id=1),(SELECT min(id) FROM profiles)),substr(t.completed_at,1,10),t.id,t.completed_at
    FROM tasks t WHERE t.state='completed' AND t.completed_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM task_completions c WHERE c.task_id=t.id);`);
}
