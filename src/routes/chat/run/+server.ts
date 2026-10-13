import { json } from '@sveltejs/kit';
import { aiResponse } from '$lib/server/ai-response';
import { processingMessages, runCapture } from '$lib/server/capture-run';
import { messageForCapture, recordMessage } from '$lib/server/repository';
export async function POST({request}){
  const form=await request.formData();let id:number;
  try{
    id=form.has('id')?Number(form.get('id')):recordMessage(String(form.get('content')??''));
    if(processingMessages.has(id))return json({error:'AI is already processing this message.'},{status:409});
    messageForCapture(id);
  }catch(error){return json({error:error instanceof Error?error.message:'Could not save message'},{status:400});}
  return aiResponse(async(emit,signal)=>{emit({type:'saved',messageId:id});const result=await runCapture(id,emit,signal);emit({type:'done',result:{...result,saved:true,messageId:id}});});
}
