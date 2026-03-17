<script>
    import { canvasState } from '../stores/canvas.js';
    import { nodeActions, nodeDataStore, connections, nodes } from '../stores/nodes.js';
    import { workflowContainers } from '../stores/workflows.js';
    import { copyConfig, copyText, generateConfig } from './clipboard.js';
    import { ContextEngine } from './ContextEngine.js';
    
    export let visible = false;
    
    /** @type {string | null} */
    let selectedEntityId = null;
    /** @type {('node'|'machine'|'factory'|'network'|'connection'|null)} */
    let selectedEntityType = null;
    let yamlConfig = '';
    let entityTitle = 'No Selection';
    // Prompt preview state for AI nodes
    /** @type {'minimal'|'full'} */
    let promptPreviewMode = 'minimal';
    let promptPreviewText = '';
    
    // This reactive block will be the heart of the component.
    // It watches for any change in selection and regenerates the YAML.
    $: {
        const state = $canvasState;
        if (state.selectedContainer) {
            selectedEntityId = state.selectedContainer;
            
            // Determine container type for the title
            const container = $workflowContainers.find(c => c.id === state.selectedContainer);
            if (container) {
                if (container.isNetwork) selectedEntityType = 'network';
                else if (container.isFactory) selectedEntityType = 'factory';
                else selectedEntityType = 'machine';
            } else {
                selectedEntityType = null;
            }
            
        } else if (state.selectedNode) {
            selectedEntityId = state.selectedNode;
            selectedEntityType = 'node';
        } else if (state.selectedConnection) {
            selectedEntityId = state.selectedConnection;
            selectedEntityType = 'connection';
        } else {
            selectedEntityId = null;
            selectedEntityType = null;
        }
        
        updateConfig();
    }
    
    // Update the config whenever the underlying data of the selected entity might change.
    $: if (selectedEntityId) {
        // These dependencies ensure re-rendering if nodes, connections, or containers change structure.
        $nodes;
        $connections;
        $workflowContainers;
        $nodeDataStore;
        updateConfig();
        updatePromptPreview();
    }
    
    async function updateConfig() {
        if (!selectedEntityId) {
            yamlConfig = '';
            entityTitle = 'No Selection';
            return;
        }
        
        try {
            switch (selectedEntityType) {
                case 'node': {
                    const nodeData = $nodeDataStore.get(selectedEntityId);
                    if (nodeData) {
                        entityTitle = `Node: ${nodeData.data.metadata.title || selectedEntityId}`;
                        // Use the same function as copyConfig for consistency
                        const result = await generateConfig(
                            nodeData,
                            /** @type {any} */ ('node'),
                            /** @type {any} */ ($connections),
                            /** @type {any} */ ($nodeDataStore),
                            /** @type {any} */ ($nodes),
                            /** @type {any} */ (nodeData.data.content)
                        );
                        yamlConfig = result.success ? result.config : 'Error generating node config.';
                    } else {
                        yamlConfig = 'Node data not found.';
                    }
                    break;
                }
                case 'machine':
                case 'factory':
                case 'network': {
                    const container = $workflowContainers.find(c => c.id === selectedEntityId);
                    if (container) {
                        entityTitle = `${selectedEntityType.charAt(0).toUpperCase() + selectedEntityType.slice(1)}: ${selectedEntityId}`;
                        const result = await generateConfig(
                            container,
                            /** @type {any} */ (selectedEntityType),
                            /** @type {any} */ ($connections),
                            /** @type {any} */ ($nodeDataStore),
                            /** @type {any} */ ($nodes)
                        );
                        yamlConfig = result.success ? result.config : `Error generating ${selectedEntityType} config.`;
                    } else {
                        yamlConfig = `${selectedEntityType} not found.`;
                    }
                    break;
                }
                case 'connection': {
                    const connection = $connections?.find(c => c.id === selectedEntityId);
                    if (connection) {
                        entityTitle = `Connection: ${selectedEntityId.substring(0, 8)}...`;
                        yamlConfig = `# Connection Configuration
id: ${connection.id}
from: ${connection.fromId}
to: ${connection.toId}
from_port: ${connection.fromPort || 'output'}
to_port: ${connection.toPort || 'input'}
created: ${new Date(connection.created).toISOString()}`;
                    } else {
                        yamlConfig = 'Connection not found.';
                    }
                    break;
                }
                default:
                    yamlConfig = 'Select an entity to view its configuration.';
                    entityTitle = 'No Selection';
            }
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            yamlConfig = `Error loading configuration: ${msg}`;
        }
    }

    // Build prompt preview for AI nodes
    $: if (selectedEntityId) {
        // Recompute when mode changes as well
        promptPreviewMode;
        updatePromptPreview();
    }

    function updatePromptPreview() {
        try {
            if (!selectedEntityId || selectedEntityType !== 'node') { promptPreviewText = ''; return; }
            const nd = $nodeDataStore.get(selectedEntityId);
            if (!nd || nd.data?.node_type !== 'ai') { promptPreviewText = ''; return; }
            // Build envelope inputs from incoming connections
            const incoming = ($connections || []).filter(c => c.toId === selectedEntityId);
            const envelopeInputs = incoming.map(conn => {
                const src = $nodeDataStore.get(conn.fromId);
                const output = src?.data?.output;
                /** @type {any} */ let dataPayload = '';
                /** @type {any[] | undefined} */ let chainPayload = undefined;
                /** @type {string[] | undefined} */ let sourcesPayload = undefined;
                if (output && output.value) {
                    dataPayload = output.value;
                    if (Array.isArray(output.context_chain)) chainPayload = output.context_chain;
                    if (Array.isArray(output.sources)) sourcesPayload = output.sources;
                } else {
                    dataPayload = src?.data?.content || '';
                }
                return {
                    source_id: conn.fromId,
                    data: dataPayload,
                    weight: 1,
                    received_at: new Date().toISOString(),
                    ...(chainPayload ? { context_chain: chainPayload } : {}),
                    ...(sourcesPayload ? { sources: sourcesPayload } : {})
                };
            });
            const envelope = ContextEngine.buildNodeExecutionEnvelope({
                id: selectedEntityId,
                node_type: nd.data?.node_type,
                content: nd.data?.content || '',
                inputs: envelopeInputs
            }, { mode: promptPreviewMode });
            promptPreviewText = envelope || '';
        } catch (e) {
            console.warn('Prompt preview build failed:', e);
            promptPreviewText = '';
        }
    }

    async function handleCopyPrompt() {
        if (!promptPreviewText) return;
        const r = await copyText(promptPreviewText);
        if (!r?.success) console.warn('Copy prompt failed:', r?.error);
    }
    
    function handleClose() {
        visible = false;
    }
    
    async function handleCopyConfig() {
        if (yamlConfig) {
            const result = await copyText(yamlConfig);
            if (result.success) {
                console.log('Config copied to clipboard');
                // Maybe show a temporary "Copied!" message
            } else {
                console.error('Failed to copy config:', result.error);
            }
        }
    }
</script>

<div class="config-panel" class:visible>
    <div class="panel-header">
        <h3>Configuration Viewer</h3>
        <button class="close-button" on:click={handleClose}>×</button>
    </div>
    
    <div class="panel-content">
        {#if selectedEntityId}
            <div class="entity-info">
                <h4>{entityTitle}</h4>
                <div class="config-actions">
                    <button class="copy-button" on:click={handleCopyConfig}>
                        📋 Copy Config
                    </button>
                </div>
            </div>
            
            {#if selectedEntityType === 'node'}
                {#if $nodeDataStore.get(selectedEntityId)?.data?.node_type === 'ai'}
                    <div class="prompt-preview">
                        <div class="prompt-controls">
                            <div class="mode-toggle">
                                <button class:active={promptPreviewMode==='minimal'} on:click={() => promptPreviewMode='minimal'}>Minimal</button>
                                <button class:active={promptPreviewMode==='full'} on:click={() => promptPreviewMode='full'}>Full</button>
                            </div>
                            <button class="copy-button" on:click={handleCopyPrompt}>📋 Copy Prompt</button>
                        </div>
                        <pre class="prompt-content">{promptPreviewText}</pre>
                    </div>
                {/if}
            {/if}

            <div class="config-display">
                <pre class="yaml-content">{yamlConfig}</pre>
            </div>
        {:else}
            <div class="no-selection">
                <p>Click a Node, Machine, Factory, or Network to view its configuration.</p>
            </div>
        {/if}
    </div>
</div>

<style>
    .config-panel {
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
    
    .config-panel.visible {
        right: 0;
    }
    
    .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
        flex-shrink: 0;
    }
    
    .panel-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
    }
    
    .close-button {
        background: none;
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
        background: rgba(0, 0, 0, 0.1);
    }
    
    .panel-content {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }
    
    .entity-info {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
        flex-shrink: 0;
    }
    
    .entity-info h4 {
        margin: 0 0 12px 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    
    .config-actions {
        display: flex;
        gap: 8px;
    }
    
    .copy-button {
        background: #2196f3;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        transition: background-color 0.2s ease;
    }
    
    .copy-button:hover {
        background: #1976d2;
    }
    
    .config-display {
        flex: 1;
        overflow: auto;
        padding: 0;
    }
    
    .yaml-content {
        margin: 0;
        padding: 20px;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 12px;
        line-height: 1.4;
        color: var(--text-primary);
        background: var(--bg-primary);
        white-space: pre-wrap;
        word-wrap: break-word;
        border: none;
        outline: none;
        text-align: left;
    }
    
    .no-selection {
        padding: 40px 20px;
        text-align: center;
        color: var(--text-secondary);
        flex-grow: 1;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .no-selection p {
        margin: 0;
        font-size: 14px;
    }
</style>