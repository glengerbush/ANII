import { fail } from '@sveltejs/kit';
import { createProject, deleteProject, listProjects, renameProject } from '$lib/server/repository';
const error=(e:unknown)=>fail(400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=()=>({projects:listProjects()});
export const actions={create:async({request})=>{const d=await request.formData();try{createProject(String(d.get('name')??''));return {success:true}}catch(e){return error(e)}},rename:async({request})=>{const d=await request.formData();try{renameProject(Number(d.get('id')),String(d.get('name')??''));return {success:true}}catch(e){return error(e)}},delete:async({request})=>{const d=await request.formData();try{deleteProject(Number(d.get('id')));return {success:true}}catch(e){return error(e)}}};
