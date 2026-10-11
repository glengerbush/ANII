import { durationMinutes, type TaskState } from './rules';

export type DeadlineTask={id:number;title:string;state:TaskState;due_at:string|null;duration_bucket:string|null;remaining_effort_minutes:number|null;lead_time_days:number};
export type DeadlineEdge={task_id:number;prerequisite_task_id:number;kind:'hard'|'soft'};
export type DeadlineForecast={taskId:number;title:string;dueAt:string;startBy:string|null;effortMinutes:number;workDays:number|null;leadDays:number;bufferDays:number;incompleteEstimates:string[];prerequisites:{id:number;title:string}[]};

function dateNumber(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:null;
}

// A conservative start estimate: all remaining effort plus the longest chain of
// calendar lead times. Parallel branches share effort capacity; shared ancestors
// count once. Completed prerequisites stop traversal. Soft edges do not constrain it.
export function forecastDeadlines(tasks:DeadlineTask[],edges:DeadlineEdge[],date:string,capacity:number,bufferDays:number):DeadlineForecast[]{
  const now=dateNumber(date);if(now===null)throw new Error('Invalid planning date');
  const byId=new Map(tasks.map(task=>[task.id,task]));const parents=new Map<number,number[]>();
  for(const edge of edges)if(edge.kind==='hard')parents.set(edge.task_id,[...(parents.get(edge.task_id)??[]),edge.prerequisite_task_id]);
  const forecasts:DeadlineForecast[]=[];
  for(const task of tasks){
    const due=task.due_at?dateNumber(task.due_at.slice(0,10)):null;
    if(!['open','waiting'].includes(task.state)||due===null||due<=now)continue;
    const included=new Map<number,DeadlineTask>();const visiting=new Set<number>();const leadCache=new Map<number,number>();
    const visit=(id:number):number=>{
      const node=byId.get(id);if(!node||node.state==='completed')return 0;
      if(visiting.has(id))throw new Error('Dependency cycle');
      const cached=leadCache.get(id);if(cached!==undefined)return cached;
      included.set(id,node);visiting.add(id);
      const lead=node.lead_time_days+Math.max(0,...(parents.get(id)??[]).map(visit));
      visiting.delete(id);leadCache.set(id,lead);return lead;
    };
    const leadDays=visit(task.id);let effortMinutes=0;const incompleteEstimates:string[]=[];
    for(const node of included.values()){
      effortMinutes+=node.remaining_effort_minutes??durationMinutes[node.duration_bucket??'']??0;
      if(node.state==='dropped'||(node.remaining_effort_minutes===null&&(!node.duration_bucket||node.duration_bucket==='2h+')))incompleteEstimates.push(node.title);
    }
    const workDays=effortMinutes===0?0:capacity>0?Math.ceil(effortMinutes/capacity):null;
    const startBy=workDays===null?null:new Date(due-(workDays+leadDays+bufferDays)*86_400_000).toISOString().slice(0,10);
    if(startBy!==null&&startBy>date)continue;
    forecasts.push({taskId:task.id,title:task.title,dueAt:task.due_at!,startBy,effortMinutes,workDays,leadDays,bufferDays,incompleteEstimates,prerequisites:[...included.values()].filter(node=>node.id!==task.id).map(({id,title})=>({id,title}))});
  }
  return forecasts.sort((a,b)=>(a.startBy??'').localeCompare(b.startBy??'')||a.dueAt.localeCompare(b.dueAt)||a.taskId-b.taskId);
}
