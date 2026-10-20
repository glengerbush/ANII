import type Database from 'better-sqlite3';
import {calendarDate} from '$lib/calendar';

export const placementSchema=`CREATE TABLE task_placements (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  focus_position INTEGER,
  queued INTEGER NOT NULL DEFAULT 0 CHECK(queued IN (0,1)),
  PRIMARY KEY(profile_id,task_id)
);`;

/** Convert the latest personal placement once; historical daily rows cease to constrain Now. */
export function migratePlacements(db:Database.Database) {
  const zone=(db.prepare("SELECT value FROM settings WHERE key='timezone'").get() as {value:string}|undefined)?.value??'local';
  let date:string;try{date=calendarDate(zone);}catch{date=calendarDate();}
  db.transaction(()=>{
    db.exec(placementSchema);
    const profiles=db.prepare('SELECT id FROM profiles ORDER BY id').all() as {id:number}[];
    const insert=db.prepare('INSERT INTO task_placements(profile_id,task_id,position,focus_position,queued) VALUES(?,?,?,?,?)');
    for(const {id} of profiles){
      const plans=db.prepare(`SELECT dp.task_id,dp.section,dp.position,t.state,s.start_date,
        NOT EXISTS(SELECT 1 FROM task_day_hides h WHERE h.task_id=dp.task_id AND h.profile_id=dp.profile_id AND h.hide_date=?) visible
        FROM daily_plans dp JOIN tasks t ON t.id=dp.task_id JOIN task_schedules s ON s.task_id=t.id
        WHERE dp.profile_id=? AND (s.assignee_id=? OR s.assignee_id IS NULL)
          AND dp.plan_date=coalesce((SELECT max(p.plan_date) FROM daily_plans p WHERE p.profile_id=dp.profile_id AND p.task_id=dp.task_id AND p.plan_date>=s.start_date AND p.plan_date<=?),
            (SELECT min(p.plan_date) FROM daily_plans p WHERE p.profile_id=dp.profile_id AND p.task_id=dp.task_id AND p.plan_date>=s.start_date))
        ORDER BY CASE dp.section WHEN 'focus' THEN 0 ELSE 1 END,dp.position,dp.task_id`).all(date,id,id,date) as {task_id:number;section:string;position:number;state:string;start_date:string;visible:number}[];
      let focus=0;
      plans.forEach((p,index)=>insert.run(id,p.task_id,index,p.section==='focus'?focus++:null,Number(p.state==='open'&&p.start_date<=date&&Boolean(p.visible))));
    }
    db.exec(`DROP TRIGGER IF EXISTS focus_capacity_task_reopen;
      DROP TRIGGER IF EXISTS focus_capacity_insert;
      DROP TRIGGER IF EXISTS focus_capacity_update;
      DROP TRIGGER IF EXISTS daily_plan_identity_immutable;
      DROP TABLE daily_plans;`);
    if((db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Placement migration would break task relationships');
  })();
}
