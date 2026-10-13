<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';
  import PencilIcon from './PencilIcon.svelte';
  let {project,renameAction='?/rename',deleteAction='?/delete'}:{project:{id:number;name:string};renameAction?:string;deleteAction?:string}=$props();
  let editing=$state(false);
</script>

<details class="project-name-editor" bind:open={editing}>
  <summary aria-label={`Rename ${project.name}`} title={`Rename ${project.name}`}><PencilIcon /></summary>
  <div class="project-name-panel">
    <form method="POST" action={renameAction} class="project-rename-form">
      <input type="hidden" name="id" value={project.id}>
      <label for={`project-name-${project.id}`}>Project name<input id={`project-name-${project.id}`} name="name" value={project.name} required maxlength="120"></label>
      <div class="actions"><button type="button" class="secondary" onclick={()=>editing=false}>Cancel</button><button>Save name</button></div>
    </form>
    <ConfirmDialog action={deleteAction} id={project.id} dialogKey={`project-${project.id}`} label={`Delete ${project.name}`} description="Tasks remain in the backlog. This removes only the project label." />
  </div>
</details>

<style>
  .project-name-editor { flex: none; }
  summary {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: .5rem;
    border-radius: 6px;
    list-style: none;
    color: var(--muted);
    cursor: pointer;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover, summary:focus-visible, .project-name-editor[open] > summary {
    color: var(--accent);
    background: var(--accent-fill);
  }
  summary :global(svg) { width: 1rem; height: 1rem; }
  .project-name-panel {
    position: absolute;
    z-index: 5;
    inset-inline-start: 0;
    top: calc(100% + .5rem);
    width: min(28rem, 100%);
    display: grid;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid var(--muted);
    border-radius: 8px;
    background: var(--surface);
  }
  @media (pointer: coarse) {
    summary { width: 2.75rem; height: 2.75rem; }
  }
</style>
