import { error as httpError, fail, redirect } from '@sveltejs/kit';
import { addDependency, addTaskProject, createProjectForTask, createTask, deleteProject, eventsFor, getBacklog, getDependencies, getProject, getProjectTasks, listProjects, removeDependency, removeTaskProject, renameProject } from '$lib/server/repository';
import { taskDeleteAction, taskEditAction, taskStateAction } from '$lib/server/task-actions';

const actionError=(error:unknown)=>fail(400,{error:error instanceof Error?error.message:'Operation failed'});
function projectId(params:Record<string,string>){const id=Number(params.id);if(!Number.isInteger(id)||id<=0)httpError(404,'Project not found');return id;}

export const load=({params})=>{
  const id=projectId(params);const project=getProject(id);if(!project)httpError(404,'Project not found');const tasks=getProjectTasks(id);
  return {project,tasks,projects:listProjects(),allTasks:getBacklog(),taskMeta:Object.fromEntries(tasks.map((task)=>[task.id,{...getDependencies(task.id),history:eventsFor(task.id)}]))};
};

export const actions={
  create:async({request,params})=>{const data=await request.formData();try{createTask({title:String(data.get('title')??''),projectIds:[projectId(params)]});return {success:true};}catch(error){return actionError(error);}},
  edit:({request})=>taskEditAction(request),
  addProject:async({request})=>{const data=await request.formData();try{addTaskProject(Number(data.get('taskId')),Number(data.get('projectId')));return {success:true};}catch(error){return actionError(error);}},
  removeProject:async({request})=>{const data=await request.formData();try{removeTaskProject(Number(data.get('taskId')),Number(data.get('projectId')));return {success:true};}catch(error){return actionError(error);}},
  createProjectTag:async({request})=>{const data=await request.formData();try{const name=String(data.get('projectName')??'').trim();const id=createProjectForTask(Number(data.get('taskId')),name);return {success:true,project:{id,name}};}catch(error){return actionError(error);}},
  state:({request})=>taskStateAction(request),
  deleteTask:({request})=>taskDeleteAction(request),
  dependency:async({request})=>{const data=await request.formData();try{addDependency(Number(data.get('taskId')),Number(data.get('prerequisiteId')),String(data.get('kind')) as any);return {success:true};}catch(error){return actionError(error);}},
  removeDependency:async({request})=>{const data=await request.formData();try{removeDependency(Number(data.get('taskId')),Number(data.get('prerequisiteId')));return {success:true};}catch(error){return actionError(error);}},
  rename:async({request,params})=>{const data=await request.formData();try{renameProject(projectId(params),String(data.get('name')??''));return {success:true};}catch(error){return actionError(error);}},
  delete:async({params})=>{try{deleteProject(projectId(params));}catch(error){return actionError(error);}redirect(303,'/projects');}
};
