import { z } from 'zod';
import { aiProvider, openAiUrl, comparableOllamaUrl, type AiError, type OllamaConnection, type OllamaErrorCode } from '$lib/ollama';
import { getSettings, normalizeOllamaUrl, proposalPayload, type buildSanityContext } from './repository';
import type { EmitActivity } from '$lib/ai-stream';
import { aiRequestOptions, chatRound, parseStructured } from './ollama-chat';

export const captureResponse = z.object({ proposals: z.array(proposalPayload).max(10) });
export const sanityResponse = z.object({ concerns: z.array(z.object({ taskId:z.number().int().positive(), observation:z.string(), reason:z.string(), choices:z.array(z.enum(['Keep','Move'])).min(1) })).max(3) });
export class OllamaError extends Error {
  constructor(public code:OllamaErrorCode,message:string){super(message);this.name='OllamaError';}
}
export function describeAiError(error:unknown):AiError {
  return error instanceof OllamaError ? {code:error.code,message:error.message} : {code:'internal',message:'ANII could not process the AI result. Try again; if this repeats, check the ANII server logs.'};
}
export function connectionError(error:unknown,timeout:number):OllamaError {
  if(error instanceof OllamaError)return error;
  if(error instanceof Error && ['AbortError','TimeoutError'].includes(error.name))return new OllamaError('timeout',`The AI server did not respond within ${timeout/1000} seconds. The model may still be loading or busy. Try again or increase the AI request timeout in Settings.`);
  const cause=error instanceof Error ? error.cause as {code?:string}|undefined : undefined;
  const detail=cause?.code==='ECONNREFUSED'?'The connection was refused. ':['ENOTFOUND','EAI_AGAIN'].includes(cause?.code??'')?'The server hostname could not be resolved. ':'';
  return new OllamaError('connection',`${detail}Could not reach AI from the ANII server. Check the address, AI service, and network access in Settings.`);
}
async function ollamaJson(url:string,init:RequestInit,timeout:number,model?:string):Promise<unknown>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new DOMException('AI request timed out','TimeoutError')),timeout);
  try{
    const response=await fetch(url,{...init,signal:controller.signal});
    if(!response.ok){
      let detail='';try{const body=await response.json();if(typeof body?.error==='string')detail=body.error.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,400);}catch{/* Proxy error pages are not useful model diagnostics. */}
      if(response.status===404 && /model.*not found|not found.*model/i.test(detail))throw new OllamaError('model_missing',`The selected model “${model??''}” is not installed in Ollama. Choose an available model in Settings and save preferences.`);
      throw new OllamaError('http',`AI server returned HTTP ${response.status}${detail?`: ${detail}`:'. Check the saved AI server address and its server logs.'}`);
    }
    try{return await response.json();}
    catch(error){if(error instanceof Error && ['AbortError','TimeoutError'].includes(error.name))throw error;throw new OllamaError('invalid_response','The AI server returned an unreadable response. Check the address and provider.');}
  }catch(error){throw connectionError(error,timeout);}finally{clearTimeout(timer);}
}
export async function sanityCheck(context:ReturnType<typeof buildSanityContext>,emit:EmitActivity=()=>{},signal?:AbortSignal){
  const options=aiRequestOptions(signal);
  try{
  const reply=await chatRound([{role:'user',content:`Review today's plan using only these facts. tasks contains the current plan (focus and also). dueOutsidePlan contains unfinished tasks due today or overdue that are missing from this profile's plan; the app already lists all of them separately with Add to Today actions. startWarnings contains future deadlines whose calculated start-by date has arrived, including remaining effort, lead time, buffer, and unfinished hard prerequisites. These warnings also have their own UI; incompleteEstimates means the start date may need to be earlier. Estimates assume daily capacity every calendar day and do not reserve capacity across competing deadlines. Consider those deadlines, blocked tasks, prerequisites, and capacity when reviewing the current plan. Do not count omitted tasks as already planned. Return at most 3 actionable concerns about tasks in tasks only, each referencing its id as taskId and offering only Keep and/or Move (Move removes it from Today). Do not repeat the missing-task list or imply tasks have already been added.\n\n${JSON.stringify(context)}`}],options,emit,{format:z.toJSONSchema(sanityResponse)});
  const result=parseStructured(sanityResponse,reply.content);
  const plannedIds=new Set(context.tasks.map(task=>task.id));const seen=new Set<number>();
  return {concerns:result.concerns.filter(concern=>{if(!plannedIds.has(concern.taskId)||seen.has(concern.taskId))return false;seen.add(concern.taskId);return true;})};
  }finally{options.dispose();}
}
export async function checkOllamaConnection(value:string,providerValue='ollama'):Promise<OllamaConnection>{
  const provider=aiProvider(providerValue);
  let url:string;
  try{url=normalizeOllamaUrl(value);}catch(error){return {url:comparableOllamaUrl(value),provider,ok:false,models:[],code:'configuration',message:error instanceof Error?error.message:'Enter a valid AI server address.'};}
  try{
    const raw=await ollamaJson(provider==='llamacpp'?`${openAiUrl(url)}/models`:`${url}/api/tags`,{},3000);
    const parsed=provider==='llamacpp'
      ? z.object({data:z.array(z.object({id:z.string().min(1)}))}).transform(data=>data.data.map(model=>model.id)).safeParse(raw)
      : z.object({models:z.array(z.object({name:z.string().min(1)}))}).transform(data=>data.models.map(model=>model.name)).safeParse(raw);
    if(!parsed.success)throw new OllamaError('invalid_response','This address did not return a model list for the selected provider. Check the provider and server URL.');
    const models=[...new Set(parsed.data)].sort();
    return {url,provider,ok:true,models,message:models.length?`${models.length} ${provider==='ollama'?'installed':'available'} ${models.length===1?'model':'models'}.`:'No available models.'};
  }catch(error){return {url,provider,ok:false,models:[],...describeAiError(error)};}
}
let healthCache:{url:string;value:boolean;at:number}|undefined;
export async function ollamaHealthy(){const settings=getSettings();const url=settings.ai_provider==='llamacpp'?`${openAiUrl(settings.ollama_url)}/models`:`${settings.ollama_url}/api/tags`;if(healthCache?.url===url&&Date.now()-healthCache.at<30_000)return healthCache.value;try{const r=await fetch(url,{signal:AbortSignal.timeout(100)});await r.body?.cancel();healthCache={url,value:r.ok,at:Date.now()};return r.ok;}catch{healthCache={url,value:false,at:Date.now()};return false;}}
