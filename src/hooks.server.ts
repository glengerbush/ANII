import type {Handle} from '@sveltejs/kit';
import {appRequestGate,requestGateMode} from '$lib/server/request-gate';

export const handle:Handle=async({event,resolve})=>{
  return requestGateMode(event.request.method,event.url)==='exclusive'?appRequestGate.withExclusive(()=>resolve(event)):appRequestGate.withShared(()=>resolve(event));
};
