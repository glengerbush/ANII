CREATE TABLE IF NOT EXISTS task_projects (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(task_id, project_id)
);

CREATE INDEX IF NOT EXISTS task_projects_by_project ON task_projects(project_id, task_id);

INSERT OR IGNORE INTO task_projects(task_id, project_id)
SELECT id, project_id FROM tasks WHERE project_id IS NOT NULL;

UPDATE tasks SET project_id = NULL WHERE project_id IS NOT NULL;
