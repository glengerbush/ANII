<script lang="ts">
  import {afterNavigate, beforeNavigate, goto} from '$app/navigation';
  import {onDestroy, untrack} from 'svelte';
  import {getTaskSaves} from '$lib/task-save-context';
  import TaskOrderList from '$lib/components/TaskOrderList.svelte';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import CompletedTasks from '$lib/components/CompletedTasks.svelte';
  let {data,form}=$props();
  type Filters={q:string;project:string;state:string;due:string};
  function serverFilters():Filters{return {q:data.filters.q,project:String(data.filters.project??''),state:data.filters.state??'',due:data.filters.due?'1':''};}
  let filters=$state<Filters>(untrack(serverFilters));
  let filtering=$state(false);
  let filterError=$state('');
  const taskSaves=getTaskSaves();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let revision=0,epoch=0;
  let requestedUrl:string|undefined;
  function cancelPending(){clearTimeout(timer);timer=undefined;epoch++;}
  beforeNavigate(navigation=>{
    if(navigation.type!=='goto'||navigation.to?.url.href!==requestedUrl)cancelPending();
  });
  afterNavigate(navigation=>{
    if(navigation.to?.url.href!==requestedUrl){filters=serverFilters();filterError='';}
  });
  onDestroy(cancelPending);
  function changeFilters(delayed=false){
    revision++;filterError='';clearTimeout(timer);timer=undefined;
    if(delayed)timer=setTimeout(()=>{timer=undefined;void applyFilters();},250);
    else void applyFilters();
  }
  async function applyFilters(){
    if(filtering)return;
    const currentEpoch=epoch;filtering=true;
    try{
      let applied=-1;
      while(applied!==revision&&currentEpoch===epoch){
        const currentRevision=revision;
        if(!await taskSaves.flush()){filterError='Save your task edits before changing filters.';return;}
        if(currentEpoch!==epoch)return;
        if(currentRevision!==revision)continue;
        const url=new URL(window.location.href);
        for(const key of ['q','project','state','due'] as const){if(filters[key])url.searchParams.set(key,filters[key]);else url.searchParams.delete(key);}
        requestedUrl=url.href;
        // This URL comes from location and already includes the configured base path.
        await goto(url,{replaceState:true,keepFocus:true,noScroll:true});
        applied=currentRevision;
      }
    }catch{filterError='Could not update filters. Try changing the filter again.';}
    finally{filtering=false;requestedUrl=undefined;}
  }
  function clearFilter(key:keyof Filters){filters[key]='';changeFilters();document.getElementById(`filter-${key}`)?.focus();}

  let filtered=$derived(Boolean(data.filters.q||data.filters.project||data.filters.state||data.filters.due));
  let stateAction=$derived(`?/state&${new URLSearchParams({q:data.filters.q,project:String(data.filters.project??''),state:data.filters.state??'',due:data.filters.due?'1':''})}`);
  let nowAction=$derived(stateAction.replace('?/state&','?/plan&'));

  type Group='queued'|'unqueued';
  const groups:Group[]=['queued','unqueued'];
  let queued=$derived(data.tasks.filter((task:any)=>task.queued));
  let unqueued=$derived(data.tasks.filter((task:any)=>!task.queued));
  function groupTasks(group:Group){return group==='queued'?queued:unqueued;}
  function groupLabel(group:Group){return group==='queued'?'Queued up':'Not queued';}
</script>
<svelte:head><title>Backlog · ANII</title></svelte:head>
<section class="page wide backlog-page"><header class="page-header"><div><h1>Backlog</h1></div></header>
{#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
<div class="task-filters">
  <form method="GET" class="backlog-filters" onsubmit={(event)=>{event.preventDefault();changeFilters();}} aria-busy={filtering}>
    <div class="filter-field filter-search">
      <div class="filter-heading"><label for="filter-q">Search</label>{#if filters.q}<button type="button" class="clear-filter" aria-label="Clear search" title="Clear search" onclick={()=>clearFilter('q')}>×</button>{/if}</div>
      <input id="filter-q" type="search" name="q" bind:value={filters.q} oninput={()=>changeFilters(true)} placeholder="Title or notes">
    </div>
    <div class="filter-field">
      <div class="filter-heading"><label for="filter-project">Project</label>{#if filters.project}<button type="button" class="clear-filter" aria-label="Clear project filter" title="Clear project filter" onclick={()=>clearFilter('project')}>×</button>{/if}</div>
      <select id="filter-project" name="project" bind:value={filters.project} onchange={()=>changeFilters()}><option value="">All</option><option value="none">None</option>{#each data.projects as project (project.id)}<option value={String(project.id)}>{project.name}</option>{/each}</select>
    </div>
    <div class="filter-field">
      <div class="filter-heading"><label for="filter-state">State</label>{#if filters.state}<button type="button" class="clear-filter" aria-label="Clear state filter" title="Clear state filter" onclick={()=>clearFilter('state')}>×</button>{/if}</div>
      <select id="filter-state" name="state" bind:value={filters.state} onchange={()=>changeFilters()}><option value="">Unfinished</option><option value="blocked">Blocked</option></select>
    </div>
    <div class="filter-field">
      <div class="filter-heading"><label for="filter-due">Due</label>{#if filters.due}<button type="button" class="clear-filter" aria-label="Clear due filter" title="Clear due filter" onclick={()=>clearFilter('due')}>×</button>{/if}</div>
      <select id="filter-due" name="due" bind:value={filters.due} onchange={()=>changeFilters()}><option value="">Any</option><option value="1">Has due date</option></select>
    </div>
  </form>
  {#if filterError}<p class="notice error" role="alert">{filterError}</p>{/if}
  <span class="sr-only" role="status">{filtering?'Updating tasks…':''}</span>
</div>
{#if data.tasks.length}
  {#each groups as group (group)}
    <section class="backlog-group" aria-labelledby={`backlog-${group}`}>
      <h2 id={`backlog-${group}`}>{groupLabel(group)} <span>{groupTasks(group).length}</span></h2>
      <div data-backlog-group={group}>
        {#if groupTasks(group).length}
          <TaskOrderList tasks={groupTasks(group)} listId={`backlog-${group}`} label={groupLabel(group)} fields={{profileId:String(data.activeProfile.id),planDate:data.date,group}}>
            {#snippet children(task,drag)}<TaskCard {task} {drag} profileId={data.activeProfile.id} allTasks={data.allTasks} projects={data.projects} profiles={data.profiles} meta={data.taskMeta[task.id]} planningControls={false} date={data.calendarDate} planDate={data.date} {nowAction} inNow={group==='queued'} {stateAction} mode="list"/>{/snippet}
          </TaskOrderList>
        {:else}<p class="group-empty">{filtered?'No matching tasks in this group.':group==='queued'?'Queue up a task to add it to Now.':'All unfinished tasks are queued up.'}</p>{/if}
      </div>
    </section>
  {/each}
{:else}<div class="empty">{#if filtered}<p>No tasks match these filters.</p><p>Clear a filter above to see more tasks.</p>{:else}<p>No unfinished tasks. Add a task below, then use Queue up to plan it.</p><a href="#backlog-title">Add your first task</a>{/if}</div>{/if}
<form method="POST" action="?/create" class="quick-add"><label for="backlog-title">Add to backlog</label><input id="backlog-title" name="title" required placeholder="New task"><button>Add</button></form>
<CompletedTasks profileId={data.activeProfile.id} planDate={data.date} tasks={data.completedTasks} allTasks={data.allTasks} projects={data.projects} profiles={data.profiles} taskMeta={data.taskMeta} {stateAction} initialOpen={data.showCompleted} />
</section>

<style>
  .backlog-filters { display: grid; grid-template-columns: minmax(0,2fr) repeat(3,minmax(0,1fr)); gap: .75rem; padding: 1rem; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .filter-field { min-width: 0; display: grid; gap: .3rem; }
  .filter-heading { min-height: 1.75rem; display: flex; align-items: center; justify-content: space-between; gap: .25rem; }
  .filter-field input, .filter-field select { width: 100%; min-width: 0; }
  .clear-filter { flex: none; width: 1.75rem; min-height: 1.75rem; padding: 0; border-color: transparent; background: transparent; color: var(--muted); font-size: 1.15rem; line-height: 1; }
  .clear-filter:hover { color: var(--accent); background: var(--accent-fill); }
  @media (max-width: 48rem) {
    .backlog-filters { grid-template-columns: repeat(2,minmax(0,1fr)); padding: .75rem; }
    .filter-search { grid-column: 1/-1; }
  }

  .backlog-group { margin-block: 1.25rem; }
  .backlog-group h2 { display: flex; gap: .6rem; align-items: baseline; margin: 0 0 .5rem; font-size: .85rem; }
  .backlog-group h2 span { color: var(--muted); font-size: .75rem; font-weight: 400; }
  .group-empty { color: var(--muted); font-size: .8rem; margin: .5rem 0; }
</style>
