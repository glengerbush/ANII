import { taskMetadata } from '$lib/server/task-reads';
import { error } from '@sveltejs/kit';
import { redirectAfterSave } from '$lib/server/form-actions';
import { activeProfileId } from '$lib/server/profiles';
import { getBacklog, getCompletedHistory, listProjects, today } from '$lib/server/repository';
import { taskActions } from '$lib/server/task-actions';

function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&Number.isFinite(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;}
function shiftDate(value:string,offset:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);const shifted=date.toISOString().slice(0,10);return validDate(shifted)?shifted:null;}

export const load=({url,cookies})=>{
  const profileId=activeProfileId(cookies);const activeDate=today();
  const date=url.searchParams.get('date')??activeDate;if(!validDate(date))error(400,'Choose a valid completed day.');
  const mode=url.searchParams.get('mode')==='all'?'all':'day';const q=url.searchParams.get('q')?.trim()??'';
  const rawProject=url.searchParams.get('project');const project=rawProject?Number(rawProject):undefined;
  if(project!==undefined&&(!Number.isSafeInteger(project)||project<1))error(400,'Choose a valid project.');
  const tasks=getCompletedHistory(mode==='all'?{q,project}:{date},undefined,profileId);
  return {mode,date,activeDate,calendarDate:today(),previousDate:shiftDate(date,-1),nextDate:shiftDate(date,1),tasks,filters:{q,project},projects:listProjects(),allTasks:[...getBacklog(),...getBacklog({state:'completed'})],taskMeta:taskMetadata(tasks)};
};

export const actions=redirectAfterSave(taskActions('completed'));
