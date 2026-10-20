import type Database from 'better-sqlite3';
import {calendarDate} from '$lib/calendar';

/** One-time conversion from the last Review-based schema. */
export function migrateCalendar(db:Database.Database) {
  const configured=(db.prepare("SELECT value FROM settings WHERE key='timezone'").get() as {value:string}|undefined)?.value??'local';
  let date:string;try{date=calendarDate(configured);}catch{date=calendarDate();}
  db.transaction(()=>{
    db.exec(`CREATE TABLE task_schedules (
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
    );`);
    // Keep each profile's active/future plans, not abandoned historical membership.
    // Shared assignments become Everyone under the single-assignee model.
    db.prepare(`INSERT INTO task_schedules(task_id,start_date,assignee_id)
      SELECT dp.task_id,min(dp.plan_date),CASE WHEN count(DISTINCT dp.profile_id)=1 THEN min(dp.profile_id) ELSE NULL END
      FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id
      WHERE t.state='open' AND dp.plan_date>=COALESCE(
        (SELECT active_date FROM profile_days WHERE profile_id=dp.profile_id),
        (SELECT max(p.plan_date) FROM daily_plans p WHERE p.profile_id=dp.profile_id AND p.plan_date<=?),?)
      GROUP BY dp.task_id`).run(date,date);
    db.exec(`ALTER TABLE daily_plans DROP COLUMN review_outcome;
      DROP TABLE review_sessions;
      DROP TABLE reviews;
      DROP TABLE profile_days;
      DELETE FROM events WHERE entity_type='review';`);
    if((db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Calendar migration would break task relationships');
  })();
}
