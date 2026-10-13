import type { EmitActivity } from '$lib/ai-stream';
import { database } from './db';
import { captureAgent } from './capture-agent';
import { OllamaError } from './ai';
import { saveAiResult } from './ai-proposals';
import { messageForCapture } from './repository';
export const processingMessages=new Set<number>();
export async function runCapture(id:number,emit:EmitActivity=()=>{},signal?:AbortSignal){
  if(processingMessages.has(id))throw new Error('AI is already processing this message. Wait for it to finish.');
  messageForCapture(id);processingMessages.add(id);
  try{
    const {plan,model}=await captureAgent(id,emit,signal);
    if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
    let result;try{result=saveAiResult(id,plan,model);}catch(error){throw new OllamaError('storage',`Could not save the proposed changes: ${error instanceof Error?error.message:'database error'}. Refresh history before retrying.`);}
    return {...result,messages:database.sqlite.prepare('SELECT m.*,p.id proposal_id,p.kind,p.payload,p.status,p.rationale,p.result_type,p.result_id FROM messages m LEFT JOIN ai_proposals p ON p.message_id=m.id WHERE m.id=? ORDER BY p.id').all(id)};
  }finally{processingMessages.delete(id);}
}
