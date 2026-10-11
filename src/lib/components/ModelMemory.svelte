<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { durationUnits, maxDurationSeconds, modelMemory, type DurationUnit } from '$lib/model-memory';

  let { value }: { value: string } = $props();
  const initial = untrack(() => modelMemory(value));
  let interactive = $state(false);
  onMount(() => { interactive = true; });
  let mode = $state(initial.mode);
  let amount = $state<number | undefined>(initial.amount);
  let unit = $state<DurationUnit>(initial.unit);
</script>

<fieldset class="model-memory" aria-describedby="memory-intro">
  <legend>Model memory</legend>
  <p id="memory-intro" class="muted">Keep the model ready between requests for faster responses.</p>
  <label class="memory-choice"><input type="radio" name="memoryMode" value="immediate" bind:group={mode} aria-describedby="memory-immediate-help">Unload after each response</label>
  <label class="memory-choice"><input type="radio" name="memoryMode" value="idle" bind:group={mode} aria-describedby="memory-idle-help">Unload after being idle for</label>
  <div class="idle-duration">
    <label>Duration<input type="number" name="memoryAmount" disabled={interactive && mode !== 'idle'} min="1" max={Math.floor(maxDurationSeconds / durationUnits[unit])} step="1" required={mode === 'idle'} bind:value={amount}></label>
    <label>Unit<select name="memoryUnit" disabled={interactive && mode !== 'idle'} bind:value={unit}><option value="s">Seconds</option><option value="m">Minutes</option><option value="h">Hours</option></select></label>
  </div>
  <label class="memory-choice"><input type="radio" name="memoryMode" value="loaded" bind:group={mode} aria-describedby="memory-loaded-help">Keep loaded</label>
  {#if initial.mode === 'existing'}
    <label class="memory-choice"><input type="radio" name="memoryMode" value="existing" bind:group={mode} aria-describedby="memory-existing-help">Keep current setting ({value})</label>
    <p id="memory-existing-help" class="muted memory-help existing-help">Your saved value is preserved. Select another option to change it.</p>
  {/if}
  <p id="memory-immediate-help" class="muted memory-help immediate-help">Frees model memory immediately. The next request takes longer to start.</p>
  <p id="memory-idle-help" class="muted memory-help idle-help">Other apps using this model can keep it active.</p>
  <p id="memory-loaded-help" class="muted memory-help loaded-help">Keeps the model in memory between requests. Ollama may unload it to make room for another model.</p>
</fieldset>

<style>
  .model-memory { padding: 0; border: 0; margin-top: .4rem; }
  legend { padding: 0; font-weight: 600; }
  #memory-intro { margin: .3rem 0 .65rem; }
  .memory-choice { display: flex; align-items: center; gap: .65rem; min-height: 2.75rem; font-weight: 400; cursor: pointer; }
  input[type='radio'] { width: 1.15rem; height: 1.15rem; min-height: 0; margin: 0; padding: 0; flex-shrink: 0; accent-color: var(--accent); }
  .idle-duration { display: none; grid-template-columns: minmax(0, 7rem) minmax(0, 10rem); gap: .65rem; margin: .25rem 0 .65rem 1.8rem; }
  .idle-duration label { min-width: 0; font-size: .875rem; }
  .idle-duration input, .idle-duration select { min-width: 0; }
  .memory-help { display: none; margin: .65rem 0 0; }
  .model-memory:has(input[value='idle']:checked) .idle-duration { display: grid; }
  .model-memory:has(input[value='idle']:checked) .idle-help,
  .model-memory:has(input[value='immediate']:checked) .immediate-help,
  .model-memory:has(input[value='loaded']:checked) .loaded-help,
  .model-memory:has(input[value='existing']:checked) .existing-help { display: block; }
</style>
