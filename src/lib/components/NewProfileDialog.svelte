<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { tick } from 'svelte';
  let {action='?/createProfile'}:{action?:string}=$props();
  let dialog:HTMLDialogElement;
  let trigger:HTMLButtonElement;
  let nameInput:HTMLInputElement;
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
  async function openDialog(){dialog.showModal();await tick();nameInput.focus();}
  function closeDialog(){if(!busy)dialog.close();}
  function dismissDialog(event:Event){event.preventDefault();if(!busy&&dialog.open)dialog.close();}
  function dialogKeydown(event:KeyboardEvent){if(event.key==='Escape')dismissDialog(event);}
  function restoreFocus(){trigger.focus();}
</script>

<button bind:this={trigger} type="button" class="secondary" aria-haspopup="dialog" onclick={openDialog}>+ New Profile</button>
<dialog bind:this={dialog} class="confirm-dialog profile-dialog" aria-labelledby="new-profile-title" oncancel={dismissDialog} onkeydown={dialogKeydown} onclose={restoreFocus}>
  <form method="POST" use:enhance={submit} aria-busy={busy} {action} class="profile-dialog-form">
    <div class="confirm-dialog-body"><p class="eyebrow">Profiles</p><h2 id="new-profile-title">New profile</h2><label for="new-profile-name">Profile name<input bind:this={nameInput} id="new-profile-name" name="name" required maxlength="80" autocomplete="off"></label></div>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    <div class="confirm-dialog-actions"><button type="button" class="secondary" disabled={busy} onclick={closeDialog}>Cancel</button><button disabled={busy}>{busy?'Creating…':'Create profile'}</button></div>
  </form>
  <button type="button" class="icon confirm-close" aria-label="Close new profile dialog" onclick={closeDialog}>×</button>
</dialog>
