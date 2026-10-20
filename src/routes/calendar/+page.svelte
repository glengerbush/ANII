<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import SchedulePicker, { type ScheduleTask } from '$lib/components/SchedulePicker.svelte';
  let { data } = $props();
  let picker: SchedulePicker;
  function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', options);
  }
  function calendarQuery(date = data.anchor, view = data.view, profile = data.selectedProfile) {
    return `?${new URLSearchParams({ date, view, profile })}`;
  }
  let heading = $derived(data.view === 'month'
    ? formatDate(data.anchor, { month: 'long', year: 'numeric' })
    : `${formatDate(data.rangeStart, { month: 'short', day: 'numeric' })} – ${formatDate(data.rangeEnd, { month: 'short', day: 'numeric', year: 'numeric' })}`);
  let tasksByDay = $derived.by(() => {
    const grouped: Record<string, ScheduleTask[]> = {};
    for (const task of data.tasks as ScheduleTask[]) {
      if (!task.start_date) continue;
      (grouped[task.start_date] ??= []).push(task);
    }
    return grouped;
  });
</script>

<svelte:head><title>{data.view === 'week' ? 'Week' : 'Month'} · ANII</title></svelte:head>
<section class="page wide calendar-page">
  <header class="page-header">
    <div><h1>Calendar</h1></div>
    <nav class="view-switch" aria-label="Calendar view">
      <a href={`${resolve('/calendar')}${calendarQuery(data.anchor, 'week')}`} aria-current={data.view === 'week' ? 'page' : undefined}>Week</a>
      <a href={`${resolve('/calendar')}${calendarQuery(data.anchor, 'month')}`} aria-current={data.view === 'month' ? 'page' : undefined}>Month</a>
    </nav>
  </header>
  <div class="calendar-toolbar">
    <div class="date-navigation">
      <a class="button secondary arrow" href={`${resolve('/calendar')}${calendarQuery(data.previous)}`} aria-label={`Previous ${data.view}`}>‹</a>
      <a class="button secondary arrow" href={`${resolve('/calendar')}${calendarQuery(data.next)}`} aria-label={`Next ${data.view}`}>›</a>
      <a class="button secondary" href={`${resolve('/calendar')}${calendarQuery(data.date)}`}>Today</a>
    </div>
    <h2 aria-live="polite">{heading}</h2>
    <label class="profile-filter">Show
      <select aria-label="Show scheduled tasks for" value={data.selectedProfile} onchange={event => goto(`${resolve('/calendar')}${calendarQuery(data.anchor, data.view, event.currentTarget.value)}`)}>
        {#each data.profiles as profile (profile.id)}
          <option value={String(profile.id)}>{profile.name}{profile.id === data.activeProfile.id ? ' (you)' : ''}</option>
        {/each}
        <option value="all">Everyone</option>
      </select>
    </label>
  </div>
  <p class="calendar-hint">Click a day to schedule a task. Tasks appear on their start date.</p>
  <!-- Keyboard users need to scroll the calendar horizontally. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="calendar-scroll" role="region" aria-label={`${data.view === 'week' ? 'Week' : 'Month'} calendar`} tabindex="0">
    <div class={`calendar-grid ${data.view}`}>
      {#each data.days.slice(0, 7) as day (day)}
        <div class="weekday">{formatDate(day, { weekday: 'short' })}</div>
      {/each}
      {#each data.days as day (day)}
        <section class:outside={data.view === 'month' && day.slice(0, 7) !== data.anchor.slice(0, 7)} class:current-day={day === data.date} class="calendar-day" aria-label={formatDate(day, { dateStyle: 'full' })}>
          <button class="day-space" type="button" aria-label={`Schedule task on ${formatDate(day, { dateStyle: 'full' })}`} onclick={event => picker.open(day, null, event.currentTarget)}></button>
          <div class="day-heading" aria-hidden="true"><span class="day-number">{Number(day.slice(-2))}</span>{#if day === data.date}<span class="today-label">Today</span>{/if}</div>
          <div class="day-tasks">
            {#each tasksByDay[day] ?? [] as task (task.id)}
              <button type="button" class="scheduled-task" class:completed={task.state === 'completed'} aria-label={`${task.state === 'completed' ? 'View completed task schedule' : 'Edit schedule'} for ${task.title}, assigned to ${task.assignee_name ?? 'Everyone'}`} onclick={event => picker.open(day, task, event.currentTarget)}>
                <span>{task.title}</span><small>{task.assignee_name ?? 'Everyone'}{task.state === 'completed' ? ' · Completed' : ''}</small>
              </button>
            {/each}
          </div>
          <span class="add-hint" aria-hidden="true">+</span>
        </section>
      {/each}
    </div>
  </div>
</section>
<SchedulePicker bind:this={picker} tasks={data.searchTasks} profiles={data.profiles} activeProfile={data.activeProfile} />

<style>
  .calendar-page { width: min(100%, 90rem); }
  .page-header { align-items: center; margin-bottom: 1.5rem; }
  .view-switch { display: flex; padding: .2rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
  .view-switch a { min-height: 2.5rem; display: grid; place-items: center; padding: .35rem .85rem; border-radius: 4px; color: var(--muted); text-decoration: none; }
  .view-switch a[aria-current] { background: var(--canvas); color: var(--accent); font-weight: 650; }
  .calendar-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: .75rem 1rem; }
  .calendar-toolbar h2 { margin: 0; font-size: 1.1rem; }
  .date-navigation { display: flex; gap: .3rem; }
  .arrow { min-width: 2.75rem; padding: .25rem; font-size: 1.5rem; }
  .profile-filter { margin-left: auto; display: flex; align-items: center; gap: .5rem; color: var(--muted); font-size: .8rem; font-weight: 400; }
  .profile-filter select { width: auto; max-width: 16rem; }
  .calendar-hint { margin: 1rem 0 .65rem; color: var(--muted); font-size: .8rem; }
  .calendar-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; }
  .calendar-scroll:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
  .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); min-width: 42rem; gap: 1px; background: var(--border); }
  .weekday { background: var(--surface); padding: .6rem; color: var(--muted); font-size: .75rem; font-weight: 650; }
  .calendar-day { position: relative; min-height: 9rem; min-width: 0; padding: .45rem; background: var(--canvas); isolation: isolate; }
  .week .calendar-day { min-height: 25rem; }
  .calendar-day.outside { background: var(--surface); }
  .day-space { position: absolute; z-index: -1; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; }
  .day-space:hover { background: var(--surface); }
  .day-space:focus-visible { outline-offset: -3px; }
  .day-heading { display: flex; align-items: center; justify-content: space-between; gap: .25rem; margin-bottom: .4rem; pointer-events: none; }
  .day-number { display: grid; place-items: center; width: 1.75rem; height: 1.75rem; font-size: .85rem; }
  .current-day .day-number { border-radius: 50%; color: var(--accent-text); background: var(--accent); }
  .outside .day-number { color: var(--muted); }
  .today-label { font-size: .65rem; color: var(--accent); }
  .day-tasks { display: grid; gap: .35rem; pointer-events: none; }
  .scheduled-task { display: flex; flex-direction: column; align-items: flex-start; gap: .2rem; width: 100%; padding: .4rem .45rem; min-height: 2.75rem; border: 1px solid var(--border);  color: var(--text); background: var(--surface); text-align: left; font-size: .78rem; overflow-wrap: anywhere; pointer-events: auto; }
  .scheduled-task.completed > span { text-decoration: line-through; color: var(--muted); }
  .scheduled-task small { font-size: .66rem; }
  .add-hint { display: block; margin-top: .5rem; color: var(--muted); text-align: center; opacity: 0; pointer-events: none; }
  .calendar-day:hover .add-hint, .calendar-day:focus-within .add-hint { opacity: 1; }
  @media (max-width: 600px) {
    .calendar-page { padding-inline: 1rem; }
    .page-header { align-items: flex-end; }
    .calendar-toolbar h2 { flex-basis: 100%; order: -1; }
    .profile-filter { max-width: calc(100% - 10rem); }
    .profile-filter select { width: 100%; min-width: 0; }
    .calendar-grid { min-width: 38rem; }
    .week .calendar-day { min-height: 18rem; }
  }
</style>
