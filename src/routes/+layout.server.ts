import { today, getProfile, getSettings, listProfiles } from '$lib/server/repository';
import { aiHealthy } from '$lib/server/ai';
import { activeProfileId } from '$lib/server/profiles';
export async function load({cookies,depends}){depends('app:appearance');const profileId=activeProfileId(cookies);const settings=getSettings();let timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;try{if(settings.timezone!=='local'){new Intl.DateTimeFormat('en-US',{timeZone:settings.timezone});timeZone=settings.timezone;}}catch{/* Existing invalid settings use the server timezone. */}return {currentDate:today(),timeZone,settings,appearance:{theme:settings.theme,focus_layout:settings.focus_layout},profiles:listProfiles(),activeProfile:getProfile(profileId)!,aiOnline:await aiHealthy()};}
