import type Database from 'better-sqlite3';
import { z } from 'zod';
import { database } from './db';
import { currentDate } from './planning';
import { shiftDate, validDate } from '$lib/calendar';
import { choreRuleSchema, occurrenceDates, nextChoreDate, type ChoreDefinition, type ChoreOccurrence, type ChoreRule } from '$lib/domain/chores';

const inputSchema=z.object({title:z.string().trim().min(1,'Enter a chore name.').max(300),notes:z.string().max(10_000).default(''),rule:choreRuleSchema,assigneeIds:z.array(z.number().int().positive()).max(100).refine(ids=>new Set(ids).size===ids.length,'Choose each person once.')}).strict();
type Input=z.infer<typeof inputSchema>;
type Row={id:number;title:string;notes:string;rule:string;active:number;revision:number;generated_through:string|null;next_assignee:number};
const occurrenceSelect=`SELECT o.*,c.title,c.notes,p.name assignee_name,done.name completed_by_name FROM chore_occurrences o JOIN chores c ON c.id=o.chore_id LEFT JOIN profiles p ON p.id=o.assignee_id LEFT JOIN profiles done ON done.id=o.completed_by`;

/** Owns recurrence materialization, accrued counts and completion-based rotation. */
export class Chores {
  constructor(private db:Database.Database=database.sqlite){}
  private row(id:number):Row {
    const row=this.db.prepare('SELECT * FROM chores WHERE id=?').get(id) as Row|undefined;
    if(!row)throw new Error('This chore no longer exists. Refresh and try again.');return row;
  }
  private profile(id:number){if(!Number.isSafeInteger(id)||!this.db.prepare('SELECT 1 FROM profiles WHERE id=?').get(id))throw new Error('Choose an existing person.');}
  private assignees(id:number):number[]{return (this.db.prepare('SELECT profile_id FROM chore_assignees WHERE chore_id=? ORDER BY position').all(id) as {profile_id:number}[]).map(r=>r.profile_id);}
  private checkRevision(actual:number,expected:number){if(!Number.isSafeInteger(expected)||actual!==expected)throw new Error('This chore changed. Refresh before trying again.');}
  private input(value:unknown):Input {const input=inputSchema.parse(value);input.assigneeIds.forEach(id=>this.profile(id));return input;}
  private setAssignees(id:number,ids:number[]){
    this.db.prepare('DELETE FROM chore_assignees WHERE chore_id=?').run(id);
    const insert=this.db.prepare('INSERT INTO chore_assignees(chore_id,profile_id,position) VALUES(?,?,?)');ids.forEach((person,index)=>insert.run(id,person,index));
  }
  private log(id:number,type:string,data:unknown){this.db.prepare("INSERT INTO events(entity_type,entity_id,event_type,data) VALUES('chore',?,?,?)").run(id,type,JSON.stringify(data));}
  private date(date:string){if(!validDate(date))throw new Error('Choose a valid date.');}
  private materializeRow(row:Row,date:string){
    if(!row.active||row.generated_through&&row.generated_through>=date)return;
    const rule=choreRuleSchema.parse(JSON.parse(row.rule));
    const from=row.generated_through?shiftDate(row.generated_through,1):rule.startDate;
    let count=0,first='',last='';
    for(const day of occurrenceDates(rule,from,date)){count++;if(!first)first=day;last=day;}
    if(count){
      const open=this.db.prepare('SELECT id FROM chore_occurrences WHERE chore_id=? AND completed_at IS NULL').get(row.id) as {id:number}|undefined;
      if(open)this.db.prepare('UPDATE chore_occurrences SET occurrence_count=occurrence_count+?,last_due_date=?,revision=revision+1 WHERE id=?').run(count,last,open.id);
      else{
        const assignees=this.assignees(row.id),person=assignees.length?assignees[row.next_assignee%assignees.length]:null;
        this.db.prepare('INSERT INTO chore_occurrences(chore_id,due_date,last_due_date,occurrence_count,assignee_id) VALUES(?,?,?,?,?)').run(row.id,first,last,count,person);
      }
    }
    this.db.prepare('UPDATE chores SET generated_through=? WHERE id=?').run(date,row.id);
  }
  private materialize(date:string){this.date(date);for(const row of this.db.prepare('SELECT * FROM chores WHERE active=1').all() as Row[])this.materializeRow(row,date);}
  create(value:unknown,date=currentDate(this.db)):number {return this.db.transaction(()=>{
    this.date(date);const input=this.input(value);
    const result=this.db.prepare('INSERT INTO chores(title,notes,rule) VALUES(?,?,?)').run(input.title,input.notes,JSON.stringify(input.rule));
    const id=Number(result.lastInsertRowid);this.setAssignees(id,input.assigneeIds);this.materializeRow(this.row(id),date);this.log(id,'created',input);return id;
  }).immediate();}
  edit(id:number,revision:number,value:unknown,date=currentDate(this.db)){return this.db.transaction(()=>{
    this.date(date);const row=this.row(id);this.checkRevision(row.revision,revision);const input=this.input(value);
    this.materializeRow(row,date);
    this.db.prepare('UPDATE chores SET title=?,notes=?,rule=?,generated_through=?,revision=revision+1 WHERE id=?').run(input.title,input.notes,JSON.stringify(input.rule),date,id);
    this.setAssignees(id,input.assigneeIds);this.log(id,'updated',input);
  }).immediate();}
  setActive(id:number,revision:number,active:boolean,date=currentDate(this.db)){return this.db.transaction(()=>{
    this.date(date);const row=this.row(id);this.checkRevision(row.revision,revision);if(Boolean(row.active)===active)return;this.materializeRow(row,date);
    const through=active?([row.generated_through??'',shiftDate(date,-1)].sort().at(-1)!):date;
    this.db.prepare('UPDATE chores SET active=?,generated_through=?,revision=revision+1 WHERE id=?').run(Number(active),through,id);
    this.materializeRow(this.row(id),date);this.log(id,active?'resumed':'paused',{});
  }).immediate();}
  due(profileId:number|null,date=currentDate(this.db)):ChoreOccurrence[]{return this.db.transaction(()=>{
    if(profileId!==null)this.profile(profileId);this.materialize(date);
    return this.db.prepare(`${occurrenceSelect} WHERE o.completed_at IS NULL AND o.due_date<=? ${profileId===null?'':'AND (o.assignee_id=? OR o.assignee_id IS NULL)'} ORDER BY o.due_date,c.title COLLATE NOCASE,o.id`).all(date,...(profileId===null?[]:[profileId])) as ChoreOccurrence[];
  }).immediate();}
  view(date=currentDate(this.db)) {return this.db.transaction(()=>{
    const dueChores=this.due(null,date);
    const chores=(this.db.prepare('SELECT * FROM chores ORDER BY active DESC,title COLLATE NOCASE,id').all() as Row[]).map(row=>{
      const rule=choreRuleSchema.parse(JSON.parse(row.rule));
      return {id:row.id,title:row.title,notes:row.notes,rule,active:Boolean(row.active),revision:row.revision,assigneeIds:this.assignees(row.id),nextDate:row.active?nextChoreDate(rule,date):null} satisfies ChoreDefinition;
    });
    const completedChores=this.db.prepare(`${occurrenceSelect} WHERE o.completed_at IS NOT NULL ORDER BY o.completed_at DESC,o.id DESC LIMIT 100`).all() as ChoreOccurrence[];
    return {chores,dueChores,completedChores,date};
  }).immediate();}
  private occurrence(id:number,revision:number,date:string):ChoreOccurrence {
    this.materialize(date);
    const occurrence=this.db.prepare(`${occurrenceSelect} WHERE o.id=?`).get(id) as ChoreOccurrence|undefined;
    if(!occurrence)throw new Error('This occurrence no longer exists. Refresh and try again.');
    this.checkRevision(occurrence.revision,revision);return occurrence;
  }
  complete(id:number,revision:number,completed:boolean,actor:number,date=currentDate(this.db)){return this.db.transaction(()=>{
    this.profile(actor);const occurrence=this.occurrence(id,revision,date);
    if(Boolean(occurrence.completed_at)===completed)return;
    if(completed){
      this.db.prepare('UPDATE chore_occurrences SET completed_at=CURRENT_TIMESTAMP,completed_by=?,revision=revision+1 WHERE id=?').run(actor,id);
      this.db.prepare('UPDATE chores SET next_assignee=next_assignee+1 WHERE id=?').run(occurrence.chore_id);
    }else{
      if(this.db.prepare('SELECT 1 FROM chore_occurrences WHERE chore_id=? AND id>?').get(occurrence.chore_id,id))throw new Error('A newer occurrence already exists. Update that chore instead.');
      this.db.prepare('UPDATE chore_occurrences SET completed_at=NULL,completed_by=NULL,revision=revision+1 WHERE id=?').run(id);
      this.db.prepare('UPDATE chores SET next_assignee=MAX(0,next_assignee-1) WHERE id=?').run(occurrence.chore_id);
    }
    this.log(occurrence.chore_id,completed?'completed':'reopened',{occurrenceId:id,count:occurrence.occurrence_count,actor});
  }).immediate();}
  assign(id:number,revision:number,assignee:number|null,actor:number,date=currentDate(this.db)){return this.db.transaction(()=>{
    this.profile(actor);if(assignee!==null)this.profile(assignee);
    const occurrence=this.occurrence(id,revision,date);if(occurrence.completed_at)throw new Error('Reopen the chore before assigning it.');
    this.db.prepare('UPDATE chore_occurrences SET assignee_id=?,revision=revision+1 WHERE id=?').run(assignee,id);
    this.log(occurrence.chore_id,'reassigned',{occurrenceId:id,from:occurrence.assignee_id,to:assignee,actor});
  }).immediate();}
}
