<script>
    import { createEventDispatcher } from 'svelte';
    import { settings, modelList, isModelListLoading, modelListError, settingsActions } from '../stores/settings.js';

    export let show = false;
    export const nodeId = '';
    export let initialModel = '';
    export let initialTemperature = null;

    const dispatch = createEventDispatcher();

    /** @type {string} */
    let modelOverride = '';
    /** @type {number|null} */
    let temperature = null;

    $: if (show) {
        modelOverride = initialModel || '';
        temperature = initialTemperature;
    }

    /** @param {KeyboardEvent} e */
    function handleKeydown(e) { if (e.key === 'Escape' && show) close(); }

    async function loadModelsIfNeeded() {
        const s = $settings;
        if (!$modelList || $modelList.length === 0) {
            let apiKey = '';
            if (s.activeMode === 'openrouter') apiKey = s.openrouter_api_key;
            if (s.activeMode === 'openai') apiKey = s.openai_api_key;
            if (s.activeMode === 'gemini') apiKey = s.gemini_api_key;
            await settingsActions.fetchModels(s.activeMode, apiKey);
        }
    }

    $: if (show) {
        // Load models only when modal is shown
        loadModelsIfNeeded();
    }

    function close() { dispatch('close'); }
    function submit() { dispatch('submit', { modelOverride, temperature }); close(); }
    function clearOverride() { modelOverride = ''; }
</script>

{#if show}
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  role="dialog"
  aria-modal="true"
  aria-label="AI node configuration"
  class="modal-backdrop"
  on:mousedown|self={close}
>
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="modal" role="document" on:mousedown|stopPropagation>
    <div class="modal-header">
      <h2>Configure AI Node</h2>
      <button class="close-btn" on:click={close}>×</button>
    </div>
    <div class="modal-body">
      <!-- Provider is controlled by Settings; no editable field here -->
      <div class="form-group">
        <label for="modelOverride">Model (optional override)</label>
        {#if $isModelListLoading}
          <div class="readonly">Loading models…</div>
        {:else}
          <select id="modelOverride" bind:value={modelOverride}>
            <option value="">Use default ({$settings.story_processing_model_id || 'unset'})</option>
            {#each $modelList as m}
              <option value={m.id}>{m.name || m.id}</option>
            {/each}
          </select>
        {/if}
        {#if $modelListError}
          <small class="error">{$modelListError}</small>
        {/if}
      </div>

      <div class="form-group">
        <label for="temperature">Temperature (optional)</label>
        <input id="temperature" type="number" min="0" max="2" step="0.1" bind:value={temperature} />
        <small>Only stored if set. Default is 0.7 for AI nodes.</small>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" on:click={clearOverride}>Clear Override</button>
      <button class="btn btn-primary" on:click={submit}>Save</button>
    </div>
  </div>
  </div>
{/if}

<svelte:window on:keydown={handleKeydown} />

<style>
  .modal-backdrop { position: fixed; inset:0; background: rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:1000; }
  .modal { background:#fff; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,.2); width:500px; max-width:90%; max-height:90vh; display:flex; flex-direction:column; }
  .modal-header { display:flex; justify-content:space-between; align-items:center; padding:20px; border-bottom:1px solid #e0e0e0; }
  .modal-header h2 { margin:0; font-size:20px; color:#000; font-weight:600; }
  .close-btn { background:none; border:none; font-size:22px; cursor:pointer; color:#666; }
  .modal-body { padding:20px; overflow-y:auto; flex:1; }
  .form-group { margin-bottom:14px; }
  .form-group label { display:block; margin-bottom:6px; font-weight:600; color:#333; font-size:14px; }
  .form-group select, .form-group input { width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; font-size:14px; }
  .readonly { padding:8px 10px; background:#f6f6f6; border:1px solid #eee; border-radius:4px; }
  .modal-footer { display:flex; justify-content:flex-end; gap:8px; padding:20px; border-top:1px solid #e0e0e0; background:#f9f9f9; }
  .btn { padding:8px 16px; border-radius:4px; font-size:14px; font-weight:500; cursor:pointer; border:none; }
  .btn-primary { background:#6366f1; color:#fff; }
  .btn-secondary { background:#e0e0e0; color:#333; }
  .error { color:#b91c1c; }
</style>
