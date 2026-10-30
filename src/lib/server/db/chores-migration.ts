import type Database from 'better-sqlite3';

/** Additive migration: existing tasks, queues and profiles are untouched. */
export function migrateChores(db:Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
      notes TEXT NOT NULL DEFAULT '',
      rule TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
      generated_through TEXT,
      next_assignee INTEGER NOT NULL DEFAULT 0 CHECK(next_assignee>=0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chore_assignees (
      chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK(position>=0),
      PRIMARY KEY(chore_id,profile_id), UNIQUE(chore_id,position)
    );
    CREATE TABLE IF NOT EXISTS chore_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      due_date TEXT NOT NULL,
      last_due_date TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK(occurrence_count>0),
      assignee_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      completed_at TEXT,
      completed_by INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
      UNIQUE(chore_id,due_date)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS chore_one_outstanding ON chore_occurrences(chore_id) WHERE completed_at IS NULL;
    CREATE INDEX IF NOT EXISTS chore_due_by_assignee ON chore_occurrences(assignee_id,completed_at,due_date);
  `);
}
