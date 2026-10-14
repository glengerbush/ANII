import { getProfile, getSettings, listProfiles } from '$lib/server/repository';
import { aiHealthy } from '$lib/server/ai';
import { activeProfileId } from '$lib/server/profiles';
export async function load({cookies}){const profileId=activeProfileId(cookies);return {settings:getSettings(),profiles:listProfiles(),activeProfile:getProfile(profileId)!,aiOnline:await aiHealthy()};}
