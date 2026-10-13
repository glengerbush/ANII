import { z } from 'zod';
import { database } from './db';
import { getDependencies, getTask, type Sqlite } from './repository';
const search=z.object({query:z.string().max(200).default(''),projectId:z.number().int().positive().optional(),state:z.enum(['open','completed','blocked','all']).default('open'),limit:z.number().int().min(1).max(10).default(6),offset:z.number().int().min(0).max(1000).default(0)}).strict();
const taskIds=z.object({ids:z.array(z.number().int().positive()).min(1).max(8)}).strict();
const history=z.object({query:z.string().min(1).max(200),limit:z.number().int().min(1).max(10).default(5),beforeId:z.number().int().positive().optional()}).strict();
export const toolSchemas={search_tasks:search,get_tasks:taskIds,get_dependencies:taskIds,search_chat_history:history};
const descriptions={search_tasks:'Find existing tasks by words in title or notes; optional project/status filters. Returns compact snippets and IDs. Use separate searches for alternative names. More pages via offset.',get_tasks:'Read full bounded task details and project labels for known task IDs.',get_dependencies:'Read prerequisites and dependents for known task IDs. Every dependency is required.',search_chat_history:'Find older chat messages by words, with proposal outcomes. Returns compact snippets. Paginate with beforeId.'};
export const lookupTools=Object.entries(toolSchemas).map(([name,schema])=>({type:'function',function:{name,description:descriptions[name as keyof typeof descriptions],parameters:z.toJSONSchema(schema)}}));
const terms=(value:string)=>value.trim().split(/\s+/).filter(Boolean).slice(0,12).map(term=>`%${term.replace(/[\\%_]/g,'\\$&')}%`);
function searchSnippet(text:string,query:string,size=240){const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean);const positions=words.map(word=>text.toLowerCase().indexOf(word)).filter(index=>index>=0);const start=positions.length?Math.max(0,Math.min(...positions)-60):0;return `${start?'…':''}${text.slice(start,start+size)}${text.length>start+size?'…':''}`;}
function outcomes(id:number,db:Sqlite){return db.prepare('SELECT kind,status,result_id,substr(payload,1,600) payload,length(payload)>600 payloadTruncated FROM ai_proposals WHERE message_id=? ORDER BY id LIMIT 3').all(id);}
export function recentConversation(messageId:number,db:Sqlite=database.sqlite){
  const rows=db.prepare('SELECT id,role,substr(content,1,1200) content FROM messages WHERE id<=? ORDER BY id DESC LIMIT 12').all(messageId) as {id:number;role:string;content:string}[];
  return rows.reverse().map(row=>({...row,proposalOutcomes:outcomes(row.id,db)}));
}
export function runLookup(name:string,args:unknown,db:Sqlite=database.sqlite){
  if(name==='search_tasks'){
    const filter=search.parse(args),where=["t.state<>'dropped'"],values:unknown[]=[];
    if(filter.state==='open'||filter.state==='completed'){where.push('t.state=?');values.push(filter.state);}
    if(filter.state==='blocked')where.push("t.state='open' AND EXISTS(SELECT 1 FROM dependencies d JOIN tasks pre ON pre.id=d.prerequisite_task_id WHERE d.task_id=t.id AND pre.state<>'completed')");
    if(filter.projectId){where.push('EXISTS(SELECT 1 FROM task_projects tp WHERE tp.task_id=t.id AND tp.project_id=?)');values.push(filter.projectId);}
    for(const term of terms(filter.query)){where.push("(t.title LIKE ? ESCAPE '\\' OR t.details LIKE ? ESCAPE '\\')");values.push(term,term);}
    const rows=db.prepare(`SELECT t.id,t.title,t.state,t.details,t.due_at FROM tasks t WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC,t.id DESC LIMIT ? OFFSET ?`).all(...values,filter.limit+1,filter.offset) as any[];
    return {tasks:rows.slice(0,filter.limit).map(({details,...row})=>({...row,title:row.title.slice(0,300),snippet:searchSnippet(details,filter.query)})),more:rows.length>filter.limit,nextOffset:filter.offset+filter.limit};
  }
  if(name==='get_tasks')return {tasks:taskIds.parse(args).ids.map(id=>{const task=getTask(id,db);return task?{...task,title:task.title.slice(0,300),details:task.details.slice(0,2000),detailsTruncated:task.details.length>2000}:{id,error:'Task not found'};})};
  if(name==='get_dependencies')return {tasks:taskIds.parse(args).ids.map(id=>({id,...Object.fromEntries(Object.entries(getDependencies(id,db)).map(([key,rows])=>[key,{items:(rows as any[]).slice(0,20).map(row=>({...row,title:row.title.slice(0,300)})),truncated:(rows as any[]).length>20}]))}))};
  if(name==='search_chat_history'){
    const filter=history.parse(args),where=['id<?'],values:unknown[]=[filter.beforeId??Number.MAX_SAFE_INTEGER];
    for(const term of terms(filter.query)){where.push("content LIKE ? ESCAPE '\\'");values.push(term);}
    const rows=db.prepare(`SELECT id,role,content FROM messages WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...values,filter.limit+1) as any[];
    return {messages:rows.slice(0,filter.limit).map(row=>({id:row.id,role:row.role,snippet:searchSnippet(row.content,filter.query,500),proposalOutcomes:outcomes(row.id,db)})),more:rows.length>filter.limit,nextBeforeId:rows[Math.min(rows.length,filter.limit)-1]?.id??null};
  }
  throw new Error('Unknown lookup tool');
}
