<script lang="ts">
  import { resolve } from '$app/paths';
  import TaskCard from '$lib/components/TaskCard.svelte';
  let {data,form}=$props();
  let actionQuery=$derived(new URLSearchParams({mode:data.mode,date:data.date,...(data.filters.q?{q:data.filters.q}:{}),...(data.filters.project?{project:String(data.filters.project)}:{})}).toString());
  let groups=$derived.by(()=>{
    const days:{date:string;tasks:typeof data.tasks}[]=[];
    for(const task of data.tasks){const last=days.at(-1);if(last?.date===task.completion_day)last.tasks.push(task);else days.push({date:task.completion_day,tasks:[task]});}
    return days;
  });
  function dayUrl(date:string):`/completed?${string}`{return `/completed?${new URLSearchParams({date})}`;}
  function label(date:string){return new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));}
  function changeDate(event:Event){(event.currentTarget as HTMLInputElement).form?.requestSubmit();}
</script>

<svelte:head><title>Completed · ANII</title></svelte:head>
<section class="page wide completed-page">
  <header class="page-header"><div><h1>Completed</h1><p class="muted">Completed tasks, organized by calendar date.</p></div></header>
  {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
  <nav class="view-switch" aria-label="Completed task views">
    <a class="button secondary" aria-current={data.mode==='day'?'page':undefined} href={resolve(dayUrl(data.date))}>By day</a>
    <a class="button secondary" aria-current={data.mode==='all'?'page':undefined} href={resolve(`/completed?mode=all&date=${data.date}`)}>Search all days</a>
  </nav>
  {#if data.mode==='day'}
    <div class="day-toolbar">
      <div class="day-navigation">
        {#if data.previousDate}<a class="button secondary day-arrow" href={resolve(dayUrl(data.previousDate))} aria-label={`Previous day, ${label(data.previousDate)}`} title="Previous day"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></a>{:else}<button class="secondary day-arrow" disabled aria-label="Previous day"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>{/if}
        <form method="GET" action={resolve('/completed')} class="day-picker"><label class="sr-only" for="completed-day">Completed day</label><input id="completed-day" name="date" type="date" min="0001-01-01" max="9999-12-31" value={data.date} required onchange={changeDate}><noscript><button>Show day</button></noscript></form>
        {#if data.nextDate}<a class="button secondary day-arrow" href={resolve(dayUrl(data.nextDate))} aria-label={`Next day, ${label(data.nextDate)}`} title="Next day"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></a>{:else}<button class="secondary day-arrow" disabled aria-label="Next day"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>{/if}
      </div>
      {#if data.date===data.activeDate}<span class="muted current-day">Current day</span>{:else}<a href={resolve(dayUrl(data.activeDate))}>Current day</a>{/if}
    </div>
  {:else}
    <form method="GET" action={resolve('/completed')} class="completed-filters">
      <input type="hidden" name="mode" value="all"><input type="hidden" name="date" value={data.date}>
      <label>Search all days<input type="search" name="q" value={data.filters.q} placeholder="Title or notes"></label>
      <label>Project<select name="project"><option value="">All projects</option>{#each data.projects as project (project.id)}<option value={project.id} selected={project.id===data.filters.project}>{project.name}</option>{/each}</select></label>
      <button>Search</button><a class="button secondary" href={resolve(`/completed?mode=all&date=${data.date}`)}>Clear filters</a>
    </form>
  {/if}
  <p class="completion-count muted">{data.tasks.length} completed {data.tasks.length===1?'task':'tasks'}{data.mode==='all'?' across all days':''}</p>
  {#if data.tasks.length}
    <div class="completion-days">{#each groups as group (group.date)}<section class="completion-day" aria-label={label(group.date)}>
      {#if data.mode==='all'}<h2><a href={resolve(dayUrl(group.date))}>{label(group.date)}</a></h2>{/if}
      <div class="task-list">{#each group.tasks as task (`${task.id}-${task.completion_day}`)}<TaskCard {task} profileId={data.activeProfile.id} planDate={data.activeDate} date={data.calendarDate} {actionQuery} allTasks={data.allTasks} projects={data.projects} profiles={data.profiles} meta={data.taskMeta[task.id]} planningControls={false} stateAction={`?/state&${actionQuery}`} />{/each}</div>
    </section>{/each}</div>
  {:else}
    <div class="empty">{#if data.mode==='day'}<p>No tasks completed for this day.</p><a href={resolve(`/completed?mode=all&date=${data.date}`)}>Search all days</a>{:else if data.filters.q||data.filters.project}<p>No completed tasks match these filters.</p><a href={resolve(`/completed?mode=all&date=${data.date}`)}>Clear filters</a>{:else}<p>No completed tasks yet.</p><a href={resolve('/now')}>Go to Now</a>{/if}</div>
  {/if}
</section>

<style>
  .page-header p { margin: .75rem 0 0; }
  .view-switch { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1.25rem; }
  .view-switch a[aria-current='page'] { color: var(--accent); border-color: var(--accent); background: var(--accent-fill); }
  .day-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1rem; }
  .day-navigation { display: flex; align-items: center; gap: .5rem; min-width: 0; }
  .day-arrow { flex: none; width: 2.75rem; padding: .5rem; }
  .day-picker { min-width: 0; }
  .day-picker input { width: 11rem; max-width: 100%; }
  .current-day, .day-toolbar > a { font-size: .875rem; }
  .completed-filters { display: grid; grid-template-columns: minmax(0,2fr) minmax(0,1fr) auto auto; align-items: end; gap: .6rem; margin-bottom: 1rem; }
  .completed-filters label { min-width: 0; }
  .completion-count { font-size: .85rem; margin-bottom: .75rem; }
  .completion-days { display: grid; gap: 1.75rem; }
  .completion-day { min-width: 0; }
  .completion-day h2 { margin: 0 0 .75rem; font-size: 1rem; }
  @media (max-width: 48rem) {
    .completed-filters { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
    .completed-filters label:first-of-type { grid-column: 1/-1; }
    .completed-filters > a { grid-column: 1/-1; justify-self: start; }
  }
</style>
