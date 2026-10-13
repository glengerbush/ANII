<script lang="ts">
  import {resolve} from '$app/paths';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import CompletedTasks from '$lib/components/CompletedTasks.svelte';
  let {data,form}=$props();
  let filtered=$derived(Boolean(data.filters.q||data.filters.project||data.filters.state||data.filters.due));
  let stateAction=$derived(`?/state&${new URLSearchParams({q:data.filters.q,project:String(data.filters.project??''),state:data.filters.state??'',due:data.filters.due?'1':''})}`);
  let todayAction=$derived(stateAction.replace('?/state&','?/plan&'));
</script>
<svelte:head><title>Backlog · ANII</title></svelte:head>
<section class="page wide backlog-page"><header class="page-header"><div><h1>Backlog</h1></div></header>
{#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
<details class="task-filters" open={filtered}><summary>Search and filters{filtered?' · applied':''}</summary><form method="GET" class="filters filter-panel"><label>Search<input type="search" name="q" value={data.filters.q} placeholder="Title or notes"></label><label>Project<select name="project"><option value="">All</option>{#each data.projects as project (project.id)}<option value={project.id} selected={project.id===data.filters.project}>{project.name}</option>{/each}</select></label><label>State<select name="state"><option value="">Unfinished</option><option value="blocked" selected={data.filters.state==='blocked'}>Blocked</option></select></label><label>Due<select name="due"><option value="">Any</option><option value="1" selected={data.filters.due}>Has due date</option></select></label><button>Apply filters</button><a class="button secondary" href={resolve('/backlog')}>Clear filters</a></form></details>
{#if data.tasks.length}<div class="task-list">{#each data.tasks as task (task.id)}<TaskCard {task} profileId={data.activeProfile.id} allTasks={data.allTasks} projects={data.projects} meta={data.taskMeta[task.id]} planningControls={false} date={data.calendarDate} planDate={data.date} {todayAction} inToday={data.plannedTaskIds.includes(task.id)} {stateAction} mode="list"/>{/each}</div>{:else}<div class="empty">{#if filtered}<p>No tasks match these filters.</p><a href={resolve('/backlog')}>Clear filters</a>{:else}<p>No unfinished tasks. Add a task below, then use Add to today to plan it.</p><a href="#backlog-title">Add your first task</a>{/if}</div>{/if}
<form method="POST" action="?/create" class="quick-add"><label for="backlog-title">Add to backlog</label><input id="backlog-title" name="title" required placeholder="New task"><button>Add</button></form>
<CompletedTasks profileId={data.activeProfile.id} planDate={data.date} tasks={data.completedTasks} allTasks={data.allTasks} projects={data.projects} taskMeta={data.taskMeta} {stateAction} initialOpen={data.showCompleted} />
</section>
