<script>
    /**
     * OrdinalNode.svelte — Generic Svelte component for all 28 Ordinal node types.
     *
     * This component renders any Ordinal node type with:
     * - Correct Catppuccin Mocha border color
     * - SVG icon from the icon registry
     * - Content display
     *
     * It's used by the OrdinalPlugin.getComponent() method for plugin system
     * compatibility. The main Node.svelte handles most rendering inline,
     * but this component is available for future plugin-dispatched rendering.
     */
    import { getBorderColor, getDefaultIcon, getNodeTypeDef } from './types.js';
    import { getIcon } from './icons.js';

    /** @type {any} */
    export let node;
    /** @type {any} */
    export let nodeData = undefined;

    $: typeDef = getNodeTypeDef(node?.type || 'default');
    $: borderColor = getBorderColor(node?.type || 'default');
    $: iconName = node?.icon || getDefaultIcon(node?.type || 'default');
    $: iconSvg = getIcon(iconName, borderColor);
    $: label = typeDef?.label || node?.type || 'Node';
    $: content = node?.content || '';
</script>

<div class="ordinal-node" style="--border-color: {borderColor}">
    <div class="ordinal-header">
        {#if iconSvg}
            <span class="ordinal-icon">{@html iconSvg}</span>
        {/if}
        <span class="ordinal-type-label">{label}</span>
    </div>
    <div class="ordinal-content">
        {#if content}
            {content}
        {:else}
            <span class="ordinal-placeholder">No content</span>
        {/if}
    </div>
</div>

<style>
    .ordinal-node {
        padding: 0;
        font-family: inherit;
    }

    .ordinal-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-bottom: 1px solid rgba(205, 214, 244, 0.1);
        background: rgba(30, 30, 46, 0.3);
        border-radius: 6px 6px 0 0;
    }

    .ordinal-icon {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .ordinal-icon :global(svg) {
        width: 18px;
        height: 18px;
    }

    .ordinal-type-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--border-color, #cdd6f4);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.8;
    }

    .ordinal-content {
        padding: 10px;
        font-size: 13px;
        line-height: 1.4;
        color: #cdd6f4;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .ordinal-placeholder {
        color: #6c7086;
        font-style: italic;
    }
</style>
