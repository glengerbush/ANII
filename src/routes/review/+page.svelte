<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import type { SubmitFunction } from '@sveltejs/kit';
  import TaskMeta from '$lib/components/TaskMeta.svelte';
  let {data,form}=$props();
  const planningToday=$derived(data.tomorrowDate===data.activeDate);
  const labels=$derived({close:'Close Out Today',plan:planningToday?'Edit Today':'Plan Tomorrow',focus:planningToday?'Set Today’s Focus':'Set Tomorrow’s Focus'});
  const rank={close:0,plan:1,focus:2,done:3} as const;
  const draftKey=$derived(`anii:review-draft:v1:${data.activeProfile.id}:${data.date}`);
  function pendingOutcome(taskId:number){return form?.pendingDecisions?.find((decision:{taskId:number;outcome:string})=>decision.taskId===taskId)?.outcome;}

  function restoreDraft(element:HTMLFormElement,key:string){
    const selects=Array.from(element.querySelectorAll<HTMLSelectElement>('select[name^="outcome-"]'));
    try {
      const saved:unknown=JSON.parse(localStorage.getItem(key)??'null');
      if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
        for(const select of selects){
          const value=(saved as Record<string,unknown>)[select.name];
          const outcome=value==='waiting'?'backlog':value==='today'?'tomorrow':value;
          if(typeof outcome==='string'&&Array.from(select.options).some(option=>option.value===outcome))select.value=outcome;
        }
      }
    } catch { /* Browser storage may be unavailable or contain an invalid draft. */ }
    const save=()=>{
      try {localStorage.setItem(key,JSON.stringify(Object.fromEntries(selects.map(select=>[select.name,select.value]))));}
      catch { /* Keep the form usable when browser storage is unavailable. */ }
    };
    // Store only current task fields, pruning removed/completed tasks from old drafts.
    save();
    element.addEventListener('change',save);
    return ()=>element.removeEventListener('change',save);
  }

  const submitCloseOut:SubmitFunction=()=>{
    const key=draftKey;
    return async({result,update})=>{
      if(result.type==='success'||result.type==='redirect'){
        try {localStorage.removeItem(key);} catch { /* Storage can be disabled. */ }
      }
      await update({reset:false});
    };
  };
</script>

<svelte:head><title>Review · ANII</title></svelte:head>

<section class="page">
  <header class="page-header"><div><h1>Daily review</h1><p class="muted">Planning for {data.activeProfile.name}</p></div></header>
  <ol class="review-progress" aria-label="Review progress">
    {#each Object.entries(labels) as [key,label],index (key)}<li class:current={data.step===key} class:complete={rank[data.step]>index} aria-current={data.step===key?'step':undefined}><span aria-hidden="true">{index+1}</span>{label}</li>{/each}
  </ol>
  {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}

  {#if data.step==='close'}
    <section aria-labelledby="close-title"><div class="section-title"><h2 id="close-title">1. Close Out Today</h2><span>{data.tasks.length} unfinished</span></div><p class="muted">Choose one explicit outcome for every task. Completed status is shared across profiles.</p>
      {#if form?.confirmRequired}
        <section class="review-delete-confirmation" aria-labelledby="review-delete-title" aria-describedby="review-delete-description">
          <p class="eyebrow" role="alert">Confirmation required</p><h3 id="review-delete-title">Delete {form.confirmDeleteTasks.length} {form.confirmDeleteTasks.length===1?'task':'tasks'}?</h3>
          <p id="review-delete-description">This removes {form.confirmDeleteTasks.length===1?'this task':'these tasks'} from every profile, plan, and project. This cannot be undone.</p>
          <ul>{#each form.confirmDeleteTasks as task (task.id)}<li>{task.title}</li>{/each}</ul>
          <form method="POST" action="?/closeOut" use:enhance={submitCloseOut} class="review-confirm-actions"><input type="hidden" name="profileId" value={data.activeProfile.id}>
            <input type="hidden" name="reviewDate" value={form.reviewDate}>
            {#each form.pendingDecisions as decision (decision.taskId)}<input type="hidden" name="taskId" value={decision.taskId}><input type="hidden" name={`outcome-${decision.taskId}`} value={decision.outcome}>{/each}
            <a class="button secondary" href={resolve('/review')}>Cancel</a><button class="confirm-danger" name="confirmDelete" value="yes">Delete {form.confirmDeleteTasks.length} and continue</button>
          </form>
        </section>
      {/if}
      {#key data}{#key form}
      <form method="POST" action="?/closeOut" use:enhance={submitCloseOut} {@attach (element)=>restoreDraft(element,draftKey)} class="review-stage"><input type="hidden" name="profileId" value={data.activeProfile.id}>
        <input type="hidden" name="reviewDate" value={data.date}>
        {#if data.tasks.length}{#each data.tasks as task (task.id)}{@const selected=pendingOutcome(task.id)??task.review_outcome}<article class="review-task"><input type="hidden" name="taskId" value={task.id}><div><strong>{task.title}</strong><TaskMeta {task} date={data.calendarDate} /></div><div><label for={`outcome-${task.id}`}>Outcome for {task.title}</label><select id={`outcome-${task.id}`} name={`outcome-${task.id}`} required><option value="" disabled selected={!selected}>Choose an outcome</option><option value="completed" selected={selected==='completed'}>Completed</option><option value="tomorrow" selected={selected==='tomorrow'}>Tomorrow</option><option value="backlog" selected={selected==='backlog'}>Backlog</option><option value="delete" selected={selected==='delete'}>Delete</option></select></div></article>{/each}{:else}<p class="empty">Nothing unfinished remains on Today.</p>{/if}
        <button>Close Out Today</button>
      </form>
      {/key}{/key}
    </section>
  {:else if data.step==='plan'}
    <section aria-labelledby="plan-title"><div class="section-title"><h2 id="plan-title">2. {labels.plan}</h2><span>{data.tomorrowIds.length} selected</span></div><p class="muted">Select the complete list for {new Date(`${data.tomorrowDate}T12:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}. This replaces that profile’s existing {planningToday?'Today':'Tomorrow'} list.</p>
      <form method="POST" action="?/planTomorrow" class="review-stage"><input type="hidden" name="profileId" value={data.activeProfile.id}>
        <input type="hidden" name="reviewDate" value={data.date}>
        {#if data.candidates.length}<div class="task-list">{#each data.candidates as task (task.id)}<label class="select-task"><input type="checkbox" name="taskId" value={task.id} checked={data.tomorrowIds.includes(task.id)}><span><strong>{task.title}</strong><TaskMeta {task} date={data.calendarDate} /></span></label>{/each}</div>{:else}<p class="empty">No active tasks are available.</p>{/if}
        <div class="review-stage-actions"><a class="button secondary" href={resolve('/today')}>Return to Today</a><button>{labels.plan}</button></div>
      </form>
    </section>
  {:else if data.step==='focus'}
    <section aria-labelledby="focus-title"><div class="section-title"><h2 id="focus-title">3. {labels.focus}</h2><span>Up to 3</span></div><p class="muted">Only tasks selected for {planningToday?'Today':'Tomorrow'} appear here. Unchecked tasks stay in {planningToday?'today’s':'tomorrow’s'} Queue. You can return to the plan without losing your Focus choices.</p>
      <form method="POST" action="?/focusTomorrow" class="review-stage"><input type="hidden" name="profileId" value={data.activeProfile.id}>
        <input type="hidden" name="reviewDate" value={data.date}>
        {#if data.tomorrowTasks.length}<div class="task-list">{#each data.tomorrowTasks as task (task.id)}<label class="select-task"><input type="checkbox" name="taskId" value={task.id} checked={task.section==='focus'}><span><strong>{task.title}</strong><TaskMeta {task} date={data.calendarDate} /></span></label>{/each}</div>{:else}<p class="empty">Tomorrow has no tasks. Continue with an empty Focus list.</p>{/if}
        <div class="review-stage-actions"><button class="secondary" formaction="?/editPlan" name="saveFocus" value="yes">Back to plan</button><button>{labels.focus}</button></div>
      </form>
    </section>
  {:else}
    <section aria-labelledby="done-title"><div class="section-title"><h2 id="done-title">Your next day is ready</h2><span>{data.tomorrowTasks.length} {data.tomorrowTasks.length===1?'task':'tasks'}</span></div><p class="notice" role="status">Review complete for {data.activeProfile.name}. Your next plan is now Today.</p>
      {#if data.tomorrowTasks.length}<ul class="plain-list review-done-list">{#each data.tomorrowTasks as task (task.id)}<li><div><strong>{task.title}</strong> · {task.section==='focus'?'Focus':'Queue'}</div><TaskMeta {task} date={data.calendarDate} /></li>{/each}</ul>{/if}
      <div class="review-stage-actions"><form method="POST" action="?/editPlan"><input type="hidden" name="profileId" value={data.activeProfile.id}><input type="hidden" name="reviewDate" value={data.date}><button class="secondary">Edit Today’s plan</button></form><a href={resolve('/today')} class="button">Return to Today</a></div>
    </section>
  {/if}
  <details class="review-history"><summary>Review history</summary>{#if data.history.length}<ol class="history-list">{#each data.history as review (review.id)}<li><strong>{review.review_date}</strong> {#if review.editable}<a href={resolve(`/review?completed=${review.review_date}`)}>View completed review</a>{/if} <small>closed {review.closed_at}</small></li>{/each}</ol>{:else}<p class="muted">No closed reviews yet.</p>{/if}</details>
</section>
