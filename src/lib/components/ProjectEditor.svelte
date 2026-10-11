<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';
  import PencilIcon from './PencilIcon.svelte';
  let {project,renameAction='?/rename',deleteAction='?/delete'}:{project:{id:number;name:string};renameAction?:string;deleteAction?:string}=$props();
  let editing=$state(false);
</script>

<details class="project-editor" bind:open={editing}>
  <summary class="secondary icon-button project-edit" aria-label={`Rename ${project.name}`} title={`Rename ${project.name}`}><PencilIcon /></summary>
  <div class="project-editor-panel">
    <form method="POST" action={renameAction} class="project-rename-form">
      <input type="hidden" name="id" value={project.id}>
      <label for={`project-name-${project.id}`}>Project name<input id={`project-name-${project.id}`} name="name" value={project.name} required maxlength="120"></label>
      <div class="actions"><button type="button" class="secondary" onclick={()=>editing=false}>Cancel</button><button>Save name</button></div>
    </form>
    <ConfirmDialog action={deleteAction} id={project.id} dialogKey={`project-${project.id}`} label={`Delete ${project.name}`} description="Tasks remain in the backlog. This removes only the project label." />
  </div>
</details>
