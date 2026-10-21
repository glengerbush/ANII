import type Database from 'better-sqlite3';

export function migrateProjectOrder(db:Database.Database) {
  db.transaction(()=>{
    db.exec('ALTER TABLE task_projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
    db.exec(`WITH ordered AS (
      SELECT tp.task_id,tp.project_id,row_number() OVER (PARTITION BY tp.project_id ORDER BY t.created_at DESC,t.id DESC)-1 position
      FROM task_projects tp JOIN tasks t ON t.id=tp.task_id
    ) UPDATE task_projects SET position=(SELECT position FROM ordered o WHERE o.task_id=task_projects.task_id AND o.project_id=task_projects.project_id)`);
  })();
}
