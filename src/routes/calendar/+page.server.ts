import {error} from '@sveltejs/kit';
import {calendarRange,validDate} from '$lib/calendar';
import {activeProfileId} from '$lib/server/profiles';
import {getBacklog,getProfile,getScheduledTasks,today} from '$lib/server/repository';
import {taskScheduleAction,taskUnscheduleAction} from '$lib/server/task-actions';
import {redirectAfterSave} from '$lib/server/form-actions';

export const load=({url,cookies})=>{
  const profileId=activeProfileId(cookies);const date=today();
  const view=url.searchParams.get('view')==='week'?'week':'month';
  const anchor=url.searchParams.get('date')??date;
  if(!validDate(anchor))error(400,'Choose a valid calendar date.');
  const selectedProfile=url.searchParams.get('profile')??String(profileId);
  const filter=selectedProfile==='all'?null:Number(selectedProfile);
  if(filter!==null&&(!Number.isSafeInteger(filter)||!getProfile(filter)))error(400,'Choose an existing user or Everyone.');
  const range=calendarRange(anchor,view);
  return {date,view,anchor,...range,selectedProfile,tasks:getScheduledTasks(range.rangeStart,range.rangeEnd,filter),searchTasks:getBacklog()};
};
export const actions=redirectAfterSave({
  schedule:({request,cookies})=>taskScheduleAction(request,cookies),
  unschedule:({request,cookies})=>taskUnscheduleAction(request,cookies)
});
