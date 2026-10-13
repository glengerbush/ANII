import { z } from 'zod';
import { database } from './db';
import { acceptProposal, addDependency, createTask, getTask, messageForCapture, proposalPayload, type Sqlite } from './repository';
const reference=z.union([z.number().int().positive(),z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)]);
export const changeSetSchema=z.object({message:z.string().max(2000).default(''),clarification:z.boolean().default(false),tasks:z.array(proposalPayload.extend({ref:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)})).max(10).default([]),dependencies:z.array(z.object({task:reference,prerequisite:reference})).max(20).default([])}).strict();
export type ChangeSet=z.infer<typeof changeSetSchema>;
function key(ref:number|string){return `${typeof ref==='number'?'id':'new'}:${ref}`;}
export function validateChangeSet(raw:unknown,db:Sqlite=database.sqlite){
  const plan=changeSetSchema.parse(raw),refs=new Set(plan.tasks.map(task=>task.ref));
  if(refs.size!==plan.tasks.length)throw new Error('New task references must be unique');
  if(plan.clarification&&(plan.tasks.length||plan.dependencies.length))throw new Error('Clarification cannot also change tasks');
  const existingTasks:Record<number,string>={};
  for(const task of plan.tasks)if(task.projectId&&!db.prepare('SELECT id FROM projects WHERE id=?').get(task.projectId))throw new Error('A proposed project no longer exists');
  const graph=new Map<string,string[]>();
  for(const row of db.prepare('SELECT task_id,prerequisite_task_id FROM dependencies').all() as {task_id:number;prerequisite_task_id:number}[])graph.set(key(row.task_id),[...(graph.get(key(row.task_id))??[]),key(row.prerequisite_task_id)]);
  const edges=new Set<string>();
  for(const edge of plan.dependencies){
    for(const ref of [edge.task,edge.prerequisite]){
      if(typeof ref==='string'){if(!refs.has(ref))throw new Error(`Unknown new task reference: ${ref}`);}
      else{const task=getTask(ref,db);if(!task||task.state==='dropped')throw new Error(`Task #${ref} no longer exists`);existingTasks[ref]=task.title;}
    }
    const from=key(edge.task),to=key(edge.prerequisite),edgeKey=`${from}>${to}`;
    if(edges.has(edgeKey))throw new Error('Duplicate proposed dependency');edges.add(edgeKey);
    if((graph.get(from)??[]).includes(to))throw new Error('This dependency already exists');
    const pending=[to],seen=new Set<string>();
    while(pending.length){const current=pending.pop()!;if(current===from)throw new Error('Dependency would create a cycle');if(!seen.has(current)){seen.add(current);pending.push(...(graph.get(current)??[]));}}
    graph.set(from,[...(graph.get(from)??[]),to]);
  }
  return {...plan,existingTasks};
}
export function saveAiResult(messageId:number,raw:unknown,model:string,db:Sqlite=database.sqlite){
  return db.transaction(()=>{
    messageForCapture(messageId,db);const plan=validateChangeSet(raw,db);let proposalCount=0;
    if(plan.tasks.length||plan.dependencies.length){
      db.prepare("INSERT INTO ai_proposals(message_id,kind,schema_version,payload,status,model,prompt_version) VALUES(?,'task_changes',2,?,'pending',?,'capture-v2')").run(messageId,JSON.stringify(plan),model);proposalCount=1;
    }
    if(plan.message)db.prepare("INSERT INTO messages(role,content,model,prompt_version) VALUES('assistant',?,?,'capture-v2')").run(plan.message,model);
    return {proposalCount,message:plan.message,clarification:plan.clarification};
  })();
}
export function acceptAiProposal(id:number,db:Sqlite=database.sqlite){
  const row=db.prepare('SELECT kind FROM ai_proposals WHERE id=?').get(id) as {kind:string}|undefined;
  if(row?.kind!=='task_changes')return acceptProposal(id,db);
  return db.transaction(()=>{
    const proposal=db.prepare('SELECT * FROM ai_proposals WHERE id=?').get(id) as any;
    if(proposal.status!=='pending')throw new Error('Proposal is no longer pending');
    const {existingTasks:_,...raw}=JSON.parse(proposal.payload);const plan=validateChangeSet(raw,db),ids=new Map<string,number>();
    for(const {ref,...task} of plan.tasks)ids.set(ref,createTask(task,db));
    const resolve=(ref:number|string)=>typeof ref==='number'?ref:ids.get(ref)!;
    for(const edge of plan.dependencies)addDependency(resolve(edge.task),resolve(edge.prerequisite),db,proposal.message_id);
    db.prepare("UPDATE ai_proposals SET status='accepted',resolved_at=CURRENT_TIMESTAMP,result_type='task_changes',result_id=NULL WHERE id=?").run(id);
    db.prepare("INSERT INTO events(entity_type,entity_id,event_type,data) VALUES('proposal',?,'accepted',?)").run(id,JSON.stringify({taskIds:Object.fromEntries(ids),dependencies:plan.dependencies}));
    return Object.fromEntries(ids);
  })();
}
