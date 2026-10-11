import { z } from 'zod';
import { getSettings, normalizeOllamaUrl, proposalPayload, type buildSanityContext } from './repository';

export const captureResponse = z.object({ proposals: z.array(proposalPayload).max(10) });
export const sanityResponse = z.object({ concerns: z.array(z.object({ taskId:z.number().int().positive(), observation:z.string(), reason:z.string(), choices:z.array(z.enum(['Keep','Move'])).min(1) })).max(3) });
async function ollama<T>(schema:z.ZodType<T>,prompt:string,format:object):Promise<T>{
  const settings=getSettings(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15_000);
  try { const response=await fetch(`${settings.ollama_url}/api/generate`,{method:'POST',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({model:settings.model,prompt,stream:false,format,options:{temperature:0},keep_alive:settings.keep_alive})});if(!response.ok)throw new Error(`Ollama ${response.status}`);const raw=await response.json() as {response?:string};return schema.parse(JSON.parse(raw.response??'')); } finally {clearTimeout(timer);}
}
export async function interpretCapture(content:string){return ollama(captureResponse,`Extract only explicit task facts from this note. Do not invent dates or projects. Return concise proposed tasks.\n\n${content}`,z.toJSONSchema(captureResponse));}
export async function sanityCheck(context:ReturnType<typeof buildSanityContext>){
  const result=await ollama(sanityResponse,`Review today's plan using only these facts. tasks contains the current plan (focus and also). dueOutsidePlan contains unfinished tasks due today or overdue that are missing from this profile's plan; the app already lists all of them separately with Add to Today actions. startWarnings contains future deadlines whose calculated start-by date has arrived, including remaining effort, lead time, buffer, and unfinished hard prerequisites. These warnings also have their own UI; incompleteEstimates means the start date may need to be earlier. Estimates assume daily capacity every calendar day and do not reserve capacity across competing deadlines. Consider those deadlines, waiting/blocked states, prerequisites, and capacity when reviewing the current plan. Do not count omitted tasks as already planned. Return at most 3 actionable concerns about tasks in tasks only, each referencing its id as taskId and offering only Keep and/or Move (Move removes it from Today). Do not repeat the missing-task list or imply tasks have already been added.\n\n${JSON.stringify(context)}`,z.toJSONSchema(sanityResponse));
  const plannedIds=new Set(context.tasks.map(task=>task.id));const seen=new Set<number>();
  return {concerns:result.concerns.filter(concern=>{if(!plannedIds.has(concern.taskId)||seen.has(concern.taskId))return false;seen.add(concern.taskId);return true;})};
}
export async function checkOllamaConnection(value:string){
  const url=normalizeOllamaUrl(value);
  try{
    const response=await fetch(`${url}/api/tags`,{signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw new Error();
    const data=await response.json();if(!Array.isArray(data.models))throw new Error();
    return {ok:true,message:`Connected to Ollama. ${data.models.length} installed ${data.models.length===1?'model':'models'}. Save preferences to use this address.`};
  }catch{return {ok:false,message:'Could not reach Ollama from the app server. Check the address, Ollama service, and network access, then test again.'};}
}
let healthCache:{url:string;value:boolean;at:number}|undefined;
export async function ollamaHealthy(){const settings=getSettings();if(healthCache?.url===settings.ollama_url&&Date.now()-healthCache.at<30_000)return healthCache.value;try{const r=await fetch(`${settings.ollama_url}/api/tags`,{signal:AbortSignal.timeout(100)});healthCache={url:settings.ollama_url,value:r.ok,at:Date.now()};return r.ok;}catch{healthCache={url:settings.ollama_url,value:false,at:Date.now()};return false;}}
