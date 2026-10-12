<script lang="ts">
  import { resolve } from '$app/paths';
  import TaskMeta from '$lib/components/TaskMeta.svelte';
  let {data,form}=$props();
  const labels={close:'Close Out Today',plan:'Plan Tomorrow',focus:'Set Tomorrow’s Focus'} as const;
  const rank={close:0,plan:1,focus:2,done:3} as const;
  function pendingOutcome(taskId:number){return form?.pendingDecisions?.find((decision:{taskId:number;outcome:string})=>decision.taskId===taskId)?.outcome;}
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
          <form method="POST" action="?/closeOut" class="review-confirm-actions"><input type="hidden" name="profileId" value={data.activeProfile.id}>
            <input type="hidden" name="reviewDate" value={form.reviewDate}>
            {#each form.pendingDecisions as decision (decision.taskId)}<input type="hidden" name="taskId" value={decision.taskId}><input type="hidden" name={`outcome-${decision.taskId}`} value={decision.outcome}>{/each}
            <a class="button secondary" href={resolve('/review')}>Cancel</a><button class="confirm-danger" name="confirmDelete" value="yes">Delete {form.confirmDeleteTasks.length} and continue</button>
          </form>
        </section>
      {/if}
      <form method="POST" action="?/closeOut" class="review-stage"><input type="hidden" name="profileId" value={data.activeProfile.id}>
        <input type="hidden" name="reviewDate" value={data.date}>
        {#if data.tasks.length}{#each data.tasks as task (task.id)}{@const selected=pendingOutcome(task.id)??task.review_outcome}<article class="review-task"><input type="hidden" name="taskId" value={task.id}><div><strong>{task.title}</strong><TaskMeta {task} date={data.date} /></div><div><label for={`outcome-${task.id}`}>Outcome for {task.title}</label><select id={`outcome-${task.id}`} name={`outcome-${task.id}`} required><option value="" disabled selected={!selected}>Choose an outcome</option><option value="completed" selected={selected==='completed'}>Completed</option><option value="tomorrow" selected={selected==='tomorrow'}>Tomorrow</option><option value="backlog" selected={selected==='backlog'}>Backlog</option><option value="waiting" selected={selected==='waiting'}>Waiting</option><option value="delete" selected={selected==='delete'}>Delete</option><option value="today" selected={selected==='today'}>Keep Today</option></select></div></article>{/each}{:else}<p class="empty">Nothing unfinished remains on Today.</p>{/if}
        <button>Close Out Today</button>
      </form>
    </section>
  {:else if data.step==='plan'}
    <section aria-labelledby="plan-title"><div class="section-title"><h2 id="plan-title">2. Plan Tomorrow</h2><span>{data.tomorrowIds.length} selected</span></div><p class="muted">Select the complete list for {new Date(`${data.tomorrowDate}T12:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}. This replaces that profile’s existing Tomorrow list.</p>
      <form method="POST" action="?/planTomorrow" class="review-stage"><input type="hidden" name="profileId" value={data.activeProfile.id}>
        <input type="hidden" name="reviewDate" value={data.date}>
        {#if data.candidates.length}<div class="task-list">{#each data.candidates as task (task.id)}<label class="select-task"><input type="checkbox" name="taskId" value={task.id} checked={data.tomorrowIds.includes(task.id)}><span><strong>{task.title}</strong><TaskMeta {task} date={data.tomorrowDate} /></span></label>{/each}</div>{:else}<p class="empty">No active tasks are available.</p>{/if}
        <div class="review-stage-actions"><a class="button secondary" href={resolve('/today')}>Return to Today</a><button>Plan Tomorrow</button></div>
      </form>
    </section>
  {:else if data.step==='focus'}
    <section aria-labelledby="focus-title"><div class="section-title"><h2 id="focus-title">3. Set Tomorrow’s Focus</h2><span>Up to 3</span></div><p class="muted">Only tasks selected for Tomorrow appear here. Unchecked tasks stay in tomorrow’s Queue. You can return to the plan without losing your Focus choices.</p>
      <form method="POST" action="?/focusTomorrow" class="review-stage"><input type="hidden" name="profileId" value={data.activeProfile.id}>
        <input type="hidden" name="reviewDate" value={data.date}>
        {#if data.tomorrowTasks.length}<div class="task-list">{#each data.tomorrowTasks as task (task.id)}<label class="select-task"><input type="checkbox" name="taskId" value={task.id} checked={task.section==='focus'}><span><strong>{task.title}</strong><TaskMeta {task} date={data.tomorrowDate} /></span></label>{/each}</div>{:else}<p class="empty">Tomorrow has no tasks. Continue with an empty Focus list.</p>{/if}
        <div class="review-stage-actions"><button class="secondary" formaction="?/editPlan" name="saveFocus" value="yes">Back to plan</button><button>Set Tomorrow’s Focus</button></div>
      </form>
    </section>
  {:else}
    <section aria-labelledby="done-title"><div class="section-title"><h2 id="done-title">Tomorrow is ready</h2><span>{data.tomorrowTasks.length} {data.tomorrowTasks.length===1?'task':'tasks'}</span></div><p class="notice" role="status">Review complete for {data.activeProfile.name}.</p>
      {#if data.tomorrowTasks.length}<ul class="plain-list review-done-list">{#each data.tomorrowTasks as task (task.id)}<li><div><strong>{task.title}</strong> · {task.section==='focus'?'Focus':'Queue'}</div><TaskMeta {task} date={data.tomorrowDate} /></li>{/each}</ul>{/if}
      <div class="review-stage-actions"><form method="POST" action="?/editPlan"><input type="hidden" name="profileId" value={data.activeProfile.id}><input type="hidden" name="reviewDate" value={data.date}><button class="secondary">Edit tomorrow’s plan</button></form><a href={resolve('/today')} class="button">Return to Today</a></div>
    </section>
  {/if}
  <details class="review-history"><summary>Review history</summary>{#if data.history.length}<ol class="history-list">{#each data.history as review (review.id)}<li><strong>{review.review_date}</strong> <small>closed {review.closed_at}</small></li>{/each}</ol>{:else}<p class="muted">No closed reviews yet.</p>{/if}</details>
</section>
