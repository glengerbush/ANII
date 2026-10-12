<script lang="ts">
  import { resolve } from '$app/paths';
  import ProjectEditor from '$lib/components/ProjectEditor.svelte';
  import { durationEstimateLabel, projectTone } from '$lib/presentation/task';
  let {data,form}=$props();
</script>
<svelte:head><title>Projects · ANII</title></svelte:head>
<section class="page wide">
  <header class="page-header"><div><p class="eyebrow">Labels that gather related tasks</p><h1>Projects</h1></div></header>
  {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
  {#if data.projects.length}<div class="card-grid">{#each data.projects as project (project.id)}<article class={`project-card project-accent-${projectTone(project.id)}`}><a class="project-card-link" href={resolve(`/projects/${project.id}`)}><h2>{project.name}</h2><dl class="project-stats"><div><dt>Active</dt><dd>{project.active_count}</dd></div><div><dt>Remaining estimate</dt><dd>{durationEstimateLabel(project.remaining_minutes,Boolean(project.remaining_open_ended))}</dd></div><div><dt>Needs attention</dt><dd>{project.needs_attention_count}</dd></div></dl>{#if project.next_task}<p class="project-next"><span>Next</span>{project.next_task}</p>{/if}</a><ProjectEditor {project} /></article>{/each}</div>{:else}<p class="empty">No projects yet.</p>{/if}
  <form method="POST" action="?/create" class="quick-add"><label for="project-name">New project</label><input id="project-name" name="name" required placeholder="Project name"><button>Create</button></form>
</section>
