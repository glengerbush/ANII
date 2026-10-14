<script lang="ts">
  import {onMount, tick} from 'svelte';
  import {MIN_AI_TIMEOUT_SECONDS, MAX_AI_TIMEOUT_SECONDS, comparableOllamaUrl, aiProvider, type OllamaConnection} from '$lib/ollama';
  import {memoryPreference, modelMemory} from '$lib/model-memory';
  import {resolve} from '$app/paths';
  import {enhance, deserialize} from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import Toast from '$lib/components/Toast.svelte';
  import ModelMemory from '$lib/components/ModelMemory.svelte';
  import ProfileActions from '$lib/components/ProfileActions.svelte';
  import NewProfileDialog from '$lib/components/NewProfileDialog.svelte';
  import DatabaseRestoreDialog from '$lib/components/DatabaseRestoreDialog.svelte';
  let {data,form}=$props();
  let preferencesForm:HTMLFormElement;
  let trackingReady=$state(false);
  let changed=$state(false);
  let savedPreferences='';
  function preferenceSnapshot(values:FormData){
    const entries=[...values.entries()].filter(([key])=>!key.startsWith('memory'));
    try{entries.push(['keepAlive',JSON.stringify(modelMemory(memoryPreference(values,data.settings.keep_alive)))]);}
    catch{entries.push(...[...values.entries()].filter(([key])=>key.startsWith('memory')));}
    return JSON.stringify(entries.sort(([a],[b])=>a.localeCompare(b)));
  }
  onMount(()=>{
    savedPreferences=preferenceSnapshot(new FormData(preferencesForm));
    trackingReady=true;
  });
  async function checkChanges(){
    // Let bound values and enabled duration fields settle before reading them.
    await tick();
    changed=preferenceSnapshot(new FormData(preferencesForm))!==savedPreferences;
  }
  let saving=$state(false);
  let saveHandled=$state(false);
  let toast=$state<{kind:'success'|'error';message:string}|null>(null);
  const savePreferences:SubmitFunction=({cancel})=>{
    if(saving || !changed){cancel();return;}
    saving=true;saveHandled=true;toast=null;
    return async({result,update})=>{
      try{
        if(result.type==='error'){
          toast={kind:'error',message:'Could not confirm your changes were saved. Check your connection and try again.'};
          return;
        }
        await update({reset:false});
        if(result.type==='failure')toast={kind:'error',message:`Preferences were not saved. ${String(result.data?.error??'Check your entries and try again.')}`};
        else if(result.type==='success'){
          await tick();
          savedPreferences=preferenceSnapshot(new FormData(preferencesForm));
          changed=false;
          toast={kind:'success',message:'Preferences saved.'};
        }
      }catch{
        toast={kind:'error',message:'Could not confirm your changes were saved. Check your connection and try again.'};
      }finally{saving=false;}
    };
  };
  let provider=$derived(aiProvider(data.settings.ai_provider));
  let ollamaUrl=$derived(data.settings.ollama_url);
  let selectedModel=$derived(data.settings.model);
  let testing=$state(false);
  let testingUrl=$state('');
  let refreshingModels=$state(false);
  let connection=$derived<OllamaConnection>(data.ollamaConnection);
  const currentConnection=$derived(connection?.url===comparableOllamaUrl(ollamaUrl)&&(connection.provider??'ollama')===provider?connection:null);
  const models=$derived(currentConnection?.ok?currentConnection.models:[]);
  const modelAvailable=$derived(models.includes(selectedModel));
  const modelDisabled=$derived(!currentConnection?.ok || !models.length);
  const unsavedAddress=$derived(comparableOllamaUrl(ollamaUrl)!==comparableOllamaUrl(data.settings.ollama_url)||provider!==data.settings.ai_provider);
  async function testConnection(event:MouseEvent,refreshModels=false){
    if(testing)return;
    const button=event.currentTarget as HTMLButtonElement;
    const address=button.form?.elements.namedItem('ollamaUrl') as HTMLInputElement|null;
    if(!address?.reportValidity())return;
    const requested=comparableOllamaUrl(ollamaUrl),requestedProvider=provider;
    testing=true;refreshingModels=refreshModels;testingUrl=requested;
    const body=new FormData();body.set('ollamaUrl',ollamaUrl);body.set('aiProvider',provider);
    try{
      const response=await fetch('?/testOllama',{method:'POST',body,headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(comparableOllamaUrl(ollamaUrl)!==requested||provider!==requestedProvider)return;
      connection=result.type==='success'?(result.data as {connection:OllamaConnection}).connection:{url:requested,provider:requestedProvider,ok:false,models:[],message:result.type==='failure'?String(result.data?.error):'Could not test the connection. Try again.'};
      if(connection.ok&&connection.models.length===1)selectedModel=connection.models[0];
    }catch{
      if(comparableOllamaUrl(ollamaUrl)===requested&&provider===requestedProvider)connection={url:requested,provider:requestedProvider,ok:false,models:[],message:'Connection test failed. Check your connection to ANII and try again.'};
    }finally{testing=false;refreshingModels=false;await checkChanges();}
  }
</script>

<svelte:head><title>Settings · ANII</title></svelte:head>
<section class="page settings-page">
  <header class="page-header"><div><h1>Settings</h1><p class="muted">Data is stored on the app server.</p></div></header>
  {#if form?.error && !saveHandled}<p class="notice error" role="alert">{form.error}</p>{/if}
  {#if form?.saved && !saveHandled}<p class="notice" role="status">Preferences saved.</p>{/if}
  {#if form?.profileCreated}<p class="notice" role="status">Profile created. Your active profile did not change.</p>{/if}
  {#if form?.profileRenamed}<p class="notice" role="status">Profile renamed to {form.profileRenamed}.</p>{/if}
  {#if form?.profileDeleted}<p class="notice" role="status">Profile {form.profileDeleted} deleted.</p>{/if}
  {#if form?.backedUp}<p class="notice" role="status">Database backup created.</p>{/if}
  {#if form?.imported}<p class="notice" role="status">Data restored from export. Recovery backup: <code>{form.recoveryBackupName}</code>.</p>{/if}
  {#if form?.databaseRestored}<p class="notice" role="status">Database restored. Pre-restore backup retained as <code>{form.recoveryBackupName}</code>.</p>{/if}
  {#if form?.restoreWarning}<p class="notice error" role="alert">{form.restoreWarning}</p>{/if}

  <section class="settings-group" aria-labelledby="profiles-title">
    <div class="settings-group-header"><div><h2 id="profiles-title" tabindex="-1">Profiles</h2><p>Each profile has its own Today plan, Focus, and review history. Tasks and projects are shared: completing or deleting a task affects every profile.</p></div><NewProfileDialog /></div>
    <div class="settings-card"><ul class="profile-list">{#each data.profiles as profile (profile.id)}<li><span><strong>{profile.name}</strong>{#if profile.id===data.activeProfile.id}<small>Current profile</small>{/if}</span><div class="profile-row-actions">{#if profile.id!==data.activeProfile.id}<form method="POST" action={resolve('/profile')}><input type="hidden" name="intent" value="switch"><input type="hidden" name="profileId" value={profile.id}><input type="hidden" name="returnTo" value="/settings"><button class="secondary" aria-label={`Switch to ${profile.name}`}>Switch</button></form>{/if}<ProfileActions {profile} canDelete={data.profiles.length>1} oncomplete={message => { toast={kind:'success',message}; }} /></div></li>{/each}</ul></div>
  </section>

  <section class="settings-group" aria-labelledby="preferences-title">
    <div class="settings-group-header"><div><h2 id="preferences-title">Preferences</h2><p>Planning, appearance, and local AI behavior.</p></div></div>
    <form method="POST" action="?/save" bind:this={preferencesForm} oninput={checkChanges} onchange={checkChanges} use:enhance={savePreferences} aria-busy={saving} inert={saving} class="settings-card preferences-card">
      <section class="settings-subsection" aria-labelledby="planning-title"><h3 id="planning-title">Planning</h3><label>Current priorities<textarea name="currentPriorities" rows="6" placeholder="Facts AI may use when reviewing priorities">{data.settings.current_priorities}</textarea></label><div class="form-grid"><label>Daily capacity (minutes)<input name="dailyCapacity" type="number" min="0" max="1440" value={data.settings.daily_capacity_minutes}></label><label>Deadline buffer (days)<input name="deadlineBuffer" type="number" min="0" max="365" step="1" value={data.settings.deadline_buffer_days??2}></label><label>Timezone<input name="timezone" value={data.settings.timezone}></label></div><p class="muted">Start-by checks use daily capacity every calendar day, including weekends, plus this buffer. Each deadline is estimated separately; other commitments may require starting earlier.</p></section>
      <section class="settings-subsection" aria-labelledby="appearance-title"><h3 id="appearance-title">Appearance</h3><label>Theme<select name="theme"><option value="system" selected={data.settings.theme==='system'}>System</option><option value="light" selected={data.settings.theme==='light'}>Light</option><option value="dark" selected={data.settings.theme==='dark'}>Dark</option></select></label></section>
      <section class="settings-subsection" aria-labelledby="ai-title">
        <h3 id="ai-title">Local AI</h3>
        <label>AI provider<select name="aiProvider" bind:value={provider}><option value="ollama">Ollama</option><option value="llamacpp">llama.cpp</option></select></label>
        <label>AI server URL<input name="ollamaUrl" type="url" required bind:value={ollamaUrl} placeholder="http://127.0.0.1:11434"></label>
        <p class="muted">Address reached by the ANII server. Containers must share a network. For llama.cpp, enter the server address with or without /v1.</p>
        <div class="ollama-connection">
          <button type="button" class="secondary" disabled={testing} onclick={event=>testConnection(event)}>{testing&&!refreshingModels?'Testing…':'Test connection'}</button>
          <span role="status" aria-live="polite">
            {#if testing && testingUrl===comparableOllamaUrl(ollamaUrl)}
              <span class="connection-pill">Checking…</span>
            {:else if currentConnection}
              <span class="connection-pill" class:connected={currentConnection.ok} class:disconnected={!currentConnection.ok}>{currentConnection.ok?'Connected':'Connection failed'}</span>
            {:else}<span class="connection-pill">Not checked</span>{/if}
          </span>
        </div>
        <div aria-live="polite">
          {#if currentConnection}
            <p class:danger={!currentConnection.ok} class="connection-message">{currentConnection.message}</p>
            {#if currentConnection.ok && unsavedAddress}<p class="muted connection-message">Save preferences to use this address.</p>{/if}
          {:else}<p class="muted connection-message">Test this address to load its available models.</p>{/if}
        </div>
        <div class="ollama-models">
          <div class="model-heading">
            <label for="ollama-model">Available models</label>
            <button type="button" class="icon model-refresh" disabled={testing} onclick={event=>testConnection(event,true)} aria-label="Refresh Available models" title="Refresh Available models" aria-busy={refreshingModels}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" /></svg>
            </button>
          </div>
          {#if models.length===1 && modelAvailable}
            <input id="ollama-model" name="model" value={selectedModel} readonly aria-describedby="model-help">
          {:else}
          <select id="ollama-model" name="model" bind:value={selectedModel} disabled={modelDisabled} aria-describedby="model-help" aria-busy={refreshingModels}>
            {#if !modelAvailable}<option value={selectedModel} disabled>{selectedModel} — {currentConnection?.ok?'not installed':'not verified'}</option>{/if}
            {#each models as model (model)}<option value={model}>{model}</option>{/each}
          </select>
          {/if}
        </div>
        {#if modelDisabled || !modelAvailable}<input type="hidden" name="model" value={selectedModel}>{/if}
        <p id="model-help" class:danger={currentConnection?.ok && !modelAvailable} class="muted">{currentConnection?.ok?modelAvailable?'Connection status confirms reachability. Send a chat message to verify generation.':models.length?'The selected model is not installed on this server. Select an available model.':'Load a model on your AI server, then refresh the list.':'Your saved model is kept. Connect to your AI server to choose another.'}</p>
        <label>AI request timeout (seconds)<input name="aiTimeout" type="number" min={MIN_AI_TIMEOUT_SECONDS} max={MAX_AI_TIMEOUT_SECONDS} step="1" required value={data.settings.ai_timeout_seconds} aria-describedby="timeout-help"></label>
        <p id="timeout-help" class="muted">Wait up to this long for Capture and plan reviews, including model loading. 5–600 seconds. Connection checks use 3 seconds.</p>
        {#if provider==='ollama'}{#key data.settings.keep_alive}<ModelMemory value={data.settings.keep_alive} />{/key}{:else}<p class="muted">Model loading, memory, context capacity, and thinking are configured on the llama.cpp server.</p>{/if}
        <p class="muted">Manual features work while AI is stopped.</p>
      </section>
      <div class="settings-save"><button disabled={saving || (trackingReady && !changed)}>{saving?'Saving…':'Save preferences'}</button></div>
    </form>
  </section>

  <section class="settings-group" aria-labelledby="backup-title">
    <div class="settings-group-header"><div><h2 id="backup-title">Backup &amp; restore</h2><p>Keep local recovery copies or move data between installations.</p></div></div>
    <div class="settings-card backup-card">
      <div><h3>SQLite backup</h3><p class="muted">Automatic backups are complete local-database <code>.db</code> snapshots. Restore accepts supported ANII backups up to 10 MB and first preserves current data.</p><div class="actions"><form method="POST" action="?/backup" use:enhance><button>Create backup now</button></form><DatabaseRestoreDialog /></div></div>
      <div><h3>Portable JSON</h3><p class="muted"><code>.json</code> exports include profiles, tasks, projects, plans, settings, chat, and history.</p><div class="actions"><a class="button secondary" href={resolve('/settings/export')}>Download JSON export</a></div><DatabaseRestoreDialog format="json" /><p class="muted">Restore checks the file and saves a recovery backup before replacing all app data.</p></div>
    </div>
  </section>
</section>

{#if toast}
  {#key toast}
    <Toast kind={toast.kind} message={toast.message} ondismiss={() => toast=null} />
  {/key}
{/if}

<style>
  .ollama-connection { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem .75rem; }
  .model-heading { display: flex; align-items: center; gap: .25rem; }
  .model-heading label { margin: 0; }
  .model-refresh { display: grid; place-items: center; }
  .connection-pill { display: inline-flex; padding: .2rem .65rem; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: .875rem; font-weight: 600; }
  .connection-pill.connected { color: var(--green); background: var(--green-fill); border-color: var(--green); }
  .connection-pill.disconnected { color: var(--red); background: var(--red-fill); border-color: var(--red); }
  .connection-message { margin: 0; overflow-wrap: anywhere; }
  .profile-row-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
  .profile-list li { flex-wrap: wrap; }
  .profile-list li > span { min-width: 0; overflow-wrap: anywhere; flex: 1 1 10rem; }
</style>
