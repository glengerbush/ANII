<script lang="ts">
  import {resolve} from '$app/paths';
  import TaskOrderList from '$lib/components/TaskOrderList.svelte';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import CompletedTasks from '$lib/components/CompletedTasks.svelte';
  let {data,form}=$props();
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
<div class="task-filters"><form method="GET" class="filters filter-panel"><label>Search<input type="search" name="q" value={data.filters.q} placeholder="Title or notes"></label><label>Project<select name="project"><option value="">All</option>{#each data.projects as project (project.id)}<option value={project.id} selected={project.id===data.filters.project}>{project.name}</option>{/each}</select></label><label>State<select name="state"><option value="">Unfinished</option><option value="blocked" selected={data.filters.state==='blocked'}>Blocked</option></select></label><label>Due<select name="due"><option value="">Any</option><option value="1" selected={data.filters.due}>Has due date</option></select></label><button>Apply filters</button><a class="button secondary" href={resolve('/backlog')}>Clear filters</a></form></div>
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
{:else}<div class="empty">{#if filtered}<p>No tasks match these filters.</p><a href={resolve('/backlog')}>Clear filters</a>{:else}<p>No unfinished tasks. Add a task below, then use Queue up to plan it.</p><a href="#backlog-title">Add your first task</a>{/if}</div>{/if}
<form method="POST" action="?/create" class="quick-add"><label for="backlog-title">Add to backlog</label><input id="backlog-title" name="title" required placeholder="New task"><button>Add</button></form>
<CompletedTasks profileId={data.activeProfile.id} planDate={data.date} tasks={data.completedTasks} allTasks={data.allTasks} projects={data.projects} profiles={data.profiles} taskMeta={data.taskMeta} {stateAction} initialOpen={data.showCompleted} />
</section>

<style>
  .backlog-group { margin-block: 1.25rem; }
  .backlog-group h2 { display: flex; gap: .6rem; align-items: baseline; margin: 0 0 .5rem; font-size: .85rem; }
  .backlog-group h2 span { color: var(--muted); font-size: .75rem; font-weight: 400; }
  .group-empty { color: var(--muted); font-size: .8rem; margin: .5rem 0; }
</style>
