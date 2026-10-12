import { fail, redirect } from '@sveltejs/kit';
import { acceptProposal, deleteMessage, editProposal, recordMessage, messageForCapture, saveCaptureProposals, rejectProposal } from '$lib/server/repository';
import type { AiError } from '$lib/ollama';
import { describeAiError, interpretCapture } from '$lib/server/ai';
function back(request:Request){const ref=request.headers.get('referer');return ref?new URL(ref).pathname:'/today';}
const processingMessages=new Set<number>();
async function processMessage(id:number,request:Request){
  if(processingMessages.has(id))return fail(409,{error:'AI is already processing this message. Wait for it to finish, then refresh history.'});
  let message:{id:number;content:string};
  try{message=messageForCapture(id);}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not load message'});}
  processingMessages.add(id);
  let aiError:AiError|null=null;let proposalCount=0;let messages:any[]=[];
  try{
    const result=await interpretCapture(message.content);
    try{messages=saveCaptureProposals(id,result.proposals);proposalCount=result.proposals.length;}
    catch{aiError={code:'storage',message:'ANII could not save the task suggestions. Refresh history and retry AI if the message is still there.'};}
  }catch(error){aiError=describeAiError(error);}
  finally{processingMessages.delete(id);}
  if(request.headers.get('x-sveltekit-action')==='true')return {saved:true,messageId:id,aiError,proposalCount,messages};
  redirect(303,back(request));
}
export const actions={
  send:async({request})=>{
    const fd=await request.formData();const content=String(fd.get('content')??'');let id:number;
    try{id=recordMessage(content);}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not save message'});}
    return processMessage(id,request);
  },
  retry:async({request})=>{
    const fd=await request.formData();return processMessage(Number(fd.get('id')),request);
  },
  delete:async({request})=>{
    const fd=await request.formData();
    try{deleteMessage(Number(fd.get('id')));}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not delete message'});}
    if(request.headers.get('x-sveltekit-action')==='true')return {deleted:true};
    redirect(303,back(request));
  },
  accept:async({request})=>{const fd=await request.formData();try{acceptProposal(Number(fd.get('id')));}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not accept'});}redirect(303,back(request));},
  edit:async({request})=>{const fd=await request.formData();try{editProposal(Number(fd.get('id')),{title:String(fd.get('title')??''),details:String(fd.get('details')??'')});}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not edit'});}redirect(303,back(request));},
  reject:async({request})=>{const fd=await request.formData();try{rejectProposal(Number(fd.get('id')));}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not reject'});}redirect(303,back(request));}
};
