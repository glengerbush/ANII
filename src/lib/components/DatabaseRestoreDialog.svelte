<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import {tick} from 'svelte';
  let {format='sqlite'}:{format?:'sqlite'|'json'}=$props();
  let label=$derived(format==='json'?'JSON export':'SQLite backup');
  let titleId=$derived(`restore-${format}-title`);
  let dialog:HTMLDialogElement;let trigger:HTMLButtonElement;let fileInput:HTMLInputElement;
  let busy=$state(false);
  let error=$state('');
  const submit:SubmitFunction=({cancel})=>{
    if(busy){cancel();return;}
    busy=true;error='';
    return async({result,update})=>{
      try{
        if(result.type!=='success'){
          error=result.type==='failure'?String(result.data?.error??'Check your entries and try again.'):'Could not confirm the change. Reload to check before trying again.';
          return;
        }
        await update();
        dialog.close();
      }catch{
        error='Could not refresh the page after saving. Reload to check before trying again.';
      }finally{busy=false;}
    };
  };
  async function openDialog(){dialog.showModal();await tick();fileInput.focus();}
  function closeDialog(){if(!busy)dialog.close();}
  function dismissDialog(event:Event){event.preventDefault();if(!busy&&dialog.open)dialog.close();}
  function dialogKeydown(event:KeyboardEvent){if(event.key==='Escape')dismissDialog(event);}
  function restoreFocus(){trigger.focus();}
</script>

<button bind:this={trigger} type="button" class="secondary" aria-haspopup="dialog" onclick={openDialog}>Restore {label}…</button>
<dialog bind:this={dialog} class="confirm-dialog database-restore-dialog" aria-labelledby={titleId} oncancel={dismissDialog} onkeydown={dialogKeydown} onclose={restoreFocus}>
  <form method="POST" use:enhance={submit} aria-busy={busy} action={format==='json'?'?/import':'?/restoreDatabase'} enctype="multipart/form-data" class="database-restore-form">
    <div class="confirm-dialog-body"><h2 id={titleId}>Restore {label}</h2><p>Current data will be backed up, then replaced with this ANII backup. Maximum file size: 10 MB.</p><label>ANII {label}<input bind:this={fileInput} type="file" name="file" accept={format==='json'?'.json,application/json':'.db,application/vnd.sqlite3,application/octet-stream'} required></label><label>Type RESTORE to confirm<input name="confirmation" required pattern="RESTORE" autocomplete="off"></label></div>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    <div class="confirm-dialog-actions"><button type="button" class="secondary" disabled={busy} onclick={closeDialog}>Cancel</button><button class="confirm-danger" disabled={busy}>{busy?'Restoring…':'Back up and restore database'}</button></div>
  </form>
  <button type="button" class="icon confirm-close" aria-label={`Close ${label} restore dialog`} onclick={closeDialog}>×</button>
</dialog>
