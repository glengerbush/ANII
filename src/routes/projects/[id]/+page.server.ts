import {projectCompletionAction} from '$lib/server/project-actions';
import { redirectAfterSave } from '$lib/server/form-actions';
import { error as httpError, fail, redirect } from '@sveltejs/kit';
import { moveProjectTask, addTaskProject, createProjectForTask, createTask, deleteProject, eventsFor, getBacklog, getDependencies, getProject, getProjectTasks, getNow, listProjects, removeTaskProject, renameProject, today } from '$lib/server/repository';
import { taskScheduleAction, taskDeleteAction, taskDependencyAction, taskEditAction, taskPlanAction, taskRemoveDependencyAction, taskStateAction } from '$lib/server/task-actions';
import { activeProfileId } from '$lib/server/profiles';

const actionError=(error:unknown)=>fail(400,{error:error instanceof Error?error.message:'Operation failed'});
function projectId(params:Record<string,string>){const id=Number(params.id);if(!Number.isInteger(id)||id<=0)httpError(404,'Project not found');return id;}

export const load=({params,cookies})=>{
  const id=projectId(params);const project=getProject(id);if(!project)httpError(404,'Project not found');const tasks=getProjectTasks(id);
  const profileId=activeProfileId(cookies);const date=today();
  return {date,calendarDate:today(),plannedTaskIds:getNow(date,undefined,profileId).map(task=>task.id),project,tasks,projects:listProjects(),allTasks:[...getBacklog(),...getBacklog({state:'completed'})],taskMeta:Object.fromEntries(tasks.map((task)=>[task.id,{...getDependencies(task.id),history:eventsFor(task.id)}]))};
};

export const actions=redirectAfterSave({
  complete:({request,params})=>projectCompletionAction(request,projectId(params)),
  move:async({request,params})=>{const data=await request.formData();try{
    moveProjectTask(projectId(params),Number(data.get('taskId')),Number(data.get('anchorId')),String(data.get('edge')) as 'before'|'after');
    return {success:true};
  }catch(error){return actionError(error);}},
  schedule:({request,cookies})=>taskScheduleAction(request,cookies),
  create:async({request,params})=>{const data=await request.formData();try{createTask({title:String(data.get('title')??''),projectIds:[projectId(params)]});return {success:true};}catch(error){return actionError(error);}},
  plan:({request,cookies})=>taskPlanAction(request,cookies),
  edit:({request})=>taskEditAction(request),
  addProject:async({request})=>{const data=await request.formData();try{addTaskProject(Number(data.get('taskId')),Number(data.get('projectId')));return {success:true};}catch(error){return actionError(error);}},
  removeProject:async({request})=>{const data=await request.formData();try{removeTaskProject(Number(data.get('taskId')),Number(data.get('projectId')));return {success:true};}catch(error){return actionError(error);}},
  createProjectTag:async({request})=>{const data=await request.formData();try{const name=String(data.get('projectName')??'').trim();const id=createProjectForTask(Number(data.get('taskId')),name);return {success:true,project:{id,name}};}catch(error){return actionError(error);}},
  state:({request,cookies})=>taskStateAction(request,cookies),
  deleteTask:({request})=>taskDeleteAction(request),
  dependency:({request})=>taskDependencyAction(request),
  removeDependency:({request})=>taskRemoveDependencyAction(request),
  rename:async({request,params})=>{const data=await request.formData();try{renameProject(projectId(params),String(data.get('name')??''));return {success:true};}catch(error){return actionError(error);}},
  delete:async({params})=>{try{deleteProject(projectId(params));}catch(error){return actionError(error);}redirect(303,'/projects');}
});
