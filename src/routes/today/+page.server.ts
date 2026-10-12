import { fail } from '@sveltejs/kit';
import {
  addDependency, addTaskProject, addToPlan, applySanityChoice, buildSanityContext, createAndPlan, createProjectForTask,
  deterministicWarnings, eventsFor, getBacklog, getDependencies, getDueOutsidePlan, getStartWarnings, getToday, listProjects,
  movePlan, removeDependency, removeFromPlan, removeTaskProject, reorderPlan, today
} from '$lib/server/repository';
import { sanityCheck } from '$lib/server/ai';
import { activeProfileId, mutationProfileId } from '$lib/server/profiles';
import { taskDeleteAction, taskEditAction, taskStateAction } from '$lib/server/task-actions';

const error=(e:unknown)=>fail(400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=({cookies})=>{
  const profileId=activeProfileId(cookies);const tasks=getToday(undefined,undefined,profileId);
  return {date:today(),tasks,warnings:deterministicWarnings(undefined,undefined,profileId),allTasks:getBacklog(),projects:listProjects(),taskMeta:Object.fromEntries(tasks.map((task)=>[task.id,{...getDependencies(task.id),history:eventsFor(task.id)}]))};
};
export const actions={
  quickAdd:async({request,cookies})=>{const d=await request.formData();try{createAndPlan(String(d.get('title')??''),undefined,undefined,mutationProfileId(cookies,d));return {success:true};}catch(e){return error(e)}},
  state:({request})=>taskStateAction(request),
  deleteTask:({request})=>taskDeleteAction(request),
  section:async({request,cookies})=>{const d=await request.formData();try{addToPlan(Number(d.get('id')),today(),String(d.get('section')) as any,undefined,mutationProfileId(cookies,d));return {success:true};}catch(e){return error(e)}},
  remove:async({request,cookies})=>{const d=await request.formData();try{removeFromPlan(Number(d.get('id')),undefined,undefined,mutationProfileId(cookies,d));return {success:true};}catch(e){return error(e)}},
  edit:({request})=>taskEditAction(request),
  addProject:async({request})=>{const d=await request.formData();try{addTaskProject(Number(d.get('taskId')),Number(d.get('projectId')));return {success:true};}catch(e){return error(e)}},
  removeProject:async({request})=>{const d=await request.formData();try{removeTaskProject(Number(d.get('taskId')),Number(d.get('projectId')));return {success:true};}catch(e){return error(e)}},
  createProjectTag:async({request})=>{const d=await request.formData();try{const name=String(d.get('projectName')??'').trim();const id=createProjectForTask(Number(d.get('taskId')),name);return {success:true,project:{id,name}};}catch(e){return error(e)}},
  dependency:async({request})=>{const d=await request.formData();try{addDependency(Number(d.get('taskId')),Number(d.get('prerequisiteId')),String(d.get('kind')) as any);return {success:true};}catch(e){return error(e)}},
  removeDependency:async({request})=>{const d=await request.formData();try{removeDependency(Number(d.get('taskId')),Number(d.get('prerequisiteId')));return {success:true};}catch(e){return error(e)}},
  reorder:async({request,cookies})=>{const d=await request.formData();try{reorderPlan(Number(d.get('id')),String(d.get('direction')) as 'up'|'down',undefined,undefined,mutationProfileId(cookies,d));return {success:true};}catch(e){return error(e)}},
  move:async({request,cookies})=>{const d=await request.formData();try{movePlan(Number(d.get('id')),String(d.get('section')) as 'focus'|'also',Number(d.get('position')),undefined,undefined,mutationProfileId(cookies,d));return {success:true};}catch(e){return error(e)}},
  sanity:async({request,cookies})=>{
    const d=await request.formData();let profileId:number;try{profileId=mutationProfileId(cookies,d);}catch(e){return error(e);}
    const context=buildSanityContext(undefined,undefined,profileId);
    const dueTasks=getDueOutsidePlan(context.date,undefined,context.profileId);
    try{return {concerns:(await sanityCheck(context)).concerns,dueTasks,startWarnings:context.startWarnings};}
    catch{return {concerns:[],dueTasks,startWarnings:context.startWarnings,offline:true};}
  },
  concern:async({request,cookies})=>{
    const d=await request.formData();let profileId:number;try{profileId=mutationProfileId(cookies,d);}catch(e){return error(e);}
    const date=today();
    try{
      if(d.get('planDate')!==date)throw new Error('The date changed; run sanity check again');
      if(d.get('profileId')!==String(profileId))throw new Error('The profile changed; run sanity check again');
      const choice=String(d.get('choice'));
      applySanityChoice(Number(d.get('taskId')),choice as 'Keep'|'Move'|'Add'|'Start',date,undefined,profileId);
      return {dueTasks:getDueOutsidePlan(date,undefined,profileId),startWarnings:getStartWarnings(date,undefined,profileId),concernResult:(choice==='Add'||choice==='Start')?'Added to Queue.':choice==='Move'?'Removed from Today.':'Kept in Today.'};
    }catch(e){return fail(400,{error:e instanceof Error?e.message:'Operation failed',dueTasks:getDueOutsidePlan(date,undefined,profileId),startWarnings:getStartWarnings(date,undefined,profileId)});}
  }
};
