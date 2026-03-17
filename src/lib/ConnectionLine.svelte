<script>
    import { canvasState } from '../stores/canvas.js';
    import { nodes, connections, connectionActions } from '../stores/nodes.js';
    import { workflowContainers } from '../stores/workflows.js';
    import { settings } from '../stores/settings.js';

    /** @type {any} */
    export let connection;

    // Find the connected entities (nodes, machines, factories, or networks)
    $: fromEntity = (connection.fromId.startsWith('machine-') ||
                     connection.fromId.startsWith('factory-') ||
                     connection.fromId.startsWith('network-'))
        ? $workflowContainers.find(c => c.id === connection.fromId)
        : $nodes.find(n => n.id === connection.fromId);
    $: toEntity = (connection.toId.startsWith('machine-') ||
                   connection.toId.startsWith('factory-') ||
                   connection.toId.startsWith('network-'))
        ? $workflowContainers.find(c => c.id === connection.toId)
        : $nodes.find(n => n.id === connection.toId);

    // Legacy aliases for backward compatibility
    $: fromNode = fromEntity;
    $: toNode = toEntity;
    $: isSelected = $canvasState.selectedConnection === connection.id;

    /**
     * @typedef {'right' | 'left' | 'down' | 'up'} ConnectorDir
     */

    /**
     * @typedef {{x: number, y: number, width: number, height: number}} Rect
     */

    /**
     * Get bounding rectangle for an entity (node or container).
     * @param {any} entity
     * @returns {Rect}
     */
    function getEntityRect(entity) {
        if (!entity) return { x: 0, y: 0, width: 0, height: 0 };

        // Handle machine containers (which have bounds)
        const bounds = entity.bounds || entity;
        return {
            x: bounds.x || entity.x || 0,
            y: bounds.y || entity.y || 0,
            width: bounds.width || entity.width || 0,
            height: bounds.height || entity.height || 0
        };
    }

    /**
     * Determine connector direction based on relative entity geometry.
     * Connector orientation is a CONSEQUENCE of placement, never an input.
     * @param {Rect} fromR
     * @param {Rect} toR
     * @returns {ConnectorDir}
     */
    function getConnectorDir(fromR, toR) {
        const fromCX = fromR.x + fromR.width / 2;
        const fromCY = fromR.y + fromR.height / 2;
        const toCX = toR.x + toR.width / 2;
        const toCY = toR.y + toR.height / 2;
        const dx = toCX - fromCX;
        const dy = toCY - fromCY;

        // Use the dominant axis to decide horizontal vs vertical
        if (Math.abs(dx) >= Math.abs(dy)) {
            return dx >= 0 ? 'right' : 'left';
        } else {
            return dy >= 0 ? 'down' : 'up';
        }
    }

    /**
     * Compute stacked port offset along an edge when multiple connections share the same edge.
     * Spreads connections evenly with padding from the edge corners.
     * @param {number} nodeSize
     * @param {number} nodeOffset
     * @param {number} index
     * @param {number} total
     * @returns {number}
     */
    function getStackedPortPosition(nodeSize, nodeOffset, index, total) {
        if (total <= 1) return nodeOffset + nodeSize / 2;  // center (default behavior)
        const padding = Math.min(20, nodeSize * 0.15);
        const available = nodeSize - padding * 2;
        const step = available / (total - 1);
        return nodeOffset + padding + step * index;
    }

    /**
     * For a given node and edge direction, find all sibling connections sharing
     * the same target (input) edge and return this connection's index and total count.
     * @param {string} toNodeId
     * @param {ConnectorDir} edge
     * @returns {{index: number, total: number}}
     */
    function getInputPortStacking(toNodeId, edge) {
        const allConns = $connections;

        const siblings = allConns.filter(c => {
            if (c.toId !== toNodeId) return false;
            const fromN = $nodes.find(n => n.id === c.fromId);
            const toN = $nodes.find(n => n.id === c.toId);
            if (!fromN || !toN) return false;
            const fromRect = getEntityRect(fromN);
            const toRect = getEntityRect(toN);
            return getConnectorDir(fromRect, toRect) === edge;
        });

        if (siblings.length <= 1) return { index: 0, total: siblings.length };

        siblings.sort((a, b) => {
            const aFrom = $nodes.find(n => n.id === a.fromId);
            const bFrom = $nodes.find(n => n.id === b.fromId);
            if (!aFrom || !bFrom) return 0;
            const aRect = getEntityRect(aFrom);
            const bRect = getEntityRect(bFrom);

            if (edge === 'right' || edge === 'left') {
                return (aRect.y + aRect.height / 2) - (bRect.y + bRect.height / 2);
            } else {
                return (aRect.x + aRect.width / 2) - (bRect.x + bRect.width / 2);
            }
        });

        const index = siblings.findIndex(c => c.id === connection.id);
        return { index: Math.max(0, index), total: siblings.length };
    }

    /**
     * For a given node and edge direction, find all sibling connections sharing
     * the same source (output) edge and return this connection's index and total count.
     * @param {string} fromNodeId
     * @param {ConnectorDir} edge
     * @returns {{index: number, total: number}}
     */
    function getOutputPortStacking(fromNodeId, edge) {
        const allConns = $connections;

        const siblings = allConns.filter(c => {
            if (c.fromId !== fromNodeId) return false;
            const fromN = $nodes.find(n => n.id === c.fromId);
            const toN = $nodes.find(n => n.id === c.toId);
            if (!fromN || !toN) return false;
            const fromRect = getEntityRect(fromN);
            const toRect = getEntityRect(toN);
            return getConnectorDir(fromRect, toRect) === edge;
        });

        if (siblings.length <= 1) return { index: 0, total: siblings.length };

        siblings.sort((a, b) => {
            const aTo = $nodes.find(n => n.id === a.toId);
            const bTo = $nodes.find(n => n.id === b.toId);
            if (!aTo || !bTo) return 0;
            const aRect = getEntityRect(aTo);
            const bRect = getEntityRect(bTo);

            if (edge === 'right' || edge === 'left') {
                return (aRect.y + aRect.height / 2) - (bRect.y + bRect.height / 2);
            } else {
                return (aRect.x + aRect.width / 2) - (bRect.x + bRect.width / 2);
            }
        });

        const index = siblings.findIndex(c => c.id === connection.id);
        return { index: Math.max(0, index), total: siblings.length };
    }

    /**
     * Get port coordinates with stacking support.
     * @param {any} entity
     * @param {ConnectorDir} dir
     * @param {'from' | 'to'} side
     * @param {number} index
     * @param {number} total
     * @returns {{x: number, y: number}}
     */
    function getPortCoordinates(entity, dir, side, index, total) {
        const rect = getEntityRect(entity);

        switch (dir) {
            case 'right':
                return side === 'from'
                    ? { x: rect.x + rect.width, y: getStackedPortPosition(rect.height, rect.y, index, total) }
                    : { x: rect.x, y: getStackedPortPosition(rect.height, rect.y, index, total) };
            case 'left':
                return side === 'from'
                    ? { x: rect.x, y: getStackedPortPosition(rect.height, rect.y, index, total) }
                    : { x: rect.x + rect.width, y: getStackedPortPosition(rect.height, rect.y, index, total) };
            case 'down':
                return side === 'from'
                    ? { x: getStackedPortPosition(rect.width, rect.x, index, total), y: rect.y + rect.height }
                    : { x: getStackedPortPosition(rect.width, rect.x, index, total), y: rect.y };
            case 'up':
                return side === 'from'
                    ? { x: getStackedPortPosition(rect.width, rect.x, index, total), y: rect.y }
                    : { x: getStackedPortPosition(rect.width, rect.x, index, total), y: rect.y + rect.height };
        }
    }

    // Compute direction and stacking
    $: fromRect = getEntityRect(fromEntity);
    $: toRect = getEntityRect(toEntity);
    $: dir = getConnectorDir(fromRect, toRect);
    $: outputStack = getOutputPortStacking(connection.fromId, dir);
    $: inputStack = getInputPortStacking(connection.toId, dir);
    $: start = getPortCoordinates(fromEntity, dir, 'from', outputStack.index, outputStack.total);
    $: end = getPortCoordinates(toEntity, dir, 'to', inputStack.index, inputStack.total);

    /**
     * Build the fluid (bezier) path based on connector direction.
     * @param {{x: number, y: number}} from
     * @param {{x: number, y: number}} to
     * @param {ConnectorDir} direction
     * @returns {string}
     */
    function buildFluidPath(from, to, direction) {
        const dx = Math.abs(to.x - from.x);
        const dy = Math.abs(to.y - from.y);
        const offset = direction === 'right' || direction === 'left'
            ? Math.max(dx * 0.4, 60)
            : Math.max(dy * 0.4, 60);

        switch (direction) {
            case 'right':
                return `M ${from.x} ${from.y} C ${from.x + offset} ${from.y}, ${to.x - offset} ${to.y}, ${to.x} ${to.y}`;
            case 'left':
                return `M ${from.x} ${from.y} C ${from.x - offset} ${from.y}, ${to.x + offset} ${to.y}, ${to.x} ${to.y}`;
            case 'down':
                return `M ${from.x} ${from.y} C ${from.x} ${from.y + offset}, ${to.x} ${to.y - offset}, ${to.x} ${to.y}`;
            case 'up':
                return `M ${from.x} ${from.y} C ${from.x} ${from.y - offset}, ${to.x} ${to.y + offset}, ${to.x} ${to.y}`;
        }
    }

    /**
     * Build a straight line path.
     * @param {{x: number, y: number}} from
     * @param {{x: number, y: number}} to
     * @returns {string}
     */
    function buildStraightPath(from, to) {
        return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }

    /**
     * Build an orthogonal (cornered) path with right-angle bends.
     * @param {{x: number, y: number}} from
     * @param {{x: number, y: number}} to
     * @param {ConnectorDir} direction
     * @returns {string}
     */
    function buildCorneredPath(from, to, direction) {
        if (direction === 'right' || direction === 'left') {
            const midX = (from.x + to.x) / 2;
            return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
        } else {
            const midY = (from.y + to.y) / 2;
            return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
        }
    }

    // Build path based on current connector style
    $: pathData = (() => {
        const style = $settings.connectorStyle || 'fluid';
        switch (style) {
            case 'straight':
                return buildStraightPath(start, end);
            case 'cornered':
                return buildCorneredPath(start, end, dir);
            case 'fluid':
            default:
                return buildFluidPath(start, end, dir);
        }
    })();

    /**
     * Arrowhead triangle points at the target (input port) end.
     * @param {{x: number, y: number}} to
     * @param {ConnectorDir} direction
     * @returns {string}
     */
    function getArrowPoints(to, direction) {
        const size = 9;
        const depth = 8;
        const tx = to.x;
        const ty = to.y;

        switch (direction) {
            case 'right':
                return `${tx},${ty} ${tx - depth},${ty - size / 2} ${tx - depth},${ty + size / 2}`;
            case 'left':
                return `${tx},${ty} ${tx + depth},${ty - size / 2} ${tx + depth},${ty + size / 2}`;
            case 'down':
                return `${tx},${ty} ${tx - size / 2},${ty - depth} ${tx + size / 2},${ty - depth}`;
            case 'up':
                return `${tx},${ty} ${tx - size / 2},${ty + depth} ${tx + size / 2},${ty + depth}`;
        }
    }

    $: arrowPoints = getArrowPoints(end, dir);

    /** @param {MouseEvent} event */
    function handleConnectionClick(event) {
        event.stopPropagation();
        canvasState.update(s => ({
            ...s,
            selectedConnection: connection.id,
            selectedNode: null,
            selectedNodes: []
        }));
    }

    function handleConnectionDelete() {
        connectionActions.delete(connection.id);
        canvasState.update(s => ({ ...s, selectedConnection: null }));
    }

    /** @param {KeyboardEvent} event */
    function handleConnectionKeyDown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            canvasState.update(s => ({
                ...s,
                selectedConnection: connection.id,
                selectedNode: null,
                selectedNodes: []
            }));
        }
    }

    /** @param {KeyboardEvent} event */
    function handleDeleteKeyDown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleConnectionDelete();
        }
    }
</script>

{#if fromNode && toNode}
    <g class="connection-group" class:selected={isSelected}>
        <!-- Invisible thick line for easier clicking -->
        <path
            d={pathData}
            stroke="transparent"
            stroke-width="16"
            fill="none"
            cursor="pointer"
            on:click={handleConnectionClick}
            on:keydown={handleConnectionKeyDown}
            tabindex="0"
            role="button"
            aria-label="Select connection"
            style="pointer-events: all;"
        />

        <!-- Selection stroke (wider background) -->
        {#if isSelected}
            <path
                d={pathData}
                stroke="#2196f3"
                stroke-width="6"
                fill="none"
                class="selection-stroke"
                opacity="0.3"
            />
        {/if}

        <!-- Visible connection line -->
        <path
            d={pathData}
            stroke={isSelected ? "#2196f3" : "var(--connection-color, #666)"}
            stroke-width={isSelected ? "3" : "2"}
            fill="none"
            marker-end="url(#arrowhead)"
            class="connection-line"
        />

        <!-- Arrowhead at target (input port) -->
        <polygon
            points={arrowPoints}
            fill={isSelected ? "#2196f3" : "var(--connection-color, #666)"}
            class="arrowhead"
        />

        <!-- Animated flow dots -->
        <circle r="4" fill="#89b4fa" opacity="0.7">
            <animateMotion dur="2s" repeatCount="indefinite" path={pathData} />
        </circle>

        <!-- Delete button when selected -->
        {#if isSelected}
            {@const midPoint = {
                x: (start.x + end.x) / 2,
                y: (start.y + end.y) / 2
            }}
            <g
                class="delete-button-group"
                tabindex="0"
                role="button"
                aria-label="Delete connection"
                on:click|stopPropagation={handleConnectionDelete}
                on:keydown|stopPropagation={handleDeleteKeyDown}
                style="pointer-events: all;"
            >
                <circle
                    cx={midPoint.x}
                    cy={midPoint.y}
                    r="10"
                    fill="#ff4444"
                    stroke="white"
                    stroke-width="2"
                    cursor="pointer"
                    class="delete-button"
                />
                <text
                    x={midPoint.x}
                    y={midPoint.y + 3}
                    text-anchor="middle"
                    fill="white"
                    font-size="12"
                    font-weight="bold"
                    cursor="pointer"
                    class="delete-text"
                    style="pointer-events: none;"
                >×</text>
            </g>
        {/if}
    </g>
{/if}

<style>
    .connection-line {
        transition: stroke 0.2s ease, stroke-width 0.2s ease;
    }

    .connection-group:hover .connection-line {
        stroke: #2196f3;
        stroke-width: 3;
    }

    .connection-group:hover .arrowhead {
        fill: #2196f3;
    }

    .connection-group.selected .connection-line {
        stroke: #2196f3;
        stroke-width: 3;
    }

    .connection-group.selected .arrowhead {
        fill: #2196f3;
    }

    .arrowhead {
        transition: fill 0.2s ease;
    }

    .delete-button-group {
        pointer-events: all;
    }

    .delete-button {
        transition: all 0.15s ease;
        pointer-events: all;
    }

    .delete-button:hover {
        r: 12;
        fill: #cc0000;
    }

    .delete-text {
        pointer-events: none;
        user-select: none;
    }

    .connection-group {
        pointer-events: none;
    }

    .connection-group path {
        pointer-events: all;
    }

    .connection-group .connection-line {
        pointer-events: none;
    }
</style>
