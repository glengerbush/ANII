<script lang="ts">
  import TaskCard from './TaskCard.svelte';
  import type { TaskView } from '$lib/server/repository';
  let {tasks,allTasks=[],projects=[],taskMeta={},stateAction='?/state',initialOpen=false}:{tasks:TaskView[];allTasks?:TaskView[];projects?:any[];taskMeta?:Record<number,any>;stateAction?:string;initialOpen?:boolean}=$props();
  let expanded=$derived(initialOpen);
</script>

{#if tasks.length}
  <details class="completed-tasks" bind:open={expanded}>
    <summary>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      <span class="show-label">Show {tasks.length} completed {tasks.length===1?'task':'tasks'}</span>
      <span class="hide-label">Hide completed tasks</span>
    </summary>
    <div class="completed-list">
      {#each tasks as task (task.id)}
        <TaskCard {task} {allTasks} {projects} meta={taskMeta[task.id]} planningControls={false} stateAction={`${stateAction}&showCompleted=1`} />
      {/each}
    </div>
  </details>
{/if}

<style>
  .completed-tasks { margin-top: 1.5rem; }
  summary { display: flex; align-items: center; gap: .5rem; min-height: 2.75rem; width: fit-content; max-width: 100%; color: var(--muted); font-size: .875rem; font-weight: 400; list-style: none; cursor: pointer; }
  summary::-webkit-details-marker { display: none; }
  summary:hover { color: var(--text); }
  summary svg { flex: none; }
  .hide-label { display: none; }
  details[open] > summary .show-label { display: none; }
  details[open] > summary .hide-label { display: inline; }
  details[open] > summary svg { transform: rotate(90deg); }
  .completed-list { margin-top: .5rem; }
  .completed-list :global(.task-card) { border: 0; border-radius: 0; background: transparent; }
  .completed-list :global(.task-card + .task-card) { border-top: 1px solid var(--border); }
  .completed-list :global(.task-title) { color: var(--muted); }
  .completed-list :global(.task-title:hover) { color: var(--text); }
  .completed-list :global(.status-completed) { display: none; }
</style>
