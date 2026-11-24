import { database } from './db';
import {
  addDependency, addTaskProject, addToPlan, assertCurrentDate, assignTask, createAndPlan,
  createProjectForTask, createTask, DEFAULT_PROFILE_ID, deleteTask, fallbackProfileId, getProfile,
  getTask, moveBacklog, movePlan, moveProjectTask, removeDependency, removeFromPlan,
  removeTaskProject, reorderPlan, replaceDependency, setTaskState, today, unscheduleTask,
  updateTask, type Sqlite
} from './repository';

/** Transport-neutral fields preserve repeated values so web and native validation agree. */
export type TaskFields = Readonly<Record<string, string | readonly string[]>>;
export type TaskContext = { profileId?: number; projectId?: number };
export type TaskResult = { success: true; plannedTaskId?: number; project?: { id:number; name:string } };
const common = {
  schedule:'schedule', state:'state', edit:'edit', deleteTask:'deleteTask', dependency:'dependency',
  removeDependency:'removeDependency', addProject:'addProject', removeProject:'removeProject', createProjectTag:'createProjectTag'
} as const;
export const taskOperations = {
  now:{...common, quickAdd:'quickAdd', section:'section', remove:'remove', reorder:'reorder', move:'moveNow'},
  backlog:{...common, create:'create', plan:'plan', move:'moveBacklog'},
  project:{...common, create:'createInProject', plan:'plan', move:'moveProject'},
  completed:common,
  calendar:{schedule:'schedule', unschedule:'unschedule'}
} as const;
export type TaskViewName = keyof typeof taskOperations;
type Values<T> = T[keyof T];
export type TaskOperation = Values<{[V in TaskViewName]: Values<typeof taskOperations[V]>}>;
export function taskOperation(view:string, action:string):TaskOperation|undefined {
  if (!Object.hasOwn(taskOperations,view)) return undefined;
  const operations = taskOperations[view as TaskViewName];
  return Object.hasOwn(operations,action) ? operations[action as keyof typeof operations] as TaskOperation : undefined;
}

/** Owns Task input validation and orchestration; adapters only decode/encode transport.
 * Planning retains ownership of Schedule, placement, daily visibility and Completion.
 */
export function executeTask(operation:TaskOperation, fields:TaskFields, context:TaskContext={}, db:Sqlite=database.sqlite):TaskResult {
  const has = (key:string) => Object.hasOwn(fields,key);
  const values = (key:string):readonly string[] => !has(key) ? [] : typeof fields[key] === 'string' ? [fields[key] as string] : fields[key] as readonly string[];
  const value = (key:string) => values(key)[0];
  const text = (key:string) => value(key) ?? '';
  const number = (key:string) => Number(value(key) ?? null);
  const profile = () => {
    const selected = context.profileId;
    const active = Number.isInteger(selected) && getProfile(selected!,db) ? selected! : fallbackProfileId(db);
    const id = Number(value('profileId') ?? selected ?? DEFAULT_PROFILE_ID);
    if (!Number.isSafeInteger(id) || !getProfile(id,db) || id !== active) throw new Error('The profile changed or was deleted. Reload before making changes.');
    return id;
  };
  const date = (required=false) => assertCurrentDate(required ? text('planDate') : value('planDate'),db);
  const id = (key:string,message='Choose a task.') => {
    const result=number(key);
    if (!Number.isSafeInteger(result) || result<1) throw new Error(message);
    return result;
  };
  const project = () => {
    if (!Number.isSafeInteger(context.projectId) || context.projectId!<1) throw new Error('Project not found');
    return context.projectId!;
  };
  switch (operation) {
    case 'edit': {
      const hours=text('remainingHours').trim();
      if (hours!=='' && (!Number.isFinite(Number(hours)) || Number(hours)<0 || Number(hours)>8760)) throw new Error('Remaining effort must be between 0 and 8760 hours');
      updateTask(number('id'),{title:text('title'),details:text('details'),duration:text('duration'),dueAt:text('dueAt'),
        remainingEffortMinutes:has('remainingHours')?(hours===''?null:Math.round(Number(hours)*60)):undefined,
        leadTimeDays:has('leadTimeDays')?number('leadTimeDays'):undefined},db);
      break;
    }
    case 'state': {
      const taskId=id('id','Invalid task'), state=text('state');
      if (state!=='open' && state!=='completed') throw new Error('Unsupported task state');
      const actor=profile();date();setTaskState(taskId,state,db,actor);break;
    }
    case 'deleteTask': deleteTask(id('id','Invalid task'),db);break;
    case 'dependency': {
      if (has('kind')) throw new Error('Dependency kinds are no longer supported. Reload and try again.');
      const taskId=id('taskId','Choose a task for this dependency.'), prerequisite=id('prerequisiteId','Choose a task for this dependency.');
      if (has('previousPrerequisiteId')) replaceDependency(taskId,number('previousPrerequisiteId'),prerequisite,db);
      else addDependency(taskId,prerequisite,db);
      break;
    }
    case 'removeDependency': removeDependency(number('taskId'),number('prerequisiteId'),db);break;
    case 'addProject': addTaskProject(number('taskId'),number('projectId'),db);break;
    case 'removeProject': removeTaskProject(number('taskId'),number('projectId'),db);break;
    case 'createProjectTag': {
      const name=text('projectName').trim(), projectId=createProjectForTask(number('taskId'),name,db);
      return {success:true,project:{id:projectId,name}};
    }
    case 'create': createTask({title:text('title')},db,profile());break;
    case 'createInProject': createTask({title:text('title'),projectIds:[project()]},db,profile());break;
    case 'quickAdd': {const actor=profile();date();createAndPlan(text('title'),undefined,db,actor);break;}
    case 'schedule': {
      profile();const taskId=id('taskId'), raw=value('assigneeId');
      if (raw==='none') {assignTask(taskId,'none',undefined,db);break;}
      if (raw===undefined || raw==='') throw new Error('Choose a user, Everyone, or No one.');
      assignTask(taskId,raw==='everyone'?null:Number(raw),has('startDate')?(text('startDate')||today(db)):undefined,db);
      break;
    }
    case 'unschedule': profile();unscheduleTask(id('taskId'),db);break;
    case 'plan': {
      const actor=profile(), day=date();
      if (values('taskId').length!==1) throw new Error('Choose one task to update in Now.');
      const taskId=id('taskId','Choose one task to update in Now.'), task=getTask(taskId,db);
      if (!task || task.state!=='open') throw new Error('This task is no longer available. Refresh and try again.');
      const planned=value('planned')??'true';
      if (planned!=='true' && planned!=='false') throw new Error('Choose whether this task belongs in Now.');
      if (planned==='false') removeFromPlan(taskId,day,db,actor);else addToPlan(taskId,day,undefined,db,actor);
      return {success:true,plannedTaskId:taskId};
    }
    case 'section': {const actor=profile();addToPlan(number('id'),date(),text('section') as 'focus'|'also',db,actor);break;}
    case 'remove': {const actor=profile();removeFromPlan(number('id'),date(),db,actor);break;}
    case 'reorder': {const actor=profile();reorderPlan(number('id'),text('direction') as 'up'|'down',date(),db,actor);break;}
    case 'moveNow': {const actor=profile();movePlan(number('id'),text('section') as 'focus'|'also',number('position'),date(),db,actor);break;}
    case 'moveBacklog': {
      const actor=profile(),day=date(true);
      moveBacklog(id('taskId','Choose valid tasks to reorder.'),id('anchorId','Choose valid tasks to reorder.'),text('edge') as 'before'|'after',text('group') as 'queued'|'unqueued',day,db,actor);break;
    }
    case 'moveProject': moveProjectTask(project(),number('taskId'),number('anchorId'),text('edge') as 'before'|'after',db);break;
    default: {const unreachable:never=operation;throw new Error(`Unknown task operation: ${unreachable}`);}
  }
  return {success:true};
}
