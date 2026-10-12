import { fail, redirect } from '@sveltejs/kit';
import { acceptProposal, editProposal, recordMessage, recordProposal, rejectProposal } from '$lib/server/repository';
import type { AiError } from '$lib/ollama';
import { describeAiError, interpretCapture } from '$lib/server/ai';
function back(request:Request){const ref=request.headers.get('referer');return ref?new URL(ref).pathname:'/today';}
export const actions={
  send:async({request})=>{
    const fd=await request.formData();const content=String(fd.get('content')??'');let id:number;
    try{id=recordMessage(content);}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not save message'});}
    let aiError:AiError|null=null;let proposalCount=0;
    try{
      const result=await interpretCapture(content);
      try{for(const proposal of result.proposals){recordProposal(id,proposal,{rationale:'Extracted from immutable source note'});proposalCount++;}}
      catch{aiError={code:'storage',message:'ANII could not save all task suggestions. Check chat history before retrying.'};}
    }catch(error){aiError=describeAiError(error);}
    if(request.headers.get('x-sveltekit-action')==='true')return {saved:true,aiError,proposalCount};
    redirect(303,back(request));
  },
  accept:async({request})=>{const fd=await request.formData();try{acceptProposal(Number(fd.get('id')));}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not accept'});}redirect(303,back(request));},
  edit:async({request})=>{const fd=await request.formData();try{editProposal(Number(fd.get('id')),{title:String(fd.get('title')??''),details:String(fd.get('details')??'')});}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not edit'});}redirect(303,back(request));},
  reject:async({request})=>{const fd=await request.formData();try{rejectProposal(Number(fd.get('id')));}catch(e){return fail(400,{error:e instanceof Error?e.message:'Could not reject'});}redirect(303,back(request));}
};
