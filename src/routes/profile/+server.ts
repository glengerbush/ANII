import { error, redirect } from '@sveltejs/kit';
import { createProfile, getProfile } from '$lib/server/repository';
import { PROFILE_COOKIE } from '$lib/server/profiles';

function safeReturnTo(raw:string,requestUrl:string){
  if(!raw.startsWith('/')||raw.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(raw))return '/today';
  try{const source=new URL(requestUrl);const target=new URL(raw,source);return target.origin===source.origin?`${target.pathname}${target.search}`:'/today';}
  catch{return '/today';}
}

export async function POST({request,cookies}){
  const data=await request.formData();
  const intent=String(data.get('intent')??'switch');
  if(intent==='create'){
    try{createProfile(String(data.get('name')??''));}
    catch(cause){error(400,cause instanceof Error?cause.message:'Unable to create profile');}
    redirect(303,safeReturnTo(String(data.get('returnTo')??'/settings'),request.url));
  }
  let profileId:number;
  try{profileId=Number(data.get('profileId'));}
  catch(cause){error(400,cause instanceof Error?cause.message:'Unable to select profile');}
  if(!getProfile(profileId))error(400,'Profile not found');
  cookies.set(PROFILE_COOKIE,String(profileId),{path:'/',httpOnly:true,secure:false,sameSite:'lax',maxAge:60*60*24*365});
  redirect(303,safeReturnTo(String(data.get('returnTo')??'/today'),request.url));
}
