import { isActionFailure, redirect, type Action } from '@sveltejs/kit';

/** Native saves end with GET; enhanced forms keep their result data and errors. */
export function redirectAfterSave<T extends Record<string, Action>>(actions:T, resultActions:readonly (keyof T)[]=[]):T {
  return Object.fromEntries(Object.entries(actions).map(([name,action])=>[name,async(event)=>{
    const result=await action(event);
    const {request}=event;
    const native=request.headers.get('accept')?.includes('text/html')
      && !request.headers.get('accept')?.includes('application/json')
      && request.headers.get('x-sveltekit-action')!=='true';
    if(native&&!isActionFailure(result)&&!resultActions.includes(name)){
      const url=new URL(request.url);
      // Keep filters and disclosure state, but never replay the named action.
      for(const key of [...url.searchParams.keys()])if(key.startsWith('/'))url.searchParams.delete(key);
      redirect(303,`${url.pathname}${url.search}`);
    }
    return result;
  }])) as T;
}
