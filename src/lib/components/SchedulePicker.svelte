<script module lang="ts">
  import type { TaskState } from '$lib/domain/rules';
  export type ScheduleTask = {
    id: number; title: string; state: TaskState; project_names: string[];
    start_date: string | null; assignee_id: number | null; assignee_name: string | null;
  };
</script>

<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { tick } from 'svelte';

  let { tasks, profiles, activeProfile }: {
    tasks: ScheduleTask[];
    profiles: { id: number; name: string }[];
    activeProfile: { id: number; name: string };
  } = $props();
  let dialog: HTMLDialogElement;
  let searchInput = $state<HTMLInputElement>();
  let dateInput = $state<HTMLInputElement>();
  let resultsList = $state<HTMLDivElement>();
  let removeButton = $state<HTMLButtonElement>();
  let returnFocus: HTMLElement | null = null;
  let query = $state('');
  let startDate = $state('');
  let editing = $state<ScheduleTask | null>(null);
  let assigneeId = $state('everyone');
  let assigneeFor = $state<number | null>(null);
  let busy = $state(false);
  let error = $state('');
  let matches = $derived.by(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return tasks.filter(task => {
      const text = `${task.title} ${task.project_names.join(' ')}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    });
  });
  let dateLabel = $derived(startDate ? new Date(`${startDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '');

  export async function open(date: string, task: ScheduleTask | null = null, trigger: HTMLElement | null = null) {
    returnFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    startDate = date;
    editing = task;
    assigneeId = task?.assignee_id == null ? 'everyone' : String(task.assignee_id);
    query = '';
    error = '';
    assigneeFor = null;
    dialog.showModal();
    await tick();
    (task?.state === 'completed' ? removeButton : task ? dateInput : searchInput)?.focus();
  }
  function close() { if (!busy) dialog.close(); }
  async function save(taskId: number, assignee: string, remove = false) {
    if (busy || (!remove && editing?.state === 'completed')) return;
    busy = true;
    error = '';
    const form = new FormData();
    form.set('profileId', String(activeProfile.id));
    form.set('taskId', String(taskId));
    form.set('startDate', startDate);
    form.set('assigneeId', assignee);
    try {
      const response = await fetch(`${resolve('/calendar')}?/${remove ? 'unschedule' : 'schedule'}`, {
        method: 'POST', body: form, headers: { 'x-sveltekit-action': 'true' }
      });
      const result = deserialize(await response.text());
      if (result.type !== 'success') {
        error = result.type === 'failure' && result.data && 'error' in result.data
          ? String(result.data.error) : 'Could not save the schedule. Please try again.';
        return;
      }
      await invalidateAll();
      dialog.close();
    } catch {
      error = 'Could not save the schedule. Check your connection and try again.';
    } finally {
      busy = false;
    }
  }
  async function toggleAssignees(id: number) {
    assigneeFor = assigneeFor === id ? null : id;
    await tick();
    if (assigneeFor !== null) resultsList?.querySelector<HTMLButtonElement>(`#assignees-${id} button`)?.focus();
  }
  function searchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      resultsList?.querySelector<HTMLButtonElement>('.select-task')?.focus();
    } else if (event.key === 'Enter' && matches.length) {
      event.preventDefault();
      void save(matches[0].id, String(activeProfile.id));
    }
  }
</script>

<dialog bind:this={dialog} class="schedule-picker" aria-labelledby="schedule-picker-title"
  oncancel={event => { if (busy) event.preventDefault(); }}
  onclose={() => returnFocus?.focus()}>
  <header>
    <h2 id="schedule-picker-title">{editing?.state === 'completed' ? 'Completed task schedule' : editing ? 'Edit schedule' : dateLabel}</h2>
    <button type="button" class="icon" aria-label="Close schedule picker" disabled={busy} onclick={close}>×</button>
  </header>
  {#if editing}
    <form class="schedule-editor" onsubmit={event => { event.preventDefault(); if (editing) void save(editing.id, assigneeId); }} aria-busy={busy}>
      <p class="editing-title">{editing.title}</p>
      {#if editing.state === 'completed'}
        <p class="completed-status">Completed</p>
        <p class="muted">This task is completed. Reopen it in Backlog to change its date or assignee. You can still remove its schedule.</p>
        <dl class="schedule-summary"><div><dt>Start date</dt><dd>{dateLabel}</dd></div><div><dt>Assigned to</dt><dd>{editing.assignee_name ?? 'Everyone'}</dd></div></dl>
      {:else}
      <label>Start date<input bind:this={dateInput} type="date" bind:value={startDate} required disabled={busy}></label>
      <label>Assigned to<select bind:value={assigneeId} disabled={busy}>
        {#each profiles as profile (profile.id)}<option value={String(profile.id)}>{profile.name}{profile.id === activeProfile.id ? ' (you)' : ''}</option>{/each}
        <option value="everyone">Everyone</option>
      </select></label>
      {/if}
      {#if error}<p class="notice error" role="alert">{error}</p>{/if}
      <div class="editor-actions">
        <button bind:this={removeButton} type="button" class="secondary danger" disabled={busy} onclick={() => editing && save(editing.id, assigneeId, true)}>Remove schedule</button>
        {#if editing.state !== 'completed'}<button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>{:else}<span role="status">{busy ? 'Removing…' : ''}</span>{/if}
      </div>
    </form>
  {:else}
    <div class="search-box">
      <input bind:this={searchInput} type="search" bind:value={query} aria-label="Search tasks" placeholder="Search tasks…" autocomplete="off" disabled={busy} onkeydown={searchKeydown}>
    </div>
    <div class="results" bind:this={resultsList} aria-busy={busy}>
      {#each matches as task (task.id)}
        <div class="result">
          <div class="result-row">
            <button type="button" class="select-task" disabled={busy} onclick={() => save(task.id, String(activeProfile.id))} aria-label={`Schedule ${task.title} for ${activeProfile.name} on ${dateLabel}`}>
              <span>{task.title}</span>
              {#if task.project_names.length}<small>{task.project_names.join(' · ')}</small>{/if}
              {#if task.start_date}<small>Scheduled {task.start_date} · {task.assignee_name ?? 'Everyone'}</small>{/if}
            </button>
            <button type="button" class="assign-button secondary" disabled={busy} aria-label={`Assign ${task.title} to another user or Everyone`} title="Choose assignee" aria-expanded={assigneeFor === task.id} aria-controls={`assignees-${task.id}`} onclick={() => toggleAssignees(task.id)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M19 8v6m-3-3h6"/></svg>
              <span aria-hidden="true">⌄</span>
            </button>
          </div>
          {#if assigneeFor === task.id}
            <div class="assignees" id={`assignees-${task.id}`} role="group" aria-label={`Assign ${task.title} to`}>
              {#each profiles as profile (profile.id)}
                <button type="button" class="secondary" disabled={busy} onclick={() => save(task.id, String(profile.id))}>{profile.name}{profile.id === activeProfile.id ? ' (you)' : ''}</button>
              {/each}
              <button type="button" class="secondary" disabled={busy} onclick={() => save(task.id, 'everyone')}>Everyone</button>
            </div>
          {/if}
        </div>
      {:else}<p class="no-results">{query.trim() ? 'No matching tasks.' : 'No open tasks. Add one in Backlog or Now.'}</p>{/each}
    </div>
    <footer><span role="status">{busy ? 'Saving…' : `${matches.length} ${matches.length === 1 ? 'task' : 'tasks'}`}</span><span>Click to assign to {activeProfile.name}</span></footer>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {/if}
</dialog>

<style>
  .schedule-picker { width: min(34rem, calc(100vw - 2rem)); max-height: min(80dvh, 42rem); padding: 0; overflow: auto; color: var(--text); background: var(--canvas); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 1rem 4rem #0003; }
  .schedule-picker::backdrop { background: #0006; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .25rem .5rem .25rem 1rem; }
  h2 { margin: 0; font-size: .88rem; }
  .search-box { padding: 0 .75rem .75rem; }
  .results { max-height: 22rem; overflow-y: auto; border-block: 1px solid var(--border); }
  .result + .result { border-top: 1px solid var(--border); }
  .result-row { display: flex; align-items: center; gap: .4rem; padding: .25rem .75rem; }
  .select-task { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: .15rem; text-align: left; padding: .5rem .25rem; border-color: transparent; background: transparent; color: var(--text); overflow-wrap: anywhere; }
  .select-task:hover { color: var(--accent); }
  .select-task small { font-size: .72rem; }
  .assign-button { flex: none; padding: .4rem; }
  .assignees { margin: 0 .75rem .65rem; padding: .4rem; display: grid; gap: .2rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; }
  .assignees button { justify-content: flex-start; border-color: transparent; }
  .no-results { margin: 0; padding: 1.2rem 1rem; color: var(--muted); }
  footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .5rem; padding: .65rem 1rem; color: var(--muted); font-size: .72rem; }
  .schedule-editor { display: grid; gap: 1rem; padding: .25rem 1rem 1rem; }
  .editing-title { margin: 0; overflow-wrap: anywhere; }
  .completed-status { margin: 0; color: var(--muted); font-size: .8rem; font-weight: 650; }
  .schedule-summary { display: grid; gap: .75rem; margin: 0; }
  .schedule-summary dt { color: var(--muted); font-size: .75rem; }
  .schedule-summary dd { margin: .2rem 0 0; }
  .editor-actions { display: flex; justify-content: space-between; gap: .75rem; }
  .notice { margin: .75rem; }
</style>
