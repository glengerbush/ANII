import { fail } from '@sveltejs/kit';
import { deleteTask, setTaskState, updateTask } from '$lib/server/repository';

const error=(value:unknown)=>fail(400,{error:value instanceof Error?value.message:'Operation failed'});

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

export async function taskStateAction(request:Request){
  const data=await request.formData();
  try{
    const id=Number(data.get('id'));const state=String(data.get('state'));
    if(!Number.isInteger(id)||id<=0)throw new Error('Invalid task');
    if(!['open','waiting','completed'].includes(state))throw new Error('Unsupported task state');
    setTaskState(id,state as 'open'|'waiting'|'completed');return {success:true};
  }catch(value){return error(value);}
}

export async function taskDeleteAction(request:Request){
  const data=await request.formData();
  try{const id=Number(data.get('id'));if(!Number.isInteger(id)||id<=0)throw new Error('Invalid task');deleteTask(id);return {success:true};}
  catch(value){return error(value);}
}
