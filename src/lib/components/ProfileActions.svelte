<script lang="ts">
  import { tick } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';

  let { profile, canDelete, oncomplete }: {
    profile: { id: number; name: string };
    canDelete: boolean;
    oncomplete: (message: string) => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let nameInput = $state<HTMLInputElement>();
  let cancelButton: HTMLButtonElement;
  let trigger: HTMLButtonElement | undefined;
  let mode = $state<'rename' | 'delete'>('rename');
  let name = $state('');
  let confirmation = $state('');
  let busy = $state(false);
  let error = $state('');
  const titleId = $derived(`profile-action-${profile.id}`);
  async function open(event: MouseEvent, action: 'rename' | 'delete') {
    trigger = event.currentTarget as HTMLButtonElement;
    mode = action; name = profile.name; confirmation = ''; error = '';
    dialog.showModal();
    await tick();
    if (action === 'rename') { nameInput?.focus(); nameInput?.select(); }
    else cancelButton.focus();
  }
  function restoreFocus() {
    if (trigger?.isConnected) trigger.focus();
    else document.getElementById('profiles-title')?.focus();
  }
  const submit: SubmitFunction = ({ cancel }) => {
    if (busy) { cancel(); return; }
    busy = true; error = '';
    return async ({ result, update }) => {
      try {
        if (result.type !== 'success') {
          error = result.type === 'failure' ? String(result.data?.error ?? 'Could not update the profile.') : 'Could not confirm the change. Reload to check the profile before trying again.';
          return;
        }
        const message = mode === 'rename' ? 'Profile renamed.' : 'Profile deleted.';
        dialog.close();
        await update({ reset: false });
        await tick();
        restoreFocus();
        oncomplete(message);
      } catch {
        error = 'Could not confirm the change. Reload to check the profile before trying again.';
      } finally { busy = false; }
    };
  };
</script>

<div class="profile-controls">
  <button type="button" class="secondary" aria-label={`Rename ${profile.name}`} aria-haspopup="dialog" onclick={event => open(event, 'rename')}>Rename</button>
  <button type="button" class="secondary" aria-label={`Delete ${profile.name}`} aria-haspopup="dialog" disabled={!canDelete} aria-describedby={!canDelete ? `last-profile-${profile.id}` : undefined} onclick={event => open(event, 'delete')}>Delete</button>
  {#if !canDelete}<small id={`last-profile-${profile.id}`} class="muted">Keep at least one profile.</small>{/if}
</div>
<dialog bind:this={dialog} class="confirm-dialog" aria-labelledby={titleId} onclose={restoreFocus} oncancel={event => { if (busy) event.preventDefault(); }}>
  <form method="POST" action={mode === 'rename' ? '?/renameProfile' : '?/deleteProfile'} use:enhance={submit} aria-busy={busy}>
    <input type="hidden" name="profileId" value={profile.id}>
    <div class="confirm-dialog-body">
      <h2 id={titleId}>{mode === 'rename' ? 'Rename profile' : `Delete ${profile.name}?`}</h2>
      {#if mode === 'rename'}
        <label>Profile name<input bind:this={nameInput} name="name" bind:value={name} required maxlength="80" autocomplete="off" disabled={busy}></label>
      {:else}
        <p>This permanently removes this profile’s queue, Focus selections, and assigned schedules. Shared tasks and projects stay available.</p>
        <p class="muted">If this is your active profile, you’ll switch to a remaining profile. Recovery requires restoring a backup.</p>
        <label>Type “{profile.name}” to confirm<input name="confirmation" bind:value={confirmation} required autocomplete="off" disabled={busy}></label>
      {/if}
      {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    </div>
    <div class="confirm-dialog-actions">
      <button bind:this={cancelButton} type="button" class="secondary" disabled={busy} onclick={() => dialog.close()}>Cancel</button>
      <button class:confirm-danger={mode === 'delete'} disabled={busy || (mode === 'rename' ? !name.trim() || name.trim() === profile.name : !canDelete || confirmation !== profile.name)}>{busy ? 'Saving…' : mode === 'rename' ? 'Save name' : 'Delete profile'}</button>
    </div>
  </form>
</dialog>
<noscript>
  <details><summary>Manage {profile.name}</summary>
    <form method="POST" action="?/renameProfile"><input type="hidden" name="profileId" value={profile.id}><label>Profile name<input name="name" value={profile.name} required maxlength="80"></label><button>Save name</button></form>
    {#if canDelete}<form method="POST" action="?/deleteProfile"><input type="hidden" name="profileId" value={profile.id}><p>Deletes this profile’s queue and assigned schedules. Shared tasks and projects are kept. Recovery requires a backup.</p><label>Type “{profile.name}” to confirm<input name="confirmation" required autocomplete="off"></label><button class="confirm-danger">Delete profile</button></form>{/if}
  </details>
</noscript>

<style>
  .profile-controls { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
  .profile-controls small { flex-basis: 100%; }
  h2, label { overflow-wrap: anywhere; }
  .confirm-dialog-body { display: grid; gap: .8rem; }
  .confirm-dialog-body p { margin: 0; }
</style>
