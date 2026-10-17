<script lang="ts">
  import { deserialize } from '$app/forms';
  import { invalidate } from '$app/navigation';
  let { settings }:{settings:Record<string,string>}=$props();
  let appearance=$derived({theme:settings.theme,focusLayout:settings.focus_layout==='now'?'now':'equal'});
  let saving=$state(false);
  let saved=$state(false);
  let error=$state('');
  const focusLayouts=[
    {value:'equal',title:'Three priorities',description:'Three tasks, equal emphasis.'},
    {value:'now',title:'Now & on deck',description:'One task with notes. Two on deck.'}
  ];

  async function saveAppearance(){
    if(saving)return;
    saving=true;saved=false;error='';
    try{
      const response=await fetch('?/appearance',{method:'POST',body:new URLSearchParams(appearance),headers:{'x-sveltekit-action':'true'}});
      const result=deserialize(await response.text());
      if(result.type!=='success'){
        error=result.type==='failure'?String(result.data?.error??'Could not save appearance. Try again.'):'Could not save appearance. Try again.';
        return;
      }
      // Refresh the shell's theme without reloading the other preferences drafts.
      await invalidate('app:appearance');
      saved=true;
    }catch{error='Could not confirm appearance was saved. Check your connection and retry.';}
    finally{saving=false;}
  }
  function changeAppearance(event:Event){
    const control=event.target;
    if(!(control instanceof HTMLInputElement||control instanceof HTMLSelectElement))return;
    if(control.name!=='theme'&&control.name!=='focusLayout')return;
    appearance={...appearance,[control.name]:control.value};
    void saveAppearance();
  }
</script>

<form method="POST" action="?/appearance" class="settings-card appearance-card" aria-labelledby="appearance-title" aria-busy={saving} onchange={changeAppearance}>
  <div class="appearance-heading"><h3 id="appearance-title">Appearance</h3><span class="muted" role="status">{saving?'Saving…':saved?'Saved':'Changes save automatically'}</span></div>
  <fieldset class="appearance-controls" disabled={saving}>
    <fieldset class="focus-layout-setting">
      <legend>Focus layout</legend>
      <div class="focus-layout-options">
        {#each focusLayouts as layout (layout.value)}
          <label class="focus-layout-option">
            <span class="option-copy">
              <span class="option-title"><input type="radio" name="focusLayout" value={layout.value} checked={appearance.focusLayout===layout.value} aria-labelledby={`focus-${layout.value}-title`} aria-describedby={`focus-${layout.value}-description`}><span id={`focus-${layout.value}-title`}>{layout.title}</span></span>
              <span class="option-description" id={`focus-${layout.value}-description`}>{layout.description}</span>
            </span>
            <span class="layout-preview" class:layout-now={layout.value==='now'} aria-hidden="true">
              {#each ['work','personal','home'] as project (project)}
                <span class="preview-task">
                  {#if layout.value==='now'&&project==='work'}<span class="preview-caption">Now</span>{/if}
                  <span class="preview-line"></span>
                  {#if layout.value==='now'&&project==='work'}<span class="preview-caption">Notes...</span>{:else}<span class="preview-line short"></span>{/if}
                  <span class="preview-badge" class:personal={project==='personal'} class:home={project==='home'}></span>
                </span>
              {/each}
            </span>
          </label>
        {/each}
      </div>
    </fieldset>
    <label>Theme<select name="theme" value={appearance.theme}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
  </fieldset>
  {#if error}<div class="appearance-error"><p class="danger" role="alert">{error}</p><button type="button" class="secondary" disabled={saving} onclick={saveAppearance}>Retry</button></div>{/if}
  <noscript><button>Save appearance</button></noscript>
</form>

<style>
  .appearance-card { margin-bottom: 1rem; }
  .appearance-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: .5rem; margin-bottom: 1rem; }
  .appearance-heading h3 { margin: 0; font-size: 1rem; }
  .appearance-heading span { font-size: .8rem; }
  .appearance-controls { border: 0; padding: 0; margin: 0; min-width: 0; }
  .focus-layout-setting { padding: 0; border: 0; margin: 0 0 1.25rem; min-width: 0; }
  .focus-layout-setting legend { padding: 0; margin-bottom: .65rem; }
  .focus-layout-options { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .75rem; }
  .focus-layout-option { display: flex; flex-direction: column; gap: .65rem; padding: .75rem; border: 1px solid var(--hover); border-radius: 6px; background: var(--canvas); cursor: pointer; min-width: 0; }
  .focus-layout-option:hover { border-color: var(--accent); }
  .focus-layout-option:has(input:checked) { border-color: var(--accent); background: var(--accent-fill); box-shadow: inset 0 0 0 1px var(--accent); }
  .option-title { display: flex; align-items: center; gap: .5rem; font-size: .875rem; }
  .option-title input { appearance: auto; accent-color: var(--accent); width: 1.0625rem; height: 1.0625rem; min-height: 0; padding: 0; margin: 0; flex-shrink: 0; cursor: inherit; }
  .option-description { display: block; margin: .25rem 0 0 1.5625rem; font-size: .75rem; font-weight: 400; color: var(--muted); }
  .layout-preview { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); align-content: start; gap: .3rem; padding: .45rem; height: 6.625rem; border: 1px solid var(--hover); border-radius: 5px; background: var(--surface); }
  .layout-preview.layout-now { grid-template-columns: 1.2fr 1fr; grid-template-rows: repeat(2,minmax(0,1fr)); }
  .preview-task { display: flex; flex-direction: column; justify-content: center; gap: .3rem; padding: .375rem; min-width: 0; min-height: 0; border: 1px solid var(--hover); border-radius: 4px; background: var(--canvas); }
  .layout-now .preview-task:first-child { grid-row: 1/3; }
  .preview-line { display: block; height: .25rem; width: 85%; border-radius: 3px; background: var(--muted); opacity: .4; }
  .preview-line.short { width: 60%; }
  .preview-caption { font-size: .6875rem; line-height: 1.35; font-weight: 400; color: var(--muted); }
  .preview-badge { width: 1.25rem; height: .4375rem; border: 1px solid var(--blue); border-radius: 999px; }
  .preview-badge.personal { border-color: var(--purple); }
  .preview-badge.home { border-color: var(--green); }
  .appearance-controls:disabled .focus-layout-option { cursor: wait; }
  @media(max-width: 40rem) { .focus-layout-options { grid-template-columns: 1fr; } }
  .appearance-error { display: flex; align-items: center; flex-wrap: wrap; gap: .75rem; margin-top: .75rem; }
  .appearance-error p { flex: 1 1 15rem; margin: 0; }
</style>
