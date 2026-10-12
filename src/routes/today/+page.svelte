<script lang="ts">
  import { resolve } from '$app/paths';
  import { invalidateAll } from '$app/navigation';
  import { tick } from 'svelte';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import CompletedTasks from '$lib/components/CompletedTasks.svelte';
  import { plannedWorkLabel } from '$lib/presentation/task';
  let {data,form}=$props();
  type Section='focus'|'also';
  type DragState={task:any;section:Section;index:number;pointerId:number|null;startX:number;startY:number;active:boolean;keyboard:boolean};
  type DragTarget={section:Section;position:number;invalid:boolean};
  let focus=$derived(data.tasks.filter((t:any)=>t.section==='focus'));
  let also=$derived(data.tasks.filter((t:any)=>t.section==='also'));
  let dragging=$state<DragState|null>(null);
  let target=$state<DragTarget|null>(null);
  let announcement=$state('');
  let moving=$state(false);
  let plannedLabel=$derived(data.tasks.length?plannedWorkLabel(data.tasks):'Nothing planned yet');

  function sectionTasks(section:Section){return section==='focus'?focus:also;}
  function targetFor(section:Section,position:number):DragTarget{
    const invalid=section==='focus'&&dragging?.section!=='focus'&&focus.length>=3;
    const maximum=sectionTasks(section).length-(dragging?.section===section?1:0);
    return {section,position:Math.max(0,Math.min(position,maximum)),invalid};
  }
  function insertionIndex(section:Section){
    if(!target||target.section!==section)return -1;
    return dragging?.section===section&&target.position>=dragging.index?target.position+1:target.position;
  }
  function beginPointer(event:PointerEvent,task:any,section:Section,index:number){
    if(moving||dragging||(event.pointerType==='mouse'&&event.button!==0))return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging={task,section,index,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,active:false,keyboard:false};target=targetFor(section,index);
  }
  function updatePointerTarget(event:PointerEvent){
    if(!dragging)return;
    const element=document.elementFromPoint(event.clientX,event.clientY) as HTMLElement|null;
    const item=element?.closest<HTMLElement>('[data-drag-item]');
    const container=element?.closest<HTMLElement>('[data-drop-section]');
    if(item){
      const section=item.dataset.section as Section;const index=Number(item.dataset.index);const rect=item.getBoundingClientRect();let position=index+(event.clientY>rect.top+rect.height/2?1:0);
      if(section===dragging.section&&position>dragging.index)position-=1;
      target=targetFor(section,position);
    }else if(container){const section=container.dataset.section as Section;target=targetFor(section,sectionTasks(section).length);}
    if(event.clientY<80)window.scrollBy(0,-12);else if(event.clientY>window.innerHeight-80)window.scrollBy(0,12);
  }
  function movePointer(event:PointerEvent){
    if(!dragging||dragging.pointerId!==event.pointerId)return;
    if(!dragging.active&&Math.hypot(event.clientX-dragging.startX,event.clientY-dragging.startY)<6)return;
    dragging.active=true;event.preventDefault();updatePointerTarget(event);
  }
  async function commitDrop(){
    const source=dragging;const destination=target;
    if(!source||!destination)return cancelDrag();
    if(destination.invalid){announcement='Focus already has three tasks.';return cancelDrag(false);}
    moving=true;dragging=null;target=null;
    const body=new FormData();body.set('profileId',String(data.activeProfile.id));body.set('id',String(source.task.id));body.set('section',destination.section);body.set('position',String(destination.position));
    let moved=false;
    try {
      const response=await fetch('?/move',{method:'POST',body});
      if(!response.ok){announcement='Could not move the task. Check your connection and try again.';return;}
      announcement=`Moved ${source.task.title} to ${destination.section==='focus'?'Focus':'Queue'}, position ${destination.position+1}.`;
      await invalidateAll();
      moved=true;
    } catch {
      announcement='Could not move the task. Check your connection and try again.';
    } finally {
      moving=false;
      await tick();
      if(moved)document.querySelector<HTMLElement>(`[data-drag-handle="${source.task.id}"]`)?.focus();
    }
  }
  function endPointer(event:PointerEvent){if(!dragging||dragging.pointerId!==event.pointerId)return;const active=dragging.active;if(active)void commitDrop();else cancelDrag();}
  function cancelDrag(clearMessage=true){dragging=null;target=null;if(clearMessage)announcement='Move cancelled.';}
  function keyboardDrag(event:KeyboardEvent,task:any,section:Section,index:number){
    const key=event.key;
    if(!dragging){if(moving||key!==' '&&key!=='Enter')return;event.preventDefault();dragging={task,section,index,pointerId:null,startX:0,startY:0,active:true,keyboard:true};target=targetFor(section,index);announcement=`Picked up ${task.title}. Use arrow keys to move, Space to place, or Escape to cancel.`;return;}
    if(!dragging.keyboard||dragging.task.id!==task.id)return;
    if(key==='Escape'){event.preventDefault();cancelDrag();return;}
    if(key===' '||key==='Enter'){event.preventDefault();void commitDrop();return;}
    if(!target)return;
    if(key==='ArrowUp'){event.preventDefault();target=targetFor(target.section,target.position-1);}
    else if(key==='ArrowDown'){event.preventDefault();target=targetFor(target.section,target.position+1);}
    else if(key==='ArrowLeft'){event.preventDefault();target=targetFor('focus',target.position);}
    else if(key==='ArrowRight'){event.preventDefault();target=targetFor('also',target.position);}
    else return;
    announcement=target.invalid?'Focus already has three tasks.':`Move target: ${target.section==='focus'?'Focus':'Queue'}, position ${target.position+1}.`;
  }
  function dragControls(task:any,section:Section,index:number){return {active:Boolean(dragging?.task.id===task.id&&dragging?.active),disabled:moving,onpointerdown:(event:PointerEvent)=>beginPointer(event,task,section,index),onpointermove:movePointer,onpointerup:endPointer,onpointercancel:()=>cancelDrag(),onkeydown:(event:KeyboardEvent)=>keyboardDrag(event,task,section,index)};}
</script>
<svelte:head><title>Today · ANII</title></svelte:head>
<section class="page today-page">
  <div class="command-strip"><div><span class="command-date">{new Date(`${data.date}T12:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</span><span>{data.activeProfile.name}</span></div><div><span>{data.tasks.length} {data.tasks.length===1?'task':'tasks'}</span><span>{plannedLabel}</span></div></div>
  <header class="page-header today-header"><div><h1>Today</h1></div><div class="actions"><a class="button secondary" href={resolve('/review')}>Review</a><form method="POST" action="?/sanity"><input type="hidden" name="profileId" value={data.activeProfile.id}><button disabled={!data.tasks.length}>Check plan</button></form></div></header>
  {#if !data.tasks.length}<section class="today-start" aria-label="Start your day"><h2>{data.completedTasks.length?'All planned tasks are complete':'What would you like to do today?'}</h2><p class="muted">{data.completedTasks.length?'Your completed tasks are below. Add another task whenever you need.':'Add a task, then choose up to three priorities for Focus. Everything else stays in your Queue.'}</p><form method="POST" action="?/quickAdd" class="quick-add command-quick-add"><input type="hidden" name="profileId" value={data.activeProfile.id}><label for="quick-title">Quick add</label><input id="quick-title" name="title" required placeholder="Capture a task for today"><button>Add task</button></form><a class="button secondary" href={resolve('/backlog')}>Choose from backlog</a></section>{/if}
  {#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
  {#if form?.offline}<p class="notice">AI unavailable. Deadline and start-by checks below still ran.</p>{/if}
  {#if form?.concernResult}<p class="notice" role="status">{form.concernResult}</p>{/if}
  {#if data.warnings.length}<section class="concerns" aria-label="Automatic warnings"><h2>Needs attention</h2>{#each data.warnings as warning (`${warning.kind}-${warning.taskId}`)}<p>{warning.message}</p>{/each}</section>{/if}
  {#if form?.dueTasks}
    <section class="concerns" aria-label="Due tasks missing from Today">
      <h2>Due, but missing from Today</h2>
      {#if form.dueTasks.length}
        <p>{form.dueTasks.length} unfinished {form.dueTasks.length===1?'task is':'tasks are'} due today or overdue. Add to Queue, then choose Focus yourself.</p>
        {#each form.dueTasks as task (task.id)}
          <article>
            <strong>{task.title}</strong>
            <p>{task.due_at!.slice(0,10)<data.date?'Overdue':'Due today'} · {task.due_at}{task.duration_bucket?` · ${task.duration_bucket}`:''}{task.state==='waiting'?' · Waiting':''}{task.blocked?' · Blocked by an unfinished prerequisite':''}</p>
            <form method="POST" action="?/concern">
              <input type="hidden" name="taskId" value={task.id}><input type="hidden" name="choice" value="Add">
              <input type="hidden" name="planDate" value={data.date}><input type="hidden" name="profileId" value={data.activeProfile.id}>
              <button class="secondary">Add to Today</button>
            </form>
          </article>
        {/each}
      {:else}<p>No unfinished tasks due today or overdue are missing from this plan.</p>{/if}
    </section>
  {/if}
  {#if form?.startWarnings?.length}
    <section class="concerns" aria-label="Future deadlines to start now">
      <h2>Start ahead of the deadline</h2>
      <p>These future deadlines need attention now. Estimates use daily capacity every calendar day; competing work may require an earlier start.</p>
      {#each form.startWarnings as warning (warning.taskId)}
        <article>
          <strong>{warning.title}</strong>
          <p>Due {warning.dueAt} · {warning.startBy?`Start by ${warning.startBy}`:'Set daily capacity to calculate a start date'}</p>
          <p>{Math.round(warning.effortMinutes/60*100)/100}h remaining{warning.workDays===null?'':` (${warning.workDays} capacity days)`} + {warning.leadDays} lead-time days + {warning.bufferDays} buffer days.</p>
          {#if warning.prerequisites.length}<p>Includes unfinished prerequisites: {warning.prerequisites.map(task=>task.title).join(', ')}.</p>{/if}
          {#if warning.incompleteEstimates.length}<p>Incomplete estimates: {warning.incompleteEstimates.join(', ')}. Allow more time; update task estimates.</p>{/if}
          {#if warning.planned}<p>Already in Today. Check that enough time is allocated.</p>
          {:else}
            <form method="POST" action="?/concern">
              <input type="hidden" name="taskId" value={warning.taskId}><input type="hidden" name="choice" value="Start">
              <input type="hidden" name="planDate" value={data.date}><input type="hidden" name="profileId" value={data.activeProfile.id}>
              <button class="secondary">Add to Today</button>
            </form>
          {/if}
        </article>
      {/each}
    </section>
  {/if}
  {#if form?.concerns?.length}<section class="concerns" aria-label="Sanity check concerns"><h2>Plan suggestions</h2>{#each form.concerns as concern (concern.taskId)}<article><strong>{concern.observation}</strong><p>{concern.reason}</p><div class="actions">{#each concern.choices as choice (choice)}<form method="POST" action="?/concern"><input type="hidden" name="taskId" value={concern.taskId}><input type="hidden" name="choice" value={choice}><input type="hidden" name="planDate" value={data.date}><input type="hidden" name="profileId" value={data.activeProfile.id}><button class="secondary">{choice}</button></form>{/each}</div></article>{/each}</section>{/if}
  <p id="drag-instructions" class="sr-only">Press and drag to move this task. With a keyboard, press Space to pick up, arrow keys to move, Space to place, or Escape to cancel.</p><p class="sr-only" aria-live="polite">{announcement}</p>
  <section class="focus-section"><div class="section-title"><h2>Focus</h2><span>{focus.length}/3 priorities</span></div><div class:drop-target={target?.section==='focus'} class:drop-invalid={target?.section==='focus'&&target.invalid} class="drop-section focus-grid" data-drop-section data-section="focus" aria-busy={moving}>{#each focus as task,index (task.id)}<div class="focus-item" data-drag-item data-section="focus" data-index={index} class:dragging={dragging?.task.id===task.id&&dragging.active} class:drop-before={insertionIndex('focus')===index}><TaskCard {task} profileId={data.activeProfile.id} allTasks={data.allTasks} projects={data.projects} meta={data.taskMeta[task.id]} drag={dragControls(task,'focus',index)} mode="focus" channelIndex={index+1} date={data.date}/></div>{/each}{#each Array(Math.max(0,3-focus.length)) as _,slot (`empty-${focus.length+slot}`)}<div class="focus-empty"><span>0{focus.length+slot+1}</span><strong>Open priority</strong><small>{also.length?'Choose a task from Queue':'Room for one priority'}</small></div>{/each}<div class="drop-end-indicator" class:drop-before={insertionIndex('focus')===focus.length}></div></div></section>
  <section class="queue-section"><div class="section-title"><div><h2>Queue</h2></div><span>{also.length} {also.length===1?'task':'tasks'}</span></div><div class="queue-columns" aria-hidden="true"><span></span><span>Task</span><span>Project / status</span><span>Actions</span></div><div class:drop-target={target?.section==='also'} class="drop-section queue-list" data-drop-section data-section="also" aria-busy={moving}>{#if !also.length}<p class="empty">Nothing else planned.</p>{/if}{#each also as task,index (task.id)}<div data-drag-item data-section="also" data-index={index} class:dragging={dragging?.task.id===task.id&&dragging.active} class:drop-before={insertionIndex('also')===index}><TaskCard {task} profileId={data.activeProfile.id} allTasks={data.allTasks} projects={data.projects} meta={data.taskMeta[task.id]} drag={dragControls(task,'also',index)} mode="queue" date={data.date}/></div>{/each}<div class="drop-end-indicator" class:drop-before={insertionIndex('also')===also.length}></div></div></section>
  {#if data.tasks.length}<form method="POST" action="?/quickAdd" class="quick-add command-quick-add"><input type="hidden" name="profileId" value={data.activeProfile.id}><label for="quick-title">Quick add</label><input id="quick-title" name="title" required placeholder="Capture a task for today"><button>Add task</button></form>{/if}
  {#key data.activeProfile.id}
    <CompletedTasks tasks={data.completedTasks} allTasks={data.allTasks} projects={data.projects} taskMeta={data.taskMeta} initialOpen={data.showCompleted} />
  {/key}
</section>
