import type { EmitActivity } from '$lib/ai-stream';
import { describeAiError } from './ai';
/** Start work immediately and let the request hook retain its gate until this body closes. */
export function aiResponse(work:(emit:EmitActivity,signal:AbortSignal)=>Promise<void>){
  const abort=new AbortController();const encoder=new TextEncoder();let cancelled=false;let finish!:()=>void;const finished=new Promise<void>(resolve=>finish=resolve);
  return new Response(new ReadableStream({
    async start(controller){
      const emit:EmitActivity=event=>{if(!cancelled)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
      try{await work(emit,abort.signal);}catch(error){emit({type:'error',error:describeAiError(error)});}
      finally{if(!cancelled)controller.close();finish();}
    },
    cancel(){cancelled=true;abort.abort();return finished;}
  }),{headers:{'content-type':'application/x-ndjson','cache-control':'no-store','x-accel-buffering':'no'}});
}
