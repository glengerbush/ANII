<script lang="ts">
  let {plan}:{plan:any}=$props();
  function taskName(ref:number|string){return typeof ref==='number'?`${plan.existingTasks?.[ref]??'Task'} (#${ref})`:plan.tasks?.find((task:any)=>task.ref===ref)?.title??ref;}
</script>
<div class="ai-changes">
  <strong>Proposed changes</strong>
  {#each plan.tasks??[] as task (task.ref)}
    <div class="proposed-task"><span>New task</span><strong>{task.title}</strong>{#if task.details}<p>{task.details}</p>{/if}<small>{[task.duration,task.dueAt?`Due ${task.dueAt}`:'',task.projectId?`Project #${task.projectId}`:''].filter(Boolean).join(' · ')}</small></div>
  {/each}
  {#if plan.dependencies?.length}<p class="dependency-heading">Required dependencies</p><ul>{#each plan.dependencies as edge (`${edge.task}-${edge.prerequisite}`)}<li><strong>{taskName(edge.task)}</strong> depends on <strong>{taskName(edge.prerequisite)}</strong>.</li>{/each}</ul>{/if}
</div>
<style>
  .ai-changes { display: grid; gap: .75rem; overflow-wrap: anywhere; }
  .proposed-task { display: grid; gap: .25rem; }
  .proposed-task>span, small { font-size: .75rem; color: var(--muted); }
  p { margin: 0; }
  .dependency-heading { font-size: .85rem; font-weight: 600; }
  ul { margin: 0; padding-left: 1.1rem; display: grid; gap: .5rem; font-size: .85rem; }
</style>
