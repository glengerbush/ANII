import { error, fail } from '@sveltejs/kit';
import { redirectAfterSave } from '$lib/server/form-actions';
import { activeProfileId } from '$lib/server/profiles';
import { addTaskProject, createProjectForTask, eventsFor, getBacklog, getCompletedHistory, getDependencies, listProjects, removeTaskProject, today } from '$lib/server/repository';
import { taskScheduleAction, taskDeleteAction, taskDependencyAction, taskEditAction, taskRemoveDependencyAction, taskStateAction } from '$lib/server/task-actions';

function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&Number.isFinite(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;}
function shiftDate(value:string,offset:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);const shifted=date.toISOString().slice(0,10);return validDate(shifted)?shifted:null;}
const actionError=(value:unknown)=>fail(400,{error:value instanceof Error?value.message:'Operation failed'});

export const load=({url,cookies})=>{
  const profileId=activeProfileId(cookies);const activeDate=today();
  const date=url.searchParams.get('date')??activeDate;if(!validDate(date))error(400,'Choose a valid completed day.');
  const mode=url.searchParams.get('mode')==='all'?'all':'day';const q=url.searchParams.get('q')?.trim()??'';
  const rawProject=url.searchParams.get('project');const project=rawProject?Number(rawProject):undefined;
  if(project!==undefined&&(!Number.isSafeInteger(project)||project<1))error(400,'Choose a valid project.');
  const tasks=getCompletedHistory(mode==='all'?{q,project}:{date},undefined,profileId);
  return {mode,date,activeDate,calendarDate:today(),previousDate:shiftDate(date,-1),nextDate:shiftDate(date,1),tasks,filters:{q,project},projects:listProjects(),allTasks:[...getBacklog(),...getBacklog({state:'completed'})],taskMeta:Object.fromEntries(tasks.map(task=>[task.id,{...getDependencies(task.id),history:eventsFor(task.id)}]))};
};

export const actions=redirectAfterSave({
  schedule:({request,cookies})=>taskScheduleAction(request,cookies),
  state:({request,cookies})=>taskStateAction(request,cookies),
  edit:({request})=>taskEditAction(request),
  deleteTask:({request})=>taskDeleteAction(request),
  dependency:({request})=>taskDependencyAction(request),
  removeDependency:({request})=>taskRemoveDependencyAction(request),
  addProject:async({request})=>{const data=await request.formData();try{addTaskProject(Number(data.get('taskId')),Number(data.get('projectId')));return {success:true};}catch(value){return actionError(value);}},
  removeProject:async({request})=>{const data=await request.formData();try{removeTaskProject(Number(data.get('taskId')),Number(data.get('projectId')));return {success:true};}catch(value){return actionError(value);}},
  createProjectTag:async({request})=>{const data=await request.formData();try{const name=String(data.get('projectName')??'').trim();const id=createProjectForTask(Number(data.get('taskId')),name);return {success:true,project:{id,name}};}catch(value){return actionError(value);}}
});
