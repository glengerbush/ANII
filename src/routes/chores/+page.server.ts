import { Chores } from '$lib/server/chores';
import { choreActions } from '$lib/server/chore-actions';
import { redirectAfterSave } from '$lib/server/form-actions';

export const load=()=>new Chores().view();
export const actions=redirectAfterSave(choreActions);
