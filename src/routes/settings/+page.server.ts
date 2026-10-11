import { fail } from '@sveltejs/kit';
import { memoryPreference } from '$lib/model-memory';
import { backupDatabase } from '$lib/server/db';
import { DatabaseRestoreError, MAX_DATABASE_UPLOAD_BYTES, restoreDatabaseBytes, restoreJsonData } from '$lib/server/database-restore';
import { createProfile, getSettings, saveSettings } from '$lib/server/repository';
import { checkOllamaConnection } from '$lib/server/ai';
const error=(e:unknown)=>fail(e instanceof DatabaseRestoreError?e.status:400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=()=>({settings:getSettings()});
export const actions={
  createProfile:async({request})=>{const d=await request.formData();try{createProfile(String(d.get('name')??''));return {profileCreated:true}}catch(e){return error(e)}},
  save:async({request})=>{const d=await request.formData();try{const values:Record<string,string>={};for(const [field,key] of [['theme','theme'],['timezone','timezone'],['currentPriorities','current_priorities'],['ollamaUrl','ollama_url'],['model','model'],['keepAlive','keep_alive'],['dailyCapacity','daily_capacity_minutes'],['deadlineBuffer','deadline_buffer_days']] as const)if(d.has(field))values[key]=String(d.get(field)??'');if(d.has('memoryMode'))values.keep_alive=memoryPreference(d,getSettings().keep_alive);saveSettings(values);return {saved:true}}catch(e){return error(e)}},
  testOllama:async({request})=>{const d=await request.formData();try{return {connection:await checkOllamaConnection(String(d.get('ollamaUrl')??''))};}catch(e){return error(e)}},
  backup:async()=>{try{const path=await backupDatabase();return {backedUp:Boolean(path)}}catch(e){return error(e)}},
  import:async({request})=>{const d=await request.formData();if(d.get('confirmation')!=='RESTORE')return fail(400,{error:'Type RESTORE to confirm database replacement'});const file=d.get('file');if(!(file instanceof File)||!file.size)return fail(400,{error:'Choose an export file'});if(file.size>10_000_000)return fail(413,{error:'Export file is too large'});try{const result=await restoreJsonData(JSON.parse(await file.text()));return {imported:true,recoveryBackupName:result.recoveryBackupName}}catch(e){return error(e)}},
  restoreDatabase:async({request})=>{const d=await request.formData();if(d.get('confirmation')!=='RESTORE')return fail(400,{error:'Type RESTORE to confirm database replacement'});const file=d.get('file');if(!(file instanceof File)||!file.size)return fail(400,{error:'Choose a database backup'});if(file.size>MAX_DATABASE_UPLOAD_BYTES)return fail(413,{error:'Database backup is too large'});try{const result=await restoreDatabaseBytes(new Uint8Array(await file.arrayBuffer()));return {databaseRestored:true,recoveryBackupName:result.recoveryBackupName,restoreWarning:result.warning};}catch(e){if(e instanceof DatabaseRestoreError)return fail(e.status,{error:e.message});return fail(500,{error:'Database restore failed. Current data was not changed.'});}}
};
