import type { AiError } from './ai';
export type AiActivityEvent =
  | {type:'status';message:string}
  | {type:'thinking';text:string}
  | {type:'tool';name:string;message:string;cached?:boolean}
  | {type:'saved';messageId:number}
  | {type:'done';result:any}
  | {type:'error';error:AiError};
export type EmitActivity=(event:AiActivityEvent)=>void;

/** NDJSON parser for application activity streams. Handles split UTF-8/chunks. */
export async function readJsonLines(response:Response,onValue:(value:any)=>void){
  if(!response.ok)throw new Error(`Request failed (${response.status}). Try again.`);
  if(!response.body)throw new Error('The server returned no response stream.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
  try{
    while(true){
      const {value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done});
      if(pending.length>1_000_000)throw new Error('Response exceeded the supported size.');
      let newline:number;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline).trim();pending=pending.slice(newline+1);if(line)onValue(JSON.parse(line));}
      if(done){if(pending.trim())onValue(JSON.parse(pending));break;}
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function consumeAiStream(response:Response,onEvent:EmitActivity){
  if(!response.ok){let message=`Request failed (${response.status}). Try again.`;try{message=String((await response.json()).error??message);}catch{}throw new Error(message);}
  let finished=false;
  await readJsonLines(response,(event:AiActivityEvent)=>{if(event.type==='done'||event.type==='error')finished=true;onEvent(event);});
  if(!finished)throw new Error('The AI connection ended before completion. Your saved message is kept; refresh history before retrying.');
}
