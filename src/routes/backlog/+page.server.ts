import { taskMetadata } from '$lib/server/task-reads';
import { getOrderedBacklog, today, getBacklog, getNow, listProjects } from '$lib/server/repository';

import { redirectAfterSave } from '$lib/server/form-actions';

import { activeProfileId } from '$lib/server/profiles';
import { taskActions } from '$lib/server/task-actions';
export const load=({url,cookies})=>{
  const profileId=activeProfileId(cookies);const date=today();
  const q=url.searchParams.get('q')??'';const project=url.searchParams.get('project')==='none'?'none':Number(url.searchParams.get('project'))||undefined;
  const requestedState=url.searchParams.get('state');const state=requestedState==='blocked'?requestedState!:undefined;
  const profileFilter=(key:string)=>{const value=Number(url.searchParams.get(key));return Number.isSafeInteger(value)&&value>0?value:undefined;};
  const assignee=url.searchParams.get('assignee')==='everyone'?'everyone':url.searchParams.get('assignee')==='unassigned'?'unassigned':profileFilter('assignee');
  const creator=url.searchParams.get('creator')==='unknown'?'unknown':profileFilter('creator');
  const due=url.searchParams.get('due')==='1';const tasks=getOrderedBacklog({q,project,state,due,assignee,creator},undefined,profileId,date);
  const completedTasks=getBacklog({q,project,due,assignee,creator,state:'completed'});
  return {date,calendarDate:today(),plannedTaskIds:getNow(date,undefined,profileId).map(task=>task.id),tasks,completedTasks,showCompleted:url.searchParams.get('showCompleted')==='1'||requestedState==='completed',allTasks:[...getBacklog(),...getBacklog({state:'completed'})],projects:listProjects(),taskMeta:taskMetadata([...tasks,...completedTasks]),filters:{q,project,state,due,assignee,creator}};
};
export const actions=redirectAfterSave(taskActions('backlog'));
