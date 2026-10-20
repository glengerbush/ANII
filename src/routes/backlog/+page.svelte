<script lang="ts">
  import {deserialize} from '$app/forms';
  import {invalidateAll} from '$app/navigation';
  import {tick} from 'svelte';
  import {getTaskSaves} from '$lib/task-save-context';
  import {resolve} from '$app/paths';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import CompletedTasks from '$lib/components/CompletedTasks.svelte';
  let {data,form}=$props();
  let filtered=$derived(Boolean(data.filters.q||data.filters.project||data.filters.state||data.filters.due));
  let stateAction=$derived(`?/state&${new URLSearchParams({q:data.filters.q,project:String(data.filters.project??''),state:data.filters.state??'',due:data.filters.due?'1':''})}`);
  let nowAction=$derived(stateAction.replace('?/state&','?/plan&'));

  type Group='queued'|'unqueued';
  type DragState={task:any;group:Group;index:number;pointerId:number|null;startX:number;startY:number;active:boolean;keyboard:boolean};
  const taskSaves=getTaskSaves();
  const groups:Group[]=['queued','unqueued'];
  let queued=$derived(data.tasks.filter((task:any)=>task.queued));
  let unqueued=$derived(data.tasks.filter((task:any)=>!task.queued));
  let dragging=$state<DragState|null>(null);
  let target=$state<number|null>(null);
  let moving=$state(false);
  let moveError=$state('');
  let announcement=$state('');
  function groupTasks(group:Group){return group==='queued'?queued:unqueued;}
  function groupLabel(group:Group){return group==='queued'?'Queued up':'Not queued';}
  function targetFor(position:number){return dragging?Math.max(0,Math.min(position,groupTasks(dragging.group).length-1)):0;}
  function insertionIndex(group:Group){
    if(!dragging||dragging.group!==group||target===null)return -1;
    return target>=dragging.index?target+1:target;
  }
  function beginPointer(event:PointerEvent,task:any,group:Group,index:number){
    if(moving||dragging||(event.pointerType==='mouse'&&event.button!==0))return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging={task,group,index,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,active:false,keyboard:false};
    target=index;
  }
  function movePointer(event:PointerEvent){
    if(!dragging||dragging.pointerId!==event.pointerId)return;
    if(!dragging.active&&Math.hypot(event.clientX-dragging.startX,event.clientY-dragging.startY)<6)return;
    dragging.active=true;event.preventDefault();
    const element=document.elementFromPoint(event.clientX,event.clientY);
    const item=element?.closest<HTMLElement>('[data-drag-item]');
    const container=element?.closest<HTMLElement>('[data-backlog-group]');
    if(container?.dataset.backlogGroup!==dragging.group){target=null;}
    else if(item){
      const index=Number(item.dataset.index),rect=item.getBoundingClientRect();
      let position=index+(event.clientY>rect.top+rect.height/2?1:0);
      if(position>dragging.index)position-=1;
      target=targetFor(position);
    }else target=targetFor(groupTasks(dragging.group).length-1);
    if(event.clientY<80)window.scrollBy(0,-12);else if(event.clientY>window.innerHeight-80)window.scrollBy(0,12);
  }
  function cancelDrag(){dragging=null;target=null;announcement='Move cancelled.';}
  function endPointer(event:PointerEvent){
    if(!dragging||dragging.pointerId!==event.pointerId)return;
    if(dragging.active)void commitDrop();else cancelDrag();
  }
  async function commitDrop(){
    const source=dragging,position=target;
    if(!source||position===null||position===source.index)return cancelDrag();
    const neighbors=groupTasks(source.group).filter((task:any)=>task.id!==source.task.id);
    const anchor=neighbors[position]??neighbors.at(-1);
    if(!anchor)return cancelDrag();
    const edge=neighbors[position]?'before':'after';
    const profile=data.activeProfile.id,date=data.date;
    moving=true;moveError='';dragging=null;target=null;
    let saved=false;
    try{
      if(!await taskSaves.flush()){moveError='Save your task edits before moving it.';return;}
      saved=true;
      const body=new FormData();
      body.set('profileId',String(profile));body.set('planDate',date);body.set('taskId',String(source.task.id));
      body.set('anchorId',String(anchor.id));body.set('edge',edge);body.set('group',source.group);
      const response=await fetch('?/move',{method:'POST',body,headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){moveError=result.type==='failure'?String(result.data?.error??'Could not move the task.'):'Could not move the task. Try again.';return;}
      await invalidateAll();
      announcement=`Moved ${source.task.title} in ${groupLabel(source.group)}, position ${position+1}.`;
    }catch{moveError='Could not move the task. Check your connection and try again.';}
    finally{
      moving=false;await tick();
      if(saved)document.querySelector<HTMLElement>(`[data-drag-handle="${source.task.id}"]`)?.focus();
    }
  }
  function keyboardDrag(event:KeyboardEvent,task:any,group:Group,index:number){
    const key=event.key;
    if(!dragging){
      if(moving||(key!==' '&&key!=='Enter'))return;
      event.preventDefault();dragging={task,group,index,pointerId:null,startX:0,startY:0,active:true,keyboard:true};target=index;
      announcement=`Picked up ${task.title}. Use up and down arrows to move within ${groupLabel(group)}, Space to place, or Escape to cancel.`;return;
    }
    if(!dragging.keyboard||dragging.task.id!==task.id)return;
    if(key==='Escape'||key==='Tab'){if(key==='Escape')event.preventDefault();cancelDrag();return;}
    if(key===' '||key==='Enter'){event.preventDefault();void commitDrop();return;}
    if(key!=='ArrowUp'&&key!=='ArrowDown'&&key!=='Home'&&key!=='End')return;
    event.preventDefault();
    target=targetFor(key==='Home'?0:key==='End'?groupTasks(group).length-1:(target??index)+(key==='ArrowDown'?1:-1));
    announcement=`Move target: ${groupLabel(group)}, position ${target+1}.`;
  }
  function dragControls(task:any,group:Group,index:number){return {active:Boolean(dragging?.task.id===task.id&&dragging?.active),disabled:moving,onpointerdown:(event:PointerEvent)=>beginPointer(event,task,group,index),onpointermove:movePointer,onpointerup:endPointer,onpointercancel:cancelDrag,onkeydown:(event:KeyboardEvent)=>keyboardDrag(event,task,group,index)};}
</script>
<svelte:head><title>Backlog · ANII</title></svelte:head>
<section class="page wide backlog-page"><header class="page-header"><div><h1>Backlog</h1></div></header>
{#if form?.error}<p class="notice error" role="alert">{form.error}</p>{/if}
<div class="task-filters"><form method="GET" class="filters filter-panel"><label>Search<input type="search" name="q" value={data.filters.q} placeholder="Title or notes"></label><label>Project<select name="project"><option value="">All</option>{#each data.projects as project (project.id)}<option value={project.id} selected={project.id===data.filters.project}>{project.name}</option>{/each}</select></label><label>State<select name="state"><option value="">Unfinished</option><option value="blocked" selected={data.filters.state==='blocked'}>Blocked</option></select></label><label>Due<select name="due"><option value="">Any</option><option value="1" selected={data.filters.due}>Has due date</option></select></label><button>Apply filters</button><a class="button secondary" href={resolve('/backlog')}>Clear filters</a></form></div>
<p id="drag-instructions" class="sr-only">Press and drag to reorder within this group. With a keyboard, press Space to pick up, up and down arrows to move, Space to place, or Escape to cancel.</p>
<p class="sr-only" role="status">{announcement}</p>
{#if moving}<p class="move-pending" role="status">Saving order…</p>{/if}
{#if moveError}<p class="notice error" role="alert">{moveError}</p>{/if}
{#if data.tasks.length}
  {#each groups as group (group)}
    <section class="backlog-group" aria-labelledby={`backlog-${group}`}>
      <h2 id={`backlog-${group}`}>{groupLabel(group)} <span>{groupTasks(group).length}</span></h2>
      <div class="task-list" data-backlog-group={group} aria-busy={moving}>
        {#each groupTasks(group) as task,index (task.id)}
          <div data-drag-item data-index={index} class:dragging={dragging?.task.id===task.id&&dragging?.active} class:drop-before={insertionIndex(group)===index}>
            <TaskCard {task} profileId={data.activeProfile.id} allTasks={data.allTasks} projects={data.projects} profiles={data.profiles} meta={data.taskMeta[task.id]} planningControls={false} date={data.calendarDate} planDate={data.date} {nowAction} inNow={group==='queued'} {stateAction} drag={dragControls(task,group,index)} mode="list"/>
          </div>
        {:else}<p class="group-empty">{filtered?'No matching tasks in this group.':group==='queued'?'Queue up a task to add it to Now.':'All unfinished tasks are queued up.'}</p>{/each}
        <div class="drop-end-indicator" class:drop-before={insertionIndex(group)===groupTasks(group).length}></div>
      </div>
    </section>
  {/each}
{:else}<div class="empty">{#if filtered}<p>No tasks match these filters.</p><a href={resolve('/backlog')}>Clear filters</a>{:else}<p>No unfinished tasks. Add a task below, then use Queue up to plan it.</p><a href="#backlog-title">Add your first task</a>{/if}</div>{/if}
<form method="POST" action="?/create" class="quick-add"><label for="backlog-title">Add to backlog</label><input id="backlog-title" name="title" required placeholder="New task"><button>Add</button></form>
<CompletedTasks profileId={data.activeProfile.id} planDate={data.date} tasks={data.completedTasks} allTasks={data.allTasks} projects={data.projects} profiles={data.profiles} taskMeta={data.taskMeta} {stateAction} initialOpen={data.showCompleted} />
</section>

<style>
  .backlog-group { margin-block: 1.25rem; }
  .backlog-group h2 { display: flex; gap: .6rem; align-items: baseline; margin: 0 0 .5rem; font-size: .85rem; }
  .backlog-group h2 span { color: var(--muted); font-size: .75rem; font-weight: 400; }
  .group-empty, .move-pending { color: var(--muted); font-size: .8rem; margin: .5rem 0; }
</style>
