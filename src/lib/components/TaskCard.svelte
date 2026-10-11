<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { tick } from 'svelte';
  import { projectTone, taskStatus } from '$lib/presentation/task';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import TrashIcon from './TrashIcon.svelte';

  type Mode='focus'|'queue'|'list';
  type DragControls={active:boolean;disabled:boolean;onpointerdown:(event:PointerEvent)=>void;onpointermove:(event:PointerEvent)=>void;onpointerup:(event:PointerEvent)=>void;onpointercancel:()=>void;onkeydown:(event:KeyboardEvent)=>void};
  let {task,allTasks=[],projects=[],meta={prerequisites:[],dependents:[],history:[]},planningControls=true,selectionForm,drag,mode='list',channelIndex,date}:{task:any;allTasks?:any[];projects?:any[];meta?:any;planningControls?:boolean;selectionForm?:string;drag?:DragControls;mode?:Mode;channelIndex?:number;date?:string}=$props();
  let open=$state(false);
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
  function complete(event:Event){(event.currentTarget as HTMLInputElement).form?.requestSubmit();}
  function focusProjectInput(){document.getElementById(`project-picker-${task.id}`)?.focus();}
  async function toggleOpen(){if(open&&tagsDirty){open=false;tagsDirty=false;await invalidateAll();}else open=!open;}
  async function postProject(action:string,data:FormData){
    projectBusy=true;projectError='';
    try{const response=await fetch(action,{method:'POST',body:data,headers:{'x-sveltekit-action':'true'}});const result=deserialize(await response.text());if(result.type!=='success'){projectError=result.type==='failure'&&result.data&&'error' in result.data?String(result.data.error):'Could not update projects. Your task is unchanged; check your connection and try again.';return null;}return result.data;}
    catch{projectError='Could not update projects. Your task is unchanged; check your connection and try again.';return null;}
    finally{projectBusy=false;}
  }
  async function addProject(project:any){const data=new FormData();data.set('taskId',String(task.id));data.set('projectId',String(project.id));if(!await postProject('?/addProject',data))return;selectedProjectIds=[...selectedProjectIds,project.id];tagsDirty=true;projectQuery='';projectActiveIndex=0;projectMenuOpen=true;await tick();focusProjectInput();}
  async function removeProject(project:any){const data=new FormData();data.set('taskId',String(task.id));data.set('projectId',String(project.id));if(!await postProject('?/removeProject',data))return;selectedProjectIds=selectedProjectIds.filter((id)=>id!==project.id);tagsDirty=true;}
  async function createProject(){const name=projectQuery.trim();if(!name){projectError='Type a project name first.';projectMenuOpen=true;await tick();focusProjectInput();return;}const data=new FormData();data.set('taskId',String(task.id));data.set('projectName',name);const result=await postProject('?/createProjectTag',data) as {project?:any}|null;if(!result?.project)return;projectOptions=[...projectOptions,result.project];selectedProjectIds=[...selectedProjectIds,result.project.id];tagsDirty=true;projectQuery='';projectActiveIndex=0;projectMenuOpen=true;await tick();focusProjectInput();}
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
  <div class="task-row">
    {#if drag}<button type="button" class="drag-handle" class:active={drag.active} disabled={drag.disabled} data-drag-handle={task.id} aria-label={`Drag ${task.title}`} aria-pressed={drag.active} aria-describedby="drag-instructions" onpointerdown={drag.onpointerdown} onpointermove={drag.onpointermove} onpointerup={drag.onpointerup} onpointercancel={drag.onpointercancel} onkeydown={drag.onkeydown}><span aria-hidden="true">⠿</span></button>{/if}
    <form method="POST" action="?/state" class="completion-form"><input type="hidden" name="id" value={task.id}><input type="hidden" name="state" value={task.state==='completed'?'open':'completed'}><label class="completion-hitbox" title={task.state==='completed'?`Mark ${task.title} incomplete`:`Complete ${task.title}`}><input class="completion-checkbox" type="checkbox" checked={task.state==='completed'} aria-label={task.state==='completed'?`Mark ${task.title} incomplete`:`Complete ${task.title}`} onchange={complete}></label></form>
    <button class="task-title" aria-label={`Edit ${task.title}`} aria-expanded={open} onclick={toggleOpen}>{task.title}</button>
    <div class="indicators">
      {#each visibleProjects as project (project.id)}<span class={`pill project-pill tone-${projectTone(project.id)}`}>{project.name}</span>{/each}
      {#if !open&&hiddenProjects.length}<span class="pill project-overflow" aria-label={`${hiddenProjects.length} more projects: ${hiddenProjects.map((project:any)=>project.name).join(', ')}`} title={hiddenProjects.map((project:any)=>project.name).join(', ')}>+{hiddenProjects.length}</span>{/if}
      <span class={`status-chip status-${status.key}`}>{status.label}</span>
      {#if task.duration_bucket}<span class="duration-chip">{task.duration_bucket}</span>{/if}
    </div>
    <div class="task-row-actions">
      {#if selectionForm}<label class="plan-select"><input type="checkbox" name="taskId" value={task.id} form={selectionForm}> Today</label>{/if}
      {#if mode==='queue'&&planningControls}<form method="POST" action="?/section"><input type="hidden" name="id" value={task.id}><input type="hidden" name="section" value="focus"><button class="secondary compact-action" disabled={task.section==='focus'}>Focus</button></form>{/if}
      {#if mode==='focus'||mode==='queue'}<ConfirmDialog action="?/deleteTask" id={task.id} dialogKey={`task-${mode}-${task.id}`} label={`Delete ${task.title}`} description="This permanently deletes the task from every profile, plan, and project." />{/if}
    </div>
  </div>
  {#if open}<div class="task-details"><div class="task-details-heading"><h3>Edit task</h3><button type="button" class="secondary" onclick={toggleOpen}>Close editor</button></div>
    <form method="POST" action="?/edit" class="stack"><input type="hidden" name="id" value={task.id}><label>Title<input name="title" value={task.title} required></label><label>Notes<textarea name="details" rows="3">{task.details}</textarea></label><div class="form-grid"><label>Duration<select name="duration"><option value="">None</option>{#each ['15m','30m','1h','2h+'] as duration (duration)}<option value={duration} selected={duration===task.duration_bucket}>{duration}</option>{/each}</select></label><label>Due date<input type="date" name="dueAt" value={task.due_at??''}></label></div><div class="form-grid"><label>Remaining effort (hours)<input name="remainingHours" type="number" min="0" max="8760" step="any" value={task.remaining_effort_minutes==null?'':task.remaining_effort_minutes/60} placeholder="Unknown"></label><label>Remaining lead time (days)<input name="leadTimeDays" type="number" min="0" max="3650" step="1" value={task.lead_time_days??0}></label></div><p class="muted">Effort is hands-on work left. Lead time is additional calendar time for waiting or delivery. Update both as work progresses; blank effort uses Duration as an estimate.</p><button>Save task</button></form>
    <section class="task-projects"><h3>Projects</h3><div class="project-multiselect" onfocusout={leaveProjectPicker}>{#if assignedProjects.length}<div class="tag-list">{#each assignedProjects as project (project.id)}<button type="button" class={`tag tone-${projectTone(project.id)}`} disabled={projectBusy} aria-label={`Remove ${project.name} from ${task.title}`} onclick={()=>removeProject(project)}><span class="tag-label">{project.name}</span><span aria-hidden="true">×</span></button>{/each}</div>{/if}<label class="sr-only" for={`project-picker-${task.id}`}>Add project</label><input bind:value={projectQuery} id={`project-picker-${task.id}`} role="combobox" aria-expanded={projectMenuOpen} aria-controls={`project-options-${task.id}`} aria-activedescendant={activeOptionId} aria-autocomplete="list" autocomplete="off" placeholder={assignedProjects.length?'Add another project…':'Add a project…'} disabled={projectBusy} onfocus={()=>projectMenuOpen=true} onclick={()=>projectMenuOpen=true} oninput={()=>{projectMenuOpen=true;projectActiveIndex=0;}} onkeydown={projectKeydown}>{#if projectMenuOpen}<div class="project-options" id={`project-options-${task.id}`} role="listbox" aria-label="Project options">{#each matchingProjects as project,index (project.id)}<button id={`project-option-${task.id}-${index}`} type="button" role="option" aria-selected={projectActiveIndex===index} class:active={projectActiveIndex===index} disabled={projectBusy} onpointerenter={()=>projectActiveIndex=index} onmousedown={(event)=>event.preventDefault()} onclick={()=>addProject(project)}>{project.name}</button>{/each}<button id={`project-option-${task.id}-${matchingProjects.length}`} type="button" class="new-project-option" class:active={projectActiveIndex===matchingProjects.length} role="option" aria-selected={projectActiveIndex===matchingProjects.length} disabled={projectBusy} onpointerenter={()=>projectActiveIndex=matchingProjects.length} onmousedown={(event)=>event.preventDefault()} onclick={createProject}>+ New project{projectQuery.trim()?` “${projectQuery.trim()}”`:''}</button></div>{/if}</div>{#if projectBusy}<p class="project-busy" role="status"><span class="spinner" aria-hidden="true"></span>Updating projects…</p>{/if}{#if projectError}<p class="danger project-error" role="alert">{projectError}</p>{/if}</section>
    <div class="actions">{#if planningControls}<form method="POST" action="?/section"><input type="hidden" name="id" value={task.id}><input type="hidden" name="section" value={task.section==='focus'?'also':'focus'}><button class="secondary">Move to {task.section==='focus'?'Queue':'Focus'}</button></form>{#each [['up','↑'],['down','↓']] as move (move[0])}<form method="POST" action="?/reorder"><input type="hidden" name="id" value={task.id}><input type="hidden" name="direction" value={move[0]}><button class="secondary" aria-label={`Move ${task.title} ${move[0]}`}>{move[1]}</button></form>{/each}<form method="POST" action="?/remove"><input type="hidden" name="id" value={task.id}><button class="secondary">Backlog</button></form>{/if}{#if task.state==='open'||task.state==='waiting'}<form method="POST" action="?/state"><input type="hidden" name="id" value={task.id}><input type="hidden" name="state" value={task.state==='waiting'?'open':'waiting'}><button class="secondary">{task.state==='waiting'?'Resume task':'Mark waiting'}</button></form>{/if}{#if mode==='list'}<ConfirmDialog action="?/deleteTask" id={task.id} dialogKey={`task-list-${task.id}`} label={`Delete ${task.title}`} description="This permanently deletes the task from every profile, plan, and project." />{/if}</div>
    <details><summary>Dependencies</summary>{#if meta.prerequisites.length}<h3>Prerequisites</h3><ul class="dependency-list">{#each meta.prerequisites as dep (`${dep.task_id}-${dep.prerequisite_task_id}`)}<li>{dep.kind==='hard'?'Blocked by':'Better after'} <strong>{dep.title}</strong> ({dep.state}) <form method="POST" action="?/removeDependency"><input type="hidden" name="taskId" value={task.id}><input type="hidden" name="prerequisiteId" value={dep.prerequisite_task_id}><button class="secondary icon-button trash-button" aria-label={`Remove dependency ${dep.title} from ${task.title}`} title={`Remove dependency ${dep.title}`}><TrashIcon /></button></form></li>{/each}</ul>{/if}{#if meta.dependents.length}<h3>Dependents</h3><ul>{#each meta.dependents as dep (`${dep.task_id}-${dep.prerequisite_task_id}`)}<li>{dep.title}</li>{/each}</ul>{/if}{#if !meta.prerequisites.length&&!meta.dependents.length}<p class="muted">No dependencies.</p>{/if}{#if allTasks.length>1}<form method="POST" action="?/dependency" class="inline-form"><input type="hidden" name="taskId" value={task.id}><select name="prerequisiteId" aria-label="Prerequisite task">{#each allTasks.filter((candidate)=>candidate.id!==task.id) as candidate (candidate.id)}<option value={candidate.id}>{candidate.title}</option>{/each}</select><select name="kind" aria-label="Dependency kind"><option value="hard">Blocked by</option><option value="soft">Better after</option></select><button>Add</button></form>{/if}</details>
    <details><summary>History</summary>{#if meta.history.length}<ol class="history-list">{#each meta.history as event (event.id)}<li><strong>{String(event.event_type).replaceAll('_',' ')}</strong> <small>{event.created_at}</small></li>{/each}</ol>{:else}<p class="muted">No history.</p>{/if}</details>
  </div>{/if}
</article>
