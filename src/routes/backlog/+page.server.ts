import { fail } from '@sveltejs/kit';
import { addDependency, addTaskProject, addToPlan, createProjectForTask, createTask, eventsFor, getBacklog, getDependencies, listProjects, removeDependency, removeTaskProject } from '$lib/server/repository';
import { activeProfileId } from '$lib/server/profiles';
import { taskDeleteAction, taskEditAction, taskStateAction } from '$lib/server/task-actions';
const error=(e:unknown)=>fail(400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=({url})=>{const q=url.searchParams.get('q')??'';const project=Number(url.searchParams.get('project'))||undefined;const state=url.searchParams.get('state')||undefined;const due=url.searchParams.get('due')==='1';const tasks=getBacklog({q,project,state,due});return {tasks,allTasks:getBacklog(),projects:listProjects(),taskMeta:Object.fromEntries(tasks.map((task)=>[task.id,{...getDependencies(task.id),history:eventsFor(task.id)}])),filters:{q,project,state,due}}};
export const actions={
  create:async({request})=>{const d=await request.formData();try{createTask({title:String(d.get('title')??'')});return {success:true}}catch(e){return error(e)}},
  plan:async({request,cookies})=>{const d=await request.formData();const profileId=activeProfileId(cookies);try{for(const id of d.getAll('taskId'))addToPlan(Number(id),undefined,undefined,undefined,profileId);return {success:true}}catch(e){return error(e)}},
  state:({request})=>taskStateAction(request),
  deleteTask:({request})=>taskDeleteAction(request),
  edit:({request})=>taskEditAction(request),
  addProject:async({request})=>{const d=await request.formData();try{addTaskProject(Number(d.get('taskId')),Number(d.get('projectId')));return {success:true}}catch(e){return error(e)}},
  removeProject:async({request})=>{const d=await request.formData();try{removeTaskProject(Number(d.get('taskId')),Number(d.get('projectId')));return {success:true}}catch(e){return error(e)}},
  createProjectTag:async({request})=>{const d=await request.formData();try{const name=String(d.get('projectName')??'').trim();const id=createProjectForTask(Number(d.get('taskId')),name);return {success:true,project:{id,name}}}catch(e){return error(e)}},
  dependency:async({request})=>{const d=await request.formData();try{addDependency(Number(d.get('taskId')),Number(d.get('prerequisiteId')),String(d.get('kind')) as any);return {success:true}}catch(e){return error(e)}},
  removeDependency:async({request})=>{const d=await request.formData();try{removeDependency(Number(d.get('taskId')),Number(d.get('prerequisiteId')));return {success:true}}catch(e){return error(e)}}
};
