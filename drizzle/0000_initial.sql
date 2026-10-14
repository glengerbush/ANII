PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  details TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','waiting','completed','dropped')),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  duration_bucket TEXT CHECK(duration_bucket IN ('15m','30m','1h','2h+')),
  due_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_plans (
  plan_date TEXT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('focus','also')),
  position INTEGER NOT NULL DEFAULT 0,
  review_outcome TEXT CHECK(review_outcome IN ('today','tomorrow','backlog','waiting','drop')),
  PRIMARY KEY(plan_date, task_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_plan_order ON daily_plans(plan_date, section, position);
CREATE TABLE IF NOT EXISTS dependencies (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  prerequisite_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('hard','soft')),
  source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(task_id, prerequisite_task_id),
  CHECK(task_id <> prerequisite_task_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model TEXT,
  prompt_version TEXT
);
CREATE TABLE IF NOT EXISTS ai_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','superseded')),
  confidence REAL,
  rationale TEXT,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  result_type TEXT,
  result_id INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  event_type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_date TEXT NOT NULL,
  closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER IF NOT EXISTS focus_capacity_insert
BEFORE INSERT ON daily_plans WHEN NEW.section = 'focus'
BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.plan_date = NEW.plan_date AND dp.section = 'focus' AND t.state NOT IN ('completed','dropped')) >= 3
    THEN RAISE(ABORT, 'Focus cannot exceed three tasks') END;
END;
CREATE TRIGGER IF NOT EXISTS focus_capacity_update
BEFORE UPDATE OF section, plan_date, task_id ON daily_plans WHEN NEW.section = 'focus'
BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.plan_date = NEW.plan_date AND dp.section = 'focus' AND dp.task_id <> OLD.task_id AND t.state NOT IN ('completed','dropped')) >= 3
    THEN RAISE(ABORT, 'Focus cannot exceed three tasks') END;
END;
CREATE TRIGGER IF NOT EXISTS daily_plan_task_immutable
BEFORE UPDATE OF task_id ON daily_plans
BEGIN
  SELECT RAISE(ABORT, 'Daily plan task identity is immutable; remove and recreate');
END;
CREATE TRIGGER IF NOT EXISTS focus_capacity_task_reopen
BEFORE UPDATE OF state ON tasks
WHEN NEW.state NOT IN ('completed','dropped') AND OLD.state IN ('completed','dropped')
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM daily_plans target
    WHERE target.task_id=NEW.id AND target.section='focus'
      AND (SELECT count(*) FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id
           WHERE dp.plan_date=target.plan_date AND dp.section='focus' AND dp.task_id<>NEW.id
             AND t.state NOT IN ('completed','dropped')) >= 3
  ) THEN RAISE(ABORT, 'Focus cannot exceed three tasks') END;
END;
CREATE TRIGGER IF NOT EXISTS dependency_cycle_insert
BEFORE INSERT ON dependencies
BEGIN
  SELECT CASE WHEN EXISTS(
    WITH RECURSIVE reachable(id) AS (
      SELECT prerequisite_task_id FROM dependencies WHERE task_id = NEW.prerequisite_task_id
      UNION
      SELECT d.prerequisite_task_id FROM dependencies d JOIN reachable r ON d.task_id = r.id
    ) SELECT 1 FROM reachable WHERE id = NEW.task_id
  ) THEN RAISE(ABORT, 'Dependency cycle') END;
END;
CREATE TRIGGER IF NOT EXISTS dependency_edges_immutable
BEFORE UPDATE OF task_id, prerequisite_task_id ON dependencies
BEGIN
  SELECT RAISE(ABORT, 'Dependency edges are immutable; remove and recreate');
END;
INSERT OR IGNORE INTO settings(key,value) VALUES
  ('theme','system'),('timezone','local'),('current_priorities',''),('model','qwen3.6-35b-a3b'),
  ('ai_url','http://127.0.0.1:11434'),('daily_capacity_minutes','480');
