<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { tick, untrack } from 'svelte';
  import TrashIcon from './TrashIcon.svelte';

  type Candidate={id:number;title:string;state:string};
  type Row={key:number;id:number|null;query:string;expanded:boolean;active:number;busy:boolean;error:string};
  let {taskId,allTasks,prerequisites=[],dependents=[],actionQuery=''}:{taskId:number;allTasks:Candidate[];prerequisites:any[];dependents:any[];actionQuery?:string}=$props();
  let nextKey=0;
  function row(id:number|null,query=''):Row{return {key:nextKey++,id,query,expanded:false,active:0,busy:false,error:''};}
  // This component mounts when the editor opens; row drafts persist until it closes.
  let rows=$state<Row[]>(untrack(()=>prerequisites.map(dep=>row(dep.prerequisite_task_id,dep.title))));
  let feedback=$state('');
  let candidates=$derived.by(()=>{
    const existing=prerequisites.filter(dep=>!allTasks.some(task=>task.id===dep.prerequisite_task_id)).map(dep=>({id:dep.prerequisite_task_id,title:dep.title,state:dep.state}));
    return [...allTasks,...existing].filter(task=>task.id!==taskId);
  });
  function options(entry:Row){
    const query=entry.query.trim().toLocaleLowerCase();
    return candidates.filter(task=>!rows.some(other=>other!==entry&&other.id===task.id)&&(!query||task.title.toLocaleLowerCase().includes(query)));
  }
  function inputId(entry:Row){return `dependency-${taskId}-${entry.key}`;}
  async function addRow(){const entry=row(null);rows.push(entry);await tick();document.getElementById(inputId(entry))?.focus();}
  async function post(entry:Row,action:string,data:FormData){
    entry.busy=true;entry.error='';feedback='Saving dependency…';
    try{
      const response=await fetch(`${action}${actionQuery?`&${actionQuery}`:''}`,{method:'POST',body:data,headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){entry.error=result.type==='failure'?String(result.data?.error):'Could not update this dependency. Try again.';feedback='';return false;}
      return true;
    }catch{entry.error='Could not confirm this dependency was saved. Reopen the task before trying again.';feedback='';return false;}
    finally{entry.busy=false;}
  }
  async function choose(entry:Row,task:Candidate){
    if(entry.busy)return;
    if(task.id===entry.id){entry.query=task.title;entry.expanded=false;return;}
    const data=new FormData();data.set('taskId',String(taskId));data.set('prerequisiteId',String(task.id));
    if(entry.id!==null)data.set('previousPrerequisiteId',String(entry.id));
    if(!await post(entry,'?/dependency',data))return;
    entry.id=task.id;entry.query=task.title;entry.expanded=false;feedback='Dependency saved.';
    await invalidateAll();document.getElementById(inputId(entry))?.focus();entry.expanded=false;
  }
  async function remove(entry:Row){
    if(entry.id!==null){
      const data=new FormData();data.set('taskId',String(taskId));data.set('prerequisiteId',String(entry.id));
      if(!await post(entry,'?/removeDependency',data))return;
    }
    rows=rows.filter(item=>item.key!==entry.key);feedback='Dependency removed.';
    await invalidateAll();await tick();document.getElementById(`add-dependency-${taskId}`)?.focus();
  }
  function keydown(event:KeyboardEvent,entry:Row){
    if(event.isComposing)return;
    const matches=options(entry);
    if(event.key==='Escape'){event.preventDefault();entry.expanded=false;entry.query=candidates.find(task=>task.id===entry.id)?.title??'';return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();entry.expanded=true;entry.active=matches.length?(entry.active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length:0;return;}
    if(event.key==='Enter'){event.preventDefault();if(entry.expanded&&matches[entry.active])void choose(entry,matches[entry.active]);}
  }
  function leave(event:FocusEvent,entry:Row){if(!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node|null)){entry.expanded=false;if(entry.id!==null)entry.query=candidates.find(task=>task.id===entry.id)?.title??'';}}
</script>

<section class="dependency-editor" aria-label="Dependencies">
  <h3>Dependencies</h3>
  {#each rows as entry (entry.key)}
    {@const matches=options(entry)}
    <div class="dependency-row">
      <div class="dependency-picker" onfocusout={(event)=>leave(event,entry)}>
        <label class="sr-only" for={inputId(entry)}>Prerequisite task</label>
        <input id={inputId(entry)} bind:value={entry.query} role="combobox" aria-label="Prerequisite task" aria-autocomplete="list" aria-expanded={entry.expanded} aria-controls={`${inputId(entry)}-options`} aria-activedescendant={entry.expanded&&matches[entry.active]?`${inputId(entry)}-option-${matches[entry.active].id}`:undefined} autocomplete="off" placeholder="Search tasks…" disabled={entry.busy} onfocus={(event)=>{entry.expanded=true;event.currentTarget.select();}} onclick={()=>entry.expanded=true} oninput={()=>{entry.expanded=true;entry.active=0;}} onkeydown={(event)=>keydown(event,entry)}>
        {#if entry.expanded}<div class="dependency-options" id={`${inputId(entry)}-options`} role="listbox" aria-label="Tasks">
          {#each matches as candidate,index (candidate.id)}<button type="button" id={`${inputId(entry)}-option-${candidate.id}`} role="option" aria-selected={entry.active===index} class:active={entry.active===index} onpointerenter={()=>entry.active=index} onmousedown={(event)=>event.preventDefault()} onclick={()=>choose(entry,candidate)}>{candidate.title}{#if candidate.state==='completed'}<small>Completed</small>{/if}</button>{:else}<p class="muted">No matching tasks.</p>{/each}
        </div>{/if}
      </div>
      <button type="button" class="secondary icon-button trash-button" disabled={entry.busy} aria-label={entry.id?`Remove dependency ${candidates.find(task=>task.id===entry.id)?.title??entry.query}`:'Remove empty dependency'} onclick={()=>remove(entry)}><TrashIcon /></button>
      {#if entry.error}<p class="danger dependency-error" role="alert">{entry.error}</p>{/if}
    </div>
  {/each}
  <button id={`add-dependency-${taskId}`} type="button" class="secondary add-dependency" onclick={addRow}>Add dependency</button>
  <span class="sr-only" role="status">{feedback}</span>
  {#if dependents.length}<div class="dependents"><h4>Required by</h4><ul>{#each dependents as dependent (dependent.task_id)}<li>{dependent.title}</li>{/each}</ul></div>{/if}
</section>

<style>
  .dependency-editor { display: grid; gap: .65rem; }
  h3, h4 { margin: 0; }
  h4 { font-size: .85rem; }
  .dependency-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: .4rem; }
  .dependency-picker { position: relative; min-width: 0; }
  .dependency-options { position: absolute; inset: calc(100% + .25rem) 0 auto; z-index: 6; max-height: 15rem; overflow-y: auto; border: 1px solid var(--muted); border-radius: 6px; background: var(--surface); }
  .dependency-options button { display: flex; justify-content: space-between; gap: .5rem; width: 100%; border: 0; border-radius: 0; padding: .55rem .75rem; text-align: left; color: var(--text); background: transparent; overflow-wrap: anywhere; }
  .dependency-options button:hover, .dependency-options button.active { background: var(--accent-fill); }
  .dependency-options p { margin: 0; padding: .75rem; }
  .dependency-error { grid-column: 1/-1; margin: 0; font-size: .85rem; }
  .add-dependency { justify-self: start; }
  .dependents { display: grid; gap: .25rem; color: var(--muted); }
  .dependents ul { margin: 0; padding-left: 1.25rem; }
</style>
