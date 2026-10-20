import { getActiveDay } from '$lib/server/repository';
import { redirectAfterSave } from '$lib/server/form-actions';
import { fail } from '@sveltejs/kit';
import { addTaskProject, createProjectForTask, createTask, eventsFor, getBacklog, getDependencies, getToday, listProjects, removeTaskProject, today } from '$lib/server/repository';
import { activeProfileId } from '$lib/server/profiles';
import { taskDeleteAction, taskDependencyAction, taskEditAction, taskPlanAction, taskRemoveDependencyAction, taskStateAction } from '$lib/server/task-actions';
const error=(e:unknown)=>fail(400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=({url,cookies})=>{
  const profileId=activeProfileId(cookies);const date=getActiveDay(undefined,profileId);
  const q=url.searchParams.get('q')??'';const project=Number(url.searchParams.get('project'))||undefined;
  const requestedState=url.searchParams.get('state');const state=requestedState==='blocked'?requestedState!:undefined;
  const due=url.searchParams.get('due')==='1';const tasks=getBacklog({q,project,state,due});
  const completedTasks=getBacklog({q,project,due,state:'completed'});
  return {date,calendarDate:today(),plannedTaskIds:getToday(date,undefined,profileId).map(task=>task.id),tasks,completedTasks,showCompleted:url.searchParams.get('showCompleted')==='1'||requestedState==='completed',allTasks:[...getBacklog(),...getBacklog({state:'completed'})],projects:listProjects(),taskMeta:Object.fromEntries([...tasks,...completedTasks].map((task)=>[task.id,{...getDependencies(task.id),history:eventsFor(task.id)}])),filters:{q,project,state,due}};
};
export const actions=redirectAfterSave({
  create:async({request})=>{const d=await request.formData();try{createTask({title:String(d.get('title')??'')});return {success:true}}catch(e){return error(e)}},
  plan:({request,cookies})=>taskPlanAction(request,cookies),
  state:({request,cookies})=>taskStateAction(request,cookies),
  deleteTask:({request})=>taskDeleteAction(request),
  edit:({request})=>taskEditAction(request),
  addProject:async({request})=>{const d=await request.formData();try{addTaskProject(Number(d.get('taskId')),Number(d.get('projectId')));return {success:true}}catch(e){return error(e)}},
  removeProject:async({request})=>{const d=await request.formData();try{removeTaskProject(Number(d.get('taskId')),Number(d.get('projectId')));return {success:true}}catch(e){return error(e)}},
  createProjectTag:async({request})=>{const d=await request.formData();try{const name=String(d.get('projectName')??'').trim();const id=createProjectForTask(Number(d.get('taskId')),name);return {success:true,project:{id,name}}}catch(e){return error(e)}},
  dependency:({request})=>taskDependencyAction(request),
  removeDependency:({request})=>taskRemoveDependencyAction(request),
});
