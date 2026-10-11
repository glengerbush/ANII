import type { Cookies } from '@sveltejs/kit';
import { DEFAULT_PROFILE_ID, getProfile, listProfiles, type Sqlite } from './repository';

export const PROFILE_COOKIE = 'life_profile';

export function activeProfileId(cookies:Cookies,db?:Sqlite):number {
  const requested=Number(cookies.get(PROFILE_COOKIE));
  if(Number.isInteger(requested)&&getProfile(requested,db))return requested;
  return getProfile(DEFAULT_PROFILE_ID,db)?.id??listProfiles(db)[0]?.id??DEFAULT_PROFILE_ID;
}
