<script>
    import { onMount, onDestroy } from 'svelte';
    import { fly } from 'svelte/transition';
    import { nodeDataStore, connections, nodes } from '../stores/nodes.js';
    import { canvasState } from '../stores/canvas.js';
    import { getNodeMeta } from './nodeTypes.js';

    /** @type {string | null} */
    export let nodeId = null;
    /** @type {number | null} */
    export let projectId = null;
    /** @type {() => void} */
    export let onClose = () => {};

    // Project requirements store (fetched once per projectId)
    /** @type {Map<string, {id: string, title: string, description: string, status: string, category: string}>} */
    let projectRequirementsMap = new Map();
    let requirementsFetched = false;

    // Reactive node data
    $: nodeData = nodeId ? $nodeDataStore.get(nodeId) : null;
    $: canvasNode = nodeId ? $nodes.find(n => n.id === nodeId) : null;
    $: nodeMeta = canvasNode ? getNodeMeta(canvasNode.type) : null;

    // Data sections derived from nodeData
    $: metadata = nodeData?.data?.metadata || {};
    $: processing = nodeData?.data?.processing || {};
    $: nodeRequirements = metadata?.requirements || [];
    $: nodeType = nodeData?.data?.node_type || canvasNode?.type || '';
    $: nodeTitle = metadata?.title || canvasNode?.title || nodeId || '';
    $: nodeContent = nodeData?.data?.content || canvasNode?.content || '';

    // Connections — find all connections where this node is from or to
    $: inputConnections = nodeId
        ? $connections.filter(c => c.toId === nodeId)
        : [];
    $: outputConnections = nodeId
        ? $connections.filter(c => c.fromId === nodeId)
        : [];

    // Get connected node title helper
    /** @param {string} id */
    function getNodeTitle(id) {
        const nd = $nodeDataStore.get(id);
        if (nd?.data?.metadata?.title) return nd.data.metadata.title;
        const cn = $nodes.find(n => n.id === id);
        return cn?.title || id;
    }

    // Model info for AI nodes
    $: isAiNode = nodeType === 'ai';
    $: modelName = processing?.model_override || processing?.model || '';
    $: temperature = processing?.parameters?.temperature ?? null;
    $: maxTokens = processing?.parameters?.max_tokens ?? null;
    $: systemPrompt = processing?.system_prompt || '';

    // Requirements enriched with project data
    $: enrichedRequirements = nodeRequirements.map(/** @param {string} reqId */ (reqId) => {
        const proj = projectRequirementsMap.get(reqId);
        return {
            id: reqId,
            title: proj?.title || null,
            status: proj?.status || null,
            category: proj?.category || null,
        };
    });

    // Fetch project requirements if projectId is set
    $: if (projectId && !requirementsFetched) {
        fetchProjectRequirements(projectId);
    }

    /** @param {number} pid */
    async function fetchProjectRequirements(pid) {
        requirementsFetched = true;
        try {
            const resp = await fetch(`/projects/${pid}`);
            if (!resp.ok) return;
            const data = await resp.json();
            const reqs = data.requirements || [];
            const map = new Map();
            for (const r of reqs) {
                if (r.id) map.set(r.id, r);
            }
            projectRequirementsMap = map;
        } catch (e) {
            console.warn('NodeDetailPanel: failed to fetch project requirements', e);
        }
    }

    /** @param {string | null} status */
    function statusColor(status) {
        switch (status) {
            case 'active': return '#89b4fa';       // blue
            case 'verified': return '#a6e3a1';     // green
            case 'deprecated': return '#f38ba8';   // red
            case 'draft':
            default: return '#a6adc8';             // gray / subtext0
        }
    }

    /** @param {string | null} status */
    function statusBg(status) {
        switch (status) {
            case 'active': return 'rgba(137, 180, 250, 0.12)';
            case 'verified': return 'rgba(166, 227, 161, 0.12)';
            case 'deprecated': return 'rgba(243, 139, 168, 0.12)';
            case 'draft':
            default: return 'rgba(166, 173, 200, 0.10)';
        }
    }

    /** @param {string} isoDate */
    function formatDate(isoDate) {
        if (!isoDate) return '—';
        try {
            return new Date(isoDate).toLocaleString();
        } catch {
            return isoDate;
        }
    }

    /** @param {KeyboardEvent} e */
    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            onClose();
        }
    }

    /** @param {MouseEvent} e */
    function handleBackdropClick(e) {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }

    onMount(() => {
        window.addEventListener('keydown', handleKeyDown);
    });

    onDestroy(() => {
        window.removeEventListener('keydown', handleKeyDown);
    });
</script>

<!-- Backdrop (click outside to close) -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="detail-backdrop" on:click={handleBackdropClick}>
    <!-- Panel slides in from the right -->
    <aside
        class="detail-panel"
        transition:fly={{ x: 420, duration: 280, opacity: 1 }}
        role="complementary"
        aria-label="Node detail"
    >
        <!-- ── Header ── -->
        <div class="panel-header">
            <div class="header-left">
                {#if nodeMeta}
                    <span class="type-badge" style="background: {nodeMeta.color}22; color: {nodeMeta.color}; border-color: {nodeMeta.color}55;">
                        {nodeMeta.icon} {nodeMeta.label}
                    </span>
                {/if}
                <h2 class="node-title-text" title={nodeTitle}>{nodeTitle}</h2>
            </div>
            <button class="close-btn" on:click={onClose} title="Close (Esc)">×</button>
        </div>

        <!-- ── Scrollable body ── -->
        <div class="panel-body">

            <!-- Content section -->
            {#if nodeContent && nodeContent !== 'Waiting for input...'}
                <section class="detail-section">
                    <h3 class="section-title">Content</h3>
                    <div class="content-box">
                        <pre class="content-text">{nodeContent}</pre>
                    </div>
                </section>
            {/if}

            <!-- Requirements section -->
            {#if enrichedRequirements.length > 0}
                <section class="detail-section">
                    <h3 class="section-title">Requirements
                        <span class="count-chip">{enrichedRequirements.length}</span>
                    </h3>
                    <ul class="req-list">
                        {#each enrichedRequirements as req}
                            <li class="req-item" style="background:{statusBg(req.status)}; border-left-color:{statusColor(req.status)}">
                                <div class="req-row">
                                    <span class="req-id">{req.id}</span>
                                    {#if req.status}
                                        <span class="req-status" style="color:{statusColor(req.status)}; border-color:{statusColor(req.status)}55;">
                                            {req.status}
                                        </span>
                                    {/if}
                                </div>
                                {#if req.title}
                                    <div class="req-title">{req.title}</div>
                                {/if}
                                {#if req.category}
                                    <div class="req-category">{req.category}</div>
                                {/if}
                            </li>
                        {/each}
                    </ul>
                </section>
            {:else if nodeRequirements.length > 0}
                <!-- Raw IDs when no project context -->
                <section class="detail-section">
                    <h3 class="section-title">Requirements
                        <span class="count-chip">{nodeRequirements.length}</span>
                    </h3>
                    <ul class="req-list">
                        {#each nodeRequirements as reqId}
                            <li class="req-item raw" style="border-left-color:#cba6f7;">
                                <span class="req-id">{reqId}</span>
                            </li>
                        {/each}
                    </ul>
                </section>
            {/if}

            <!-- Connections section -->
            {#if inputConnections.length > 0 || outputConnections.length > 0}
                <section class="detail-section">
                    <h3 class="section-title">Connections</h3>

                    {#if inputConnections.length > 0}
                        <div class="conn-group">
                            <div class="conn-group-label">
                                <span class="conn-arrow in">←</span> Inputs ({inputConnections.length})
                            </div>
                            <ul class="conn-list">
                                {#each inputConnections as conn}
                                    <li class="conn-item">
                                        <span class="conn-node-title">{getNodeTitle(conn.fromId)}</span>
                                        <span class="conn-id">{conn.fromId}</span>
                                        {#if conn.type === 'loop'}
                                            <span class="conn-tag">loop ×{conn.loop_count || 1}</span>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}

                    {#if outputConnections.length > 0}
                        <div class="conn-group">
                            <div class="conn-group-label">
                                <span class="conn-arrow out">→</span> Outputs ({outputConnections.length})
                            </div>
                            <ul class="conn-list">
                                {#each outputConnections as conn}
                                    <li class="conn-item">
                                        <span class="conn-node-title">{getNodeTitle(conn.toId)}</span>
                                        <span class="conn-id">{conn.toId}</span>
                                        {#if conn.type === 'loop'}
                                            <span class="conn-tag">loop ×{conn.loop_count || 1}</span>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}
                </section>
            {/if}

            <!-- Model Info (AI nodes) -->
            {#if isAiNode}
                <section class="detail-section">
                    <h3 class="section-title">Model Info</h3>
                    <div class="meta-grid">
                        {#if modelName}
                            <span class="meta-key">Model</span>
                            <span class="meta-val mono">{modelName}</span>
                        {:else}
                            <span class="meta-key">Model</span>
                            <span class="meta-val muted">default</span>
                        {/if}
                        {#if temperature !== null}
                            <span class="meta-key">Temperature</span>
                            <span class="meta-val mono">{temperature}</span>
                        {/if}
                        {#if maxTokens !== null}
                            <span class="meta-key">Max Tokens</span>
                            <span class="meta-val mono">{maxTokens}</span>
                        {/if}
                    </div>
                    {#if systemPrompt}
                        <div class="system-prompt-box">
                            <div class="system-prompt-label">System Prompt</div>
                            <pre class="system-prompt-text">{systemPrompt.length > 400 ? systemPrompt.slice(0, 400) + '…' : systemPrompt}</pre>
                        </div>
                    {/if}
                </section>
            {/if}

            <!-- Metadata section -->
            <section class="detail-section">
                <h3 class="section-title">Metadata</h3>
                <div class="meta-grid">
                    <span class="meta-key">Node ID</span>
                    <span class="meta-val mono small">{nodeId}</span>

                    <span class="meta-key">Type</span>
                    <span class="meta-val mono">{nodeType}</span>

                    {#if metadata.created_at}
                        <span class="meta-key">Created</span>
                        <span class="meta-val small">{formatDate(metadata.created_at)}</span>
                    {/if}

                    {#if metadata.customColor}
                        <span class="meta-key">Custom Color</span>
                        <span class="meta-val">
                            <span class="color-swatch" style="background:{metadata.customColor}"></span>
                            <span class="mono small">{metadata.customColor}</span>
                        </span>
                    {/if}

                    {#if metadata.customLabel}
                        <span class="meta-key">Custom Label</span>
                        <span class="meta-val">{metadata.customLabel}</span>
                    {/if}

                    {#if canvasNode}
                        <span class="meta-key">Position</span>
                        <span class="meta-val mono small">x:{Math.round(canvasNode.x)}, y:{Math.round(canvasNode.y)}</span>

                        <span class="meta-key">Size</span>
                        <span class="meta-val mono small">{canvasNode.width || 250}×{canvasNode.height || 120}</span>
                    {/if}

                    {#if metadata.version}
                        <span class="meta-key">Version</span>
                        <span class="meta-val mono">{metadata.version}</span>
                    {/if}
                </div>
            </section>

        </div>
    </aside>
</div>

<style>
    .detail-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1100;
        /* Transparent — lets canvas show through, backdrop click closes */
        pointer-events: none;
    }

    .detail-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: 400px;
        height: 100vh;
        background: #1e1e2e;
        border-left: 1px solid #313244;
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.45);
        z-index: 1100;
        display: flex;
        flex-direction: column;
        pointer-events: all;
        overflow: hidden;
    }

    /* ── Header ── */
    .panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px 14px;
        border-bottom: 1px solid #313244;
        background: #181825;
        flex-shrink: 0;
    }

    .header-left {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        flex: 1;
    }

    .type-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid;
        width: fit-content;
    }

    .node-title-text {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: #b4befe;
        line-height: 1.3;
        word-break: break-word;
    }

    .close-btn {
        flex-shrink: 0;
        background: transparent;
        border: none;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
        color: #6c7086;
        padding: 2px 6px;
        border-radius: 4px;
        transition: background 0.15s, color 0.15s;
        margin-top: 2px;
    }

    .close-btn:hover {
        background: #313244;
        color: #cdd6f4;
    }

    /* ── Body ── */
    .panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px 16px 24px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        scrollbar-width: thin;
        scrollbar-color: #313244 transparent;
    }

    .panel-body::-webkit-scrollbar {
        width: 5px;
    }
    .panel-body::-webkit-scrollbar-track { background: transparent; }
    .panel-body::-webkit-scrollbar-thumb {
        background: #313244;
        border-radius: 3px;
    }

    /* ── Sections ── */
    .detail-section {
        padding: 14px 0 10px;
        border-bottom: 1px solid #1e1e2e;
    }

    .detail-section:last-child {
        border-bottom: none;
    }

    .section-title {
        margin: 0 0 10px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #b4befe;
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .count-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        background: rgba(180, 190, 254, 0.15);
        color: #b4befe;
        border-radius: 9px;
        font-size: 10px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    /* ── Content box ── */
    .content-box {
        background: #181825;
        border: 1px solid #313244;
        border-radius: 6px;
        padding: 12px;
        max-height: 300px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: #313244 transparent;
    }

    .content-text {
        margin: 0;
        font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
        font-size: 12px;
        color: #cdd6f4;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.55;
    }

    /* ── Requirements ── */
    .req-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .req-item {
        padding: 8px 10px;
        border-radius: 5px;
        border-left: 3px solid #cba6f7;
        background: rgba(203, 166, 247, 0.08);
    }

    .req-item.raw {
        padding: 6px 10px;
    }

    .req-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .req-id {
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 12px;
        font-weight: 600;
        color: #cba6f7;
    }

    .req-status {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 1px 6px;
        border-radius: 3px;
        border: 1px solid;
    }

    .req-title {
        margin-top: 4px;
        font-size: 13px;
        color: #cdd6f4;
        line-height: 1.4;
    }

    .req-category {
        margin-top: 2px;
        font-size: 11px;
        color: #6c7086;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    /* ── Connections ── */
    .conn-group {
        margin-bottom: 10px;
    }

    .conn-group-label {
        font-size: 11px;
        font-weight: 600;
        color: #a6adc8;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .conn-arrow {
        font-size: 14px;
        font-weight: 700;
    }
    .conn-arrow.in { color: #89dceb; }   /* sky */
    .conn-arrow.out { color: #a6e3a1; }  /* green */

    .conn-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .conn-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: #181825;
        border: 1px solid #313244;
        border-radius: 5px;
        flex-wrap: wrap;
    }

    .conn-node-title {
        font-size: 13px;
        color: #cdd6f4;
        font-weight: 500;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .conn-id {
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 10px;
        color: #6c7086;
        flex-shrink: 0;
    }

    .conn-tag {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 3px;
        background: rgba(249, 226, 175, 0.12);
        color: #f9e2af;
        flex-shrink: 0;
    }

    /* ── Meta grid ── */
    .meta-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 6px 12px;
        align-items: start;
    }

    .meta-key {
        font-size: 11px;
        font-weight: 600;
        color: #6c7086;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding-top: 1px;
        white-space: nowrap;
    }

    .meta-val {
        font-size: 13px;
        color: #a6adc8;
        display: flex;
        align-items: center;
        gap: 6px;
        word-break: break-all;
    }

    .meta-val.mono {
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 12px;
    }

    .meta-val.small {
        font-size: 11px;
    }

    .meta-val.muted {
        color: #6c7086;
        font-style: italic;
    }

    .color-swatch {
        display: inline-block;
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 1px solid #313244;
        flex-shrink: 0;
    }

    /* ── System prompt ── */
    .system-prompt-box {
        margin-top: 10px;
        background: #181825;
        border: 1px solid #313244;
        border-radius: 6px;
        padding: 10px 12px;
    }

    .system-prompt-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #6c7086;
        margin-bottom: 6px;
    }

    .system-prompt-text {
        margin: 0;
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 11px;
        color: #a6adc8;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.5;
    }
</style>
