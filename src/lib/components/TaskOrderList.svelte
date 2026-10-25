<script lang="ts">
  import {deserialize} from '$app/forms';
  import {invalidateAll} from '$app/navigation';
  import {tick, type Snippet} from 'svelte';
  import {captureTaskPosition} from '$lib/task-scroll';
  import {getTaskSaves} from '$lib/task-save-context';

  type DragControls={active:boolean;disabled:boolean;instructionsId:string;onpointerdown:(event:PointerEvent)=>void;onpointermove:(event:PointerEvent)=>void;onpointerup:(event:PointerEvent)=>void;onpointercancel:()=>void;onkeydown:(event:KeyboardEvent)=>void};
  let {tasks,listId,label,fields={},children}:{tasks:any[];listId:string;label:string;fields?:Record<string,string>;children:Snippet<[any,DragControls]>}=$props();
  type DragState={task:any;index:number;pointerId:number|null;startX:number;startY:number;active:boolean;keyboard:boolean};
  const taskSaves=getTaskSaves();
  let dragging=$state<DragState|null>(null);
  let target=$state<number|null>(null);
  let moving=$state(false);
  let moveError=$state('');
  let announcement=$state('');
  const instructionsId=$derived(`order-help-${listId}`);
  let insertionIndex=$derived(!dragging||target===null?-1:target>=dragging.index?target+1:target);
  function targetFor(position:number){return Math.max(0,Math.min(position,tasks.length-1));}
  function beginPointer(event:PointerEvent,task:any,index:number){
    if(moving||dragging||(event.pointerType==='mouse'&&event.button!==0))return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging={task,index,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,active:false,keyboard:false};target=index;
  }
  function movePointer(event:PointerEvent){
    if(!dragging||dragging.pointerId!==event.pointerId)return;
    if(!dragging.active&&Math.hypot(event.clientX-dragging.startX,event.clientY-dragging.startY)<6)return;
    dragging.active=true;event.preventDefault();
    const element=document.elementFromPoint(event.clientX,event.clientY);
    const item=element?.closest<HTMLElement>('[data-drag-item]');
    const container=element?.closest<HTMLElement>('[data-order-list]');
    if(container?.dataset.orderList!==listId)target=null;
    else if(item){
      const index=Number(item.dataset.index),rect=item.getBoundingClientRect();
      let position=index+(event.clientY>rect.top+rect.height/2?1:0);
      if(position>dragging.index)position-=1;
      target=targetFor(position);
    }else target=targetFor(tasks.length-1);
    if(event.clientY<80)window.scrollBy(0,-12);else if(event.clientY>window.innerHeight-80)window.scrollBy(0,12);
  }
  function cancelDrag(){dragging=null;target=null;announcement='Move cancelled.';}
  function endPointer(event:PointerEvent){if(!dragging||dragging.pointerId!==event.pointerId)return;if(dragging.active)void commitDrop();else cancelDrag();}
  async function commitDrop(){
    const source=dragging,position=target;
    if(!source||position===null||position===source.index)return cancelDrag();
    const neighbors=tasks.filter(task=>task.id!==source.task.id),anchor=neighbors[position]??neighbors.at(-1);
    if(!anchor)return cancelDrag();
    const body=new FormData();for(const [key,value] of Object.entries(fields))body.set(key,value);
    body.set('taskId',String(source.task.id));body.set('anchorId',String(anchor.id));body.set('edge',neighbors[position]?'before':'after');
    const restore=captureTaskPosition(source.task.id);
    moving=true;moveError='';dragging=null;target=null;let saved=false;
    try{
      if(!await taskSaves.flush()){moveError='Save your task edits before moving it.';return;}
      saved=true;
      const response=await fetch('?/move',{method:'POST',body,headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){moveError=result.type==='failure'?String(result.data?.error??'Could not move the task.'):'Could not move the task. Try again.';return;}
      await invalidateAll();announcement=`Moved ${source.task.title} in ${label}, position ${position+1}.`;
    }catch{moveError='Could not move the task. Check your connection and try again.';}
    finally{moving=false;await tick();await restore();if(saved)document.querySelector<HTMLElement>(`[data-drag-handle="${source.task.id}"]`)?.focus({preventScroll:true});}
  }
  function keyboardDrag(event:KeyboardEvent,task:any,index:number){
    const key=event.key;
    if(!dragging){
      if(moving||(key!==' '&&key!=='Enter'))return;
      event.preventDefault();dragging={task,index,pointerId:null,startX:0,startY:0,active:true,keyboard:true};target=index;
      announcement=`Picked up ${task.title}. Use up and down arrows to move, Space to place, or Escape to cancel.`;return;
    }
    if(!dragging.keyboard||dragging.task.id!==task.id)return;
    if(key==='Escape'||key==='Tab'){if(key==='Escape')event.preventDefault();cancelDrag();return;}
    if(key===' '||key==='Enter'){event.preventDefault();void commitDrop();return;}
    if(!['ArrowUp','ArrowDown','Home','End'].includes(key))return;
    event.preventDefault();target=targetFor(key==='Home'?0:key==='End'?tasks.length-1:(target??index)+(key==='ArrowDown'?1:-1));
    announcement=`Move target: ${label}, position ${target+1}.`;
  }
  function controls(task:any,index:number):DragControls{return {active:Boolean(dragging?.task.id===task.id&&dragging?.active),disabled:moving,instructionsId,onpointerdown:(event)=>beginPointer(event,task,index),onpointermove:movePointer,onpointerup:endPointer,onpointercancel:cancelDrag,onkeydown:(event)=>keyboardDrag(event,task,index)};}
</script>
<p id={instructionsId} class="sr-only">Drag to reorder. With a keyboard, press Space to pick up, up and down arrows to move, Space to place, or Escape to cancel.</p>
<p class="sr-only" role="status">{announcement}</p>
{#if moving}<p class="muted" role="status">Saving order…</p>{/if}
{#if moveError}<p class="notice error" role="alert">{moveError}</p>{/if}
<div class="task-list" data-order-list={listId} aria-busy={moving}>
  {#each tasks as task,index (task.id)}
    <div data-drag-item data-index={index} class:dragging={dragging?.task.id===task.id&&dragging?.active} class:drop-before={insertionIndex===index}>
      {@render children(task,controls(task,index))}
    </div>
  {/each}
  <div class="drop-end-indicator" class:drop-before={insertionIndex===tasks.length}></div>
</div>
