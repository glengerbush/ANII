import { addToPlan, assertActiveDay, fallbackProfileId, getActiveDay, getTask, getToday, removeFromPlan } from '$lib/server/repository';
import { fail, type Cookies } from '@sveltejs/kit';
import { mutationProfileId } from '$lib/server/profiles';
import { addDependency, deleteTask, removeDependency, replaceDependency, setTaskState, updateTask } from '$lib/server/repository';

const error=(value:unknown)=>fail(400,{error:value instanceof Error?value.message:'Operation failed'});

export async function taskDependencyAction(request:Request){
  const data=await request.formData();
  try{
    if(data.has('kind'))throw new Error('Dependency kinds are no longer supported. Reload and try again.');
    const taskId=Number(data.get('taskId'));const preId=Number(data.get('prerequisiteId'));
    if(!Number.isSafeInteger(taskId)||taskId<1||!Number.isSafeInteger(preId)||preId<1)throw new Error('Choose a task for this dependency.');
    if(data.has('previousPrerequisiteId'))replaceDependency(taskId,Number(data.get('previousPrerequisiteId')),preId);else addDependency(taskId,preId);
    return {success:true};
  }catch(value){return error(value);}
}
export async function taskRemoveDependencyAction(request:Request){
  const data=await request.formData();
  try{removeDependency(Number(data.get('taskId')),Number(data.get('prerequisiteId')));return {success:true};}
  catch(value){return error(value);}
}

export async function taskEditAction(request:Request){
  const data=await request.formData();
  try{
    const hours=String(data.get('remainingHours')??'').trim();
    if(hours!==''&&(!Number.isFinite(Number(hours))||Number(hours)<0||Number(hours)>8760))throw new Error('Remaining effort must be between 0 and 8760 hours');
    updateTask(Number(data.get('id')),{
      title:String(data.get('title')??''),details:String(data.get('details')??''),duration:String(data.get('duration')??''),dueAt:String(data.get('dueAt')??''),
      remainingEffortMinutes:data.has('remainingHours')?(hours===''?null:Math.round(Number(hours)*60)):undefined,
      leadTimeDays:data.has('leadTimeDays')?Number(data.get('leadTimeDays')):undefined
    });
    return {success:true};
  }catch(value){return error(value);}
}

export async function taskStateAction(request:Request,cookies?:Cookies){
  const data=await request.formData();
  try{
    const id=Number(data.get('id'));const state=String(data.get('state'));
    if(!Number.isInteger(id)||id<=0)throw new Error('Invalid task');
    if(!['open','completed'].includes(state))throw new Error('Unsupported task state');
    const profileId=cookies?mutationProfileId(cookies,data):fallbackProfileId();
    assertActiveDay(data.has('planDate')?String(data.get('planDate')):undefined,undefined,profileId);
    setTaskState(id,state as 'open'|'completed',undefined,profileId);return {success:true};
  }catch(value){return error(value);}
}

export async function taskDeleteAction(request:Request){
  const data=await request.formData();
  try{const id=Number(data.get('id'));if(!Number.isInteger(id)||id<=0)throw new Error('Invalid task');deleteTask(id);return {success:true};}
  catch(value){return error(value);}
}

export async function taskPlanAction(request:Request,cookies:Cookies){
  const d=await request.formData();
  try{
    const profileId=mutationProfileId(cookies,d);const date=getActiveDay(undefined,profileId);const taskId=Number(d.get('taskId'));assertActiveDay(d.has('planDate')?String(d.get('planDate')):undefined,undefined,profileId);
    if(d.getAll('taskId').length!==1||!Number.isSafeInteger(taskId)||taskId<1)throw new Error('Choose one task to update in Today.');
    const task=getTask(taskId);if(!task||task.state!=='open')throw new Error('This task is no longer available. Refresh and try again.');
    const planned=d.get('planned')??'true';if(planned!=='true'&&planned!=='false')throw new Error('Choose whether this task belongs in Today.');
    if(planned==='false')removeFromPlan(taskId,date,undefined,profileId);
    else if(!getToday(date,undefined,profileId).some(planned=>planned.id===taskId))addToPlan(taskId,date,'also',undefined,profileId);
    return {success:true,plannedTaskId:taskId};
  }catch(e){return error(e)}
}
