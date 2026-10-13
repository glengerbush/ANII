import { json } from '@sveltejs/kit';
import { aiResponse } from '$lib/server/ai-response';
import { describeAiError, sanityCheck } from '$lib/server/ai';
import { mutationProfileId } from '$lib/server/profiles';
import { buildSanityContext, getActiveDay, getDueOutsidePlan, today } from '$lib/server/repository';
export async function POST({request,cookies}){
  const form=await request.formData();let profileId:number;
  try{profileId=mutationProfileId(cookies,form);}catch(error){return json({error:error instanceof Error?error.message:'Profile changed'},{status:400});}
  const date=getActiveDay(undefined,profileId);
  if(form.get('planDate')!==date)return json({error:'The day changed. Reload Today and check this plan again.'},{status:409});
  const context=buildSanityContext(date,undefined,profileId,today());
  const dueTasks=getDueOutsidePlan(date,undefined,profileId,today());
  return aiResponse(async(emit,signal)=>{
    emit({type:'status',message:'Deadline checks complete. Asking Ollama to review the plan…'});
    try{const {concerns}=await sanityCheck(context,emit,signal);emit({type:'done',result:{concerns,dueTasks,startWarnings:context.startWarnings,checked:true}});}
    catch(error){emit({type:'done',result:{concerns:[],dueTasks,startWarnings:context.startWarnings,checked:true,offline:true,aiError:describeAiError(error).message}});}
  });
}
