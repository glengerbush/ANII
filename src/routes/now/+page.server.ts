import { taskMetadata } from '$lib/server/task-reads';
import { Chores } from '$lib/server/chores';
import { choreOccurrenceActions } from '$lib/server/chore-actions';
import { applySanityChoice, buildSanityContext, deterministicWarnings, getBacklog, getDueOutsidePlan, getStartWarnings, getNow, getCompletedNow, listProjects, today } from '$lib/server/repository';

import { redirectAfterSave } from '$lib/server/form-actions';
import { fail } from '@sveltejs/kit';

import { describeAiError, sanityCheck } from '$lib/server/ai';
import { activeProfileId, mutationProfileId } from '$lib/server/profiles';
import { taskActions } from '$lib/server/task-actions';

const error=(e:unknown)=>fail(400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=({cookies,url})=>{
  const profileId=activeProfileId(cookies);const date=today();const tasks=getNow(date,undefined,profileId);const completedTasks=getCompletedNow(date,undefined,profileId);
  return {dueChores:new Chores().due(profileId,date),date,calendarDate:today(),tasks,completedTasks,showCompleted:url?.searchParams.get('showCompleted')==='1',warnings:deterministicWarnings(date,undefined,profileId,today()),allTasks:[...getBacklog(),...getBacklog({state:'completed'})],projects:listProjects(),taskMeta:taskMetadata([...tasks,...completedTasks])};
};
export const actions=redirectAfterSave({
  ...choreOccurrenceActions,
  ...taskActions('now'),
  sanity:async({request,cookies})=>{
    const d=await request.formData();let profileId:number;try{profileId=mutationProfileId(cookies,d);}catch(e){return error(e);}
    const context=buildSanityContext(today(),undefined,profileId,today());
    const dueTasks=getDueOutsidePlan(context.date,undefined,context.profileId,today());
    try{return {concerns:(await sanityCheck(context)).concerns,dueTasks,startWarnings:context.startWarnings,checked:true};}
    catch(error){return {concerns:[],dueTasks,startWarnings:context.startWarnings,offline:true,checked:true,aiError:describeAiError(error).message};}
  },
  concern:async({request,cookies})=>{
    const d=await request.formData();let profileId:number;try{profileId=mutationProfileId(cookies,d);}catch(e){return error(e);}
    const date=today();
    try{
      if(d.get('planDate')!==date)throw new Error('Your day changed; run Check plan again');
      if(d.get('profileId')!==String(profileId))throw new Error('The profile changed; run sanity check again');
      const choice=String(d.get('choice'));
      applySanityChoice(Number(d.get('taskId')),choice as 'Keep'|'Move'|'Add'|'Start',date,undefined,profileId,today());
      return {dueTasks:getDueOutsidePlan(date,undefined,profileId,today()),startWarnings:getStartWarnings(date,undefined,profileId,today()),concernResult:(choice==='Add'||choice==='Start')?'Added to Queue.':choice==='Move'?'Removed from Now.':'Kept in Now.'};
    }catch(e){return fail(400,{error:e instanceof Error?e.message:'Operation failed',dueTasks:getDueOutsidePlan(date,undefined,profileId,today()),startWarnings:getStartWarnings(date,undefined,profileId,today())});}
  }
}, ['sanity']);
