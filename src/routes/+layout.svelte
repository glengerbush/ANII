<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { asset, resolve } from '$app/paths';
  import { tick } from 'svelte';
  let { data, children } = $props();
  let chatOpen = $state(false);
  let mobileModal = $state(false);
  let chatTrigger: HTMLButtonElement;
  let chatPanel: HTMLElement;
  let messagesPanel: HTMLElement;
  let captureInput: HTMLTextAreaElement;
  const links=[['/today','Today'],['/backlog','Backlog'],['/projects','Projects'],['/review','Review']] as const;
  let messages=$state.raw<any[]>([]);
  let nextCursor=$state<number|null>(null);
  let historyBusy=$state(false);
  let historyError=$state('');
  let sending=$state(false);
  let proposalBusy=$state(false);
  let chatError=$state('');
  let chatStatus=$state('');
  async function loadMessages(older=false){
    if(historyBusy)return;
    historyBusy=true;historyError='';
    const oldHeight=messagesPanel?.scrollHeight??0;
    try{
      const url=resolve('/chat/messages')+(older&&nextCursor?`?before=${nextCursor}`:'');
      const response=await fetch(url);if(!response.ok)throw new Error();
      const result=await response.json();
      messages=older?[...result.messages,...messages]:result.messages;nextCursor=result.nextCursor;
      await tick();if(older)messagesPanel.scrollTop+=messagesPanel.scrollHeight-oldHeight;else scrollMessagesToEnd();
    }catch{historyError='Could not load chat history. Check your connection and retry.';}
    finally{historyBusy=false;}
  }
  function isActive(path:string){return path==='/projects'?page.url.pathname==='/projects'||page.url.pathname.startsWith('/projects/'):page.url.pathname===path;}
  function payload(raw: unknown) {
    try { return JSON.parse(String(raw ?? '{}')) as { title?: string; details?: string }; }
    catch { return {}; }
  }
  async function submitChat(event: SubmitEvent) {
    event.preventDefault();if(sending)return;
    const form=event.currentTarget as HTMLFormElement;
    sending=true;chatError='';chatStatus='Saving your note and checking for tasks…';
    try{
      const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){chatError=result.type==='failure'?String(result.data?.error):'Could not save your note. Try again.';chatStatus='';return;}
      form.reset();chatStatus=result.data?.aiOffline?'Note saved. Ollama is unavailable; you can still add tasks manually.':'Note saved. Review any proposed tasks before accepting.';
      await loadMessages();
    }catch{chatStatus='';chatError='Could not confirm your note was saved. Your draft is kept. Check chat history before retrying.';}
    finally{sending=false;}
  }
  async function submitProposal(event:SubmitEvent){
    event.preventDefault();if(proposalBusy)return;
    const form=event.currentTarget as HTMLFormElement;proposalBusy=true;chatError='';
    try{
      const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type==='failure'||result.type==='error'){chatError=result.type==='failure'?String(result.data?.error):'Could not update the proposal. Try again.';return;}
      await loadMessages();await invalidateAll();
    }catch{chatError='Could not confirm the proposal update. Check your connection and refresh history before retrying.';}
    finally{proposalBusy=false;}
  }
  function switchProfile(event:Event){(event.currentTarget as HTMLSelectElement).form?.requestSubmit();}
  function syncChatMode(){mobileModal=window.matchMedia('(max-width: 48rem)').matches;}
  function scrollMessagesToEnd(){if(messagesPanel)messagesPanel.scrollTop=messagesPanel.scrollHeight;}
  async function openChat(event:MouseEvent){chatTrigger=event.currentTarget as HTMLButtonElement;syncChatMode();chatOpen=true;await tick();scrollMessagesToEnd();captureInput?.focus({preventScroll:true});void loadMessages();}
  async function closeChat(){chatOpen=false;await tick();chatTrigger?.focus();}
  function toggleChat(event:MouseEvent){if(chatOpen)void closeChat();else void openChat(event);}
  function chatKeydown(event:KeyboardEvent){
    if(!chatOpen)return;
    if(event.key==='Escape'){event.preventDefault();void closeChat();return;}
    if(!mobileModal||event.key!=='Tab')return;
    const focusable=[...chatPanel.querySelectorAll<HTMLElement>('button, textarea, input, select, a[href], summary, [tabindex]:not([tabindex="-1"])')].filter((element)=>!element.hasAttribute('disabled')&&element.tabIndex>=0&&element.getClientRects().length>0);
    if(!focusable.length){event.preventDefault();return;}
    const first=focusable[0];const last=focusable[focusable.length-1];const active=document.activeElement;
    if(event.shiftKey&&(active===first||!chatPanel.contains(active))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!chatPanel.contains(active))){event.preventDefault();first.focus();}
  }
</script>
<svelte:window onkeydown={chatKeydown} onresize={()=>{if(chatOpen)syncChatMode();}} />
<svelte:head><title>Life Management</title><meta name="description" content="Private local-first daily planning" /></svelte:head>
{#snippet profilePicker(mobile=false)}
  <form method="POST" action={resolve('/profile')} class:mobile-profile={mobile} class="profile-switch">
    <input type="hidden" name="intent" value="switch"><input type="hidden" name="returnTo" value={`${page.url.pathname}${page.url.search}`}>
    <label><span>Planning as</span><select name="profileId" aria-label="Active profile" onchange={switchProfile}>{#each data.profiles as profile (profile.id)}<option value={profile.id} selected={profile.id===data.activeProfile.id}>{profile.name}</option>{/each}</select></label>
    <noscript><button class="profile-switch-submit">Switch</button></noscript>
  </form>
{/snippet}
<div class:chat-open={chatOpen} class:theme-light={data.settings.theme==='light'} class:theme-dark={data.settings.theme==='dark'} class="shell">
  <aside class="rail" aria-label="Primary navigation" inert={chatOpen&&mobileModal}>
    <a class="brand" href={resolve('/today')} aria-label="Life — Today"><img class="brand-icon" src={asset('/icons/brand.svg')} width="48" height="48" alt="" /></a>
    {@render profilePicker()}
    <nav>{#each links as link (link[0])}<a class:active={isActive(link[0])} aria-current={isActive(link[0])?'page':undefined} href={resolve(link[0])}>{link[1]}</a>{/each}</nav>
    <nav class="rail-bottom"><a class:active={page.url.pathname==='/settings'} href={resolve('/settings')}>Settings</a></nav>
  </aside>
  <main inert={chatOpen&&mobileModal}>{@render profilePicker(true)}<button class="chat-toggle" aria-expanded={chatOpen} aria-controls="capture-chat" onclick={toggleChat}>Capture</button>{@render children()}</main>
  <aside bind:this={chatPanel} id="capture-chat" class="chat" aria-label="Capture chat" role={mobileModal?'dialog':'complementary'} aria-modal={mobileModal&&chatOpen?'true':undefined}>
    <header><div><strong>Capture</strong><small>{data.aiOnline?'AI ready':'AI offline · manual app available'}</small></div><button class="icon" aria-label="Close chat" onclick={closeChat}>×</button></header>
    <div bind:this={messagesPanel} class="messages" aria-busy={historyBusy}>
      {#if chatOpen}
      {#if historyBusy}<p role="status">Loading history…</p>{/if}
      {#if historyError}<p class="danger" role="alert">{historyError}</p><button class="secondary chat-history-action" onclick={()=>loadMessages()}>Retry history</button>{/if}
      {#if nextCursor}<button class="secondary chat-history-action" disabled={historyBusy} onclick={()=>loadMessages(true)}>Load older notes</button>{/if}
      {#if !historyBusy&&!historyError&&messages.length===0}<p class="muted">Write a messy note. Tasks change only when you accept a proposal.</p>{/if}
      {#each messages as message (`${message.id}-${message.proposal_id??'source'}`)}
        <article class:user={message.role==='user'} class:proposal={message.proposal_id}>
          <p>{message.content}</p>
          {#if message.proposal_id}
            {@const parsed=payload(message.payload)}
            <div class="proposal-title"><small>Proposed task</small><strong>{parsed.title ?? 'Untitled proposal'}</strong>{#if parsed.details}<span>{parsed.details}</span>{/if}</div>
            {#if message.status==='pending'}<div class="actions"><form method="POST" onsubmit={submitProposal} action={`${resolve('/chat')}?/accept`}><input type="hidden" name="id" value={message.proposal_id}><button disabled={proposalBusy}>Accept</button></form><details><summary>Edit</summary><form method="POST" onsubmit={submitProposal} action={`${resolve('/chat')}?/edit`} class="stack"><input type="hidden" name="id" value={message.proposal_id}><label>Title<input name="title" value={parsed.title??''} required></label><label>Notes<textarea name="details" rows="2">{parsed.details??''}</textarea></label><button class="secondary" disabled={proposalBusy}>Save edit</button></form></details><form method="POST" onsubmit={submitProposal} action={`${resolve('/chat')}?/reject`}><input type="hidden" name="id" value={message.proposal_id}><button class="secondary" disabled={proposalBusy}>Dismiss</button></form></div>{:else}<small>{message.status}{message.result_id?` · task #${message.result_id}`:''}</small>{/if}
          {/if}
        </article>
      {/each}
      {/if}
    </div>
    <form class="composer" method="POST" action={`${resolve('/chat')}?/send`} onsubmit={submitChat}><label for="capture">Capture note</label><textarea bind:this={captureInput} id="capture" name="content" rows="3" required readonly={sending} placeholder="Write anything…"></textarea><button disabled={sending||historyBusy}>{sending?'Saving…':chatError?'Retry send':'Send'}</button>{#if chatStatus}<p class="chat-feedback muted" role="status">{chatStatus}</p>{/if}{#if chatError}<p class="chat-feedback danger" role="alert">{chatError}</p><button type="button" class="secondary" disabled={historyBusy} onclick={()=>loadMessages()}>Refresh history</button>{/if}</form>
  </aside>
  <nav class="bottom-nav" aria-label="Primary navigation" inert={chatOpen&&mobileModal}>{#each links as link (link[0])}<a class:active={isActive(link[0])} aria-current={isActive(link[0])?'page':undefined} href={resolve(link[0])}>{link[1]}</a>{/each}<a href={resolve('/settings')} class:active={page.url.pathname==='/settings'} aria-current={page.url.pathname==='/settings'?'page':undefined}>Settings</a></nav>
  <button class="mobile-chat" aria-expanded={chatOpen} aria-controls="capture-chat" disabled={chatOpen&&mobileModal} inert={chatOpen&&mobileModal} onclick={openChat}>Capture</button>
</div>
