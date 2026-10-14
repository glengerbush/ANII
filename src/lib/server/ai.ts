import { z } from 'zod';
import { openAiUrl, comparableAiUrl, type AiError, type AiConnection, type AiErrorCode } from '$lib/ai';
import { getSettings, normalizeAiUrl, proposalPayload, type buildSanityContext } from './repository';
import type { EmitActivity } from '$lib/ai-stream';
import { aiRequestOptions, chatRound, parseStructured } from './ai-chat';
import { durationMinutes } from '$lib/domain/rules';

export const captureResponse = z.object({ proposals: z.array(proposalPayload).max(10) });
export const sanityResponse = z.object({ concerns: z.array(z.object({ taskId:z.number().int().positive(), basis:z.enum(['blocked','capacity','deadline','priority','estimate']), observation:z.string(), reason:z.string(), choices:z.array(z.enum(['Keep','Move'])).min(1) })).max(3) });
export class AiServiceError extends Error {
  constructor(public code:AiErrorCode,message:string){super(message);this.name='AiServiceError';}
}
export function describeAiError(error:unknown):AiError {
  return error instanceof AiServiceError ? {code:error.code,message:error.message} : {code:'internal',message:'ANII could not process the AI result. Try again; if this repeats, check the ANII server logs.'};
}
export function connectionError(error:unknown,timeout:number):AiServiceError {
  if(error instanceof AiServiceError)return error;
  if(error instanceof Error && ['AbortError','TimeoutError'].includes(error.name))return new AiServiceError('timeout',`The AI server did not respond within ${timeout/1000} seconds. The model may still be loading or busy. Try again or increase the AI request timeout in Settings.`);
  const cause=error instanceof Error ? error.cause as {code?:string}|undefined : undefined;
  const detail=cause?.code==='ECONNREFUSED'?'The connection was refused. ':['ENOTFOUND','EAI_AGAIN'].includes(cause?.code??'')?'The server hostname could not be resolved. ':'';
  return new AiServiceError('connection',`${detail}Could not reach AI from the ANII server. Check the address, AI service, and network access in Settings.`);
}
async function aiJson(url:string,init:RequestInit,timeout:number,model?:string):Promise<unknown>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new DOMException('AI request timed out','TimeoutError')),timeout);
  try{
    const response=await fetch(url,{...init,signal:controller.signal});
    if(!response.ok){
      let detail='';try{const body=await response.json();if(typeof body?.error==='string')detail=body.error.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,400);}catch{/* Proxy error pages are not useful model diagnostics. */}
      if(response.status===404 && /model.*not found|not found.*model/i.test(detail))throw new AiServiceError('model_missing',`The selected model “${model??''}” is not available on the AI server. Choose an available model in Settings and save preferences.`);
      throw new AiServiceError('http',`AI server returned HTTP ${response.status}${detail?`: ${detail}`:'. Check the saved AI server address and its server logs.'}`);
    }
    try{return await response.json();}
    catch(error){if(error instanceof Error && ['AbortError','TimeoutError'].includes(error.name))throw error;throw new AiServiceError('invalid_response','The AI server returned an unreadable response. Check the server address.');}
  }catch(error){throw connectionError(error,timeout);}finally{clearTimeout(timer);}
}
export async function sanityCheck(context:ReturnType<typeof buildSanityContext>,emit:EmitActivity=()=>{},signal?:AbortSignal){
  const options=aiRequestOptions(signal);
  try{
  const reply=await chatRound([{role:'user',content:`Review today's plan using only these facts. tasks contains the current plan (focus and also). dueOutsidePlan contains unfinished tasks due today or overdue that are missing from this profile's plan; the app already lists all of them separately with Add to Today actions. startWarnings contains future deadlines whose calculated start-by date has arrived, including remaining effort, lead time, buffer, and unfinished hard prerequisites. These warnings also have their own UI; incompleteEstimates is uncertainty in a deadline forecast, not a task problem or a reason to remove it from Today. Estimates are optional. A null estimate means unknown, not infeasible, over capacity, or zero effort. A duration such as 15m, 30m, 1h, or 2h+ is an estimate even when remainingEffortMinutes is null; 2h+ is a lower bound. remainingEffortMinutes describes the whole remaining task, not necessarily today's work. Estimates assume daily capacity every calendar day and do not reserve capacity across competing deadlines. Consider those deadlines, blocked tasks, prerequisites, and capacity when reviewing the current plan. Do not count omitted tasks as already planned. Return zero to at most 3 actionable concerns about tasks in tasks only, each referencing its id as taskId and offering only Keep and/or Move (Move removes it from Today). Set basis to blocked, capacity, deadline, or priority for a concrete conflict supported by the facts. Use estimate only for a concern solely about missing estimates; those concerns are not actionable with Keep/Move and will be omitted. Do not invent concerns to fill the limit. Observation and reason must be plain-language, task-specific explanations, never internal field names. Do not repeat the missing-task list or imply tasks have already been added.\n\n${JSON.stringify(context)}`}],options,emit,{format:z.toJSONSchema(sanityResponse)});
  const result=parseStructured(sanityResponse,reply.content);
  const planned=new Map(context.tasks.map(task=>[task.id,task]));const seen=new Set<number>();
  const plannedMinutes=context.tasks.reduce((sum,task)=>sum+(durationMinutes[task.duration??'']??0),0);
  const deadlinePressure=context.dueOutsidePlan.length>0||context.startWarnings.length>0||context.tasks.some(task=>task.dueAt&&task.dueAt.slice(0,10)<=context.calendarDate);
  return {concerns:result.concerns.filter(concern=>{
    const task=planned.get(concern.taskId);
    if(!task||seen.has(task.id))return false;
    // Missing estimates cannot establish a conflict, even if the model calls it capacity.
    if(concern.basis==='estimate')return false;
    if(concern.basis==='capacity'&&plannedMinutes<=context.dailyCapacityMinutes)return false;
    if(concern.basis==='blocked'&&!task.blocked)return false;
    if(concern.basis==='deadline'&&!deadlinePressure)return false;
    if(concern.basis==='priority'&&!context.currentPriorities.trim())return false;
    seen.add(task.id);return true;
  })};
  }finally{options.dispose();}
}
export async function checkAiConnection(value:string):Promise<AiConnection>{
  let url:string;
  try{url=normalizeAiUrl(value);}catch(error){return {url:comparableAiUrl(value),ok:false,models:[],code:'configuration',message:error instanceof Error?error.message:'Enter a valid AI server address.'};}
  try{
    const raw=await aiJson(`${openAiUrl(url)}/models`,{},3000);
    const parsed=z.object({data:z.array(z.object({id:z.string().min(1)}))}).transform(data=>data.data.map(model=>model.id)).safeParse(raw);
    if(!parsed.success)throw new AiServiceError('invalid_response','This address did not return a model list from llama.cpp. Check the server URL.');
    const models=[...new Set(parsed.data)].sort();
    return {url,ok:true,models,message:models.length?`${models.length} available ${models.length===1?'model':'models'}.`:'No available models.'};
  }catch(error){return {url,ok:false,models:[],...describeAiError(error)};}
}
let healthCache:{url:string;value:boolean;at:number}|undefined;
export async function aiHealthy(){const settings=getSettings();const url=`${openAiUrl(settings.ai_url)}/models`;if(healthCache?.url===url&&Date.now()-healthCache.at<30_000)return healthCache.value;try{const r=await fetch(url,{signal:AbortSignal.timeout(100)});await r.body?.cancel();healthCache={url,value:r.ok,at:Date.now()};return r.ok;}catch{healthCache={url,value:false,at:Date.now()};return false;}}
