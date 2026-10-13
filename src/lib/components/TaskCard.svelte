<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { tick, onMount, onDestroy } from 'svelte';
  import { TaskAutosave, taskDraft, taskDraftKey, draftFields, type SaveState, type TaskDraft } from '$lib/task-autosave';
  import { getTaskSaves } from '$lib/task-save-context';
  import { projectTone, taskStatus } from '$lib/presentation/task';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import DependencyEditor from './DependencyEditor.svelte';

  type Mode='focus'|'queue'|'list';
  type DragControls={active:boolean;disabled:boolean;onpointerdown:(event:PointerEvent)=>void;onpointermove:(event:PointerEvent)=>void;onpointerup:(event:PointerEvent)=>void;onpointercancel:()=>void;onkeydown:(event:KeyboardEvent)=>void};
  let {task,profileId,allTasks=[],projects=[],meta={prerequisites:[],dependents:[],history:[]},planningControls=true,todayAction,inToday=false,stateAction='?/state',drag,mode='list',channelIndex,date,planDate,actionQuery=''}:{task:any;profileId?:number;allTasks?:any[];projects?:any[];meta?:any;planningControls?:boolean;todayAction?:string;inToday?:boolean;stateAction?:string;drag?:DragControls;mode?:Mode;channelIndex?:number;date?:string;planDate?:string;actionQuery?:string}=$props();
  function taskAction(name:string){return `?/${name}${actionQuery?`&${actionQuery}`:''}`;}
  let planBusy=$state(false);
  let planError=$state('');
  let planFeedback=$state('');
  async function addToToday(event:SubmitEvent){
    event.preventDefault();if(planBusy||inToday)return;
    const form=event.currentTarget as HTMLFormElement;planBusy=true;planError='';planFeedback='Adding to Today…';
    try{
      const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){planError=result.type==='failure'?String(result.data?.error):'Could not add this task to Today. Try again.';planFeedback='';return;}
      await invalidateAll();planFeedback=`${task.title} added to Today.`;
    }catch{planError='Could not confirm this task was added. Try again; existing Today tasks stay in place.';planFeedback='';}
    finally{planBusy=false;}
  }
  let open=$state(false);
  let editFormId=$derived(`task-edit-${mode}-${task.id}`);
  const taskSaves=getTaskSaves();
  let draft=$state.raw<TaskDraft|null>(null);
  let saveState=$state.raw<SaveState|null>(null);
  let editForm=$state<HTMLFormElement>();
  let editor:TaskAutosave|undefined;
  let unregister:(()=>void)|undefined;
  let composing=false;
  function draftStorage(){try{return window.localStorage;}catch{return undefined;}}
  function startEditor(){
    const id=task.id;
    const action=new URL(taskAction('edit'),window.location.href).href;
    editor=new TaskAutosave({initial:taskDraft(task),key:taskDraftKey(id),storage:draftStorage(),
      changed:(state)=>{draft=state.draft;saveState=state;},
      save:async(snapshot)=>{
        const body=new FormData();body.set('id',String(id));
        for(const field of draftFields)body.set(field,snapshot[field]);
        let result;
        try{
          const response=await fetch(action,{method:'POST',body,headers:{'x-sveltekit-action':'true'}});
          result=deserialize(await response.text());
        }catch{throw new Error('Could not save. Your edits are kept; retry.');}
        if(result.type!=='success')throw new Error(result.type==='failure'?String(result.data?.error??'Could not save. Retry.'):'Could not save. Your edits are kept; retry.');
        // The draft is independent of refreshed server props, including edits typed in flight.
        await invalidateAll().catch(()=>{});
      }});
    unregister=taskSaves.register({get pending(){return editor?.pending??false;},flush:flushTask});
    open=true;
  }
  onMount(()=>{
    // Reopen recovered work so an interrupted save is visible, never silently overwritten.
    try{if(draftStorage()?.getItem(taskDraftKey(task.id)))startEditor();}catch{/* Storage may be disabled. */}
  });
  onDestroy(()=>{unregister?.();editor?.dispose();});
  function captureDraft(event:Event){
    const form=event.currentTarget as HTMLFormElement;
    const data=new FormData(form);
    const next=Object.fromEntries(draftFields.map(field=>[field,String(data.get(field)??'')])) as TaskDraft;
    const target=event.target;
    const immediate=target instanceof HTMLSelectElement||(target instanceof HTMLInputElement&&target.type==='date');
    const invalid=form.querySelector<HTMLInputElement>(':invalid');
    editor?.update(next,immediate&&!composing,invalid?.validationMessage??'');
    if(composing)editor?.pause();
  }
  async function flushTask(){
    if(composing)return false;
    const saved=await editor?.flush()??true;
    if(!saved){await tick();editForm?.reportValidity();editForm?.querySelector<HTMLElement>(':invalid')?.focus();}
    return saved;
  }
  function saveTask(event:SubmitEvent){event.preventDefault();void flushTask();}
  function editKeydown(event:KeyboardEvent){
    if(event.key==='Enter'&&!event.isComposing&&event.target instanceof HTMLInputElement){event.preventDefault();void flushTask();}
  }
  let projectQuery=$state('');
  let projectMenuOpen=$state(false);
  let projectBusy=$state(false);
  let projectError=$state('');
  let projectActiveIndex=$state(0);
  let tagsDirty=$state(false);
  let selectedProjectIds=$derived<number[]>(task.project_ids??[]);
  let projectOptions=$derived<any[]>(projects);
  let assignedProjects=$derived(projectOptions.filter((project:any)=>selectedProjectIds.includes(project.id)));
  let visibleProjects=$derived(open?assignedProjects:assignedProjects.slice(0,2));
  let hiddenProjects=$derived(assignedProjects.slice(2));
  let availableProjects=$derived(projectOptions.filter((project:any)=>!selectedProjectIds.includes(project.id)));
  let matchingProjects=$derived.by(()=>{const query=projectQuery.trim().toLocaleLowerCase();return query?availableProjects.filter((project:any)=>project.name.toLocaleLowerCase().includes(query)):availableProjects;});
  let status=$derived(taskStatus(task,date));
  let channelTone=$derived((['blue','magenta','purple'] as const)[((channelIndex??1)-1)%3]);
  let activeOptionId=$derived(projectMenuOpen?`project-option-${task.id}-${projectActiveIndex}`:undefined);
  function complete(event:Event){const input=event.currentTarget as HTMLInputElement;input.checked=task.state==='completed';input.form?.requestSubmit();}
  function focusProjectInput(){document.getElementById(`project-picker-${task.id}`)?.focus();}
  async function toggleOpen(){
    if(!open){startEditor();return;}
    if(!await flushTask())return;
    open=false;unregister?.();unregister=undefined;editor?.dispose();editor=undefined;
    if(tagsDirty){tagsDirty=false;await invalidateAll();}
  }
  async function postProject(action:string,data:FormData){
    projectBusy=true;projectError='';
    try{const response=await fetch(action,{method:'POST',body:data,headers:{'x-sveltekit-action':'true'}});const result=deserialize(await response.text());if(result.type!=='success'){projectError=result.type==='failure'&&result.data&&'error' in result.data?String(result.data.error):'Could not update projects. Your task is unchanged; check your connection and try again.';return null;}return result.data;}
    catch{projectError='Could not update projects. Your task is unchanged; check your connection and try again.';return null;}
    finally{projectBusy=false;}
  }
  async function addProject(project:any){const data=new FormData();data.set('taskId',String(task.id));data.set('projectId',String(project.id));if(!await postProject(taskAction('addProject'),data))return;selectedProjectIds=[...selectedProjectIds,project.id];tagsDirty=true;projectQuery='';projectActiveIndex=0;projectMenuOpen=true;await tick();focusProjectInput();}
  async function removeProject(project:any){const data=new FormData();data.set('taskId',String(task.id));data.set('projectId',String(project.id));if(!await postProject(taskAction('removeProject'),data))return;selectedProjectIds=selectedProjectIds.filter((id)=>id!==project.id);tagsDirty=true;}
  async function createProject(){const name=projectQuery.trim();if(!name){projectError='Type a project name first.';projectMenuOpen=true;await tick();focusProjectInput();return;}const data=new FormData();data.set('taskId',String(task.id));data.set('projectName',name);const result=await postProject(taskAction('createProjectTag'),data) as {project?:any}|null;if(!result?.project)return;projectOptions=[...projectOptions,result.project];selectedProjectIds=[...selectedProjectIds,result.project.id];tagsDirty=true;projectQuery='';projectActiveIndex=0;projectMenuOpen=true;await tick();focusProjectInput();}
  function projectKeydown(event:KeyboardEvent){
    const optionCount=matchingProjects.length+1;
    if(event.key==='Escape'){event.preventDefault();projectMenuOpen=false;return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();projectMenuOpen=true;projectActiveIndex=(projectActiveIndex+(event.key==='ArrowDown'?1:-1)+optionCount)%optionCount;return;}
    if(event.key!=='Enter'||!projectMenuOpen)return;
    event.preventDefault();
    if(projectActiveIndex<matchingProjects.length)void addProject(matchingProjects[projectActiveIndex]);else void createProject();
  }
  function leaveProjectPicker(event:FocusEvent){if(!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null))projectMenuOpen=false;}
</script>

<article class:task-card-expanded={open} class={`task-card task-card-${mode}${mode==='focus'?` focus-accent-${channelTone}`:''}`}>
  {#if mode==='focus'}<div class="focus-channel"><span>0{channelIndex??1}</span><span>{task.duration_bucket??'OPEN'}</span></div>{/if}
  <div class="task-row" class:task-row-has-today={Boolean(todayAction)}>
    {#if drag}<button type="button" class="drag-handle" class:active={drag.active} disabled={drag.disabled} data-drag-handle={task.id} aria-label={`Drag ${task.title}`} aria-pressed={drag.active} aria-describedby="drag-instructions" onpointerdown={drag.onpointerdown} onpointermove={drag.onpointermove} onpointerup={drag.onpointerup} onpointercancel={drag.onpointercancel} onkeydown={drag.onkeydown}><span aria-hidden="true">⠿</span></button>{/if}
    {#if todayAction}<div class="today-add-control">{#if inToday}<span class="in-today">In Today</span>{:else}<form method="POST" action={todayAction} onsubmit={addToToday}><input type="hidden" name="profileId" value={profileId}>{#if planDate}<input type="hidden" name="planDate" value={planDate}>{/if}<input type="hidden" name="taskId" value={task.id}><button class="secondary compact-action" disabled={planBusy} aria-label={`Add ${task.title} to today`} aria-busy={planBusy}>{planBusy?'Adding…':'Add to today'}</button></form>{/if}<span class="sr-only" role="status">{planFeedback}</span></div>{/if}
    <form method="POST" action={stateAction} class="completion-form">{#if profileId}<input type="hidden" name="profileId" value={profileId}>{/if}{#if planDate}<input type="hidden" name="planDate" value={planDate}>{/if}<input type="hidden" name="id" value={task.id}><input type="hidden" name="state" value={task.state==='completed'?'open':'completed'}><label class="completion-hitbox" title={task.state==='completed'?`Mark ${task.title} incomplete`:`Complete ${task.title}`}><input class="completion-checkbox" type="checkbox" checked={task.state==='completed'} aria-label={task.state==='completed'?`Mark ${task.title} incomplete`:`Complete ${task.title}`} onchange={complete}></label></form>
    <button class="task-title" aria-label={`Edit ${task.title}`} aria-expanded={open} onclick={toggleOpen}>{task.title}</button>
    <div class="indicators">
      {#each visibleProjects as project (project.id)}<span class={`pill project-pill tone-${projectTone(project.id)}`}>{project.name}</span>{/each}
      {#if !open&&hiddenProjects.length}<span class="pill project-overflow" aria-label={`${hiddenProjects.length} more projects: ${hiddenProjects.map((project:any)=>project.name).join(', ')}`} title={hiddenProjects.map((project:any)=>project.name).join(', ')}>+{hiddenProjects.length}</span>{/if}
      <span class={`status-chip status-${status.key}`}>{status.label}</span>
      {#if task.duration_bucket}<span class="duration-chip">{task.duration_bucket}</span>{/if}
    </div>
    <div class="task-row-actions">
      {#if mode==='queue'&&planningControls}<form method="POST" action="?/section"><input type="hidden" name="profileId" value={profileId}>{#if planDate}<input type="hidden" name="planDate" value={planDate}>{/if}<input type="hidden" name="id" value={task.id}><input type="hidden" name="section" value="focus"><button class="secondary compact-action" disabled={task.section==='focus'}>Focus</button></form>{/if}
    </div>
  </div>
  {#if planError}<p class="plan-error danger" role="alert">{planError}</p>{/if}
  {#if open&&draft}<div class="task-details">
    <form bind:this={editForm} id={editFormId} data-task-autosave method="POST" action={taskAction('edit')} class="stack" onsubmit={saveTask} oninput={captureDraft} onchange={(event)=>{if(event.target instanceof HTMLSelectElement||(event.target instanceof HTMLInputElement&&event.target.type==='date'))captureDraft(event);}} onfocusout={()=>{if(!composing)void flushTask();}} oncompositionstart={()=>{composing=true;editor?.pause();}} oncompositionend={(event)=>{composing=false;captureDraft(event);}}><input type="hidden" name="id" value={task.id}><label>Title<input name="title" onkeydown={editKeydown} value={draft.title} required></label><label>Notes<textarea name="details" rows="3" value={draft.details}></textarea></label><div class="form-grid"><label>Duration<select name="duration" value={draft.duration}><option value="">None</option>{#each ['15m','30m','1h','2h+'] as duration (duration)}<option value={duration}>{duration}</option>{/each}</select></label><label>Due date<input type="date" name="dueAt" onkeydown={editKeydown} value={draft.dueAt}></label></div><div class="form-grid"><label>Remaining effort (hours)<input name="remainingHours" onkeydown={editKeydown} type="number" min="0" max="8760" step="any" value={draft.remainingHours} placeholder="Unknown"></label><label>Remaining lead time (days)<input name="leadTimeDays" onkeydown={editKeydown} type="number" min="0" max="3650" step="1" value={draft.leadTimeDays}></label></div><p class="muted">Effort is hands-on work left. Lead time is additional calendar time for waiting or delivery. Update both as work progresses; blank effort uses Duration as an estimate.</p></form>
    <section class="task-projects"><h3>Projects</h3><div class="project-multiselect" onfocusout={leaveProjectPicker}>{#if assignedProjects.length}<div class="tag-list">{#each assignedProjects as project (project.id)}<button type="button" class={`tag tone-${projectTone(project.id)}`} disabled={projectBusy} aria-label={`Remove ${project.name} from ${task.title}`} onclick={()=>removeProject(project)}><span class="tag-label">{project.name}</span><span aria-hidden="true">×</span></button>{/each}</div>{/if}<label class="sr-only" for={`project-picker-${task.id}`}>Add project</label><input bind:value={projectQuery} id={`project-picker-${task.id}`} role="combobox" aria-expanded={projectMenuOpen} aria-controls={`project-options-${task.id}`} aria-activedescendant={activeOptionId} aria-autocomplete="list" autocomplete="off" placeholder={assignedProjects.length?'Add another project…':'Add a project…'} disabled={projectBusy} onfocus={()=>projectMenuOpen=true} onclick={()=>projectMenuOpen=true} oninput={()=>{projectMenuOpen=true;projectActiveIndex=0;}} onkeydown={projectKeydown}>{#if projectMenuOpen}<div class="project-options" id={`project-options-${task.id}`} role="listbox" aria-label="Project options">{#each matchingProjects as project,index (project.id)}<button id={`project-option-${task.id}-${index}`} type="button" role="option" aria-selected={projectActiveIndex===index} class:active={projectActiveIndex===index} disabled={projectBusy} onpointerenter={()=>projectActiveIndex=index} onmousedown={(event)=>event.preventDefault()} onclick={()=>addProject(project)}>{project.name}</button>{/each}<button id={`project-option-${task.id}-${matchingProjects.length}`} type="button" class="new-project-option" class:active={projectActiveIndex===matchingProjects.length} role="option" aria-selected={projectActiveIndex===matchingProjects.length} disabled={projectBusy} onpointerenter={()=>projectActiveIndex=matchingProjects.length} onmousedown={(event)=>event.preventDefault()} onclick={createProject}>+ New project{projectQuery.trim()?` “${projectQuery.trim()}”`:''}</button></div>{/if}</div>{#if projectBusy}<p class="project-busy" role="status"><span class="spinner" aria-hidden="true"></span>Updating projects…</p>{/if}{#if projectError}<p class="danger project-error" role="alert">{projectError}</p>{/if}</section>
    <div class="actions">{#if planningControls}<form method="POST" action="?/section"><input type="hidden" name="profileId" value={profileId}>{#if planDate}<input type="hidden" name="planDate" value={planDate}>{/if}<input type="hidden" name="id" value={task.id}><input type="hidden" name="section" value={task.section==='focus'?'also':'focus'}><button class="secondary">Move to {task.section==='focus'?'Queue':'Focus'}</button></form>{#each [['up','↑'],['down','↓']] as move (move[0])}<form method="POST" action="?/reorder"><input type="hidden" name="profileId" value={profileId}>{#if planDate}<input type="hidden" name="planDate" value={planDate}>{/if}<input type="hidden" name="id" value={task.id}><input type="hidden" name="direction" value={move[0]}><button class="secondary" aria-label={`Move ${task.title} ${move[0]}`}>{move[1]}</button></form>{/each}<form method="POST" action="?/remove"><input type="hidden" name="profileId" value={profileId}>{#if planDate}<input type="hidden" name="planDate" value={planDate}>{/if}<input type="hidden" name="id" value={task.id}><button class="secondary">Backlog</button></form>{/if}</div>
    <DependencyEditor taskId={task.id} {allTasks} {actionQuery} prerequisites={meta.prerequisites} dependents={meta.dependents} />
    <div class="task-save"><span class="muted" role="status">{saveState?.saving?'Saving…':saveState?.error?'Not saved':saveState?.recovered?'Recovered unsaved edits':saveState?.dirty?'Unsaved changes':'Saved'}</span>{#if saveState?.error}<p class="danger" role="alert">{saveState.error}</p>{/if}{#if saveState?.error||saveState?.recovered}<button type="submit" form={editFormId} class="secondary" disabled={saveState?.saving}>{saveState?.recovered?'Save recovered edits':'Retry'}</button>{/if}{#if saveState?.storageError&&saveState.dirty}<p class="danger" role="alert">Draft recovery is unavailable in this browser. Keep this page open until saved.</p>{/if}</div>
    <div class="task-footer">
      <details><summary>History</summary>{#if meta.history.length}<ol class="history-list">{#each meta.history as event (event.id)}<li><strong>{String(event.event_type).replaceAll('_',' ')}</strong> <small>{event.created_at}</small></li>{/each}</ol>{:else}<p class="muted">No history.</p>{/if}</details>
      <div class="task-delete"><ConfirmDialog action={taskAction('deleteTask')} id={task.id} dialogKey={`task-editor-${mode}-${task.id}`} label={`Delete ${task.title}`} triggerText="Delete" description="This permanently deletes the task from every profile, plan, and project." /></div>
    </div>
  </div>{/if}
</article>

<style>
  .task-footer { display: flex; align-items: flex-start; gap: 1rem; }
  .task-footer > details { flex: 1; min-width: 0; }
  .task-delete { flex: none; }
  .task-save { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; padding-top: .5rem; }
  .task-save p { flex-basis: 100%; margin: 0; }
  .task-card:not(.task-card-focus) .task-row.task-row-has-today { grid-template-columns: auto auto minmax(0,1fr) minmax(0,auto) auto; }
  .today-add-control { min-width: 6.75rem; padding-left: .5rem; }
  .in-today { display: block; padding-inline: .55rem; color: var(--muted); font-size: .75rem; }
  .plan-error { margin: 0; padding: .25rem .75rem .75rem; font-size: .85rem; }
  @media (max-width: 48rem) {
    .task-card:not(.task-card-focus) .task-row.task-row-has-today { grid-template-columns: auto auto minmax(0,1fr); }
    .task-row.task-row-has-today .indicators { grid-column: 3; grid-row: 2; }
    .task-row.task-row-has-today .task-row-actions { display: none; }
  }
</style>
