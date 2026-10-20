import type Database from 'better-sqlite3';
import {calendarDate, validDate} from '$lib/calendar';
import {assertFocusCapacity, transitionTask, type TaskState} from '$lib/domain/rules';

type Db = Database.Database;
type Section = 'focus' | 'also';
type PlacementRow = {
  task_id:number; position:number; focus_position:number|null; queued:number;
  eligible:number; state:TaskState; start_date:string|null;
};
export type Placement = {taskId:number; queued:boolean; section:Section; position:number};

export function currentDate(db:Db):string {
  const zone=(db.prepare("SELECT value FROM settings WHERE key='timezone'").get() as {value:string}|undefined)?.value??'local';
  try{return calendarDate(zone);}catch{return calendarDate();}
}

/** Owns Schedule, personal placement, daily visibility, and Completion as one transaction boundary.
 * Callers never need to read a view before issuing a command. Dates are explicit for deterministic
 * tests; request adapters reject stale page dates before calling the module.
 */
export class Planning {
  constructor(private db:Db) {}

  private date(date=currentDate(this.db)) {
    if(!validDate(date))throw new Error('Choose a valid date.');
    return date;
  }
  private profile(id:number) {
    if(!Number.isSafeInteger(id)||!this.db.prepare('SELECT 1 FROM profiles WHERE id=?').get(id))throw new Error('Profile not found.');
  }
  private task(id:number,open=false) {
    const task=this.db.prepare(`SELECT t.id,t.state,s.start_date,s.assignee_id FROM tasks t LEFT JOIN task_schedules s ON s.task_id=t.id WHERE t.id=?`).get(id) as {id:number;state:TaskState;start_date:string|null;assignee_id:number|null}|undefined;
    if(!task)throw new Error('Task not found.');
    if(open&&task.state!=='open')throw new Error('This task is no longer available. Refresh and try again.');
    return task;
  }
  private event(entity:'task'|'plan',id:number,name:string,data:unknown={}) {
    this.db.prepare('INSERT INTO events(entity_type,entity_id,event_type,data) VALUES(?,?,?,?)').run(entity,id,name,JSON.stringify(data));
  }
  private profiles() {return (this.db.prepare('SELECT id FROM profiles ORDER BY id').all() as {id:number}[]).map(p=>p.id);}
  private rows(profileId:number,date:string):PlacementRow[] {
    return this.db.prepare(`SELECT p.*,t.state,s.start_date,
      CASE WHEN t.state='open' AND s.start_date<=? AND (s.assignee_id=? OR s.assignee_id IS NULL)
        AND NOT EXISTS(SELECT 1 FROM task_day_hides h WHERE h.task_id=t.id AND h.profile_id=? AND h.hide_date=?)
        THEN 1 ELSE 0 END eligible
      FROM task_placements p JOIN tasks t ON t.id=p.task_id LEFT JOIN task_schedules s ON s.task_id=t.id
      WHERE p.profile_id=? ORDER BY p.position,p.task_id`).all(date,profileId,profileId,date,profileId) as PlacementRow[];
  }
  private reconcile(profileId:number,date:string):PlacementRow[] {
    this.profile(profileId);
    // New tasks start at the top of the unqueued group, newest first.
    const missing=this.db.prepare(`SELECT id FROM tasks t WHERE t.state<>'dropped' AND NOT EXISTS(
      SELECT 1 FROM task_placements p WHERE p.profile_id=? AND p.task_id=t.id) ORDER BY t.created_at,t.id`).all(profileId) as {id:number}[];
    let first=(this.db.prepare('SELECT coalesce(min(position),0) n FROM task_placements WHERE profile_id=?').get(profileId) as {n:number}).n;
    for(const task of missing)this.db.prepare('INSERT INTO task_placements(profile_id,task_id,position) VALUES(?,?,?)').run(profileId,task.id,--first);
    const rows=this.rows(profileId,date);
    const returning=new Set(rows.filter(r=>r.eligible&&!r.queued).map(r=>r.task_id));
    let end=Math.max(-1,...rows.filter(r=>r.queued&&r.eligible).map(r=>r.position));
    let top=Math.min(0,...rows.filter(r=>!r.queued).map(r=>r.position));
    const transitions=rows.filter(r=>r.queued!==r.eligible).sort((a,b)=>(a.start_date??'').localeCompare(b.start_date??'')||a.task_id-b.task_id);
    for(const row of transitions){
      row.queued=row.eligible;row.position=row.eligible?++end:--top;
      this.db.prepare('UPDATE task_placements SET queued=?,position=? WHERE profile_id=? AND task_id=?').run(row.queued,row.position,profileId,row.task_id);
    }
    // Hidden/completed tasks retain their preferred placement, but cannot displace three
    // already-visible priorities when they return. Reopening always succeeds into Queue.
    const focus=rows.filter(r=>r.eligible&&r.focus_position!==null).sort((a,b)=>Number(returning.has(a.task_id))-Number(returning.has(b.task_id))||a.focus_position!-b.focus_position!||a.task_id-b.task_id);
    for(const row of focus.slice(3)){
      row.focus_position=null;
      this.db.prepare('UPDATE task_placements SET focus_position=NULL WHERE profile_id=? AND task_id=?').run(profileId,row.task_id);
    }
    return rows.filter(r=>r.state==='open').sort((a,b)=>b.queued-a.queued||a.position-b.position||a.task_id-b.task_id);
  }
  private all(date:string){for(const profileId of this.profiles())this.reconcile(profileId,date);}
  private writeOrder(profileId:number,ids:number[],field:'position'|'focus_position') {
    const stmt=this.db.prepare(`UPDATE task_placements SET ${field}=? WHERE profile_id=? AND task_id=?`);
    ids.forEach((id,index)=>stmt.run(index,profileId,id));
  }

  view(profileId:number,date?:string):{backlog:Placement[];now:Placement[]} {
    return this.db.transaction(()=>{
      const rows=this.reconcile(profileId,this.date(date));
      const backlog=rows.map(r=>({taskId:r.task_id,queued:Boolean(r.queued),section:r.focus_position===null?'also' as const:'focus' as const,position:r.position}));
      const focused=rows.filter(r=>r.queued&&r.focus_position!==null).sort((a,b)=>a.focus_position!-b.focus_position!||a.task_id-b.task_id);
      const queue=rows.filter(r=>r.queued&&r.focus_position===null);
      const now=[...focused.map((r,i)=>({taskId:r.task_id,queued:true,section:'focus' as const,position:i})),...queue.map((r,i)=>({taskId:r.task_id,queued:true,section:'also' as const,position:i}))];
      return {backlog,now};
    })();
  }

  schedule(taskId:number,schedule:{startDate:string;assigneeId:number|null}|null) {
    this.db.transaction(()=>{
      const task=this.task(taskId,schedule!==null);
      if(schedule){this.date(schedule.startDate);if(schedule.assigneeId!==null)this.profile(schedule.assigneeId);}
      if(schedule?task.start_date===schedule.startDate&&task.assignee_id===schedule.assigneeId:!task.start_date)return;
      const date=this.date();this.all(date);
      if(schedule)this.db.prepare(`INSERT INTO task_schedules(task_id,start_date,assignee_id) VALUES(?,?,?)
        ON CONFLICT(task_id) DO UPDATE SET start_date=excluded.start_date,assignee_id=excluded.assignee_id`).run(taskId,schedule.startDate,schedule.assigneeId);
      else this.db.prepare('DELETE FROM task_schedules WHERE task_id=?').run(taskId);
      this.db.prepare('DELETE FROM task_day_hides WHERE task_id=?').run(taskId);
      this.all(date);
      this.event('task',taskId,schedule?'scheduled':'unscheduled',schedule??{});
    })();
  }

  queue(profileId:number,taskId:number,options:{date?:string;section?:Section}={}) {
    this.db.transaction(()=>{
      const date=this.date(options.date);const task=this.task(taskId,true);
      const before=this.reconcile(profileId,date).find(r=>r.task_id===taskId)!;
      if(options.section!==undefined&&!['focus','also'].includes(options.section))throw new Error('Choose a valid section.');
      if(!task.start_date||task.start_date>date||(task.assignee_id!==null&&task.assignee_id!==profileId)){
        // A deliberate Queue up replaces an ineligible shared Schedule; eligible Everyone stays shared.
        this.db.prepare(`INSERT INTO task_schedules(task_id,start_date,assignee_id) VALUES(?,?,?)
          ON CONFLICT(task_id) DO UPDATE SET start_date=excluded.start_date,assignee_id=excluded.assignee_id`).run(taskId,date,profileId);
        this.event('task',taskId,'scheduled',{startDate:date,assigneeId:profileId});
      }
      this.db.prepare('DELETE FROM task_day_hides WHERE task_id=? AND profile_id=? AND hide_date=?').run(taskId,profileId,date);
      this.all(date);
      const rows=this.reconcile(profileId,date);const row=rows.find(r=>r.task_id===taskId)!;
      if(options.section==='focus'&&row.focus_position===null){
        const focus=rows.filter(r=>r.queued&&r.focus_position!==null);assertFocusCapacity(focus.length);
        const position=Math.max(-1,...focus.map(r=>r.focus_position!))+1;
        this.db.prepare('UPDATE task_placements SET focus_position=? WHERE profile_id=? AND task_id=?').run(position,profileId,taskId);
      }else if(options.section==='also'&&row.focus_position!==null){
        this.db.prepare('UPDATE task_placements SET focus_position=NULL WHERE profile_id=? AND task_id=?').run(profileId,taskId);
      }
      if(!before.queued||options.section!==undefined)this.event('plan',taskId,'planned',{profileId,date,section:options.section??(row.focus_position===null?'also':'focus')});
    })();
  }

  hide(profileId:number,taskId:number,date?:string) {
    this.db.transaction(()=>{
      const day=this.date(date);this.task(taskId,true);this.reconcile(profileId,day);
      this.db.prepare('INSERT OR IGNORE INTO task_day_hides(task_id,profile_id,hide_date) VALUES(?,?,?)').run(taskId,profileId,day);
      const rows=this.reconcile(profileId,day);
      const top=Math.min(0,...rows.filter(r=>!r.queued&&r.task_id!==taskId).map(r=>r.position))-1;
      this.db.prepare('UPDATE task_placements SET queued=0,position=? WHERE profile_id=? AND task_id=?').run(top,profileId,taskId);
      this.event('plan',taskId,'hidden',{profileId,date:day});
    })();
  }

  moveBacklog(profileId:number,taskId:number,anchorId:number,edge:'before'|'after',group:'queued'|'unqueued',date?:string) {
    this.db.transaction(()=>{
      const day=this.date(date);
      if(!['before','after'].includes(edge)||!['queued','unqueued'].includes(group))throw new Error('Choose a valid move.');
      const rows=this.reconcile(profileId,day);const task=rows.find(r=>r.task_id===taskId),anchor=rows.find(r=>r.task_id===anchorId);
      const queued=group==='queued';
      if(!task||!anchor||Boolean(task.queued)!==queued||Boolean(anchor.queued)!==queued)throw new Error('The queue changed. Reload before moving this task.');
      if(taskId===anchorId)return;
      const original=rows.filter(r=>Boolean(r.queued)===queued).map(r=>r.task_id);
      const ordered=original.filter(id=>id!==taskId);ordered.splice(ordered.indexOf(anchorId)+(edge==='after'?1:0),0,taskId);
      if(ordered.every((id,index)=>id===original[index]))return;
      this.writeOrder(profileId,ordered,'position');
      this.event('plan',taskId,'backlog_moved',{profileId,date:day,anchorId,edge,group});
    })();
  }

  moveNow(profileId:number,taskId:number,section:Section,position:number,date?:string) {
    this.db.transaction(()=>{
      const day=this.date(date);
      if(!['focus','also'].includes(section)||!Number.isInteger(position))throw new Error('Choose a valid section and position.');
      const rows=this.reconcile(profileId,day);const row=rows.find(r=>r.task_id===taskId&&r.queued);
      if(!row)throw new Error('Task is not queued up.');
      const focus=rows.filter(r=>r.queued&&r.focus_position!==null).sort((a,b)=>a.focus_position!-b.focus_position!||a.task_id-b.task_id);
      if(section==='focus'&&row.focus_position===null)assertFocusCapacity(focus.length);
      const original=(section==='focus'?focus:rows.filter(r=>r.queued&&r.focus_position===null)).map(r=>r.task_id);
      const ordered=original.filter(id=>id!==taskId);const at=Math.max(0,Math.min(position,ordered.length));ordered.splice(at,0,taskId);
      const sameSection=(row.focus_position!==null)===(section==='focus');
      if(sameSection&&ordered.every((id,index)=>id===original[index]))return;
      if(section==='focus')this.writeOrder(profileId,ordered,'focus_position');
      else{
        this.db.prepare('UPDATE task_placements SET focus_position=NULL WHERE profile_id=? AND task_id=?').run(profileId,taskId);
        // Reorder Queue slots in the queued Backlog group, leaving Focus's Backlog slots intact.
        const group=rows.filter(r=>r.queued).map(r=>r.task_id);
        const slots=new Set(ordered);let index=0;
        this.writeOrder(profileId,group.map(id=>slots.has(id)?ordered[index++]:id),'position');
      }
      this.event('plan',taskId,'moved',{profileId,date:day,section,position:at});
    })();
  }

  reorderNow(profileId:number,taskId:number,direction:'up'|'down',date?:string) {
    this.db.transaction(()=>{
      if(!['up','down'].includes(direction))throw new Error('Invalid direction');
      const day=this.date(date);const view=this.view(profileId,day);const task=view.now.find(t=>t.taskId===taskId);
      if(!task)throw new Error('Task is not queued up.');
      this.moveNow(profileId,taskId,task.section,task.position+(direction==='up'?-1:1),day);
    })();
  }

  setState(taskId:number,to:TaskState,actorId:number,date?:string) {
    this.db.transaction(()=>{
      if(to==='dropped')throw new Error('This state is legacy-only');
      this.profile(actorId);const task=this.task(taskId);if(task.state===to)return;
      transitionTask(task.state,to);const day=this.date(date);this.all(day);
      const visible=to==='completed'?this.profiles().filter(id=>id===actorId||this.rows(id,day).some(r=>r.task_id===taskId&&r.eligible)):[];
      this.db.prepare(`UPDATE tasks SET state=?,completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(to,to,taskId);
      this.db.prepare('DELETE FROM task_completions WHERE task_id=?').run(taskId);
      for(const id of visible)this.db.prepare('INSERT INTO task_completions(profile_id,day_date,task_id) VALUES(?,?,?)').run(id,day,taskId);
      this.all(day);
      this.event('task',taskId,'state_changed',{from:task.state,to,profileId:actorId});
    })();
  }
}
