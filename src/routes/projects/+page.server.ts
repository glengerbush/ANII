import { redirectAfterSave } from '$lib/server/form-actions';
import { fail } from '@sveltejs/kit';
import { createProject, deleteProject, listProjects, renameProject } from '$lib/server/repository';
const error=(e:unknown)=>fail(400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=({url})=>{const projects=listProjects();return {projects:projects.filter(p=>p.state==='active'),completedProjects:projects.filter(p=>p.state==='archived').sort((a,b)=>(b.completed_at??'').localeCompare(a.completed_at??'')||b.id-a.id),showCompleted:url?.searchParams.get('showCompleted')==='1'};};
export const actions=redirectAfterSave({create:async({request})=>{const d=await request.formData();try{createProject(String(d.get('name')??''));return {success:true}}catch(e){return error(e)}},rename:async({request})=>{const d=await request.formData();try{renameProject(Number(d.get('id')),String(d.get('name')??''));return {success:true}}catch(e){return error(e)}},delete:async({request})=>{const d=await request.formData();try{deleteProject(Number(d.get('id')));return {success:true}}catch(e){return error(e)}}});
