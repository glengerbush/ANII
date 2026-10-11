CREATE TABLE IF NOT EXISTS review_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  review_date TEXT NOT NULL,
  tomorrow_date TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('plan','focus','done')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(profile_id, review_date)
);

INSERT OR IGNORE INTO review_sessions(profile_id,review_date,tomorrow_date,stage,started_at,completed_at)
SELECT profile_id,review_date,date(review_date,'+1 day'),'done',min(closed_at),max(closed_at)
FROM reviews
GROUP BY profile_id,review_date;
