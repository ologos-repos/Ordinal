<script>
    import { pasteAndCreateConfigUniversal } from './clipboard.js';
    import { templates, templateActions } from '../stores/templates.js';
    import { historyActions } from '../stores/canvasHistory.js';
    import { appMode } from '../stores/mode.js';
    import { automationSubMode } from '../stores/automationSubMode.js';
    import { workflowContainers, workflowActions } from '../stores/workflows.js';
    import { get } from 'svelte/store';

    export let isOpen = false;

    // Reactive filter: only show templates matching current mode OR mode: "all"
    $: filteredTemplates = Object.entries($templates).filter(([key, template]) => {
        return template.mode === $appMode || template.mode === 'all';
    });

    /** @param {string} templateKey */
    async function handleBlueprintClick(templateKey) {
        const template = (/** @type {any} */ ($templates))[templateKey];
        console.log('📋 Creating blueprint:', template.name);

        try {
            // Set the correct mode BEFORE adding nodes so modeLocked engages with the right mode.
            // Templates have a mode field ('knowledge', 'automation', 'diagramming', or 'all').
            // If the template specifies a concrete mode, switch to it now.
            if (template.mode && template.mode !== 'all') {
                /** @type {'knowledge' | 'automation' | 'diagramming'} */
                const targetMode = template.mode;
                appMode.set(targetMode);
                console.log(`🔧 Set canvas mode to '${targetMode}' for blueprint: ${template.name}`);
            }

            // Start macro recording for blueprint creation
            await historyActions.startMacro(`Create Blueprint: ${template.name}`);

            // Parse the YAML and pass it directly to the paste function
            console.log('📄 Template YAML:', template.yaml);
            const yamlParse = await import('yaml').then(m => m.parse);
            const parsedYaml = yamlParse(template.yaml);
            console.log('📋 Parsed YAML:', parsedYaml);
            
            // Use the templateConfig parameter instead of clipboard
            const result = await pasteAndCreateConfigUniversal(/** @type {any} */ (400), /** @type {any} */ (300), parsedYaml);
            if (result.success) {
                console.log('✅ Blueprint created successfully:', result);

                // Auto-organize spawned containers so blueprints don't need manual layout
                await new Promise(resolve => setTimeout(resolve, 150));
                const containers = get(workflowContainers);
                for (const container of containers) {
                    if (container.type === 'network' || container.isNetwork) {
                        await workflowActions.organize(container.id, { deep: true });
                    }
                }
                // If no networks, organize top-level factories/machines
                if (!containers.some(c => c.type === 'network' || c.isNetwork)) {
                    for (const container of containers) {
                        if (container.type === 'factory' || container.isFactory || container.type === 'machine' || container.isMachine) {
                            if (!container.parentId) {
                                await workflowActions.organize(container.id, { deep: true });
                            }
                        }
                    }
                }
                // Allow layout to settle
                await new Promise(resolve => setTimeout(resolve, 200));

                // End macro recording
                await historyActions.endMacro();
                // Close the palette after successful creation
                isOpen = false;
            } else {
                console.error('❌ Failed to create blueprint:', result.error);
                // End macro recording even on failure
                await historyActions.endMacro();
                alert('Failed to create blueprint: ' + result.error);
            }
        } catch (error) {
            const e = /** @type {any} */ (error);
            console.error('❌ Error creating blueprint:', e);
            // End macro recording even on error
            await historyActions.endMacro();
            alert('Failed to create blueprint: ' + (e?.message || String(e)));
        }
    }

    /** @param {string} templateKey @param {MouseEvent} event */
    function handleDeleteBlueprint(templateKey, event) {
        event.stopPropagation(); // Prevent template click
        
        const template = (/** @type {any} */ ($templates))[templateKey];
        if (template.isDefault) {
            alert('Cannot delete default blueprints');
            return;
        }
        
        if (confirm(`Are you sure you want to delete the blueprint "${template.name}"?`)) {
            templateActions.delete(templateKey);
        }
    }

    function handleClose() {
        isOpen = false;
    }

    /** @param {KeyboardEvent} event */
    function handleBackdropKeydown(event) {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
            handleClose();
        }
    }
</script>

<div class="template-palette" class:open={isOpen}>
    <div class="palette-header">
        <h3>Blueprints</h3>
        <button class="close-btn" on:click={handleClose}>×</button>
    </div>
    
    <div class="template-sections">
        <!-- Default Blueprints Section (filtered by current mode) -->
        <div class="template-section">
            <h4 class="section-title">Built-in Blueprints</h4>
            <div class="template-grid">
                {#each filteredTemplates.filter(([key, template]) => template.isDefault) as [key, template]}
                    <div class="template-item-container">
                        <button
                            class="template-item"
                            on:click={() => handleBlueprintClick(key)}
                            title={template.name}
                        >
                            <div class="template-icon">{template.icon}</div>
                            <div class="template-name">{template.name}</div>
                        </button>
                    </div>
                {/each}
            </div>
        </div>

        <!-- Custom Blueprints Section (only show if there are custom blueprints for this mode) -->
        {#if filteredTemplates.some(([key, template]) => !template.isDefault)}
            <div class="template-section">
                <h4 class="section-title">Custom Blueprints</h4>
                <div class="template-grid">
                    {#each filteredTemplates.filter(([key, template]) => !template.isDefault) as [key, template]}
                        <div class="template-item-container">
                            <button
                                class="template-item"
                                on:click={() => handleBlueprintClick(key)}
                                title={template.name}
                            >
                                <div class="template-icon">{template.icon}</div>
                                <div class="template-name">{template.name}</div>
                            </button>

                            <button
                                class="delete-btn"
                                on:click={(e) => handleDeleteBlueprint(key, e)}
                                title="Delete blueprint"
                            >
                                ×
                            </button>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</div>

{#if isOpen}
    <!-- Backdrop -->
    <div class="backdrop" on:click={handleClose} on:keydown={handleBackdropKeydown} tabindex="0" role="button" aria-label="Close blueprints panel"></div>
{/if}

<style>
    .template-palette {
        position: fixed;
        top: 0;
        right: -400px;
        width: 400px;
        height: 100vh;
        background: var(--bg-primary, #ffffff);
        border-left: 1px solid var(--border-color, #e0e0e0);
        box-shadow: -2px 0 10px rgba(0, 0, 0, 0.1);
        z-index: 1000;
        transition: right 0.3s ease;
        display: flex;
        flex-direction: column;
    }

    .template-palette.open {
        right: 0;
    }

    .palette-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid var(--border-color, #e0e0e0);
        background: var(--bg-secondary, #f8fafc);
    }

    .palette-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary, #1e293b);
    }

    .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--text-secondary, #64748b);
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background-color 0.2s;
    }

    .close-btn:hover {
        background-color: rgba(0, 0, 0, 0.1);
    }

    .template-sections {
        flex: 1;
        overflow-y: auto;
        padding: 0;
    }

    .template-section {
        padding: 20px 20px 0 20px;
    }

    .template-section:last-child {
        padding-bottom: 20px;
    }

    .section-title {
        margin: 0 0 15px 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid var(--border-color, #e0e0e0);
        padding-bottom: 8px;
    }

    .template-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 12px;
        margin-bottom: 20px;
    }

    .template-item-container {
        position: relative;
        height: 100px; /* Fixed height to prevent misalignment */
    }

    .template-item {
        width: 100%;
        height: 100%;
        background: var(--bg-primary, #ffffff);
        border: 1px solid var(--border-color, #e0e0e0);
        border-radius: 8px;
        padding: 12px 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        position: relative;
        overflow: hidden;
    }

    .template-item:hover {
        background: var(--bg-secondary, #f8fafc);
        border-color: #2196f3;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .template-icon {
        font-size: 28px;
        margin-bottom: 6px;
        flex-shrink: 0;
    }

    .template-name {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-primary, #1e293b);
        line-height: 1.2;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        max-height: 2.4em; /* 2 lines * 1.2 line-height */
        width: 100%;
    }

    .delete-btn {
        position: absolute;
        top: 4px;
        right: 4px;
        background: #ff4444;
        color: white;
        border: none;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        opacity: 0.9;
        z-index: 1;
    }

    .delete-btn:hover {
        background: #cc0000;
        opacity: 1;
        transform: scale(1.1);
    }

    .backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.3);
        z-index: 999;
    }

    /* Dark mode support */
    :global(body.dark-mode) .template-palette {
        background: var(--bg-primary);
        border-left-color: var(--border-color);
    }

    :global(body.dark-mode) .palette-header {
        background: var(--bg-secondary);
        border-bottom-color: var(--border-color);
    }

    :global(body.dark-mode) .template-item {
        background: var(--bg-primary);
        border-color: var(--border-color);
        color: var(--text-primary);
    }

    :global(body.dark-mode) .template-item:hover {
        background: var(--bg-secondary);
    }

    :global(body.dark-mode) .close-btn:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }
</style>