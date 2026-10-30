<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { tick } from 'svelte';
  import ChoreEditor from '$lib/components/ChoreEditor.svelte';
  import ChoreDueList from '$lib/components/ChoreDueList.svelte';
  import { describeChoreRule, type ChoreDefinition, type ChoreOccurrence } from '$lib/domain/chores';
  type Profile={id:number;name:string};
  let {data,form}:{data:{chores:ChoreDefinition[];dueChores:ChoreOccurrence[];completedChores:ChoreOccurrence[];date:string;profiles:Profile[];activeProfile:Profile};form?:{error?:string}|null}=$props();
  let query=$state(''), creating=$state(false), editing=$state<number|null>(null);
  let pending=$state<Record<number,boolean>>({}), errors=$state<Record<number,string>>({});
  let filtered=$derived(data.chores.filter(chore=>`${chore.title} ${chore.notes}`.toLowerCase().includes(query.trim().toLowerCase())));
  async function closeEditor(id:number|null){creating=false;editing=null;await tick();document.getElementById(id===null?'new-chore':`edit-chore-${id}`)?.focus({preventScroll:true});}
  function assignments(chore:ChoreDefinition){return chore.assigneeIds.length?chore.assigneeIds.map(id=>data.profiles.find(profile=>profile.id===id)?.name??'Unavailable profile').join(' → '):'Everyone';}
  async function toggleActive(event:SubmitEvent,chore:ChoreDefinition){
    event.preventDefault();if(pending[chore.id])return;pending[chore.id]=true;errors[chore.id]='';
    const scrollY=window.scrollY;
    try{
      const response=await fetch('?/active',{method:'POST',body:new FormData(event.currentTarget as HTMLFormElement),headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){errors[chore.id]=result.type==='failure'&&result.data&&'error' in result.data?String(result.data.error):'Could not update this schedule. Try again.';return;}
      await invalidateAll();window.scrollTo(0,scrollY);
    }catch{errors[chore.id]='Could not update this schedule. Check your connection and try again.';}
    finally{pending[chore.id]=false;}
  }
</script>

<svelte:head><title>Chores · ANII</title></svelte:head>
<section class="page wide chores-page">
  <header class="page-header"><div><h1>Chores</h1><p class="muted">Recurring work, with a turn for everyone.</p></div><button id="new-chore" onclick={()=>{creating=true;editing=null;}} disabled={creating||editing!==null}>New chore</button></header>
  {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
  {#if creating}<ChoreEditor profiles={data.profiles} date={data.date} profileId={data.activeProfile.id} onclose={()=>void closeEditor(null)}/>{/if}
  <section class="chores-section" aria-labelledby="due-chores-heading"><h2 id="due-chores-heading">Due chores <span>{data.dueChores.length}</span></h2>
    {#if data.dueChores.some(chore=>chore.occurrence_count>1)}<p class="group-empty">The × count shows accrued scheduled occurrences. Completing a chore clears its count and passes the next turn to the next person.</p>{/if}
    {#if data.dueChores.length}<ChoreDueList chores={data.dueChores} profiles={data.profiles} profileId={data.activeProfile.id} date={data.date}/>{:else}<p class="group-empty">{data.chores.length?'All caught up. Your next chores will appear when they’re due.':'Create a chore to set its schedule and assignment.'}</p>{/if}
  </section>
  <section class="chores-section" aria-labelledby="chore-schedules-heading"><h2 id="chore-schedules-heading">Schedules <span>{data.chores.length}</span></h2>
    {#if data.chores.length}
      <label class="schedule-search" for="chore-search">Search schedules<input type="search" id="chore-search" bind:value={query} disabled={editing!==null} placeholder="Title or notes"></label>
      <div class="schedule-list">{#each filtered as chore (chore.id)}
        <article class="schedule" aria-labelledby={`schedule-title-${chore.id}`}>
          <div class="schedule-info"><h3 id={`schedule-title-${chore.id}`}>{chore.title}{#if !chore.active}<span class="paused">Paused</span>{/if}</h3><p>{describeChoreRule(chore.rule)}</p><p>{chore.assigneeIds.length>1?'Take turns after completion: ':''}{assignments(chore)}</p><p class="next-date">{chore.active?(chore.nextDate?`Next: ${chore.nextDate}`:'No upcoming date matches this schedule.'):'No new occurrences while paused.'}</p></div>
          <div class="actions"><button type="button" class="secondary" id={`edit-chore-${chore.id}`} disabled={creating||editing!==null||pending[chore.id]} onclick={()=>editing=chore.id}>Edit</button><form method="POST" action="?/active" onsubmit={(event)=>toggleActive(event,chore)}><input type="hidden" name="id" value={chore.id}><input type="hidden" name="revision" value={chore.revision}><input type="hidden" name="active" value={chore.active?'false':'true'}><input type="hidden" name="profileId" value={data.activeProfile.id}><button class="secondary" disabled={pending[chore.id]||editing===chore.id}>{pending[chore.id]?'Saving…':chore.active?'Pause':'Resume'}</button></form></div>
          {#if errors[chore.id]}<p class="notice error schedule-error" role="alert">{errors[chore.id]}</p>{/if}
          {#if editing===chore.id}<div class="schedule-editor"><ChoreEditor {chore} profiles={data.profiles} date={data.date} profileId={data.activeProfile.id} onclose={()=>void closeEditor(chore.id)}/></div>{/if}
        </article>
      {:else}<p class="group-empty">No schedules match “{query}”. <button type="button" class="secondary" onclick={()=>query=''}>Clear search</button></p>{/each}</div>
      <p class="schedule-note">Pausing stops new occurrences. Existing due chores stay until completed.</p>
    {:else}<p class="group-empty">No schedules yet. Daily dishes, fortnightly laundry, or quarterly maintenance can start here.</p>{/if}
  </section>
  {#if data.completedChores.length}<details class="closed-tasks"><summary>Completed chores ({data.completedChores.length})</summary><ChoreDueList chores={data.completedChores} profiles={data.profiles} profileId={data.activeProfile.id} date={data.date} completed/></details>{/if}
</section>

<style>
  .page-header p { margin:.5rem 0 0; font-size:.875rem; }
  .chores-section { margin-block:1.75rem; } h2 { display:flex; align-items:baseline; gap:.5rem; margin-bottom:.75rem; } h2 span { color:var(--muted); font-size:.8rem; font-weight:400; }
  .group-empty,.schedule-note { color:var(--muted); font-size:.85rem; } .schedule-note { margin-top:.75rem; }
  .schedule-search { margin-bottom:1rem; max-width:30rem; font-size:.85rem; }
  .schedule-list { border-top:1px solid var(--border); }
  .schedule { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:.75rem; padding:1rem 0; border-bottom:1px solid var(--border); }
  .schedule-info { min-width:0; } h3 { margin:0 0 .35rem; font-size:.95rem; overflow-wrap:anywhere; } .schedule-info p { margin:.2rem 0 0; font-size:.85rem; color:var(--muted); overflow-wrap:anywhere; }
  .paused { display:inline-block; margin-left:.5rem; color:var(--muted); font-size:.75rem; font-weight:400; } .next-date { font-variant-numeric:tabular-nums; }
  .schedule-editor,.schedule-error { grid-column:1/-1; } .schedule-editor :global(.chore-editor) { margin:0; }
  @media(max-width:36rem){.schedule { grid-template-columns:1fr; }.schedule>.actions { justify-content:flex-start; }}
</style>
