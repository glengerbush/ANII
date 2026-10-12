import type { Cookies } from '@sveltejs/kit';
import { DEFAULT_PROFILE_ID, fallbackProfileId, getProfile, type Sqlite } from './repository';

export const PROFILE_COOKIE = 'life_profile';

export function activeProfileId(cookies:Cookies,db?:Sqlite):number {
  const requested=Number(cookies.get(PROFILE_COOKIE));
  if(Number.isInteger(requested)&&getProfile(requested,db))return requested;
  return fallbackProfileId(db);
}

// A page can outlive its profile or the browser's current selection.
export function mutationProfileId(cookies:Cookies,data:FormData,db?:Sqlite):number{
  const id=Number(data.get('profileId')??cookies.get(PROFILE_COOKIE)??DEFAULT_PROFILE_ID);
  if(!Number.isSafeInteger(id)||!getProfile(id,db)||id!==activeProfileId(cookies,db))throw new Error('The profile changed or was deleted. Reload before making changes.');
  return id;
}
export function selectProfile(cookies:Cookies,id:number){
  cookies.set(PROFILE_COOKIE,String(id),{path:'/',httpOnly:true,secure:false,sameSite:'lax',maxAge:60*60*24*365});
}
