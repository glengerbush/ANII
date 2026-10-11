<script lang="ts">
  import {resolve} from '$app/paths';
  import {enhance, deserialize} from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import Toast from '$lib/components/Toast.svelte';
  import NewProfileDialog from '$lib/components/NewProfileDialog.svelte';
  import DatabaseRestoreDialog from '$lib/components/DatabaseRestoreDialog.svelte';
  let {data,form}=$props();
  let saving=$state(false);
  let saveHandled=$state(false);
  let toast=$state<{kind:'success'|'error';message:string}|null>(null);
  const savePreferences:SubmitFunction=({cancel})=>{
    if(saving){cancel();return;}
    saving=true;saveHandled=true;toast=null;
    return async({result,update})=>{
      try{
        if(result.type==='error'){
          toast={kind:'error',message:'Could not confirm your changes were saved. Check your connection and try again.'};
          return;
        }
        await update({reset:false});
        if(result.type==='failure')toast={kind:'error',message:`Preferences were not saved. ${String(result.data?.error??'Check your entries and try again.')}`};
        else if(result.type==='success')toast={kind:'success',message:'Preferences saved.'};
      }catch{
        toast={kind:'error',message:'Could not confirm your changes were saved. Check your connection and try again.'};
      }finally{saving=false;}
    };
  };
  let testing=$state(false);
  let connection=$state<{ok:boolean;message:string}|null>(null);
  async function testConnection(event:MouseEvent){
    const button=event.currentTarget as HTMLButtonElement;if(!button.form?.reportValidity())return;
    testing=true;connection=null;
    try{
      const response=await fetch('?/testOllama',{method:'POST',body:new FormData(button.form),headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      connection=result.type==='success'?(result.data as any).connection:{ok:false,message:result.type==='failure'?String(result.data?.error):'Could not test the connection. Try again.'};
    }catch{connection={ok:false,message:'Connection test failed. Check your connection to the app server and try again.'};}
    finally{testing=false;}
  }
</script>

<svelte:head><title>Settings · Life</title></svelte:head>
<section class="page settings-page">
  <header class="page-header"><div><h1>Settings</h1><p class="muted">Data is stored on the app server.</p></div></header>
  {#if form?.error && !saveHandled}<p class="notice error" role="alert">{form.error}</p>{/if}
  {#if form?.saved && !saveHandled}<p class="notice" role="status">Preferences saved.</p>{/if}
  {#if form?.profileCreated}<p class="notice" role="status">Profile created. Your active profile did not change.</p>{/if}
  {#if form?.backedUp}<p class="notice" role="status">Database backup created.</p>{/if}
  {#if form?.imported}<p class="notice" role="status">Data restored from export. Recovery backup: <code>{form.recoveryBackupName}</code>.</p>{/if}
  {#if form?.databaseRestored}<p class="notice" role="status">Database restored. Pre-restore backup retained as <code>{form.recoveryBackupName}</code>.</p>{/if}
  {#if form?.restoreWarning}<p class="notice error" role="alert">{form.restoreWarning}</p>{/if}

  <section class="settings-group" aria-labelledby="profiles-title">
    <div class="settings-group-header"><div><h2 id="profiles-title">Profiles</h2><p>Each profile has its own Today plan, Focus, and review history. Tasks and projects are shared: completing or deleting a task affects every profile.</p></div><NewProfileDialog /></div>
    <div class="settings-card"><ul class="profile-list">{#each data.profiles as profile (profile.id)}<li><span><strong>{profile.name}</strong>{#if profile.id===data.activeProfile.id}<small>Current profile</small>{/if}</span>{#if profile.id!==data.activeProfile.id}<form method="POST" action={resolve('/profile')}><input type="hidden" name="intent" value="switch"><input type="hidden" name="profileId" value={profile.id}><input type="hidden" name="returnTo" value="/settings"><button class="secondary" aria-label={`Switch to ${profile.name}`}>Switch</button></form>{/if}</li>{/each}</ul></div>
  </section>

  <section class="settings-group" aria-labelledby="preferences-title">
    <div class="settings-group-header"><div><h2 id="preferences-title">Preferences</h2><p>Planning, appearance, and local AI behavior.</p></div></div>
    <form method="POST" action="?/save" use:enhance={savePreferences} aria-busy={saving} class="settings-card preferences-card">
      <section class="settings-subsection" aria-labelledby="planning-title"><h3 id="planning-title">Planning</h3><label>Current priorities<textarea name="currentPriorities" rows="6" placeholder="Facts AI may use when reviewing priorities">{data.settings.current_priorities}</textarea></label><div class="form-grid"><label>Daily capacity (minutes)<input name="dailyCapacity" type="number" min="0" max="1440" value={data.settings.daily_capacity_minutes}></label><label>Deadline buffer (days)<input name="deadlineBuffer" type="number" min="0" max="365" step="1" value={data.settings.deadline_buffer_days??2}></label><label>Timezone<input name="timezone" value={data.settings.timezone}></label></div><p class="muted">Start-by checks use daily capacity every calendar day, including weekends, plus this buffer. Each deadline is estimated separately; other commitments may require starting earlier.</p></section>
      <section class="settings-subsection" aria-labelledby="appearance-title"><h3 id="appearance-title">Appearance</h3><label>Theme<select name="theme"><option value="system" selected={data.settings.theme==='system'}>System</option><option value="light" selected={data.settings.theme==='light'}>Light</option><option value="dark" selected={data.settings.theme==='dark'}>Dark</option></select></label></section>
      <section class="settings-subsection" aria-labelledby="ai-title"><h3 id="ai-title">Local AI</h3><label>Ollama server URL<input name="ollamaUrl" type="url" required value={data.settings.ollama_url} placeholder="http://127.0.0.1:11434"></label><p class="muted">Address reached by the app server. For Docker with Ollama on the host, use http://host.docker.internal:11434.</p><div class="form-grid"><label>Ollama model<input name="model" value={data.settings.model}></label><label>Keep model loaded<input name="keepAlive" value={data.settings.keep_alive}></label></div><p class="muted">How long the model stays in memory after use (for example, 5m). Use 0 to unload immediately. Manual features work while Ollama is stopped.</p><div class="actions"><button type="button" class="secondary" disabled={testing} onclick={testConnection}>{testing?'Testing connection…':'Test connection'}</button></div>{#if connection}<p class:danger={!connection.ok} role="status">{connection.message}</p>{/if}</section>
      <div class="settings-save"><button disabled={saving}>{saving?'Saving…':'Save preferences'}</button></div>
    </form>
  </section>

  <section class="settings-group" aria-labelledby="backup-title">
    <div class="settings-group-header"><div><h2 id="backup-title">Backup &amp; restore</h2><p>Keep local recovery copies or move data between installations.</p></div></div>
    <div class="settings-card backup-card">
      <div><h3>SQLite backup</h3><p class="muted">Automatic backups are complete local-database <code>.db</code> snapshots. Restore accepts supported Life backups up to 10 MB and first preserves current data.</p><div class="actions"><form method="POST" action="?/backup"><button>Create backup now</button></form><DatabaseRestoreDialog /></div></div>
      <div><h3>Portable JSON</h3><p class="muted"><code>.json</code> exports include profiles, tasks, projects, plans, settings, chat, and history.</p><div class="actions"><a class="button secondary" href={resolve('/settings/export')}>Download JSON export</a></div><DatabaseRestoreDialog format="json" /><p class="muted">Restore checks the file and saves a recovery backup before replacing all app data.</p></div>
    </div>
  </section>
</section>

{#if toast}
  {#key toast}
    <Toast kind={toast.kind} message={toast.message} ondismiss={() => toast=null} />
  {/key}
{/if}
