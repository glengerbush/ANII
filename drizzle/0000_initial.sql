PRAGMA foreign_keys = ON;
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model TEXT,
  prompt_version TEXT
);

CREATE TABLE ai_proposals (
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

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  event_type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0),
  color TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task_projects (
  position INTEGER NOT NULL DEFAULT 0,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(task_id, project_id)
);

CREATE TABLE "tasks" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  details TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','completed','dropped')),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  duration_bucket TEXT CHECK(duration_bucket IN ('15m','30m','1h','2h+')),
  due_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  remaining_effort_minutes INTEGER CHECK (remaining_effort_minutes IS NULL OR (typeof(remaining_effort_minutes)='integer' AND remaining_effort_minutes BETWEEN 0 AND 525600)),
  lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (typeof(lead_time_days)='integer' AND lead_time_days BETWEEN 0 AND 3650)
);

CREATE TABLE task_completions (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day_date TEXT NOT NULL CHECK(day_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(profile_id,day_date,task_id)
);

CREATE TABLE "dependencies" (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  prerequisite_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(task_id, prerequisite_task_id),
  CHECK(task_id <> prerequisite_task_id)
);

CREATE INDEX task_projects_by_project ON task_projects(project_id, task_id);

CREATE TRIGGER dependency_cycle_insert BEFORE INSERT ON dependencies
BEGIN
  SELECT CASE WHEN EXISTS(
    WITH RECURSIVE reachable(id) AS (
      SELECT prerequisite_task_id FROM dependencies WHERE task_id=NEW.prerequisite_task_id
      UNION SELECT d.prerequisite_task_id FROM dependencies d JOIN reachable r ON d.task_id=r.id
    ) SELECT 1 FROM reachable WHERE id=NEW.task_id
  ) THEN RAISE(ABORT, 'Dependency cycle') END;
END;

CREATE TRIGGER dependency_edges_immutable BEFORE UPDATE OF task_id, prerequisite_task_id ON dependencies
BEGIN
  SELECT RAISE(ABORT, 'Dependency edges are immutable; remove and recreate');
END;

CREATE TABLE task_schedules (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  assignee_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX schedule_start ON task_schedules(start_date,assignee_id);
CREATE TABLE task_day_hides (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  hide_date TEXT NOT NULL,
  PRIMARY KEY(task_id,profile_id,hide_date)
);
CREATE TABLE task_placements (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  focus_position INTEGER,
  queued INTEGER NOT NULL DEFAULT 0 CHECK(queued IN (0,1)),
  PRIMARY KEY(profile_id,task_id)
);
INSERT INTO profiles(id,name) VALUES(1,'Default');
INSERT INTO settings(key,value) VALUES
  ('theme','system'),('timezone','local'),('current_priorities',''),('model','qwen3.6-35b-a3b'),
  ('ai_url','http://127.0.0.1:11434'),('daily_capacity_minutes','480'),('deadline_buffer_days','2');
