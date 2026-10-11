BEGIN;
ALTER TABLE tasks ADD COLUMN remaining_effort_minutes INTEGER CHECK (remaining_effort_minutes IS NULL OR (typeof(remaining_effort_minutes)='integer' AND remaining_effort_minutes BETWEEN 0 AND 525600));
ALTER TABLE tasks ADD COLUMN lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (typeof(lead_time_days)='integer' AND lead_time_days BETWEEN 0 AND 3650);
INSERT OR IGNORE INTO settings(key,value) VALUES('deadline_buffer_days','2');
COMMIT;
