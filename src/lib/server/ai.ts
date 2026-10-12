import { z } from 'zod';
import { DEFAULT_AI_TIMEOUT_SECONDS, validAiTimeout, comparableOllamaUrl, type AiError, type OllamaConnection, type OllamaErrorCode } from '$lib/ollama';
import { getSettings, normalizeOllamaUrl, proposalPayload, type buildSanityContext } from './repository';

export const captureResponse = z.object({ proposals: z.array(proposalPayload).max(10) });
export const sanityResponse = z.object({ concerns: z.array(z.object({ taskId:z.number().int().positive(), observation:z.string(), reason:z.string(), choices:z.array(z.enum(['Keep','Move'])).min(1) })).max(3) });
class OllamaError extends Error {
  constructor(public code:OllamaErrorCode,message:string){super(message);this.name='OllamaError';}
}
export function describeAiError(error:unknown):AiError {
  return error instanceof OllamaError ? {code:error.code,message:error.message} : {code:'internal',message:'ANII could not process the AI result. Try again; if this repeats, check the ANII server logs.'};
}
function connectionError(error:unknown,timeout:number):OllamaError {
  if(error instanceof OllamaError)return error;
  if(error instanceof Error && ['AbortError','TimeoutError'].includes(error.name))return new OllamaError('timeout',`Ollama did not respond within ${timeout/1000} seconds. The model may still be loading or busy. Try again or increase the AI request timeout in Settings.`);
  const cause=error instanceof Error ? error.cause as {code?:string}|undefined : undefined;
  const detail=cause?.code==='ECONNREFUSED'?'The connection was refused. ':['ENOTFOUND','EAI_AGAIN'].includes(cause?.code??'')?'The server hostname could not be resolved. ':'';
  return new OllamaError('connection',`${detail}Could not reach Ollama from the ANII server. Check the address, Ollama service, and network access in Settings.`);
}
async function ollamaJson(url:string,init:RequestInit,timeout:number,model?:string):Promise<unknown>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new DOMException('Ollama request timed out','TimeoutError')),timeout);
  try{
    const response=await fetch(url,{...init,signal:controller.signal});
    if(!response.ok){
      let detail='';try{const body=await response.json();if(typeof body?.error==='string')detail=body.error.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,400);}catch{/* Proxy error pages are not useful model diagnostics. */}
      if(response.status===404 && /model.*not found|not found.*model/i.test(detail))throw new OllamaError('model_missing',`The selected model “${model??''}” is not installed in Ollama. Choose an available model in Settings and save preferences.`);
      throw new OllamaError('http',`Ollama returned HTTP ${response.status}${detail?`: ${detail}`:'. Check the saved Ollama address and its server logs.'}`);
    }
    try{return await response.json();}
    catch(error){if(error instanceof Error && ['AbortError','TimeoutError'].includes(error.name))throw error;throw new OllamaError('invalid_response','The Ollama server returned an unreadable response. Check that the address points to Ollama.');}
  }catch(error){throw connectionError(error,timeout);}finally{clearTimeout(timer);}
}
async function ollama<T>(schema:z.ZodType<T>,prompt:string,format:object):Promise<T>{
  const settings=getSettings();let url:string;
  try{url=normalizeOllamaUrl(settings.ollama_url);}catch{throw new OllamaError('configuration','The saved Ollama address is invalid. Correct it in Settings.');}
  const raw=await ollamaJson(`${url}/api/generate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:settings.model,prompt,stream:false,format,options:{temperature:0},keep_alive:settings.keep_alive})},(validAiTimeout(settings.ai_timeout_seconds)?Number(settings.ai_timeout_seconds):DEFAULT_AI_TIMEOUT_SECONDS)*1000,settings.model);
  const envelope=z.object({response:z.string()}).safeParse(raw);
  if(!envelope.success)throw new OllamaError('invalid_response','Ollama returned no usable model response. Check the model and Ollama server logs.');
  try{return schema.parse(JSON.parse(envelope.data.response));}
  catch{throw new OllamaError('invalid_response','The model responded, but its task suggestions were not in the format ANII needs. Try a clearer message or select another model in Settings.');}
}
export async function interpretCapture(content:string){return ollama(captureResponse,`Extract only explicit task facts from this message. Do not invent dates or projects. Return concise proposed tasks.\n\n${content}`,z.toJSONSchema(captureResponse));}
export async function sanityCheck(context:ReturnType<typeof buildSanityContext>){
  const result=await ollama(sanityResponse,`Review today's plan using only these facts. tasks contains the current plan (focus and also). dueOutsidePlan contains unfinished tasks due today or overdue that are missing from this profile's plan; the app already lists all of them separately with Add to Today actions. startWarnings contains future deadlines whose calculated start-by date has arrived, including remaining effort, lead time, buffer, and unfinished hard prerequisites. These warnings also have their own UI; incompleteEstimates means the start date may need to be earlier. Estimates assume daily capacity every calendar day and do not reserve capacity across competing deadlines. Consider those deadlines, waiting/blocked states, prerequisites, and capacity when reviewing the current plan. Do not count omitted tasks as already planned. Return at most 3 actionable concerns about tasks in tasks only, each referencing its id as taskId and offering only Keep and/or Move (Move removes it from Today). Do not repeat the missing-task list or imply tasks have already been added.\n\n${JSON.stringify(context)}`,z.toJSONSchema(sanityResponse));
  const plannedIds=new Set(context.tasks.map(task=>task.id));const seen=new Set<number>();
  return {concerns:result.concerns.filter(concern=>{if(!plannedIds.has(concern.taskId)||seen.has(concern.taskId))return false;seen.add(concern.taskId);return true;})};
}
export async function checkOllamaConnection(value:string):Promise<OllamaConnection>{
  let url:string;
  try{url=normalizeOllamaUrl(value);}catch(error){return {url:comparableOllamaUrl(value),ok:false,models:[],code:'configuration',message:error instanceof Error?error.message:'Enter a valid Ollama address.'};}
  try{
    const raw=await ollamaJson(`${url}/api/tags`,{},3000);
    const parsed=z.object({models:z.array(z.object({name:z.string().min(1)}))}).safeParse(raw);
    if(!parsed.success)throw new OllamaError('invalid_response','This address did not return an Ollama model list. Check the server URL.');
    const models=[...new Set(parsed.data.models.map(model=>model.name))].sort();
    return {url,ok:true,models,message:models.length?`${models.length} installed ${models.length===1?'model':'models'}.`:'No installed models.'};
  }catch(error){return {url,ok:false,models:[],...describeAiError(error)};}
}
let healthCache:{url:string;value:boolean;at:number}|undefined;
export async function ollamaHealthy(){const settings=getSettings();if(healthCache?.url===settings.ollama_url&&Date.now()-healthCache.at<30_000)return healthCache.value;try{const r=await fetch(`${settings.ollama_url}/api/tags`,{signal:AbortSignal.timeout(100)});healthCache={url:settings.ollama_url,value:r.ok,at:Date.now()};return r.ok;}catch{healthCache={url:settings.ollama_url,value:false,at:Date.now()};return false;}}
