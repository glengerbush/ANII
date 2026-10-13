-- Better-after relationships are intentionally discarded, never promoted to blockers.
DROP TRIGGER IF EXISTS dependency_cycle_insert;
DROP TRIGGER IF EXISTS dependency_edges_immutable;
CREATE TABLE dependencies_required (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  prerequisite_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(task_id, prerequisite_task_id),
  CHECK(task_id <> prerequisite_task_id)
);
INSERT INTO dependencies_required(task_id,prerequisite_task_id,source_message_id,confidence,created_at)
SELECT task_id,prerequisite_task_id,source_message_id,confidence,created_at FROM dependencies WHERE kind='hard';
DROP TABLE dependencies;
ALTER TABLE dependencies_required RENAME TO dependencies;
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
