import { assertActiveDay, getActiveDay } from '$lib/server/repository';
import { redirectAfterSave } from '$lib/server/form-actions';
import { fail } from '@sveltejs/kit';
import {
  addTaskProject, addToPlan, applySanityChoice, buildSanityContext, createAndPlan, createProjectForTask,
  deterministicWarnings, eventsFor, getBacklog, getDependencies, getDueOutsidePlan, getStartWarnings, getToday, getCompletedToday, listProjects,
  movePlan, removeFromPlan, removeTaskProject, reorderPlan, today
} from '$lib/server/repository';
import { describeAiError, sanityCheck } from '$lib/server/ai';
import { activeProfileId, mutationProfileId } from '$lib/server/profiles';
import { taskDeleteAction, taskDependencyAction, taskEditAction, taskRemoveDependencyAction, taskStateAction } from '$lib/server/task-actions';

const error=(e:unknown)=>fail(400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=({cookies,url})=>{
  const profileId=activeProfileId(cookies);const date=getActiveDay(undefined,profileId);const tasks=getToday(date,undefined,profileId);const completedTasks=getCompletedToday(date,undefined,profileId);
  return {date,calendarDate:today(),tasks,completedTasks,showCompleted:url?.searchParams.get('showCompleted')==='1',warnings:deterministicWarnings(date,undefined,profileId,today()),allTasks:[...getBacklog(),...getBacklog({state:'completed'})],projects:listProjects(),taskMeta:Object.fromEntries([...tasks,...completedTasks].map((task)=>[task.id,{...getDependencies(task.id),history:eventsFor(task.id)}]))};
};
export const actions=redirectAfterSave({
  quickAdd:async({request,cookies})=>{const d=await request.formData();try{const profileId=mutationProfileId(cookies,d);assertActiveDay(d.has('planDate')?String(d.get('planDate')):undefined,undefined,profileId);createAndPlan(String(d.get('title')??''),undefined,undefined,profileId);return {success:true};}catch(e){return error(e)}},
  state:({request,cookies})=>taskStateAction(request,cookies),
  deleteTask:({request})=>taskDeleteAction(request),
  section:async({request,cookies})=>{const d=await request.formData();try{const profileId=mutationProfileId(cookies,d);const date=assertActiveDay(d.has('planDate')?String(d.get('planDate')):undefined,undefined,profileId);addToPlan(Number(d.get('id')),date,String(d.get('section')) as any,undefined,profileId);return {success:true};}catch(e){return error(e)}},
  remove:async({request,cookies})=>{const d=await request.formData();try{const profileId=mutationProfileId(cookies,d);const date=assertActiveDay(d.has('planDate')?String(d.get('planDate')):undefined,undefined,profileId);removeFromPlan(Number(d.get('id')),date,undefined,profileId);return {success:true};}catch(e){return error(e)}},
  edit:({request})=>taskEditAction(request),
  addProject:async({request})=>{const d=await request.formData();try{addTaskProject(Number(d.get('taskId')),Number(d.get('projectId')));return {success:true};}catch(e){return error(e)}},
  removeProject:async({request})=>{const d=await request.formData();try{removeTaskProject(Number(d.get('taskId')),Number(d.get('projectId')));return {success:true};}catch(e){return error(e)}},
  createProjectTag:async({request})=>{const d=await request.formData();try{const name=String(d.get('projectName')??'').trim();const id=createProjectForTask(Number(d.get('taskId')),name);return {success:true,project:{id,name}};}catch(e){return error(e)}},
  dependency:({request})=>taskDependencyAction(request),
  removeDependency:({request})=>taskRemoveDependencyAction(request),
  reorder:async({request,cookies})=>{const d=await request.formData();try{const profileId=mutationProfileId(cookies,d);const date=assertActiveDay(d.has('planDate')?String(d.get('planDate')):undefined,undefined,profileId);reorderPlan(Number(d.get('id')),String(d.get('direction')) as 'up'|'down',date,undefined,profileId);return {success:true};}catch(e){return error(e)}},
  move:async({request,cookies})=>{const d=await request.formData();try{const profileId=mutationProfileId(cookies,d);const date=assertActiveDay(d.has('planDate')?String(d.get('planDate')):undefined,undefined,profileId);movePlan(Number(d.get('id')),String(d.get('section')) as 'focus'|'also',Number(d.get('position')),date,undefined,profileId);return {success:true};}catch(e){return error(e)}},
  sanity:async({request,cookies})=>{
    const d=await request.formData();let profileId:number;try{profileId=mutationProfileId(cookies,d);}catch(e){return error(e);}
    const context=buildSanityContext(getActiveDay(undefined,profileId),undefined,profileId,today());
    const dueTasks=getDueOutsidePlan(context.date,undefined,context.profileId,today());
    try{return {concerns:(await sanityCheck(context)).concerns,dueTasks,startWarnings:context.startWarnings,checked:true};}
    catch(error){return {concerns:[],dueTasks,startWarnings:context.startWarnings,offline:true,checked:true,aiError:describeAiError(error).message};}
  },
  concern:async({request,cookies})=>{
    const d=await request.formData();let profileId:number;try{profileId=mutationProfileId(cookies,d);}catch(e){return error(e);}
    const date=getActiveDay(undefined,profileId);
    try{
      if(d.get('planDate')!==date)throw new Error('Your day changed; run Check plan again');
      if(d.get('profileId')!==String(profileId))throw new Error('The profile changed; run sanity check again');
      const choice=String(d.get('choice'));
      applySanityChoice(Number(d.get('taskId')),choice as 'Keep'|'Move'|'Add'|'Start',date,undefined,profileId,today());
      return {dueTasks:getDueOutsidePlan(date,undefined,profileId,today()),startWarnings:getStartWarnings(date,undefined,profileId,today()),concernResult:(choice==='Add'||choice==='Start')?'Added to Queue.':choice==='Move'?'Removed from Today.':'Kept in Today.'};
    }catch(e){return fail(400,{error:e instanceof Error?e.message:'Operation failed',dueTasks:getDueOutsidePlan(date,undefined,profileId,today()),startWarnings:getStartWarnings(date,undefined,profileId,today())});}
  }
}, ['sanity']);
