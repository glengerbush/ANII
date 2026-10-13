import type {Handle} from '@sveltejs/kit';
import {appRequestGate,requestGateMode} from '$lib/server/request-gate';

export const handle:Handle=async({event,resolve})=>{
  const mode=requestGateMode(event.request.method,event.url);
  const release=await (mode==='exclusive'?appRequestGate.acquireExclusive():appRequestGate.acquireShared());
  try{
    const response=await resolve(event);
    if(!response.body){release();return response;}
    const reader=response.body.getReader();let cancelling=false;
    const body=new ReadableStream({
      async pull(controller){
        try{const {value,done}=await reader.read();if(cancelling)return;if(done){release();controller.close();}else controller.enqueue(value);}
        catch(error){if(!cancelling){release();controller.error(error);}}
      },
      async cancel(reason){cancelling=true;try{await reader.cancel(reason);}finally{release();}}
    });
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){release();throw error;}
};
