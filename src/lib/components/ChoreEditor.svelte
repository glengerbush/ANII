<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import { describeChoreRule, type ChoreDefinition, type ChoreRule } from '$lib/domain/chores';
  type Profile = {id:number; name:string};
  let {chore,profiles,date,profileId,onclose}:{chore?:ChoreDefinition;profiles:Profile[];date:string;profileId:number;onclose:()=>void}=$props();
  const uid=$props.id();
  onMount(()=>document.getElementById(`${uid}-title`)?.focus());
  const originalRevision=untrack(()=>chore?.revision);
  let title=$state(untrack(()=>chore?.title??''));
  let notes=$state(untrack(()=>chore?.notes??''));
  let rule=$state<ChoreRule>(untrack(()=>chore?structuredClone(chore.rule):{startDate:date,frequency:'daily',interval:1,weekdays:[],monthDays:[],months:[]}));
  let assigneeIds=$state<number[]>(untrack(()=>[...(chore?.assigneeIds??[])]));
  let busy=$state(false), error=$state('');
  const weekdays=[{id:1,name:'Monday'},{id:2,name:'Tuesday'},{id:3,name:'Wednesday'},{id:4,name:'Thursday'},{id:5,name:'Friday'},{id:6,name:'Saturday'},{id:0,name:'Sunday'}];
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days=Array.from({length:31},(_,i)=>i+1);
  const presets=[{id:'daily',name:'Daily'},{id:'weekdays',name:'Weekdays'},{id:'weekly',name:'Weekly'},{id:'fortnight',name:'Fortnightly'},{id:'twice-month',name:'Twice a month'},{id:'monthly',name:'Monthly'},{id:'quarterly',name:'Quarterly'},{id:'yearly',name:'Yearly'}];
  function preset(id:string){
    const base:ChoreRule={startDate:rule.startDate,frequency:'daily',interval:1,weekdays:[],monthDays:[],months:[]};
    if(id==='weekdays')base.weekdays=[1,2,3,4,5];
    if(id==='weekly'||id==='fortnight'){base.frequency='weekly';base.interval=id==='fortnight'?2:1;}
    if(['twice-month','monthly','quarterly'].includes(id)){base.frequency='monthly';base.interval=id==='quarterly'?3:1;if(id==='twice-month')base.monthDays=[1,15];}
    if(id==='yearly')base.frequency='yearly';
    rule=base;
  }
  function toggle(field:'weekdays'|'monthDays'|'months',value:number){rule[field]=rule[field].includes(value)?rule[field].filter(n=>n!==value):[...rule[field],value].sort((a,b)=>a-b);}
  function toggleAssignee(id:number){assigneeIds=assigneeIds.includes(id)?assigneeIds.filter(n=>n!==id):[...assigneeIds,id];}
  function moveAssignee(index:number,offset:number){const next=[...assigneeIds];[next[index],next[index+offset]]=[next[index+offset],next[index]];assigneeIds=next;}
  function profileName(id:number){return profiles.find(profile=>profile.id===id)?.name??'Unavailable profile';}
  async function save(event:SubmitEvent){
    event.preventDefault();if(busy)return;busy=true;error='';
    try{
      const body=new FormData(event.currentTarget as HTMLFormElement);
      const response=await fetch(chore?'?/edit':'?/create',{method:'POST',body,headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){error=result.type==='failure'&&result.data&&'error' in result.data?String(result.data.error):'Could not save this chore. Your edits are here; try again.';return;}
      await invalidateAll();onclose();
    }catch{error='Could not save this chore. Your edits are here; check your connection and try again.';}
    finally{busy=false;}
  }
</script>

<form class="chore-editor" method="POST" action={chore?'?/edit':'?/create'} onsubmit={save} aria-busy={busy} aria-labelledby={`${uid}-heading`}>
  <h2 id={`${uid}-heading`}>{chore?'Edit chore':'New chore'}</h2>
  <input type="hidden" name="profileId" value={profileId}>
  {#if chore}<input type="hidden" name="id" value={chore.id}><input type="hidden" name="revision" value={originalRevision}>{/if}
  <input type="hidden" name="rule" value={JSON.stringify(rule)}>
  <input type="hidden" name="assigneeIds" value={JSON.stringify(assigneeIds)}>
  <fieldset class="editor-fields" disabled={busy}>
    <label for={`${uid}-title`}>Chore<input id={`${uid}-title`} name="title" bind:value={title} required maxlength="240" placeholder="Wash the dishes"></label>
    <label for={`${uid}-notes`}>Notes <span class="optional">Optional</span><textarea id={`${uid}-notes`} name="notes" bind:value={notes} rows="2" placeholder="Anything helpful to remember"></textarea></label>
    <fieldset class="presets"><legend>Schedule presets</legend><div class="preset-options">{#each presets as item (item.id)}<button type="button" class="secondary" onclick={()=>preset(item.id)}>{item.name}</button>{/each}</div><small>Choosing a preset replaces the schedule selections below. Twice a month uses the 1st and 15th.</small></fieldset>
    <div class="recurrence-fields">
      <label for={`${uid}-start`}>Start date<input id={`${uid}-start`} type="date" bind:value={rule.startDate} required></label>
      <label for={`${uid}-interval`}>Every<input id={`${uid}-interval`} type="number" min="1" max="1000" step="1" bind:value={rule.interval} required></label>
      <label for={`${uid}-frequency`}>Period<select id={`${uid}-frequency`} bind:value={rule.frequency}><option value="daily">Days</option><option value="weekly">Weeks</option><option value="monthly">Months</option><option value="yearly">Years</option></select></label>
    </div>
    <fieldset class="filter-options"><legend>Days of the week</legend><p class="hint">Optional. Weekly schedules use the start date’s weekday when none are selected.</p><div class="choices">{#each weekdays as day (day.id)}<label class="choice"><input type="checkbox" checked={rule.weekdays.includes(day.id)} onchange={()=>toggle('weekdays',day.id)}>{day.name}</label>{/each}</div></fieldset>
    <details open={rule.monthDays.length>0||rule.months.length>0}>
      <summary>Days of the month and months{rule.monthDays.length||rule.months.length?' · selections applied':''}</summary>
      <fieldset class="filter-options"><legend>Days of the month</legend><p class="hint">Optional. Monthly and yearly schedules use the start date’s day when none are selected. Dates a month does not have are skipped.</p><div class="choices month-days">{#each days as day (day)}<label class="choice"><input type="checkbox" checked={rule.monthDays.includes(day)} onchange={()=>toggle('monthDays',day)}>{day}</label>{/each}<label class="choice last-day"><input type="checkbox" checked={rule.monthDays.includes(-1)} onchange={()=>toggle('monthDays',-1)}>Last day</label></div></fieldset>
      <fieldset class="filter-options"><legend>Months</legend><p class="hint">Optional. Yearly schedules use the start date’s month when none are selected.</p><div class="choices">{#each months as month,index (month)}<label class="choice"><input type="checkbox" checked={rule.months.includes(index+1)} onchange={()=>toggle('months',index+1)}>{month}</label>{/each}</div></fieldset>
    </details>
    <p class="schedule-summary"><strong>{describeChoreRule(rule)}</strong><br><small>All selected filters apply together.</small></p>
    <fieldset class="filter-options"><legend>Who does it?</legend><p class="hint">Leave everyone unchecked for Everyone. Select one person for a fixed assignment, or several to take turns after completion, in order.</p><div class="choices">{#each profiles as profile (profile.id)}<label class="choice"><input type="checkbox" checked={assigneeIds.includes(profile.id)} onchange={()=>toggleAssignee(profile.id)}>{profile.name}</label>{/each}</div>
      {#if assigneeIds.length>1}<h3>Rotation order</h3><ol class="rotation">{#each assigneeIds as id,index (id)}<li><span>{profileName(id)}</span><div class="actions"><button type="button" class="secondary compact-action" disabled={index===0} aria-label={`Move ${profileName(id)} earlier in rotation`} onclick={()=>moveAssignee(index,-1)}>Earlier</button><button type="button" class="secondary compact-action" disabled={index===assigneeIds.length-1} aria-label={`Move ${profileName(id)} later in rotation`} onclick={()=>moveAssignee(index,1)}>Later</button></div></li>{/each}</ol><small>The next person takes over after completion. Missed dates increase the outstanding count without changing whose turn it is.</small>{/if}
    </fieldset>
    {#if chore}<p class="hint">Schedule and rotation changes start tomorrow. Existing due chores keep their dates and assignments.</p>{/if}
  </fieldset>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  <div class="actions"><button disabled={busy}>{busy?'Saving…':chore?'Save chore':'Create chore'}</button><button type="button" class="secondary" disabled={busy} onclick={onclose}>Cancel</button></div>
</form>

<style>
  .chore-editor { display:grid; gap:1rem; padding:1rem; margin-block:1rem; background:var(--surface); border:1px solid var(--border); border-radius:8px; }
  h2 { margin:0; } h3 { margin:1rem 0 .5rem; font-size:.9rem; }
  .editor-fields { display:grid; gap:1rem; border:0; padding:0; }
  .optional,.hint { font-weight:400; font-size:.8rem; color:var(--muted); }
  .optional { display:inline; } .hint { margin:.25rem 0 .6rem; max-width:70ch; }
  .presets,.filter-options { padding:.75rem; } .preset-options { display:flex; flex-wrap:wrap; gap:.4rem; margin-bottom:.5rem; }
  .preset-options button { font-size:.8rem; }
  .recurrence-fields { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(0,.7fr) minmax(0,1fr); gap:.75rem; }
  .recurrence-fields label { min-width:0; } .recurrence-fields input { min-width:0; }
  .choices { display:flex; flex-wrap:wrap; gap:.25rem .75rem; }
  .choice { display:flex; align-items:center; gap:.4rem; min-height:2.75rem; font-size:.85rem; font-weight:400; cursor:pointer; }
  .choice input { width:1.1rem; height:1.1rem; min-height:0; accent-color:var(--accent); }
  .month-days { display:grid; grid-template-columns:repeat(auto-fit,minmax(3.5rem,1fr)); } .last-day { grid-column:span 2; }
  details .filter-options + .filter-options { margin-top:.75rem; }
  .schedule-summary { margin:0; color:var(--accent); overflow-wrap:anywhere; }
  .rotation { padding-left:1.5rem; margin:.5rem 0; } .rotation li { padding:.25rem 0; } .rotation li>span { display:inline-block; min-width:8rem; overflow-wrap:anywhere; } .rotation .actions { display:inline-flex; }
  @media(max-width:30rem){.recurrence-fields { grid-template-columns:1fr 1fr; }.recurrence-fields label:first-child { grid-column:1/-1; }.chore-editor { padding:.75rem; }.rotation li>span { display:block; }}
</style>
