<script lang="ts">
  import { resolve } from '$app/paths';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import ProjectEditor from '$lib/components/ProjectEditor.svelte';
  import { durationEstimateLabel, projectTone } from '$lib/presentation/task';
  let {data,form}=$props();
  let active=$derived(data.tasks.filter((task:any)=>task.state==='open'||task.state==='waiting'));
  let closed=$derived(data.tasks.filter((task:any)=>task.state==='completed'));
</script>
<svelte:head><title>{data.project.name} · Projects · ANII</title></svelte:head>
<section class={`page wide project-detail project-accent-${projectTone(data.project.id)}`}>
  <header class="page-header"><div><p class="eyebrow"><a href={resolve('/projects')}>Projects</a></p><h1>{data.project.name}</h1></div><ProjectEditor project={data.project} /></header>
  {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
  <dl class="project-detail-stats"><div><dt>Active</dt><dd>{data.project.active_count}</dd></div><div><dt>Remaining estimate</dt><dd>{durationEstimateLabel(data.project.remaining_minutes,Boolean(data.project.remaining_open_ended))}</dd></div><div><dt>Waiting</dt><dd>{data.project.waiting_count}</dd></div><div><dt>Completed</dt><dd>{data.project.completed_count}</dd></div>{#if data.project.unestimated_count}<div><dt>Unestimated</dt><dd>{data.project.unestimated_count}</dd></div>{/if}</dl>
  <div class="section-title"><h2>Tasks</h2><span>{active.length}</span></div>
  {#if active.length}<div class="task-list">{#each active as task (task.id)}<TaskCard {task} allTasks={data.allTasks} projects={data.projects} meta={data.taskMeta[task.id]} planningControls={false}/>{/each}</div>{:else}<p class="empty">No open tasks carry this project label.</p>{/if}
  {#if closed.length}<details class="closed-tasks"><summary>Completed ({closed.length})</summary><div class="task-list">{#each closed as task (task.id)}<TaskCard {task} allTasks={data.allTasks} projects={data.projects} meta={data.taskMeta[task.id]} planningControls={false}/>{/each}</div></details>{/if}
  <form method="POST" action="?/create" class="quick-add"><label for="project-task-title">Add to {data.project.name}</label><input id="project-task-title" name="title" required placeholder="New task"><button>Add task</button></form>
</section>
