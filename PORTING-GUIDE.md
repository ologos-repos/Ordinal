# Porting Guide: Cherry-Picking Improvements from Backup

This guide documents how to port our custom improvements from the Ordinal backup into the Thoughtorio codebase.

## Overview

**Backup location**: `/home/bobbyhiddn/Code/Ordinal-backup/`
**Current codebase**: `/home/bobbyhiddn/Code/Rhode/ordinal-app/`
**Improvements doc**: `/home/bobbyhiddn/Code/Ordinal-backup/IMPROVEMENTS-TO-PORT.md`

## Key Differences: ConnectionLine.svelte

### Thoughtorio's Approach (Current)
- **Port-based connections**: Uses explicit `fromPort` and `toPort` (input/output/top/bottom/ai_input/ai_output)
- **Fixed port positions**: Ports are at center of edges (no stacking)
- **Single connector style**: Only bezier curves (no orthogonal option)
- **Container support**: Already supports machine/factory/network entities ✅
- **File size**: 261 lines

### Our Backup's Approach
- **Direction-aware**: Automatically computes direction (right/left/up/down) based on relative positions
- **Port stacking**: Multiple connections spread along edges with padding
- **Three connector styles**: Fluid (bezier), straight, cornered (orthogonal)
- **Container support**: Also supports containers ✅
- **File size**: 408 lines

## Recommendation: Hybrid Approach

**Keep Thoughtorio's foundation** (explicit ports + container logic)
**Add our enhancements** (stacking + orthogonal routing)

## Changes to Make

### 1. Add Connector Style Store

**File**: `src/stores/settings.js` (or create `src/stores/connectorStyle.js`)

```javascript
import { writable } from 'svelte/store'

// Connector style: 'fluid', 'straight', or 'cornered'
export const connectorStyle = writable('fluid')
```

### 2. Enhance getPortCoordinates() with Stacking

Replace the current fixed-center port positioning with our stacking logic:

```javascript
/**
 * Get stacked port position along an edge when multiple connections share it.
 * Spreads connections evenly with padding from corners.
 */
function getStackedPortPosition(nodeSize, nodeOffset, index, total) {
  if (total <= 1) return nodeOffset + nodeSize / 2  // center (default)
  const padding = Math.min(20, nodeSize * 0.15)
  const available = nodeSize - padding * 2
  const step = available / (total - 1)
  return nodeOffset + padding + step * index
}

/**
 * For a given node and port direction, find all sibling connections sharing
 * the same edge and return this connection's index and total count.
 */
function getPortStacking(nodeId, port, isSource) {
  const allConns = $connections  // or however Thoughtorio stores connections
  const siblings = allConns.filter(c => {
    if (isSource) {
      return c.fromId === nodeId && c.fromPort === port
    } else {
      return c.toId === nodeId && c.toPort === port
    }
  })

  if (siblings.length <= 1) return { index: 0, total: siblings.length }

  // Sort by target/source position (Y for horizontal, X for vertical)
  siblings.sort((a, b) => {
    const aOther = isSource ? $nodes.find(n => n.id === a.toId) : $nodes.find(n => n.id === a.fromId)
    const bOther = isSource ? $nodes.find(n => n.id === b.toId) : $nodes.find(n => n.id === b.fromId)
    if (!aOther || !bOther) return 0

    if (port === 'input' || port === 'output') {
      // Horizontal ports: sort by Y position
      return (aOther.y + aOther.height / 2) - (bOther.y + bOther.height / 2)
    } else {
      // Vertical ports: sort by X position
      return (aOther.x + aOther.width / 2) - (bOther.x + bOther.width / 2)
    }
  })

  const index = siblings.findIndex(c => c.id === connection.id)
  return { index: Math.max(0, index), total: siblings.length }
}
```

### 3. Add Orthogonal Path Builder

Add alongside `getBezierPath()`:

```javascript
/**
 * Build an orthogonal (cornered) path with right-angle bends.
 */
function getCorneredPath(fromNode, toNode, conn) {
  if (!fromNode || !toNode || !conn) return ''

  const start = getPortCoordinates(fromNode, conn.fromPort)
  const end = getPortCoordinates(toNode, conn.toPort)

  const { x: x1, y: y1 } = start
  const { x: x2, y: y2 } = end

  // Determine if connection is primarily horizontal or vertical
  if (conn.fromPort === 'output' || conn.fromPort === 'input') {
    // Horizontal
    const midX = (x1 + x2) / 2
    return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
  } else {
    // Vertical
    const midY = (y1 + y2) / 2
    return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`
  }
}

/**
 * Build a straight line path.
 */
function getStraightPath(fromNode, toNode, conn) {
  if (!fromNode || !toNode || !conn) return ''

  const start = getPortCoordinates(fromNode, conn.fromPort)
  const end = getPortCoordinates(toNode, conn.toPort)

  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
}
```

### 4. Add Style Switcher in Path Computation

Replace the single `pathData` reactive statement:

```javascript
import { connectorStyle } from '../stores/settings.js'

$: pathData = (() => {
  const style = $connectorStyle
  switch (style) {
    case 'straight':
      return getStraightPath(fromNode, toNode, connection)
    case 'cornered':
      return getCorneredPath(fromNode, toNode, connection)
    case 'fluid':
    default:
      return getBezierPath(fromNode, toNode, connection)
  }
})()
```

### 5. Add UI Toggle for Connector Style

**File**: `src/lib/SettingsPanel.svelte` (or wherever settings UI lives)

```svelte
<script>
  import { connectorStyle } from '../stores/settings.js'
</script>

<div class="setting-row">
  <label>Connector Style:</label>
  <select bind:value={$connectorStyle}>
    <option value="fluid">Fluid (Bezier)</option>
    <option value="straight">Straight</option>
    <option value="cornered">Cornered (Orthogonal)</option>
  </select>
</div>
```

### 6. Optional: Add Animated Flow Dots

Inside the `<g class="connection-group">` in ConnectionLine.svelte:

```svelte
<!-- Animated flow dots -->
<circle r="4" fill="#89b4fa" opacity="0.7">
  <animateMotion dur="2s" repeatCount="indefinite" path={pathData} />
</circle>
```

## Testing Checklist

- [ ] Build succeeds (`npm run build`)
- [ ] Connections render correctly with all three styles
- [ ] Port stacking works when multiple connections share an edge
- [ ] Container connections (machine/factory/network) still work
- [ ] Delete button appears on selection
- [ ] Hover effects work
- [ ] Animated dots flow along paths
- [ ] Settings toggle switches styles in real-time

## Files to Reference

All improvements are documented and backed up in:
- `/home/bobbyhiddn/Code/Ordinal-backup/src/lib/ConnectionLine.svelte`
- `/home/bobbyhiddn/Code/Ordinal-backup/IMPROVEMENTS-TO-PORT.md`

## Next Steps

1. Add connectorStyle store to settings
2. Implement port stacking logic
3. Add getCorneredPath() and getStraightPath() functions
4. Update pathData reactive statement to switch based on style
5. Add UI toggle for connector style
6. Test thoroughly with various graph configurations
7. Consider porting other improvements (NodeData normalization, clipboard enhancements)

---

**Created**: 2026-02-16 by Rhode-Eta
**Migration**: Thoughtorio → Rhode's Ordinal
