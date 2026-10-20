import { fail, redirect } from '@sveltejs/kit';
import { deleteMessage, editProposal, recordMessage, messageForCapture, rejectProposal } from '$lib/server/repository';
import type { AiError } from '$lib/ai';
import { describeAiError } from '$lib/server/ai';
import { processingMessages, runCapture } from '$lib/server/capture-run';
import { acceptAiProposal } from '$lib/server/ai-proposals';
function back(request:Request){const ref=request.headers.get('referer');return ref?new URL(ref).pathname:'/now';}
async function processMessage(id:number,request:Request){
  if(processingMessages.has(id))return fail(409,{error:'AI is already processing this message. Wait for it to finish, then refresh history.'});
  let message:{id:number;content:string};
  try{message=messageForCapture(id);}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not load message'});}
  let aiError:AiError|null=null;let proposalCount=0;let messages:any[]=[];
  try{
    const result=await runCapture(message.id);messages=result.messages;proposalCount=result.proposalCount;
  }catch(error){aiError=describeAiError(error);}
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
  accept:async({request})=>{const fd=await request.formData();try{acceptAiProposal(Number(fd.get('id')));}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not accept'});}redirect(303,back(request));},
  edit:async({request})=>{const fd=await request.formData();try{editProposal(Number(fd.get('id')),{title:String(fd.get('title')??''),details:String(fd.get('details')??'')});}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not edit'});}redirect(303,back(request));},
  reject:async({request})=>{const fd=await request.formData();try{rejectProposal(Number(fd.get('id')));}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not reject'});}redirect(303,back(request));}
};
