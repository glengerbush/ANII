<script lang="ts">
  import { tick } from 'svelte';
  import TrashIcon from './TrashIcon.svelte';
  let {action,id,label,description,dialogKey=String(id),triggerText=''}:{action:string;id:number;label:string;description:string;dialogKey?:string;triggerText?:string}=$props();
  let dialog:HTMLDialogElement;
  let trigger:HTMLButtonElement;
  let cancel:HTMLButtonElement;
  let titleId=$derived(`confirm-title-${dialogKey}`);
  let descriptionId=$derived(`confirm-description-${dialogKey}`);
  async function openDialog(){dialog.showModal();await tick();cancel.focus();}
  function closeDialog(){dialog.close();}
  function restoreFocus(){trigger.focus();}
</script>

<button bind:this={trigger} type="button" class={`delete-trigger ${triggerText?'confirm-danger':'secondary icon-button'}`} aria-label={label} title={label} aria-haspopup="dialog" onclick={openDialog}><TrashIcon />{#if triggerText}<span>{triggerText}</span>{/if}</button>
<dialog bind:this={dialog} class="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onclose={restoreFocus}>
  <div class="confirm-dialog-body"><p class="eyebrow">Confirm deletion</p><h2 id={titleId}>{label}?</h2><p id={descriptionId}>{description}</p></div>
  <div class="confirm-dialog-actions"><form method="dialog"><button bind:this={cancel} class="secondary">Cancel</button></form><form method="POST" {action}><input type="hidden" name="id" value={id}><button class="confirm-danger">Delete</button></form></div>
  <button type="button" class="icon confirm-close" aria-label="Cancel deletion" onclick={closeDialog}>×</button>
</dialog>
<noscript><details class="project-delete-fallback"><summary>{label}</summary><p>{description}</p><form method="POST" {action}><input type="hidden" name="id" value={id}><button class="confirm-danger">Confirm delete</button></form></details></noscript>
