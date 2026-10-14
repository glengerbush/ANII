import { z } from 'zod';
import { readJsonLines, type EmitActivity } from '$lib/ai-stream';
import { DEFAULT_AI_TIMEOUT_SECONDS, validAiTimeout } from '$lib/ollama';
import { getSettings, normalizeOllamaUrl } from './repository';
import { OllamaError, connectionError } from './ai';
import { llamaChat } from './llama-chat';
export type ChatMessage={role:'system'|'user'|'assistant'|'tool';content:string;thinking?:string;tool_calls?:ToolCall[];tool_name?:string;tool_call_id?:string};
export type ToolCall={id?:string;function:{name:string;arguments:unknown;index?:number}};
export function aiRequestOptions(signal?:AbortSignal){
  const settings=getSettings();let url:string;
  try{url=normalizeOllamaUrl(settings.ollama_url);}catch{throw new OllamaError('configuration','Correct the AI server address in Settings.');}
  const timeout=(validAiTimeout(settings.ai_timeout_seconds)?Number(settings.ai_timeout_seconds):DEFAULT_AI_TIMEOUT_SECONDS)*1000;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('AI request timed out','TimeoutError')),timeout);timer.unref?.();
  return {settings,url,timeout,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,dispose:()=>clearTimeout(timer)};
}
export async function chatRound(messages:ChatMessage[],options:ReturnType<typeof aiRequestOptions>,emit:EmitActivity,extra:{tools?:unknown[];format?:object}={}):Promise<ChatMessage>{
  let content='',thinking='',done=false;const calls:ToolCall[]=[];
  emit({type:'status',message:'Waiting for AI…'});
  try{
    if(options.settings.ai_provider==='llamacpp')return await llamaChat(messages,options,emit,extra);
    const response=await fetch(`${options.url}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},signal:options.signal,body:JSON.stringify({model:options.settings.model,messages,stream:true,keep_alive:options.settings.keep_alive,options:{temperature:0},...extra})});
    if(!response.ok){
      let detail='';try{detail=String((await response.json()).error??'').slice(0,400);}catch{}
      if(response.status===404&&/model.*not found|not found.*model/i.test(detail))throw new OllamaError('model_missing',`The model “${options.settings.model}” is not installed. Choose an installed model in Settings.`);
      if(/does not support|not supported|unsupported|tools/i.test(detail))throw new OllamaError('http',`This Ollama/model combination could not run the requested capability: ${detail}. Update Ollama or select a model supporting tools and structured output, such as qwen3.5:4b, in Settings.`);
      throw new OllamaError('http',`Ollama returned HTTP ${response.status}${detail?`: ${detail}`:'. Check its address and logs in Settings.'}`);
    }
    await readJsonLines(response,chunk=>{
      if(chunk.error)throw new OllamaError('invalid_response',`Ollama stopped: ${String(chunk.error).slice(0,400)}. Check the model in Settings.`);
      if(typeof chunk.message?.content==='string'&&chunk.message.content){if(!content)emit({type:'status',message:'Ollama is preparing its response…'});content+=chunk.message.content;}
      if(typeof chunk.message?.thinking==='string'&&chunk.message.thinking){if(!thinking)emit({type:'status',message:'Ollama is thinking…'});thinking+=chunk.message.thinking;emit({type:'thinking',text:chunk.message.thinking});}
      if(Array.isArray(chunk.message?.tool_calls))calls.push(...chunk.message.tool_calls);
      if(content.length+thinking.length>60_000||calls.length>8)throw new OllamaError('invalid_response','The model exceeded the response limit. Try a narrower request.');
      if(chunk.done===true)done=true;
    });
    if(!done)throw new OllamaError('invalid_response','Ollama ended before finishing its response. Your message is saved; retry AI.');
    return {role:'assistant',content,...(thinking?{thinking}:{}),...(calls.length?{tool_calls:calls}:{})};
  }catch(error){if(error instanceof SyntaxError)throw new OllamaError('invalid_response','The AI server returned an unreadable stream. Check the model and server logs.');throw connectionError(error,options.timeout);}
}
export function parseStructured<T>(schema:z.ZodType<T>,content:string):T{
  try{return schema.parse(JSON.parse(content));}catch{throw new OllamaError('invalid_response','The model returned an invalid suggestion format. Try again, or select a model supporting structured output in Settings.');}
}
