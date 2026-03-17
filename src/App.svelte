<script>
  import Canvas from './lib/Canvas.svelte';
  import { settings } from './stores/settings.js';
  import { onMount } from 'svelte';
  import { initHeadlessAPI } from './lib/headlessApi.js';
  import { pendingOracleNode } from './stores/workflows.js';

  // Initialize headless API for Playwright tests
  onMount(() => {
    initHeadlessAPI();
  });

  // ── Oracle gate: user input for oracle nodes during Agent Graph execution ──
  let oracleInput = '';

  function submitOracleInput() {
    const pending = $pendingOracleNode;
    if (pending) {
      pending.resolve(oracleInput.trim());
      oracleInput = '';
    }
  }

  function dismissOracle() {
    const pending = $pendingOracleNode;
    if (pending) {
      pending.reject(new Error('Oracle gate dismissed by user'));
      oracleInput = '';
    }
  }

  function handleOracleKeydown(/** @type {KeyboardEvent} */ e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      submitOracleInput();
    } else if (e.key === 'Escape') {
      dismissOracle();
    }
  }

  // Apply theme colors as CSS custom properties
  $: if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.style.setProperty('--node-color', $settings.nodeColor);
    root.style.setProperty('--machine-color', $settings.machineColor);
    root.style.setProperty('--factory-color', $settings.factoryColor);
    root.style.setProperty('--network-color', $settings.networkColor);
  }
</script>

<main>
  <Canvas />
</main>

{#if $pendingOracleNode}
  <!-- Oracle gate modal: pauses Agent Graph execution for human input -->
  <div class="oracle-overlay" role="dialog" aria-modal="true" aria-label="Oracle gate">
    <div class="oracle-modal">
      <div class="oracle-header">
        <span class="oracle-icon">🔮</span>
        <span class="oracle-title">Oracle Gate</span>
      </div>
      {#if $pendingOracleNode.upstreamContext}
        <div class="oracle-context">
          <div class="oracle-context-label">Upstream context:</div>
          <pre class="oracle-context-text">{$pendingOracleNode.upstreamContext.slice(0, 500)}{$pendingOracleNode.upstreamContext.length > 500 ? '…' : ''}</pre>
        </div>
      {/if}
      <div class="oracle-prompt">{$pendingOracleNode.prompt}</div>
      <textarea
        class="oracle-input"
        bind:value={oracleInput}
        on:keydown={handleOracleKeydown}
        placeholder="Enter your response… (Ctrl+Enter to submit, Esc to cancel)"
        rows="4"
        autofocus
      ></textarea>
      <div class="oracle-actions">
        <button class="oracle-btn oracle-btn-cancel" on:click={dismissOracle}>Cancel</button>
        <button class="oracle-btn oracle-btn-submit" on:click={submitOracleInput} disabled={!oracleInput.trim()}>
          Submit ↵
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(:root) {
    /* Catppuccin Mocha theme (Ordinal default) */
    --bg-primary: #11111b;
    --bg-secondary: #181825;
    --text-primary: #cdd6f4;
    --text-secondary: #bac2de;
    --border-color: #313244;
    --canvas-bg: #1e1e2e;
    --canvas-dots: #313244;
    --connection-color: #89b4fa;

    /* Node colors */
    --node-color: #1e1e2e;
    --machine-color: #313244;
    --factory-color: #45475a;
    --network-color: #585b70;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    overflow: hidden;
    background: #11111b;
    color: #cdd6f4;
    overscroll-behavior: none;
    -webkit-overflow-scrolling: touch;
    touch-action: none;
  }

  :global(html) {
    overscroll-behavior: none;
    touch-action: none;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(::-webkit-scrollbar) {
    width: 6px;
    height: 6px;
  }

  :global(::-webkit-scrollbar-track) {
    background: #181825;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: #313244;
    border-radius: 3px;
  }

  main {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #11111b;
    display: flex;
    flex-direction: column;
  }

  /* ── Oracle Gate Modal ── */
  .oracle-overlay {
    position: fixed;
    inset: 0;
    background: rgba(17, 17, 27, 0.85);
    backdrop-filter: blur(4px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .oracle-modal {
    background: #1e1e2e;
    border: 1px solid #89b4fa;
    border-radius: 12px;
    padding: 24px;
    width: min(520px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(137, 180, 250, 0.15);
  }

  .oracle-header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 1rem;
    color: #89b4fa;
  }

  .oracle-icon {
    font-size: 1.25rem;
  }

  .oracle-title {
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-size: 0.85rem;
  }

  .oracle-context {
    background: #181825;
    border-radius: 6px;
    padding: 10px 12px;
    border-left: 3px solid #585b70;
  }

  .oracle-context-label {
    font-size: 0.7rem;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 6px;
  }

  .oracle-context-text {
    margin: 0;
    font-size: 0.78rem;
    color: #bac2de;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'Fira Code', 'Courier New', monospace;
    max-height: 120px;
    overflow-y: auto;
  }

  .oracle-prompt {
    font-size: 0.95rem;
    color: #cdd6f4;
    line-height: 1.5;
    font-weight: 500;
  }

  .oracle-input {
    background: #181825;
    border: 1px solid #313244;
    border-radius: 8px;
    color: #cdd6f4;
    font-family: inherit;
    font-size: 0.9rem;
    padding: 10px 12px;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
    line-height: 1.5;
  }

  .oracle-input:focus {
    border-color: #89b4fa;
    box-shadow: 0 0 0 2px rgba(137, 180, 250, 0.15);
  }

  .oracle-input::placeholder {
    color: #45475a;
    font-size: 0.82rem;
  }

  .oracle-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .oracle-btn {
    padding: 8px 20px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .oracle-btn-cancel {
    background: transparent;
    border-color: #45475a;
    color: #bac2de;
  }

  .oracle-btn-cancel:hover {
    border-color: #585b70;
    color: #cdd6f4;
    background: #181825;
  }

  .oracle-btn-submit {
    background: #89b4fa;
    color: #1e1e2e;
    border-color: #89b4fa;
  }

  .oracle-btn-submit:hover:not(:disabled) {
    background: #b4befe;
    border-color: #b4befe;
  }

  .oracle-btn-submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
