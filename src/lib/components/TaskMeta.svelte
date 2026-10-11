<script lang="ts">
  import { projectTone, taskProjects, taskStatus } from '$lib/presentation/task';
  let {task,date}:{task:any;date?:string}=$props();
  let projects=$derived(taskProjects(task));
  let status=$derived(taskStatus(task,date));
</script>

<div class="indicators task-meta">
  {#each projects.visible as project (project.id)}<span class={`pill project-pill tone-${projectTone(project.id)}`}>{project.name}</span>{/each}
  {#if projects.hidden.length}<span class="pill project-overflow" aria-label={`${projects.hidden.length} more projects: ${projects.hidden.map((project)=>project.name).join(', ')}`} title={projects.hidden.map((project)=>project.name).join(', ')}>+{projects.hidden.length}</span>{/if}
  <span class={`status-chip status-${status.key}`}>{status.label}</span>
  {#if task.duration_bucket}<span class="duration-chip">{task.duration_bucket}</span>{/if}
</div>
