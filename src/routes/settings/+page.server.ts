import { redirectAfterSave } from '$lib/server/form-actions';
import { fail } from '@sveltejs/kit';
import { backupDatabase } from '$lib/server/db';
import { DatabaseRestoreError, MAX_DATABASE_UPLOAD_BYTES, restoreDatabaseBytes, restoreJsonData } from '$lib/server/database-restore';
import { createProfile, renameProfile, deleteProfile, getSettings, saveSettings, normalizeAiUrl } from '$lib/server/repository';
import { activeProfileId, selectProfile } from '$lib/server/profiles';
import { checkAiConnection } from '$lib/server/ai';
const error=(e:unknown)=>fail(e instanceof DatabaseRestoreError?e.status:400,{error:e instanceof Error?e.message:'Operation failed'});
export const load=async()=>{const settings=getSettings();return {settings,aiConnection:await checkAiConnection(settings.ai_url)};};
export const actions=redirectAfterSave({
  createProfile:async({request})=>{const d=await request.formData();try{createProfile(String(d.get('name')??''));return {profileCreated:true}}catch(e){return error(e)}},
  renameProfile:async({request})=>{const d=await request.formData();try{const name=renameProfile(Number(d.get('profileId')),String(d.get('name')??''));return {profileRenamed:name}}catch(e){return error(e)}},
  deleteProfile:async({request,cookies})=>{const d=await request.formData();try{const id=Number(d.get('profileId'));const active=activeProfileId(cookies);const result=deleteProfile(id,String(d.get('confirmation')??''));if(active===id)selectProfile(cookies,result.fallbackId);return {profileDeleted:result.name}}catch(e){return error(e)}},
  save:async({request})=>{const d=await request.formData();try{const values:Record<string,string>={};for(const [field,key] of [['focusLayout','focus_layout'],['theme','theme'],['timezone','timezone'],['currentPriorities','current_priorities'],['aiUrl','ai_url'],['model','model'],['aiTimeout','ai_timeout_seconds'],['dailyCapacity','daily_capacity_minutes'],['deadlineBuffer','deadline_buffer_days']] as const)if(d.has(field))values[key]=String(d.get(field)??'');const current=getSettings();const url=normalizeAiUrl(values.ai_url??current.ai_url);const model=values.model??current.model;if(url!==normalizeAiUrl(current.ai_url)||model!==current.model){const connection=await checkAiConnection(url);if(!connection.ok)throw new Error(connection.message);if(!connection.models.includes(model))throw new Error('The selected model is not installed. Refresh the model list and choose an available model.');}saveSettings(values);return {saved:true}}catch(e){return error(e)}},
  appearance:async({request})=>{
    const d=await request.formData();
    try{
      const values:Record<string,string>={};
      if(d.has('theme'))values.theme=String(d.get('theme'));
      if(d.has('focusLayout'))values.focus_layout=String(d.get('focusLayout'));
      if(!Object.keys(values).length)throw new Error('Choose an appearance setting');
      saveSettings(values);return {appearanceSaved:true};
    }catch(e){return error(e)}
  },
  testAi:async({request})=>{const d=await request.formData();try{return {connection:await checkAiConnection(String(d.get('aiUrl')??''))};}catch(e){return error(e)}},
  backup:async()=>{try{const path=await backupDatabase();return {backedUp:Boolean(path)}}catch(e){return error(e)}},
  import:async({request})=>{const d=await request.formData();if(d.get('confirmation')!=='RESTORE')return fail(400,{error:'Type RESTORE to confirm database replacement'});const file=d.get('file');if(!(file instanceof File)||!file.size)return fail(400,{error:'Choose an export file'});if(file.size>10_000_000)return fail(413,{error:'Export file is too large'});try{const result=await restoreJsonData(JSON.parse(await file.text()));return {imported:true,recoveryBackupName:result.recoveryBackupName}}catch(e){return error(e)}},
  restoreDatabase:async({request})=>{const d=await request.formData();if(d.get('confirmation')!=='RESTORE')return fail(400,{error:'Type RESTORE to confirm database replacement'});const file=d.get('file');if(!(file instanceof File)||!file.size)return fail(400,{error:'Choose a database backup'});if(file.size>MAX_DATABASE_UPLOAD_BYTES)return fail(413,{error:'Database backup is too large'});try{const result=await restoreDatabaseBytes(new Uint8Array(await file.arrayBuffer()));return {databaseRestored:true,recoveryBackupName:result.recoveryBackupName,restoreWarning:result.warning};}catch(e){if(e instanceof DatabaseRestoreError)return fail(e.status,{error:e.message});return fail(500,{error:'Database restore failed. Current data was not changed.'});}}
}, ['testAi']);
