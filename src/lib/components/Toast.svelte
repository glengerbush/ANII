<script lang="ts">
  import { fade } from 'svelte/transition';
  import { MediaQuery } from 'svelte/reactivity';

  let { kind, message, ondismiss }: {
    kind: 'success' | 'error';
    message: string;
    ondismiss: () => void;
  } = $props();
  const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
  let hovered = $state(false);
  let focused = $state(false);

  $effect(() => {
    if (kind !== 'success' || hovered || focused) return;
    const timer = setTimeout(ondismiss, 5000);
    return () => clearTimeout(timer);
  });
</script>

<div class="toast-position">
  <div
    class="toast"
    role="group"
    aria-label="Notification"
    class:error={kind === 'error'}
    out:fade={{ duration: reducedMotion.current ? 0 : 180 }}
    onpointerenter={() => hovered = true}
    onpointerleave={() => hovered = false}
    onfocusin={() => focused = true}
    onfocusout={() => focused = false}
  >
    <svg class="toast-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {#if kind === 'success'}
        <path d="m5 12 4 4L19 6" />
      {:else}
        <circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" />
      {/if}
    </svg>
    <p role={kind === 'error' ? 'alert' : 'status'} aria-atomic="true">{message}</p>
    <button type="button" class="secondary toast-dismiss" aria-label="Dismiss notification" onclick={ondismiss}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
  </div>
</div>

<style>
  .toast-position {
    position: fixed;
    z-index: 30;
    inset-inline-end: 1rem;
    inset-block-end: max(1rem, env(safe-area-inset-bottom));
    width: min(28rem, calc(100vw - 2rem));
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: .75rem;
    padding: .75rem;
    border: 1px solid var(--accent);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    pointer-events: auto;
  }
  .toast.error { border-color: var(--red); }
  .toast-symbol { width: 1.5rem; height: 1.5rem; flex: none; color: var(--accent); }
  .error .toast-symbol { color: var(--red); }
  p { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .toast-dismiss { flex: none; width: 2.75rem; min-height: 2.75rem; padding: .65rem; }
  .toast-dismiss svg { display: block; width: 100%; height: 100%; }
  @media (max-width: 48rem) {
    .toast-position { inset-block-end: calc(4.5rem + env(safe-area-inset-bottom)); }
  }
</style>
