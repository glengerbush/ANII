<script lang="ts">
  import {tick} from 'svelte';
  let {format='sqlite'}:{format?:'sqlite'|'json'}=$props();
  let label=$derived(format==='json'?'JSON export':'SQLite backup');
  let titleId=$derived(`restore-${format}-title`);
  let dialog:HTMLDialogElement;let trigger:HTMLButtonElement;let fileInput:HTMLInputElement;
  async function openDialog(){dialog.showModal();await tick();fileInput.focus();}
  function closeDialog(){dialog.close();}
  function dismissDialog(event:Event){event.preventDefault();if(dialog.open)dialog.close();}
  function dialogKeydown(event:KeyboardEvent){if(event.key==='Escape')dismissDialog(event);}
  function restoreFocus(){trigger.focus();}
</script>

<button bind:this={trigger} type="button" class="secondary" aria-haspopup="dialog" onclick={openDialog}>Restore {label}…</button>
<dialog bind:this={dialog} class="confirm-dialog database-restore-dialog" aria-labelledby={titleId} oncancel={dismissDialog} onkeydown={dialogKeydown} onclose={restoreFocus}>
  <form method="POST" action={format==='json'?'?/import':'?/restoreDatabase'} enctype="multipart/form-data" class="database-restore-form">
    <div class="confirm-dialog-body"><h2 id={titleId}>Restore {label}</h2><p>Current data will be backed up, then replaced with this Life backup. Maximum file size: 10 MB.</p><label>Life {label}<input bind:this={fileInput} type="file" name="file" accept={format==='json'?'.json,application/json':'.db,application/vnd.sqlite3,application/octet-stream'} required></label><label>Type RESTORE to confirm<input name="confirmation" required pattern="RESTORE" autocomplete="off"></label></div>
    <div class="confirm-dialog-actions"><button type="button" class="secondary" onclick={closeDialog}>Cancel</button><button class="confirm-danger">Back up and restore database</button></div>
  </form>
  <button type="button" class="icon confirm-close" aria-label={`Close ${label} restore dialog`} onclick={closeDialog}>×</button>
</dialog>
