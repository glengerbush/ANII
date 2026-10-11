<script lang="ts">
  import { tick } from 'svelte';
  let {action='?/createProfile'}:{action?:string}=$props();
  let dialog:HTMLDialogElement;
  let trigger:HTMLButtonElement;
  let nameInput:HTMLInputElement;
  async function openDialog(){dialog.showModal();await tick();nameInput.focus();}
  function closeDialog(){dialog.close();}
  function dismissDialog(event:Event){event.preventDefault();if(dialog.open)dialog.close();}
  function dialogKeydown(event:KeyboardEvent){if(event.key==='Escape')dismissDialog(event);}
  function restoreFocus(){trigger.focus();}
</script>

<button bind:this={trigger} type="button" class="secondary" aria-haspopup="dialog" onclick={openDialog}>+ New Profile</button>
<dialog bind:this={dialog} class="confirm-dialog profile-dialog" aria-labelledby="new-profile-title" oncancel={dismissDialog} onkeydown={dialogKeydown} onclose={restoreFocus}>
  <form method="POST" {action} class="profile-dialog-form">
    <div class="confirm-dialog-body"><p class="eyebrow">Profiles</p><h2 id="new-profile-title">New profile</h2><label for="new-profile-name">Profile name<input bind:this={nameInput} id="new-profile-name" name="name" required maxlength="80" autocomplete="off"></label></div>
    <div class="confirm-dialog-actions"><button type="button" class="secondary" onclick={closeDialog}>Cancel</button><button>Create profile</button></div>
  </form>
  <button type="button" class="icon confirm-close" aria-label="Close new profile dialog" onclick={closeDialog}>×</button>
</dialog>
