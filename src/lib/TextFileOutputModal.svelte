<script>
    import { createEventDispatcher } from 'svelte';
    import { selectSaveFilePath } from './rhodeApi.js';

    export let show = false;
    export const nodeId = '';
    export const nodeTitle = '';
    export let isUpdate = false;
    export let initialInstructions = '';
    export let initialMaxTokens = 8000;
    export let initialOutputPath = '';
    export let initialModel = '';
    export let initialTemperature = null;
    
    const dispatch = createEventDispatcher();
    
    // Form fields
    let instructions = '';
    let maxTokens = 8000;
    let outputPath = '';
    /** @type {any} */
    let fileHandle = null;
    let modelOverride = '';
    /** @type {number|null} */
    let temperature = null;

    // Initialize from props when shown
    $: if (show) {
        instructions = initialInstructions || '';
        maxTokens = initialMaxTokens || 8000;
        outputPath = initialOutputPath || '';
        modelOverride = initialModel || '';
        temperature = initialTemperature;
    }
    
    function handleSubmit() {
        if (!outputPath.trim()) {
            alert('Please specify an output file path');
            return;
        }
        
        dispatch('submit', { instructions, maxTokens, outputPath, fileHandle, modelOverride, temperature });
        close();
    }
    
    function close() {
        dispatch('close');
        // Keep values; modal will re-init on next open
    }
    
    /** @param {KeyboardEvent} event */
    function handleKeydown(event) {
        if (event.key === 'Escape') {
            close();
        }
    }
    
    async function selectOutputPath() {
        try {
            // Prefer non-writing desktop API when available to obtain absolute path
            // Use Rhode API file selector
            try {
                const path = await selectSaveFilePath('output.md');
                if (path) {
                    outputPath = path;
                }
            } catch (error) {
                console.warn('File save dialog error:', error);
                // Fallback - just suggest a path
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                outputPath = `output-${timestamp}.md`;
            }

            if (!outputPath) {
                // Fallback - just suggest a path
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                outputPath = `output-${timestamp}.md`;
            }
        } catch (err) {
            console.error('Error selecting file path:', err);
        }
    }
</script>

{#if show}
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-label="Text file output configuration"
        class="modal-backdrop"
        on:mousedown|self={close}
        on:keydown={handleKeydown}
    >
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div class="modal" role="document" on:mousedown|stopPropagation>
            <div class="modal-header">
                <h2>{isUpdate ? 'Update Text File Output' : 'Configure Text File Output'}</h2>
                <button class="close-btn" on:click={close}>×</button>
            </div>
            
            <div class="modal-body">
                <div class="form-group">
                    <label for="instructions">Optional Instructions</label>
                    <textarea
                        id="instructions"
                        bind:value={instructions}
                        placeholder="e.g., Generate a markdown report with sections for introduction, analysis, and conclusion..."
                        rows="4"
                    ></textarea>
                    <small>These instructions will be added to the system prompt for this node</small>
                </div>

                <div class="form-group">
                    <label for="modelOverride">Model (optional override)</label>
                    <input id="modelOverride" type="text" bind:value={modelOverride} placeholder="e.g., gpt-4o-mini" />
                    <small>Leave blank to use the default model from Settings</small>
                </div>

                <div class="form-group">
                    <label for="temperature">Temperature (optional)</label>
                    <input id="temperature" type="number" min="0" max="2" step="0.1" bind:value={temperature} />
                    <small>Only stored if set. Default is 0.3 for this node type.</small>
                </div>

                <div class="form-group">
                    <label for="maxTokens">Max Length (tokens)</label>
                    <input
                        id="maxTokens"
                        type="number"
                        bind:value={maxTokens}
                        min="100"
                        max="100000"
                        step="100"
                    />
                    <small>Maximum number of tokens to generate (default: 8000)</small>
                </div>
                
                <div class="form-group">
                    <label for="outputPath">Output File Path <span class="required">*</span></label>
                    <div class="path-input-group">
                        <input
                            id="outputPath"
                            type="text"
                            bind:value={outputPath}
                            placeholder="/path/to/output.md"
                            required
                        />
                        <button 
                            type="button" 
                            class="browse-btn"
                            on:click={selectOutputPath}
                        >
                            Browse...
                        </button>
                    </div>
                    <small>The file will be created if it doesn't exist and will autosave after generation</small>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" on:click={close}>Cancel</button>
                <button class="btn btn-primary" on:click={handleSubmit}>{isUpdate ? 'Update Node' : 'Create Node'}</button>
            </div>
        </div>
    </div>
{/if}

<svelte:window on:keydown={handleKeydown} />

<style>
    .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }
    
    .modal {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        width: 500px;
        max-width: 90%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
    }
    
    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid #e0e0e0;
    }
    
    .modal-header h2 {
        margin: 0;
        font-size: 20px;
        color: #333;
    }
    
    .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background 0.2s;
    }
    
    .close-btn:hover {
        background: #f0f0f0;
    }
    
    .modal-body {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
    }
    
    .form-group {
        margin-bottom: 20px;
    }
    
    .form-group label {
        display: block;
        margin-bottom: 8px;
        font-weight: 600;
        color: #333;
        font-size: 14px;
    }
    
    .form-group textarea,
    .form-group input[type="text"],
    .form-group input[type="number"] {
        width: 100%;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
        font-family: inherit;
        box-sizing: border-box;
    }
    
    .form-group textarea {
        resize: vertical;
        min-height: 80px;
    }
    
    .form-group small {
        display: block;
        margin-top: 4px;
        color: #666;
        font-size: 12px;
    }
    
    
    .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 20px;
        border-top: 1px solid #e0e0e0;
        background: #f9f9f9;
    }
    
    .btn {
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
    }
    
    .btn-primary {
        background: #f59e0b;
        color: white;
    }
    
    .btn-primary:hover {
        background: #d97706;
    }
    
    .btn-secondary {
        background: #e0e0e0;
        color: #333;
    }
    
    .btn-secondary:hover {
        background: #d0d0d0;
    }
    
    
    .required {
        color: #dc2626;
        font-weight: normal;
    }
    
    .path-input-group {
        display: flex;
        gap: 10px;
        align-items: stretch;
    }
    
    .path-input-group input {
        flex: 1;
    }
    
    .browse-btn {
        padding: 10px 16px;
        background: #f3f4f6;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
    }
    
    .browse-btn:hover {
        background: #e5e7eb;
    }
</style>
                
