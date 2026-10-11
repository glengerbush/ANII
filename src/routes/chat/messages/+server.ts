import {json,error} from '@sveltejs/kit';
import {getMessagePage} from '$lib/server/repository';
export function GET({url}){
  const raw=url.searchParams.get('before');const before=raw===null?undefined:Number(raw);
  if(before!==undefined&&(!Number.isSafeInteger(before)||before<=0))error(400,'Invalid history cursor');
  return json(getMessagePage(before),{headers:{'cache-control':'no-store'}});
}
