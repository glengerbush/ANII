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
  {#if data.projects.length}
    <div class="card-grid">
      {#each data.projects as project (project.id)}
        <article class={`project-card project-accent-${projectTone(project.id)}`}>
          <a class="project-card-link" href={resolve(`/projects/${project.id}`)} aria-labelledby={`project-title-${project.id}`}></a>
          <div class="project-card-heading">
            <h2 id={`project-title-${project.id}`}>{project.name}</h2>
            <ProjectEditor {project} />
          </div>
          <dl class="project-stats">
            <div><dt>Tasks</dt><dd>{project.open_count}</dd></div>
            <div><dt>Remaining time</dt><dd>{durationEstimateLabel(project.remaining_minutes,Boolean(project.remaining_open_ended))}</dd></div>
          </dl>
          {#if project.next_task}<p class="project-next"><span>Next</span>{project.next_task}</p>{/if}
        </article>
      {/each}
    </div>
  {:else}<p class="empty">No projects yet.</p>{/if}
  <form method="POST" action="?/create" class="quick-add"><label for="project-name">New project</label><input id="project-name" name="name" required placeholder="Project name"><button>Create</button></form>
</section>

<style>
  .project-card { position: relative; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .project-card-heading { position: relative; display: flex; align-items: center; gap: .25rem; min-width: 0; }
  .project-card-link { position: absolute; inset: 0; z-index: 1; border-radius: 8px; }
  .project-card-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .project-card:has(.project-card-link:hover), .project-card:has(.project-card-link:focus-visible) { background: var(--accent-fill); box-shadow: 0 3px 10px rgb(0 0 0 / .08); }
  .project-card-link { cursor: pointer; }
  .project-card-heading :global(.project-name-editor > summary) { position: relative; z-index: 2; }
  .project-card h2 { min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .project-stats { grid-template-columns: minmax(0, 1fr); gap: .5rem; }
  .project-stats > div { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
  .project-stats dt { font-size: .88rem; font-weight: 400; letter-spacing: normal; text-transform: none; }
  .project-stats dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .project-next { margin: 0; overflow-wrap: anywhere; }
</style>
