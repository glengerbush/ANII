import { taskMetadata } from '$lib/server/task-reads';
import { projectCompletionAction } from '$lib/server/project-actions';
import { redirectAfterSave } from '$lib/server/form-actions';
import { error as httpError, fail, redirect } from '@sveltejs/kit';
import { deleteProject, getBacklog, getProject, getProjectTasks, getNow, listProjects, renameProject, today } from '$lib/server/repository';
import { taskActions } from '$lib/server/task-actions';
import { activeProfileId } from '$lib/server/profiles';

const actionError=(error:unknown)=>fail(400,{error:error instanceof Error?error.message:'Operation failed'});
function projectId(params:Record<string,string>){const id=Number(params.id);if(!Number.isInteger(id)||id<=0)httpError(404,'Project not found');return id;}

export const load=({params,cookies})=>{
  const id=projectId(params);const project=getProject(id);if(!project)httpError(404,'Project not found');const tasks=getProjectTasks(id);
  const profileId=activeProfileId(cookies);const date=today();
  return {date,calendarDate:today(),plannedTaskIds:getNow(date,undefined,profileId).map(task=>task.id),project,tasks,projects:listProjects(),allTasks:[...getBacklog(),...getBacklog({state:'completed'})],taskMeta:taskMetadata(tasks)};
};

export const actions=redirectAfterSave({
  complete:({request,params})=>projectCompletionAction(request,projectId(params)),
  ...taskActions('project'),
  rename:async({request,params})=>{const data=await request.formData();try{renameProject(projectId(params),String(data.get('name')??''));return {success:true};}catch(error){return actionError(error);}},
  delete:async({params})=>{try{deleteProject(projectId(params));}catch(error){return actionError(error);}redirect(303,'/projects');}
});
