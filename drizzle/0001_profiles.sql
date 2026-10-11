CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0),
  color TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO profiles(id, name) VALUES(1, 'Default');

DROP TRIGGER IF EXISTS focus_capacity_insert;
DROP TRIGGER IF EXISTS focus_capacity_update;
DROP TRIGGER IF EXISTS daily_plan_task_immutable;
DROP TRIGGER IF EXISTS focus_capacity_task_reopen;
DROP INDEX IF EXISTS daily_plan_order;

ALTER TABLE daily_plans RENAME TO daily_plans_without_profiles;

CREATE TABLE daily_plans (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('focus','also')),
  position INTEGER NOT NULL DEFAULT 0,
  review_outcome TEXT CHECK(review_outcome IN ('today','tomorrow','backlog','waiting','drop')),
  PRIMARY KEY(profile_id, plan_date, task_id)
);

INSERT INTO daily_plans(profile_id, plan_date, task_id, section, position, review_outcome)
SELECT 1, plan_date, task_id, section, position, review_outcome
FROM daily_plans_without_profiles;

DROP TABLE daily_plans_without_profiles;

CREATE UNIQUE INDEX daily_plan_order ON daily_plans(profile_id, plan_date, section, position);

ALTER TABLE reviews ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE CASCADE;

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
