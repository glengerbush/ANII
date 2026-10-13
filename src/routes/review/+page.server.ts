import { fail, redirect } from '@sveltejs/kit';
import { closeOutToday, editReviewPlan, completeReviewFocus, getBacklog, getCurrentReviewSession, getReviewSession, getActiveDay, getToday, listReviews, planReviewTomorrow, previewCloseOut, today, tomorrow, type CloseOutOutcome } from '$lib/server/repository';
import { activeProfileId, mutationProfileId } from '$lib/server/profiles';

const error=(e:unknown)=>fail(400,{error:e instanceof Error?e.message:'Operation failed'});

function reviewDate(data:FormData){
  const value=data.get('reviewDate');
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Invalid review date');
  const [year,month,day]=value.split('-').map(Number);const parsed=new Date(year,month-1,day,12);
  if(parsed.getFullYear()!==year||parsed.getMonth()!==month-1||parsed.getDate()!==day)throw new Error('Invalid review date');
  return value;
}

function closeReviewDate(data:FormData,profileId:number){
  const posted=reviewDate(data);const active=getActiveDay(undefined,profileId);
  if(posted!==active||getCurrentReviewSession(undefined,undefined,profileId).stage!=='close')throw new Error('Your day or review stage changed; reload and try again');
  return posted;
}

function activeReviewDate(data:FormData,profileId:number){
  const posted=reviewDate(data);const current=getCurrentReviewSession(undefined,undefined,profileId);
  if(posted!==current.reviewDate)throw new Error('Review stage changed; reload and try again');
  return posted;
}

function editableReviewDate(data:FormData,profileId:number){
  const posted=reviewDate(data);const session=getReviewSession(posted,undefined,profileId);const active=getActiveDay(undefined,profileId);
  if(posted!==active&&session.tomorrowDate!==active)throw new Error('This review belongs to an earlier day');
  if(session.stage==='done'&&getCurrentReviewSession(undefined,undefined,profileId).stage!=='close')throw new Error('Finish the current review before editing the previous plan');
  return posted;
}

export const load=({cookies,url})=>{
  const profileId=activeProfileId(cookies);const activeDate=getActiveDay(undefined,profileId);let session=getCurrentReviewSession(undefined,undefined,profileId);
  const completed=url?.searchParams.get('completed');
  if(completed&&session.stage==='close'){
    const previous=getReviewSession(completed,undefined,profileId);
    if(previous.stage==='done'&&previous.tomorrowDate===activeDate)session={...previous,reviewDate:completed};
  }
  const tomorrowTasks=getToday(session.tomorrowDate,undefined,profileId);
  return {step:session.stage,date:session.reviewDate,calendarDate:today(),activeDate,tomorrowDate:session.tomorrowDate,tasks:getToday(session.reviewDate,undefined,profileId),candidates:getBacklog(),tomorrowTasks,tomorrowIds:tomorrowTasks.map((task)=>task.id),history:listReviews(undefined,profileId).map(review=>({...review,editable:tomorrow(review.review_date)===activeDate}))};
};

export const actions={
  editPlan:async({request,cookies})=>{const data=await request.formData();try{const profileId=mutationProfileId(cookies,data);editReviewPlan(editableReviewDate(data,profileId),data.has('saveFocus')?data.getAll('taskId').map(Number):undefined,undefined,profileId);}catch(e){return error(e)}redirect(303,'/review');},
  closeOut:async({request,cookies})=>{const data=await request.formData();try{const profileId=mutationProfileId(cookies,data);const date=closeReviewDate(data,profileId);const decisions=data.getAll('taskId').map((value)=>{const taskId=Number(value);return {taskId,outcome:String(data.get(`outcome-${taskId}`)??'') as CloseOutOutcome};});const tasks=getToday(date,undefined,profileId);const preview=previewCloseOut(decisions,tasks.map((task)=>task.id));if(preview.deleteTaskIds.length&&data.get('confirmDelete')!=='yes'){const deleteIds=new Set(preview.deleteTaskIds);return fail(409,{confirmRequired:true,confirmDeleteTasks:tasks.filter((task)=>deleteIds.has(task.id)).map((task)=>({id:task.id,title:task.title})),pendingDecisions:decisions,reviewDate:date});}closeOutToday(decisions,date,undefined,profileId);}catch(e){return error(e)}redirect(303,'/review');},
  planTomorrow:async({request,cookies})=>{const data=await request.formData();try{const profileId=mutationProfileId(cookies,data);planReviewTomorrow(data.getAll('taskId').map(Number),activeReviewDate(data,profileId),undefined,profileId);}catch(e){return error(e)}redirect(303,'/review');},
  focusTomorrow:async({request,cookies})=>{const data=await request.formData();try{const profileId=mutationProfileId(cookies,data);completeReviewFocus(data.getAll('taskId').map(Number),activeReviewDate(data,profileId),undefined,profileId);}catch(e){return error(e)}redirect(303,`/review?completed=${reviewDate(data)}`);}
};
