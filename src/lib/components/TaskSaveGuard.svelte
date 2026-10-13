<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { TaskSaveGroup } from '$lib/task-autosave';

  let { saves }: { saves: TaskSaveGroup } = $props();
  let resuming = false;
  beforeNavigate((navigation) => {
    if (!saves.pending) return;
    navigation.cancel();
    // Refresh/tab close cannot await a request. The synchronous recovery draft is the fallback.
    if (navigation.type === 'leave') { void saves.flush(); return; }
    if (resuming) return;
    resuming = true;
    void saves.flush().then(async (saved) => {
      if (!saved || !navigation.to) return;
      if (navigation.type === 'popstate') window.history.go(navigation.delta);
      else if (navigation.willUnload) window.location.assign(navigation.to.url.href);
      // This URL comes from the router and already includes any configured base path.
      else await goto(navigation.to.url, { invalidateAll: true });
    }).finally(() => { resuming = false; });
  });

  onMount(() => {
    const replaying = new WeakSet<HTMLFormElement>();
    let submitting = false;
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.hasAttribute('data-task-autosave') || replaying.has(form) || !saves.pending) return;
      // Native task actions also unload the editor (complete, move, profile switch, etc.).
      event.preventDefault();event.stopImmediatePropagation();
      if (submitting) return;
      submitting = true;
      const submitter = event.submitter;
      void saves.flush().then((saved) => {
        if (!saved || !form.isConnected) return;
        replaying.add(form);
        try { form.requestSubmit(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : undefined); }
        finally { replaying.delete(form); }
      }).finally(() => { submitting = false; });
    };
    document.addEventListener('submit', submit, true);
    return () => document.removeEventListener('submit', submit, true);
  });
</script>
