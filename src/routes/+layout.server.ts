import { getProfile, getSettings, listProfiles } from '$lib/server/repository';
import { aiHealthy } from '$lib/server/ai';
import { activeProfileId } from '$lib/server/profiles';
export async function load({cookies,depends}){depends('app:appearance');const profileId=activeProfileId(cookies);const settings=getSettings();return {settings,appearance:{theme:settings.theme,focus_layout:settings.focus_layout},profiles:listProfiles(),activeProfile:getProfile(profileId)!,aiOnline:await aiHealthy()};}
