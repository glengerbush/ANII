import { fail, type Action } from '@sveltejs/kit';
import { PROFILE_COOKIE } from './profiles';
import { executeTask, taskOperations, type TaskFields, type TaskViewName } from './task-operations';

/** Web adapter: progressive redirects remain the page's responsibility. */
export function taskActions<V extends TaskViewName>(view:V):Record<keyof typeof taskOperations[V],Action> {
  return Object.fromEntries(Object.entries(taskOperations[view]).map(([name,operation])=>[name,async({request,cookies,params}:Parameters<Action>[0])=>{
    try {
      const form=await request.formData();
      const fields:Record<string,string[]>=Object.create(null);
      for (const key of new Set(form.keys())) fields[key]=form.getAll(key).map(String);
      const selected=cookies?.get(PROFILE_COOKIE);
      return executeTask(operation,fields as TaskFields,{profileId:selected===undefined?undefined:Number(selected),projectId:view==='project'?Number(params?.id):undefined});
    } catch (error) {return fail(400,{error:error instanceof Error?error.message:'Operation failed'});}
  }])) as unknown as Record<keyof typeof taskOperations[V],Action>;
}
