import { z } from 'zod';
import { type EmitActivity } from '$lib/ai-stream';
import { DEFAULT_AI_TIMEOUT_SECONDS, validAiTimeout } from '$lib/ai';
import { getSettings, normalizeAiUrl } from './repository';
import { AiServiceError, connectionError } from './ai';
import { llamaChat } from './llama-chat';
export type ChatMessage={role:'system'|'user'|'assistant'|'tool';content:string;thinking?:string;tool_calls?:ToolCall[];tool_name?:string;tool_call_id?:string};
export type ToolCall={id?:string;function:{name:string;arguments:unknown;index?:number}};
export function aiRequestOptions(signal?:AbortSignal){
  const settings=getSettings();let url:string;
  try{url=normalizeAiUrl(settings.ai_url);}catch{throw new AiServiceError('configuration','Correct the AI server address in Settings.');}
  const timeout=(validAiTimeout(settings.ai_timeout_seconds)?Number(settings.ai_timeout_seconds):DEFAULT_AI_TIMEOUT_SECONDS)*1000;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('AI request timed out','TimeoutError')),timeout);timer.unref?.();
  return {settings,url,timeout,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,dispose:()=>clearTimeout(timer)};
}
export async function chatRound(messages:ChatMessage[],options:ReturnType<typeof aiRequestOptions>,emit:EmitActivity,extra:{tools?:unknown[];format?:object}={}):Promise<ChatMessage>{
  emit({type:'status',message:'Waiting for AI…'});
  try{
    return await llamaChat(messages,options,emit,extra);
  }catch(error){if(error instanceof SyntaxError)throw new AiServiceError('invalid_response','The AI server returned an unreadable stream. Check the model and server logs.');throw connectionError(error,options.timeout);}
}
export function parseStructured<T>(schema:z.ZodType<T>,content:string):T{
  try{return schema.parse(JSON.parse(content));}catch{throw new AiServiceError('invalid_response','The model returned an invalid suggestion format. Try again, or select a model supporting structured output in Settings.');}
}
