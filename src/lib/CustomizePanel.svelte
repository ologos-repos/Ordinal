<script>
    export let visible = false;
    export let entityType = 'node'; // 'node', 'machine', 'factory', 'network'
    export const entityId = '';
    export let currentColor = '';
    export let currentLabel = '';
    /** @type {(data: {color: string, label: string | null}) => void} */
    export let onSave = (data) => {};
    /** @type {() => void} */
    export let onCancel = () => {};

    let selectedColor = currentColor || '#ffffff';
    let customLabel = currentLabel || '';

    // Update when props change
    $: if (visible) {
        selectedColor = currentColor || '#ffffff';
        customLabel = currentLabel || '';
    }

    function handleSave() {
        if (onSave) {
            onSave({
                color: selectedColor,
                label: customLabel.trim() || null
            });
        }
        handleClose();
    }

    function handleClose() {
        if (onCancel) {
            onCancel();
        }
        visible = false;
    }

    function getEntityTitle() {
        switch (entityType) {
            case 'node': return 'Node';
            case 'machine': return 'Machine';
            case 'factory': return 'Factory'; 
            case 'network': return 'Network';
            default: return 'Entity';
        }
    }
</script>

<div class="customize-panel" class:visible>
    <div class="panel-header">
        <h3>Customize {getEntityTitle()}</h3>
        <button class="close-button" on:click={handleClose}>×</button>
    </div>
    
    <div class="panel-content">
        <div class="form-section">
            <label for="entity-color">Color:</label>
            <div class="color-input-container">
                <input 
                    id="entity-color"
                    type="color" 
                    bind:value={selectedColor}
                    class="color-picker"
                    tabindex="0"
                />
                <div class="color-preview" style="background-color: {selectedColor}"></div>
                <input 
                    type="text" 
                    bind:value={selectedColor}
                    class="color-text"
                    placeholder="#ffffff"
                    tabindex="0"
                />
            </div>
        </div>
        
        <div class="form-section">
            <label for="entity-label">Custom Label:</label>
            <input 
                id="entity-label"
                type="text" 
                bind:value={customLabel}
                class="label-input"
                placeholder="Enter custom label (optional)"
                tabindex="0"
            />
            <small class="help-text">
                {#if entityType === 'node'}
                    This will replace the node type label (e.g., "Input Node", "AI Node")
                {:else}
                    This will replace the container type label (e.g., "Node {getEntityTitle()}")
                {/if}
            </small>
        </div>
    </div>
    
    <div class="panel-actions">
        <button class="cancel-button" on:click={handleClose}>Cancel</button>
        <button class="save-button" on:click={handleSave}>Save</button>
    </div>
</div>

<style>
    .customize-panel {
        position: fixed;
        top: 0;
        right: -400px;
        width: 400px;
        height: 100vh;
        background: var(--bg-primary);
        border-left: 1px solid var(--border-color);
        box-shadow: -2px 0 10px rgba(0, 0, 0, 0.1);
        z-index: 1000;
        transition: right 0.3s ease;
        display: flex;
        flex-direction: column;
    }
    
    .customize-panel.visible {
        right: 0;
    }
    
    .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
    }
    
    .panel-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
    }
    
    .close-button {
        background: transparent;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--text-secondary);
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background-color 0.2s ease;
    }
    
    .close-button:hover {
        background: var(--border-color);
        color: var(--text-primary);
    }
    
    .panel-content {
        flex: 1;
        padding: 24px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
    }
    
    .form-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    
    .form-section label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
    }
    
    .color-input-container {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .color-picker {
        width: 50px;
        height: 50px;
        border: 2px solid var(--border-color);
        border-radius: 8px;
        cursor: pointer;
        background: none;
        transition: border-color 0.2s ease;
    }
    
    .color-picker:hover {
        border-color: var(--text-primary);
    }
    
    .color-preview {
        width: 30px;
        height: 30px;
        border-radius: 6px;
        border: 2px solid var(--border-color);
        flex-shrink: 0;
    }
    
    .color-text {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-family: 'Monaco', 'Courier New', monospace;
        font-size: 13px;
    }
    
    .color-text:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }
    
    .label-input {
        padding: 12px;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 14px;
        pointer-events: auto;
        user-select: text;
        cursor: text;
    }
    
    .label-input:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }
    
    .help-text {
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.4;
    }
    
    .panel-actions {
        display: flex;
        gap: 12px;
        padding: 20px;
        border-top: 1px solid var(--border-color);
        background: var(--bg-secondary);
        justify-content: flex-end;
    }
    
    .cancel-button, .save-button {
        padding: 10px 20px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid transparent;
    }
    
    .cancel-button {
        background: transparent;
        color: var(--text-secondary);
        border-color: var(--border-color);
    }
    
    .cancel-button:hover {
        background: var(--border-color);
        color: var(--text-primary);
    }
    
    .save-button {
        background: #4f46e5;
        color: white;
        border-color: #4f46e5;
    }
    
    .save-button:hover {
        background: #6366f1;
        border-color: #6366f1;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
    }
</style>