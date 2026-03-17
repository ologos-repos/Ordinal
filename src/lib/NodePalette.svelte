<script>
    import { appMode, modeLocked } from '../stores/mode.js';
    import { automationSubMode } from '../stores/automationSubMode.js';
    import {
        getAgentGraphTypes,
        getActionGraphTypes,
        getDiagramTypes,
        getKnowledgeTypes,
        getNodeMeta
    } from './nodeTypes.js';
    import { getIcon } from '../plugins/nodes/ordinal/icons.js';

    // Reactive: which types to show based on mode + sub-mode
    $: paletteTypes = (() => {
        if ($appMode === 'knowledge') {
            return getKnowledgeTypes();
        }
        if ($appMode === 'diagramming') {
            return getDiagramTypes();
        }
        // Automation mode
        return $automationSubMode === 'action'
            ? getActionGraphTypes()
            : getAgentGraphTypes();
    })();

    $: paletteTitle = (() => {
        if ($appMode === 'knowledge') return 'Knowledge';
        if ($appMode === 'diagramming') return 'Diagram';
        return $automationSubMode === 'action' ? 'Action' : 'Agent';
    })();

    // Build node list with metadata
    $: nodeList = paletteTypes.map(type => {
        const meta = getNodeMeta(type);
        // Resolve SVG icon using iconName from metadata; fall back to emoji
        const iconName = meta.iconName;
        const iconSvg = iconName ? getIcon(iconName, meta.borderColor) : null;
        return {
            type,
            title: meta.label,
            description: '', // Can add descriptions later
            icon: meta.icon,
            iconSvg,
            color: meta.color
        };
    });

    function toggleMode() {
        if ($modeLocked) return;
        appMode.update(m => {
            if (m === 'automation') return 'diagramming';
            if (m === 'diagramming') return 'knowledge';
            return 'automation';
        });
    }

    /** @param {DragEvent} event @param {string} nodeType */
    function handleDragStart(event, nodeType) {
        const dt = event.dataTransfer;
        if (!dt) return;
        dt.setData('text/plain', nodeType);
        dt.effectAllowed = 'copy';
    }

    // ── Mobile FAB state ──────────────────────────────────────────────────────
    let fabOpen = false;

    function toggleFab() {
        fabOpen = !fabOpen;
    }

    /** @param {string} nodeType */
    function fabAddNode(nodeType) {
        fabOpen = false;
        // Delegate to global handler registered by Canvas.svelte
        if (typeof window !== 'undefined' && (/** @type {any} */ (window)).addNodeAtCenter) {
            (/** @type {any} */ (window)).addNodeAtCenter(nodeType);
        }
    }

    function fabToggleMode() {
        fabOpen = false;
        toggleMode();
    }
</script>

<div class="node-palette">
    <!-- ── Sidebar brand header ── -->
    <div class="sidebar-brand">
        <span class="brand-wordmark">Ordinal</span>
    </div>

    <!-- ── Mode selector ── -->
    <button
        class="mode-btn"
        class:mode-auto={$appMode === 'automation'}
        class:mode-diagram={$appMode === 'diagramming'}
        class:mode-knowledge={$appMode === 'knowledge'}
        class:mode-locked={$modeLocked}
        disabled={$modeLocked}
        on:click={toggleMode}
        title={$modeLocked
            ? 'Mode locked — clear the canvas to switch modes'
            : `Switch mode (→ ${$appMode === 'automation' ? 'Diagram' : $appMode === 'diagramming' ? 'Knowledge' : 'Auto'})`}
    >
        {#if $appMode === 'automation'}
            <span class="mode-icon">⚡</span><span class="mode-label">Automation</span>
        {:else if $appMode === 'diagramming'}
            <span class="mode-icon">📐</span><span class="mode-label">Diagram</span>
        {:else}
            <span class="mode-icon">🧠</span><span class="mode-label">Knowledge</span>
        {/if}
        {#if $modeLocked}
            <span class="lock-icon" aria-label="Mode locked">🔒</span>
        {/if}
    </button>

    <!-- ── Automation sub-mode toggle ── -->
    {#if $appMode === 'automation'}
        <div class="submode-toggle" class:submode-locked={$modeLocked}>
            <button
                class="submode-btn"
                class:submode-active={$automationSubMode === 'agent'}
                class:submode-agent={$automationSubMode === 'agent'}
                disabled={$modeLocked}
                on:click={() => { if (!$modeLocked) automationSubMode.set('agent'); }}
                title={$modeLocked ? 'Sub-mode locked — clear canvas to switch' : 'Agent Graph — Rhode live execution'}
            >
                🤖 Agent
            </button>
            <button
                class="submode-btn"
                class:submode-active={$automationSubMode === 'action'}
                class:submode-action={$automationSubMode === 'action'}
                disabled={$modeLocked}
                on:click={() => { if (!$modeLocked) automationSubMode.set('action'); }}
                title={$modeLocked ? 'Sub-mode locked — clear canvas to switch' : 'Action Graph — Gitea Actions pipeline'}
            >
                ⚙️ Action
            </button>
        </div>
    {/if}

    <!-- ── Palette section header ── -->
    <div class="palette-header">
        <h3>{paletteTitle} Nodes</h3>
    </div>

    {#if $modeLocked}
        <div class="lock-banner" title="Clear the canvas to switch modes">
            🔒 <span>Mode locked</span>
        </div>
    {/if}

    <div class="palette-nodes">
        {#each nodeList as nodeType}
            <div
                role="button"
                tabindex="0"
                aria-label="{nodeType.title} node"
                class="palette-node"
                draggable="true"
                on:dragstart={(e) => handleDragStart(e, nodeType.type)}
            >
                {#if nodeType.iconSvg}
                    <span class="palette-node-icon palette-node-icon-svg" aria-hidden="true">{@html nodeType.iconSvg}</span>
                {:else}
                    <div class="palette-node-icon">{nodeType.icon}</div>
                {/if}
                <div class="palette-node-info">
                    <div class="palette-node-title">{nodeType.title}</div>
                    {#if nodeType.description}
                    <div class="palette-node-description">{nodeType.description}</div>
                    {/if}
                </div>
            </div>
        {/each}
    </div>

    <div class="palette-controls">
        <div class="control-section">
            <h4>Canvas Controls</h4>
            <div class="control-hint">
                <strong>Pan:</strong> Shift + Drag or Middle Mouse<br>
                <strong>Zoom:</strong> Mouse Wheel<br>
                <strong>Select:</strong> Click node<br>
                <strong>Delete:</strong> Select node + Delete key<br>
                <strong>New Text:</strong> Double-click canvas
            </div>
        </div>
    </div>
</div>

<!-- ── Mobile FAB (only visible below 768px) ── -->
<div class="mobile-fab-container" class:fab-open={fabOpen}>
    <!-- Expanded node type buttons (shown when FAB is open) -->
    {#if fabOpen}
        <div class="fab-backdrop" role="button" tabindex="-1" aria-label="Close menu"
             on:click={() => fabOpen = false}
             on:keydown={(e) => e.key === 'Escape' && (fabOpen = false)}
        ></div>
        <div class="fab-node-list">
            <!-- Mode toggle at top of FAB menu -->
            <button
                class="fab-mode-btn"
                class:fab-mode-auto={$appMode === 'automation'}
                class:fab-mode-diagram={$appMode === 'diagramming'}
                class:fab-mode-knowledge={$appMode === 'knowledge'}
                disabled={$modeLocked}
                on:click={fabToggleMode}
                title="Switch mode"
            >
                {#if $appMode === 'automation'}⚡ Auto{:else if $appMode === 'diagramming'}📐 Diagram{:else}🧠 Knowledge{/if}
            </button>
            <div class="fab-divider"></div>
            {#each nodeList as nodeType}
                <button
                    class="fab-node-item"
                    on:click={() => fabAddNode(nodeType.type)}
                    aria-label="Add {nodeType.title} node"
                >
                    {#if nodeType.iconSvg}
                        <span class="fab-node-icon-svg" aria-hidden="true">{@html nodeType.iconSvg}</span>
                    {:else}
                        <span class="fab-node-icon">{nodeType.icon}</span>
                    {/if}
                    <span class="fab-node-label">{nodeType.title}</span>
                </button>
            {/each}
        </div>
    {/if}

    <!-- Main FAB button -->
    <button
        class="fab-main"
        class:fab-is-open={fabOpen}
        on:click={toggleFab}
        aria-label={fabOpen ? 'Close node menu' : 'Add node'}
        title={fabOpen ? 'Close' : 'Add node'}
    >
        {#if fabOpen}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
        {:else}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/>
            </svg>
        {/if}
    </button>
</div>

<style>
    .node-palette {
        width: 148px;
        background: #181825;
        border-right: 1px solid #313244;
        display: flex;
        flex-direction: column;
        padding: 0;
        gap: 0;
        flex-shrink: 0;
        overflow-y: auto;
    }

    /* ── Brand header ── */
    .sidebar-brand {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px 12px 10px;
        border-bottom: 1px solid #313244;
        flex-shrink: 0;
    }

    .brand-wordmark {
        font-weight: 800;
        font-size: 15px;
        color: #cba6f7;
        letter-spacing: 1.5px;
        text-transform: uppercase;
    }

    /* ── Mode selector button ── */
    .mode-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        margin: 10px 10px 4px;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid #313244;
        background: rgba(49, 50, 68, 0.4);
        color: #bac2de;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
        width: calc(100% - 20px);
        flex-shrink: 0;
    }

    .mode-btn:hover:not(:disabled) {
        background: rgba(49, 50, 68, 0.8);
        border-color: #585b70;
    }

    .mode-auto {
        color: #a6e3a1;
        border-color: rgba(166, 227, 161, 0.35);
        background: rgba(166, 227, 161, 0.08);
    }
    .mode-auto:hover:not(:disabled) {
        background: rgba(166, 227, 161, 0.15);
        border-color: rgba(166, 227, 161, 0.55);
    }
    .mode-diagram {
        color: #89b4fa;
        border-color: rgba(137, 180, 250, 0.35);
        background: rgba(137, 180, 250, 0.08);
    }
    .mode-diagram:hover:not(:disabled) {
        background: rgba(137, 180, 250, 0.15);
        border-color: rgba(137, 180, 250, 0.55);
    }
    .mode-knowledge {
        color: #cba6f7;
        border-color: rgba(203, 166, 247, 0.35);
        background: rgba(203, 166, 247, 0.08);
    }
    .mode-knowledge:hover:not(:disabled) {
        background: rgba(203, 166, 247, 0.15);
        border-color: rgba(203, 166, 247, 0.55);
    }

    .mode-icon {
        font-size: 14px;
    }
    .mode-label {
        flex: 1;
        text-align: left;
    }

    /* Mode lock styles */
    .mode-locked,
    .mode-locked:hover {
        opacity: 0.5;
        cursor: not-allowed;
        border-style: dashed;
    }
    .mode-locked:hover {
        background: inherit;
        border-color: inherit;
        color: inherit;
    }
    .lock-icon {
        font-size: 11px;
        opacity: 0.8;
    }

    /* ── Automation sub-mode toggle ── */
    .submode-toggle {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0 10px 4px;
        background: rgba(30, 30, 46, 0.8);
        border: 1px solid #313244;
        border-radius: 8px;
        padding: 3px;
        flex-shrink: 0;
    }
    .submode-btn {
        background: transparent;
        border: 1px solid transparent;
        color: #6c7086;
        font-size: 11px;
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
        text-align: left;
        width: 100%;
    }
    .submode-btn:hover {
        color: #bac2de;
        background: rgba(49, 50, 68, 0.5);
    }
    .submode-active {
        background: rgba(49, 50, 68, 0.8);
        border-color: transparent;
    }
    .submode-agent.submode-active {
        color: #a6e3a1;
        background: rgba(166, 227, 161, 0.12);
        border-color: rgba(166, 227, 161, 0.3);
    }
    .submode-action.submode-active {
        color: #94e2d5;
        background: rgba(148, 226, 213, 0.12);
        border-color: rgba(148, 226, 213, 0.3);
    }
    .submode-locked .submode-btn {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .submode-locked .submode-btn:hover {
        background: transparent;
        color: #6c7086;
    }
    .submode-locked .submode-btn.submode-active {
        opacity: 0.65;
    }

    /* ── Palette section header ── */
    .palette-header {
        padding: 10px 12px 4px;
        flex-shrink: 0;
    }

    .palette-header h3 {
        margin: 0;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 1.2px;
        color: #585b70;
        padding-bottom: 6px;
        border-bottom: 1px solid #313244;
    }

    /* ── Mode lock banner ── */
    .lock-banner {
        display: flex;
        align-items: center;
        gap: 4px;
        margin: 0 10px;
        background: rgba(49, 50, 68, 0.6);
        border: 1px dashed #45475a;
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 10px;
        color: #6c7086;
        cursor: help;
        user-select: none;
        flex-shrink: 0;
    }
    .lock-banner span {
        font-size: 10px;
        letter-spacing: 0.3px;
    }

    /* ── Node list ── */
    .palette-nodes {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 8px 8px;
        flex: 1;
    }

    .palette-node {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: rgba(49, 50, 68, 0.4);
        border: 1px solid transparent;
        border-radius: 8px;
        color: #cdd6f4;
        cursor: grab;
        transition: all 0.15s;
        font-size: 12px;
        user-select: none;
    }

    .palette-node:hover {
        background: rgba(49, 50, 68, 0.8);
        border-color: var(--accent);
        box-shadow: 0 0 12px rgba(137, 180, 250, 0.1);
    }

    .palette-node:active {
        cursor: grabbing;
        transform: scale(0.97);
    }

    .palette-node-icon {
        font-size: 16px;
        flex-shrink: 0;
    }

    .palette-node-icon-svg {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        font-size: 0;
        flex-shrink: 0;
    }

    .palette-node-icon-svg :global(svg) {
        width: 20px;
        height: 20px;
    }

    .palette-node-info {
        flex: 1;
        min-width: 0;
    }

    .palette-node-title {
        font-weight: 500;
        font-size: 12px;
        color: #cdd6f4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .palette-node-description {
        display: none; /* Hide descriptions in compact mode */
    }

    .palette-controls {
        display: none; /* Hide controls in compact mode */
    }

    /* ── Mobile responsive ── */
    @media (max-width: 768px) {
        .node-palette {
            display: none;
        }
    }

    /* ── Mobile FAB ─────────────────────────────────────────────────────────── */
    .mobile-fab-container {
        display: none; /* hidden on desktop */
    }

    @media (max-width: 768px) {
        .mobile-fab-container {
            display: block;
            position: fixed;
            bottom: 80px; /* above any bottom toolbar area */
            right: 16px;
            z-index: 1100;
        }

        /* Semi-transparent backdrop behind the expanded menu */
        .fab-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            z-index: -1;
            cursor: pointer;
            border: none;
        }

        /* Scrollable list of node type buttons */
        .fab-node-list {
            position: absolute;
            bottom: 68px; /* above the main FAB button */
            right: 0;
            background: #1e1e2e; /* Catppuccin Mocha base */
            border: 1px solid #313244;
            border-radius: 14px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 6px; /* 6px gap → fat fingers won't mis-tap between items */
            min-width: 200px;
            max-height: 72vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        }

        .fab-mode-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            /* 44px touch target height */
            min-height: 44px;
            padding: 0 14px;
            border-radius: 10px;
            border: 1px solid #313244;
            background: rgba(49, 50, 68, 0.6);
            color: #cdd6f4;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
        }
        .fab-mode-btn:active {
            background: rgba(49, 50, 68, 0.9);
        }
        .fab-mode-auto { color: #a6e3a1; border-color: rgba(166,227,161,0.4); background: rgba(166,227,161,0.06); }
        .fab-mode-diagram { color: #89b4fa; border-color: rgba(137,180,250,0.4); background: rgba(137,180,250,0.06); }
        .fab-mode-knowledge { color: #cba6f7; border-color: rgba(203,166,247,0.4); background: rgba(203,166,247,0.06); }

        .fab-divider {
            height: 1px;
            background: #313244;
            margin: 6px 0;
        }

        .fab-node-item {
            display: flex;
            align-items: center;
            gap: 12px;
            /* 44px touch target: padding + line-height */
            min-height: 44px;
            padding: 0 14px;
            border-radius: 10px;
            border: 1px solid transparent;
            background: rgba(49, 50, 68, 0.4);
            color: #cdd6f4;
            font-size: 15px;
            cursor: pointer;
            text-align: left;
            width: 100%;
            transition: background 0.12s, border-color 0.12s;
        }

        .fab-node-item:active {
            background: rgba(49, 50, 68, 0.9);
            border-color: #89b4fa;
        }

        .fab-node-icon {
            font-size: 20px;
            flex-shrink: 0;
            width: 24px;
            text-align: center;
        }

        .fab-node-icon-svg {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            font-size: 0;
            flex-shrink: 0;
        }

        .fab-node-icon-svg :global(svg) {
            width: 24px;
            height: 24px;
        }

        .fab-node-label {
            font-weight: 500;
            white-space: nowrap;
            font-size: 15px;
            color: #cdd6f4;
        }

        /* Main FAB button */
        .fab-main {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            border: none;
            background: #cba6f7; /* Catppuccin Mocha mauve */
            color: #1e1e2e;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            transition: background 0.15s, transform 0.15s;
            position: relative;
            z-index: 1;
        }

        .fab-main:active {
            transform: scale(0.93);
        }

        .fab-main.fab-is-open {
            background: #f38ba8; /* Catppuccin Mocha red — signals "close" */
        }
    }
</style>
