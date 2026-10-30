<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { tick } from 'svelte';
  import type { ChoreOccurrence } from '$lib/domain/chores';
  let {chores,profiles,profileId,date,completed=false,actionBase=''}:{chores:ChoreOccurrence[];profiles:{id:number;name:string}[];profileId:number;date:string;completed?:boolean;actionBase?:string}=$props();
  const uid=$props.id();
  let pending=$state<Record<number,boolean>>({}), errors=$state<Record<number,string>>({});
  function dueLabel(value:string){return value===date?'Today':`${value<date?'Overdue · ':''}${new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;}
  async function mutate(event:SubmitEvent,chore:ChoreOccurrence,kind:'complete'|'assign'){
    event.preventDefault();if(pending[chore.id])return;
    const form=event.currentTarget as HTMLFormElement;
    const body=new FormData(form);
    const row=form.closest<HTMLElement>('[data-chore-row]');
    const restoreFocus=Boolean(row?.contains(document.activeElement));
    const nextRow=row?.nextElementSibling,previousRow=row?.previousElementSibling;
    const heading=row?.closest('section')?.querySelector<HTMLElement>('h2,h1');
    const anchor=kind==='complete'?(row?.nextElementSibling??row?.previousElementSibling??row?.parentElement):row;
    const anchorTop=anchor?.getBoundingClientRect().top;
    const scrollY=window.scrollY;
    let saved=false;
    pending[chore.id]=true;errors[chore.id]='';
    try{
      const response=await fetch(form.action,{method:'POST',body,headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){errors[chore.id]=result.type==='failure'&&result.data&&'error' in result.data?String(result.data.error):'Could not update this chore. Try again.';return;}
      saved=true;await invalidateAll();await tick();
      if(restoreFocus&&!row?.isConnected&&(document.activeElement===document.body||!document.activeElement)){
        const sibling=nextRow?.isConnected?nextRow:previousRow?.isConnected?previousRow:null;
        const target=sibling?.querySelector<HTMLElement>('input[type="checkbox"]:enabled,select:enabled')??heading;
        if(target){if(target===heading)target.tabIndex=-1;target.focus({preventScroll:true});}
      }
      if(anchor?.isConnected&&anchorTop!==undefined)window.scrollBy(0,anchor.getBoundingClientRect().top-anchorTop);else window.scrollTo(0,scrollY);
    }catch{errors[chore.id]='Could not update this chore. Check your connection and try again.';}
    finally{pending[chore.id]=false;if(!saved){const select=form.querySelector('select');if(select)select.value=String(chore.assignee_id??'everyone');}}
  }
</script>

<div class="chore-due-list">
  {#each chores as chore (chore.id)}
    <article class="chore-row" data-chore-row aria-busy={Boolean(pending[chore.id])}>
      <form class="completion-form" method="POST" action={`${actionBase}?/choreComplete`} onsubmit={(event)=>mutate(event,chore,'complete')}>
        <input type="hidden" name="planDate" value={date}><input type="hidden" name="occurrenceId" value={chore.id}><input type="hidden" name="revision" value={chore.revision}><input type="hidden" name="profileId" value={profileId}><input type="hidden" name="completed" value={completed?'false':'true'}>
        <label class="completion-hitbox"><input class="completion-checkbox" type="checkbox" checked={completed} disabled={pending[chore.id]} aria-label={`${completed?'Mark unfinished':'Complete'}: ${chore.title}${chore.occurrence_count>1?`, ${chore.occurrence_count} accrued occurrences`:''}, ${chore.due_date}`} onchange={(event)=>{event.currentTarget.checked=completed;event.currentTarget.form?.requestSubmit();}}></label>
      </form>
      <div class="chore-content"><h3 class:finished={completed}>{chore.title}{#if chore.occurrence_count>1}<span class="accrued-count" title={`${chore.occurrence_count} scheduled occurrences accrued through ${chore.last_due_date}`} aria-label={`${chore.occurrence_count} scheduled occurrences accrued`}>×{chore.occurrence_count}</span>{/if}</h3><p class:overdue={!completed&&chore.due_date<date} class="due-date">{completed?`Scheduled ${chore.due_date}`:dueLabel(chore.due_date)}{#if completed&&chore.completed_by_name} · Completed by {chore.completed_by_name}{/if}</p>{#if chore.notes}<p class="chore-notes">{chore.notes}</p>{/if}</div>
      <form class="assignee-form" method="POST" action={`${actionBase}?/choreAssign`} onsubmit={(event)=>mutate(event,chore,'assign')}>
        <input type="hidden" name="planDate" value={date}><input type="hidden" name="occurrenceId" value={chore.id}><input type="hidden" name="revision" value={chore.revision}><input type="hidden" name="profileId" value={profileId}>
        <label for={`${uid}-assignee-${chore.id}`} class="sr-only">Assignee for {chore.title}, {chore.due_date}</label>
        <select id={`${uid}-assignee-${chore.id}`} name="assigneeId" value={String(chore.assignee_id??'everyone')} disabled={completed||pending[chore.id]} onchange={(event)=>event.currentTarget.form?.requestSubmit()}>
          <option value="everyone">Everyone</option>{#each profiles as profile (profile.id)}<option value={String(profile.id)}>{profile.name}</option>{/each}
        </select>
      </form>
      {#if pending[chore.id]}<span class="sr-only" role="status">Saving {chore.title}…</span>{/if}
      {#if errors[chore.id]}<p class="notice error row-error" role="alert">{errors[chore.id]}</p>{/if}
    </article>
  {/each}
</div>

<style>
  .chore-due-list { display:grid; gap:.35rem; }
  .chore-row { display:grid; grid-template-columns:2.75rem minmax(0,1fr) minmax(8rem,11rem); align-items:center; gap:.5rem; padding:.35rem .65rem .35rem 0; border:1px solid var(--border); border-radius:6px; background:var(--surface); }
  .chore-content { min-width:0; padding-block:.35rem; } h3 { margin:0; font-size:.94rem; font-weight:600; overflow-wrap:anywhere; } .finished { color:var(--muted); text-decoration:line-through; }
  .accrued-count { display:inline-block; margin-left:.5rem; padding:.05rem .4rem; border-radius:4px; background:var(--accent-fill); color:var(--accent); font-size:.8rem; font-variant-numeric:tabular-nums; text-decoration:none; }
  .due-date,.chore-notes { margin:.2rem 0 0; font-size:.8rem; color:var(--muted); overflow-wrap:anywhere; } .overdue { color:var(--orange); } .chore-notes { white-space:pre-line; }
  .assignee-form { min-width:0; } select { font-size:.8rem; }
  .row-error { grid-column:2/-1; margin:0 0 .5rem; }
  @media(max-width:36rem){.chore-row { grid-template-columns:2.75rem minmax(0,1fr); }.assignee-form { grid-column:2; max-width:15rem; margin-bottom:.35rem; }}
</style>
