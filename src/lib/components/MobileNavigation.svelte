<script lang="ts">
  import type { Snippet } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';

  type NavPath = '/now' | '/backlog' | '/chores' | '/projects' | '/calendar' | '/completed' | '/settings';
  let { links, inert = false, captureIcon, openCapture }: {
    links: readonly (readonly [NavPath, string])[];
    inert?: boolean;
    captureIcon: Snippet;
    openCapture: (event: MouseEvent) => void;
  } = $props();
  const tabs = ['/now', '/backlog', '/chores', '/projects', '/calendar'] as const;
  let menuOpen = $state(false);
  let header: HTMLElement;
  let trigger: HTMLElement;
  function active(path: NavPath) {
    const target = resolve(path);
    return page.url.pathname === target || (path === '/projects' && page.url.pathname.startsWith(`${target}/`));
  }
  let title = $derived(links.find(([path]) => active(path))?.[1] ?? (active('/settings') ? 'Settings' : 'ANII'));
  let bottomLinks = $derived(tabs.map(path => links.find(([href]) => href === path)!).filter(Boolean));
  afterNavigate(() => { menuOpen = false; });
  function dismiss(event: KeyboardEvent) {
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault();
      menuOpen = false;
      trigger?.focus();
    }
  }
</script>

<svelte:window onkeydown={dismiss}
  onpointerdown={event => { if (menuOpen && !header?.contains(event.target as Node)) menuOpen = false; }}
  onfocusin={event => { if (menuOpen && !header?.contains(event.target as Node)) menuOpen = false; }}
  onresize={() => { if (!window.matchMedia('(max-width: 48rem), (max-height: 30rem) and (pointer: coarse)').matches) menuOpen = false; }} />

<header bind:this={header} class="mobile-topbar" {inert}>
  <details bind:open={menuOpen}>
    <summary bind:this={trigger} aria-label="Navigation" aria-expanded={menuOpen} aria-controls="mobile-navigation">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </summary>
    <nav id="mobile-navigation" class="navigation-menu" aria-label="All pages">
      {#each links as [path, label] (path)}
        <a class:active={active(path)} aria-current={active(path) ? 'page' : undefined} href={resolve(path)}>{label}</a>
      {/each}
      <a class:active={active('/settings')} aria-current={active('/settings') ? 'page' : undefined} href={resolve('/settings')}>Settings</a>
    </nav>
  </details>
  <strong>{title}</strong>
  <button class="capture-toggle" aria-label="Open capture chat" title="Open capture chat" aria-controls="capture-chat" onclick={event => { menuOpen = false; openCapture(event); }}>{@render captureIcon()}</button>
</header>
<nav class="bottom-nav" aria-label="Primary navigation" {inert}>
  {#each bottomLinks as [path, label] (path)}
    <a class:active={active(path)} aria-current={active(path) ? 'page' : undefined} href={resolve(path)}>{label}</a>
  {/each}
</nav>

<style>
  .mobile-topbar, .bottom-nav { display: none; }
  @media (max-width: 48rem), (max-height: 30rem) and (pointer: coarse) {
    .mobile-topbar { position: sticky; top: 0; z-index: 16; display: flex; align-items: center; gap: .75rem; padding: calc(.375rem + env(safe-area-inset-top)) max(.75rem, env(safe-area-inset-right)) .375rem max(.75rem, env(safe-area-inset-left)); background: var(--surface); border-bottom: 1px solid var(--border); }
    .mobile-topbar strong { flex: 1; min-width: 0; font-size: 1.1rem; }
    summary { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; list-style: none; cursor: pointer; border-radius: 4px; }
    summary::-webkit-details-marker { display: none; }
    summary:hover, summary[aria-expanded="true"] { background: var(--hover); }
    .navigation-menu { position: absolute; top: 100%; left: 0; right: 0; display: grid; gap: .25rem; padding: .5rem max(.75rem, env(safe-area-inset-right)) max(.75rem, env(safe-area-inset-bottom)) max(.75rem, env(safe-area-inset-left)); max-height: calc(100dvh - 3.5rem - env(safe-area-inset-top)); overflow-y: auto; overscroll-behavior: contain; background: var(--surface); border-bottom: 1px solid var(--border); }
    .navigation-menu a { display: flex; align-items: center; min-height: 2.75rem; padding: .65rem .75rem; border-radius: 4px; color: var(--text); text-decoration: none; }
    .navigation-menu a:hover { background: var(--hover); }
    .navigation-menu a.active { background: var(--accent-fill); color: var(--accent); font-weight: 700; }
    .bottom-nav { position: fixed; z-index: 15; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); border-top: 1px solid var(--border); background: var(--surface); }
    .bottom-nav a { display: flex; justify-content: center; align-items: center; min-width: 0; min-height: 3.5rem; padding: .6rem .15rem; font-size: .75rem; color: var(--muted); text-decoration: none; border-top: 3px solid transparent; overflow-wrap: anywhere; }
    .bottom-nav a.active { color: var(--accent); background: var(--accent-fill); border-top-color: var(--accent); font-weight: 700; }
  }
</style>
