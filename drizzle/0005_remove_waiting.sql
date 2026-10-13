-- Foreign keys are disabled by createDatabase around this atomic table rebuild.
-- Keep historical migrations unchanged so legacy backups remain reproducible.
DROP TRIGGER IF EXISTS focus_capacity_insert;
DROP TRIGGER IF EXISTS focus_capacity_update;
DROP TRIGGER IF EXISTS daily_plan_task_immutable;
DROP TRIGGER IF EXISTS daily_plan_identity_immutable;
DROP TRIGGER IF EXISTS focus_capacity_task_reopen;
CREATE TEMP TABLE waiting_task_sequence AS SELECT seq FROM sqlite_sequence WHERE name='tasks';
CREATE TABLE tasks_without_waiting (
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
CREATE TABLE daily_plans_without_waiting (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('focus','also')),
  position INTEGER NOT NULL DEFAULT 0,
  review_outcome TEXT CHECK(review_outcome IN ('today','tomorrow','backlog','drop')),
  PRIMARY KEY(profile_id, plan_date, task_id)
);

INSERT INTO tasks_without_waiting
SELECT id,title,details,CASE state WHEN 'waiting' THEN 'open' ELSE state END,
       project_id,duration_bucket,due_at,created_at,updated_at,completed_at,
       remaining_effort_minutes,lead_time_days FROM tasks;
INSERT INTO daily_plans_without_waiting
SELECT profile_id,plan_date,task_id,section,position,
       CASE review_outcome WHEN 'waiting' THEN 'backlog' ELSE review_outcome END FROM daily_plans;
DROP TABLE daily_plans;
DROP TABLE tasks;
ALTER TABLE tasks_without_waiting RENAME TO tasks;
ALTER TABLE daily_plans_without_waiting RENAME TO daily_plans;
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT seq FROM waiting_task_sequence),0)) WHERE name='tasks';
DROP TABLE waiting_task_sequence;
CREATE UNIQUE INDEX daily_plan_order ON daily_plans(profile_id,plan_date,section,position);
CREATE TRIGGER focus_capacity_insert
BEFORE INSERT ON daily_plans WHEN NEW.section = 'focus'
BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id = NEW.profile_id AND dp.plan_date = NEW.plan_date AND dp.section = 'focus' AND t.state NOT IN ('completed','dropped')) >= 3
    THEN RAISE(ABORT, 'Focus cannot exceed three tasks') END;
END;

CREATE TRIGGER focus_capacity_update
BEFORE UPDATE OF profile_id, section, plan_date, task_id ON daily_plans WHEN NEW.section = 'focus'
BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id WHERE dp.profile_id = NEW.profile_id AND dp.plan_date = NEW.plan_date AND dp.section = 'focus' AND NOT (dp.profile_id = OLD.profile_id AND dp.plan_date = OLD.plan_date AND dp.task_id = OLD.task_id) AND t.state NOT IN ('completed','dropped')) >= 3
    THEN RAISE(ABORT, 'Focus cannot exceed three tasks') END;
END;

CREATE TRIGGER daily_plan_identity_immutable
BEFORE UPDATE OF profile_id, task_id ON daily_plans
BEGIN
  SELECT RAISE(ABORT, 'Daily plan identity is immutable; remove and recreate');
END;

CREATE TRIGGER focus_capacity_task_reopen
BEFORE UPDATE OF state ON tasks
WHEN NEW.state NOT IN ('completed','dropped') AND OLD.state IN ('completed','dropped')
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM daily_plans target
    WHERE target.task_id=NEW.id AND target.section='focus'
      AND (SELECT count(*) FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id
           WHERE dp.profile_id=target.profile_id AND dp.plan_date=target.plan_date AND dp.section='focus' AND dp.task_id<>NEW.id
             AND t.state NOT IN ('completed','dropped')) >= 3
  ) THEN RAISE(ABORT, 'Focus cannot exceed three tasks') END;
END;
