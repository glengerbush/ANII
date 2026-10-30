import { fail, type Action } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { Chores } from './chores';
import { mutationProfileId } from './profiles';
import { assertCurrentDate } from './repository';

function id(data:FormData,key:string){const value=Number(data.get(key));if(!Number.isSafeInteger(value)||value<1)throw new Error('Choose an existing chore or person.');return value;}
function revision(data:FormData){const value=Number(data.get('revision'));if(!data.has('revision')||!Number.isSafeInteger(value)||value<0)throw new Error('Refresh this chore before making changes.');return value;}
function boolean(data:FormData,key:string){const value=data.get(key);if(value!=='true'&&value!=='false')throw new Error('Choose a valid chore state.');return value==='true';}
function input(data:FormData){
  let rule,assigneeIds;try{rule=JSON.parse(String(data.get('rule')));assigneeIds=JSON.parse(String(data.get('assigneeIds')));}catch{throw new Error('Choose a valid schedule and assignment.');}
  return {title:String(data.get('title')??''),notes:String(data.get('notes')??''),rule,assigneeIds};
}
function action(run:(chores:Chores,data:FormData,profile:number,date:string)=>void):Action{return async({request,cookies})=>{
  try{const data=await request.formData(),profile=mutationProfileId(cookies,data),date=assertCurrentDate(data.has('planDate')?String(data.get('planDate')):undefined);run(new Chores(),data,profile,date);return {success:true};}
  catch(error){return fail(400,{error:error instanceof ZodError?error.issues.map(issue=>issue.message).join(' '):error instanceof Error?error.message:'Could not update the chore.'});}
};}
export const choreOccurrenceActions={
  choreComplete:action((chores,data,profile,date)=>chores.complete(id(data,'occurrenceId'),revision(data),boolean(data,'completed'),profile,date)),
  choreAssign:action((chores,data,profile,date)=>chores.assign(id(data,'occurrenceId'),revision(data),data.get('assigneeId')==='everyone'?null:id(data,'assigneeId'),profile,date))
};
export const choreActions={...choreOccurrenceActions,
  create:action((chores,data,_profile,date)=>chores.create(input(data),date)),
  edit:action((chores,data,_profile,date)=>chores.edit(id(data,'id'),revision(data),input(data),date)),
  active:action((chores,data,_profile,date)=>chores.setActive(id(data,'id'),revision(data),boolean(data,'active'),date))
};
