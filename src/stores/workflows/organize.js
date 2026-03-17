import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from './bounds.js';
import { get } from 'svelte/store';
import { containerCustomizations } from './customizations.js';

// Layout defaults for auto-organize feature (moved from workflows.js)
// Increased spacing to give connector beziers breathing room
export const ORGANIZE_NODE_HORIZONTAL_SPACING = 120;
export const ORGANIZE_NODE_VERTICAL_SPACING = 160;
export const ORGANIZE_CONTAINER_HORIZONTAL_SPACING = 240;
export const ORGANIZE_CONTAINER_VERTICAL_SPACING = 300;
export const ORGANIZE_GRID_COLUMNS = 4;

/**
 * @typedef {import('../workflows.js').Node} Node
 * @typedef {import('../workflows.js').Connection} Connection
 * @typedef {import('../workflows.js').WorkflowContainer} WorkflowContainer
 * @typedef {import('../workflows.js').FactoryContainer} FactoryContainer
 * @typedef {import('../workflows.js').NetworkContainer} NetworkContainer
 * @typedef {import('../workflows.js').OrganizeItem} OrganizeItem
 * @typedef {import('../workflows.js').OrganizeEdge} OrganizeEdge
 * @typedef {import('../workflows.js').OrganizeOptions} OrganizeOptions
 * @typedef {import('../workflows.js').OrganizeContext} OrganizeContext
 * @typedef {import('../workflows.js').OrganizeLayoutPosition} OrganizeLayoutPosition
 */

/**
 * @param {string[]} nodeIds
 * @param {Map<string, Node>} nodeIndex
 * @returns {import('../workflows.js').ContainerBounds | null}
 */
export function computeBoundsFromNodeIds(nodeIds, nodeIndex) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodeIds.forEach((nodeId) => {
    const node = nodeIndex.get(nodeId);
    if (!node) return;
    const width = node.width || DEFAULT_NODE_WIDTH;
    const height = node.height || DEFAULT_NODE_HEIGHT;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + width);
    maxY = Math.max(maxY, node.y + height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * @param {OrganizeItem[]} items
 * @returns {import('../workflows.js').ContainerBounds | null}
 */
export function computeBoundsFromItems(items) {
  if (!items || !items.length) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  items.forEach((item) => {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? /** @type {number} */ (value) : fallback;
}

/**
 * @param {Connection[] | undefined} connections
 * @param {Map<string, OrganizeItem>} itemMap
 * @param {Map<string, string>} nodeToItem
 * @returns {OrganizeEdge[]}
 */
export function buildEdgesForOrganize(connections = [], itemMap, nodeToItem) {
  if (!connections || !connections.length) {
    return [];
  }

  /** @type {OrganizeEdge[]} */
  const edges = [];

  connections.forEach((conn) => {
    const fromId = resolveOrganizeEntity(conn.fromId);
    const toId = resolveOrganizeEntity(conn.toId);
    if (!fromId || !toId || fromId === toId) {
      return;
    }
    edges.push({ from: fromId, to: toId });
  });

  return edges;

  /**
   * @param {string | undefined} id
   * @returns {string | null}
   */
  function resolveOrganizeEntity(id) {
    if (!id) {
      return null;
    }
    if (itemMap.has(id)) {
      return id;
    }
    if (nodeToItem.has(id)) {
      return nodeToItem.get(id) ?? null;
    }
    return null;
  }
}

/**
 * @param {OrganizeItem[]} items
 * @param {OrganizeEdge[]} edges
 * @param {OrganizeOptions} [options]
 * @returns {Map<string, OrganizeLayoutPosition>}
 */
export function computeOrganizedLayout(items, edges, options = {}) {
  if (!items || !items.length) {
    return new Map();
  }

  /** @type {Map<string, OrganizeItem>} */
  const itemMap = new Map(items.map((item) => [item.id, item]));
  /** @type {Map<string, string[]>} */
  const adjacency = new Map();
  /** @type {Map<string, number>} */
  const indegree = new Map();

  items.forEach((item) => {
    adjacency.set(item.id, []);
    indegree.set(item.id, 0);
  });

  (edges || []).forEach(({ from, to }) => {
    if (!adjacency.has(from) || !indegree.has(to)) {
      return;
    }
    const fromList = adjacency.get(from);
    if (fromList) {
      fromList.push(to);
    }
    indegree.set(to, (indegree.get(to) || 0) + 1);
  });

  /** @type {Map<string, number>} */
  const levels = new Map();
  /** @type {string[]} */
  const queue = [];
  const sortedByPosition = items.slice().sort((a, b) => a.x - b.x || a.y - b.y);

  sortedByPosition.forEach((item) => {
    if ((indegree.get(item.id) || 0) === 0) {
      levels.set(item.id, 0);
      queue.push(item.id);
    }
  });

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const currentLevel = levels.get(current) || 0;
    (adjacency.get(current) || []).forEach((target) => {
      const candidate = currentLevel + 1;
      const existing = levels.get(target);
      if (existing === undefined || candidate > existing) {
        levels.set(target, candidate);
      }
      const newDegree = (indegree.get(target) || 0) - 1;
      indegree.set(target, newDegree);
      if (newDegree === 0) {
        queue.push(target);
      }
    });
  }

  const unresolved = items.filter((item) => !levels.has(item.id));
  if (unresolved.length) {
    unresolved.sort((a, b) => a.y - b.y || a.x - b.x);
    unresolved.forEach((item) => {
      const incomingLevels = (edges || [])
        .filter((edge) => edge.to === item.id && levels.has(edge.from))
        .map((edge) => levels.get(edge.from))
        .filter((lvl) => typeof lvl === 'number');
      if (incomingLevels.length) {
        const numericLevels = /** @type {number[]} */ (incomingLevels);
        const maxLevel = Math.max(...numericLevels);
        levels.set(item.id, maxLevel + 1);
      } else {
        levels.set(item.id, 0);
      }
    });
  }

  const uniqueLevels = [...new Set(levels.values())].sort((a, b) => a - b);
  /** @type {Map<number, number>} */
  const levelRemap = new Map(uniqueLevels.map((lvl, idx) => [lvl, idx]));
  /** @type {Map<string, number>} */
  const normalizedLevels = new Map();
  levels.forEach((lvl, id) => {
    const remapped = levelRemap.get(lvl);
    normalizedLevels.set(id, remapped !== undefined ? remapped : lvl);
  });

  /** @type {Map<string, number>} */
  const effectiveLevels = normalizedLevels.size ? normalizedLevels : new Map(levels);

  const totalEdges = edges ? edges.length : 0;
  const orientation = options.orientation || 'horizontal';
  // forceGrid: container-level layouts (factory/network) with 3+ items always
  // use the grid path, even when edges exist, so complex models wrap into rows
  // instead of producing a single ultra-wide horizontal strip.
  const useGridPath = (totalEdges === 0 || options.forceGrid) && items.length > 1;
  if (useGridPath) {
    const gridColumns = options.gridColumns || ORGANIZE_GRID_COLUMNS;
    const ordered = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    ordered.forEach((item, index) => {
      if (orientation === 'horizontal') {
        const column = Math.floor(index / gridColumns);
        effectiveLevels.set(item.id, column);
      } else {
        const row = Math.floor(index / gridColumns);
        effectiveLevels.set(item.id, row);
      }
    });
  }

  /** @type {Map<number, OrganizeItem[]>} */
  const grouped = new Map();
  effectiveLevels.forEach((lvl, id) => {
    if (!grouped.has(lvl)) {
      grouped.set(lvl, []);
    }
    const item = itemMap.get(id);
    const bucket = grouped.get(lvl);
    if (item && bucket) {
      bucket.push(item);
    }
  });

  const orderedLevels = [...grouped.keys()].sort((a, b) => a - b);
  const horizontalSpacing = options.horizontalSpacing ?? ORGANIZE_NODE_HORIZONTAL_SPACING;
  const verticalSpacing = options.verticalSpacing ?? ORGANIZE_NODE_VERTICAL_SPACING;

  const minX = Math.min(...items.map((item) => item.x));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const minY = Math.min(...items.map((item) => item.y));
  const maxY = Math.max(...items.map((item) => item.y + item.height));

  const defaultStartX = finiteOr(options.startX, minX);
  const defaultStartY = finiteOr(options.startY, minY);
  const defaultCenterX = (minX + maxX) / 2;
  const defaultCenterY = (minY + maxY) / 2;

  /** @type {Map<string, OrganizeLayoutPosition>} */
  const layout = new Map();

  if (orientation === 'horizontal') {
    const referenceCenterY = finiteOr(options.referenceCenterY, defaultCenterY);
    let currentX = defaultStartX;

    /**
     * @param {string} itemId
     * @returns {number[]}
     */
    const getParentCenters = (itemId) => {
      /** @type {number[]} */
      const parents = [];
      (edges || []).forEach((edge) => {
        if (edge.to === itemId && layout.has(edge.from)) {
          const parentItem = itemMap.get(edge.from);
          const parentPos = layout.get(edge.from);
          if (parentItem && parentPos) {
            parents.push(parentPos.y + parentItem.height / 2);
          }
        }
      });
      return parents;
    };

    orderedLevels.forEach((level) => {
      const columnItems = (grouped.get(level) || []).slice();
      if (!columnItems.length) {
        return;
      }

      const columnWidth = columnItems.reduce((max, item) => Math.max(max, item.width), 0);

      /** @type {{ item: OrganizeItem, targetCenter: number, fallbackCenter: number }[]} */
      const columnEntries = columnItems.map((item) => {
        const parentCenters = getParentCenters(item.id);
        const fallbackCenter = item.y + item.height / 2;
        const targetCenter = parentCenters.length
          ? parentCenters.reduce((sum, center) => sum + center, 0) / parentCenters.length
          : fallbackCenter;
        return {
          item,
          targetCenter: Number.isFinite(targetCenter) ? targetCenter : fallbackCenter,
          fallbackCenter,
        };
      });

      columnEntries.sort((a, b) => {
        if (Math.abs(a.targetCenter - b.targetCenter) > 0.5) {
          return a.targetCenter - b.targetCenter;
        }
        if (Math.abs(a.fallbackCenter - b.fallbackCenter) > 0.5) {
          return a.fallbackCenter - b.fallbackCenter;
        }
        return a.item.id.localeCompare(b.item.id);
      });

      let previousBottom = Number.NEGATIVE_INFINITY;

      columnEntries.forEach((entry) => {
        const { item } = entry;
        let desiredTop = entry.targetCenter - item.height / 2;
        if (!Number.isFinite(desiredTop)) {
          desiredTop = entry.fallbackCenter - item.height / 2;
        }

        if (!Number.isFinite(desiredTop)) {
          desiredTop = referenceCenterY - item.height / 2;
        }

        if (previousBottom !== Number.NEGATIVE_INFINITY) {
          const minTop = previousBottom + verticalSpacing;
          if (desiredTop < minTop) {
            desiredTop = minTop;
          }
        }

        const finalY = Math.round(desiredTop);
        layout.set(item.id, {
          x: Math.round(currentX),
          y: finalY,
        });

        previousBottom = finalY + item.height;
      });

      currentX += columnWidth + horizontalSpacing;
    });
  } else {
    const referenceCenterX = finiteOr(options.referenceCenterX, defaultCenterX);
    let currentY = defaultStartY;

    orderedLevels.forEach((level) => {
      const rowItems = (grouped.get(level) || [])
        .slice()
        .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
      if (!rowItems.length) {
        return;
      }

      const totalWidth = rowItems.reduce((sum, item, index) => {
        if (index === 0) return item.width;
        return sum + horizontalSpacing + item.width;
      }, 0);

      let cursorX = referenceCenterX - totalWidth / 2;
      let rowHeight = 0;

      rowItems.forEach((item) => {
        layout.set(item.id, {
          x: Math.round(cursorX),
          y: Math.round(currentY),
        });
        cursorX += item.width + horizontalSpacing;
        rowHeight = Math.max(rowHeight, item.height);
      });

      currentY += rowHeight + verticalSpacing;
    });
  }

  items.forEach((item) => {
    if (!layout.has(item.id)) {
      layout.set(item.id, {
        x: Math.round(item.x),
        y: Math.round(item.y),
      });
    }
  });

  // Post-processing pass: use actual cubic bezier sampling to detect and
  // resolve collisions between connector paths and non-endpoint nodes.
  if (edges && edges.length && orientation === 'horizontal') {
    applyBezierCollisionClearance(items, itemMap, edges, effectiveLevels, layout);
  }

  return layout;
}

// ---------------------------------------------------------------------------
// Bezier collision clearance — replaces the old applyMultiLevelClearance
// ---------------------------------------------------------------------------

/**
 * Sample N+1 evenly-spaced points along a cubic bezier curve.
 *
 * @param {{ x: number, y: number }} p0
 * @param {{ x: number, y: number }} p1
 * @param {{ x: number, y: number }} p2
 * @param {{ x: number, y: number }} p3
 * @param {number} [numSamples]
 * @returns {{ x: number, y: number }[]}
 */
function sampleCubicBezier(p0, p1, p2, p3, numSamples = 16) {
  const points = [];
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x;
    const y =
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y;
    points.push({ x, y });
  }
  return points;
}

/**
 * Returns true when any sampled bezier point falls within the padded bounding
 * box of the given item.
 *
 * @param {{ x: number, y: number }[]} bezierPoints
 * @param {{ x: number, y: number }} itemPos  top-left of the item
 * @param {number} itemWidth
 * @param {number} itemHeight
 * @param {number} [padding]
 * @returns {boolean}
 */
function bezierIntersectsItem(bezierPoints, itemPos, itemWidth, itemHeight, padding = 20) {
  const left = itemPos.x - padding;
  const right = itemPos.x + itemWidth + padding;
  const top = itemPos.y - padding;
  const bottom = itemPos.y + itemHeight + padding;
  return bezierPoints.some((p) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom);
}

/**
 * Post-processing pass that checks every edge against every non-endpoint item
 * using the *actual* cubic bezier formula used by ConnectionLine.svelte.
 *
 * For each collision detected, the colliding item is nudged upward or downward
 * (whichever needs less displacement to clear the bezier).  All items in the
 * same column (same DAG level) that are below the nudged item are cascaded
 * down by the same delta so column spacing is preserved.
 *
 * Multiple passes (up to MAX_PASSES) are run until no new collisions are found.
 *
 * @param {OrganizeItem[]} items
 * @param {Map<string, OrganizeItem>} itemMap
 * @param {OrganizeEdge[]} edges
 * @param {Map<string, number>} levels
 * @param {Map<string, OrganizeLayoutPosition>} layout
 */
function applyBezierCollisionClearance(items, itemMap, edges, levels, layout) {
  const PADDING = 20;     // Extra clearance around item bounding box
  const MIN_NUDGE = 24;   // Minimum pixels to move when a collision is found
  const MAX_PASSES = 3;

  // Build level → item[] lookup for cascade operations
  /** @type {Map<number, OrganizeItem[]>} */
  const levelItems = new Map();
  items.forEach((item) => {
    const lvl = levels.get(item.id);
    if (lvl === undefined) return;
    if (!levelItems.has(lvl)) levelItems.set(lvl, []);
    levelItems.get(lvl)?.push(item);
  });

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let anyNudge = false;

    for (const { from, to } of edges) {
      const fromPos = layout.get(from);
      const toPos = layout.get(to);
      const fromItem = itemMap.get(from);
      const toItem = itemMap.get(to);
      if (!fromPos || !toPos || !fromItem || !toItem) continue;

      // Compute bezier control points matching ConnectionLine.svelte 'right' direction:
      //   M sourcePort.x sourcePort.y C P1, P2, targetPort.x targetPort.y
      // Source port = right edge of source item, target port = left edge of target item
      const sourcePort = {
        x: fromPos.x + fromItem.width,
        y: fromPos.y + fromItem.height / 2,
      };
      const targetPort = {
        x: toPos.x,
        y: toPos.y + toItem.height / 2,
      };
      const dx = Math.abs(targetPort.x - sourcePort.x);
      const offset = Math.max(dx * 0.4, 60);
      const p0 = sourcePort;
      const p1 = { x: sourcePort.x + offset, y: sourcePort.y };
      const p2 = { x: targetPort.x - offset, y: targetPort.y };
      const p3 = targetPort;

      const bezierPoints = sampleCubicBezier(p0, p1, p2, p3, 18);

      // Determine the Y-range actually occupied by this bezier
      const bezierMinY = Math.min(...bezierPoints.map((p) => p.y));
      const bezierMaxY = Math.max(...bezierPoints.map((p) => p.y));

      // Check every item that is NOT the source or target of this edge
      for (const candidate of items) {
        if (candidate.id === from || candidate.id === to) continue;

        const candidatePos = layout.get(candidate.id);
        if (!candidatePos) continue;

        if (!bezierIntersectsItem(bezierPoints, candidatePos, candidate.width, candidate.height, PADDING)) {
          continue;
        }

        // Collision detected — decide direction.
        // Option A: nudge downward (below the bezier's bottom + padding)
        const nudgeDown = bezierMaxY + PADDING + 1 - candidatePos.y;
        // Option B: nudge upward  (above the bezier's top - padding)
        const nudgeUp = candidatePos.y + candidate.height - (bezierMinY - PADDING - 1);

        let dy;
        if (nudgeUp > 0 && nudgeDown > 0) {
          // Both directions can fix it; pick the one that moves the item less
          dy = nudgeUp <= nudgeDown ? -nudgeUp : nudgeDown;
        } else if (nudgeDown > 0) {
          dy = nudgeDown;
        } else if (nudgeUp > 0) {
          dy = -nudgeUp;
        } else {
          continue; // Shouldn't happen
        }

        // Apply at least MIN_NUDGE
        if (dy > 0) dy = Math.max(dy, MIN_NUDGE);
        else if (dy < 0) dy = Math.min(dy, -MIN_NUDGE);

        // Cascade: shift the candidate AND all same-level items below it
        // (or above it when nudging up) by |dy| so column spacing is preserved.
        const candidateLevel = levels.get(candidate.id);
        const columnItems = candidateLevel !== undefined ? (levelItems.get(candidateLevel) || []) : [candidate];

        if (dy > 0) {
          // Moving candidate down — also move everything below it in the column
          const threshold = candidatePos.y;
          columnItems.forEach((colItem) => {
            const pos = layout.get(colItem.id);
            if (!pos) return;
            if (pos.y >= threshold) {
              layout.set(colItem.id, { x: pos.x, y: Math.round(pos.y + dy) });
            }
          });
        } else {
          // Moving candidate up — also move everything above it in the column
          const threshold = candidatePos.y + candidate.height;
          columnItems.forEach((colItem) => {
            const pos = layout.get(colItem.id);
            if (!pos) return;
            if (pos.y + (itemMap.get(colItem.id)?.height ?? 0) <= threshold) {
              layout.set(colItem.id, { x: pos.x, y: Math.round(pos.y + dy) });
            }
          });
        }

        anyNudge = true;
      }
    }

    if (!anyNudge) break;
  }
}

/**
 * Apply position hints to override auto-layout positions.
 * Position hints are relative placement directives like "below machine-1".
 *
 * This runs AFTER computeOrganizedLayout() and overrides specific item positions
 * based on YAML-authored position: hints stored in containerCustomizations.
 *
 * @param {Map<string, OrganizeLayoutPosition>} layout - computed positions from computeOrganizedLayout
 * @param {OrganizeItem[]} items - the organize items
 * @param {Map<string, string>} positionHints - map of item ID → position hint string (e.g., "below machine-1")
 * @param {number} horizontalSpacing - spacing constant
 * @param {number} verticalSpacing - spacing constant
 * @returns {Map<string, OrganizeLayoutPosition>} - modified layout with hints applied
 */
export function applyPositionHints(layout, items, positionHints, horizontalSpacing, verticalSpacing) {
  if (!positionHints || positionHints.size === 0) return layout;

  const itemMap = new Map(items.map((item) => [item.id, item]));
  const result = new Map(layout); // clone — don't mutate original

  // ── Step 1: Parse all hints into (direction, anchorId) pairs ──────────────
  /** @type {Map<string, { direction: string, anchorId: string }>} */
  const parsedHints = new Map();
  positionHints.forEach((hint, itemId) => {
    const match = hint.match(/^(below|above|right-of|left-of)\s+(\S+)$/);
    if (match) {
      parsedHints.set(itemId, { direction: match[1], anchorId: match[2] });
    }
  });

  if (parsedHints.size === 0) return result;

  // ── Step 2: Topological sort so anchors are placed before dependants ───────
  // Build dependency graph: hinted item → its anchor (only if anchor is also hinted)
  const hintedIds = new Set(parsedHints.keys());

  // Kahn's algorithm — compute in-degrees within the hinted subgraph
  /** @type {Map<string, number>} */
  const inDegree = new Map();
  /** @type {Map<string, string[]>} */
  const dependants = new Map(); // anchorId → [itemIds that depend on it]

  hintedIds.forEach((id) => {
    inDegree.set(id, 0);
    dependants.set(id, []);
  });

  hintedIds.forEach((itemId) => {
    const { anchorId } = parsedHints.get(itemId);
    if (hintedIds.has(anchorId)) {
      // anchorId must be placed before itemId
      inDegree.set(itemId, (inDegree.get(itemId) ?? 0) + 1);
      dependants.get(anchorId)?.push(itemId);
    }
  });

  // Queue starts with all hinted items whose anchor is NOT itself hinted (in-degree 0)
  /** @type {string[]} */
  const queue = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  /** @type {string[]} */
  const topoOrder = [];
  while (queue.length > 0) {
    const id = /** @type {string} */ (queue.shift());
    topoOrder.push(id);
    (dependants.get(id) ?? []).forEach((depId) => {
      const newDeg = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, newDeg);
      if (newDeg === 0) queue.push(depId);
    });
  }

  // Detect cycles — any hinted item not reached by Kahn's is part of a cycle
  if (topoOrder.length < hintedIds.size) {
    const cyclic = [...hintedIds].filter((id) => !topoOrder.includes(id));
    console.warn(
      '⚠️ applyPositionHints: cyclic position hint dependencies detected — skipping cyclic items:',
      cyclic
    );
    // Still apply the non-cyclic ones (topoOrder already excludes them)
  }

  // ── Step 3: Apply hints in topo order ─────────────────────────────────────
  topoOrder.forEach((itemId) => {
    const parsed = parsedHints.get(itemId);
    if (!parsed) return;

    const { direction, anchorId } = parsed;
    const anchor = itemMap.get(anchorId);
    const item = itemMap.get(itemId);
    const anchorPos = result.get(anchorId); // reads progressively-updated result

    if (!anchor || !item || !anchorPos) return;

    switch (direction) {
      case 'below':
        result.set(itemId, {
          x: anchorPos.x,
          y: anchorPos.y + anchor.height + verticalSpacing,
        });
        break;
      case 'above':
        result.set(itemId, {
          x: anchorPos.x,
          y: anchorPos.y - item.height - verticalSpacing,
        });
        break;
      case 'right-of':
        result.set(itemId, {
          x: anchorPos.x + anchor.width + horizontalSpacing,
          y: anchorPos.y,
        });
        break;
      case 'left-of':
        result.set(itemId, {
          x: anchorPos.x - item.width - horizontalSpacing,
          y: anchorPos.y,
        });
        break;
      default:
        break;
    }
  });

  return result;
}

/**
 * Adjust bridge node Y positions after initial layout.
 *
 * A "bridge node" is a standalone node item (type === 'node') that has BOTH
 * incoming AND outgoing edges in the edge list — it bridges between two
 * containers. The topological sort already places bridge nodes at the correct
 * horizontal level (X), but their Y is computed as the average of their parent
 * containers' centers, which for a single-parent bridge is just the center of
 * the upstream container.
 *
 * This pass re-centers each bridge node vertically between its upstream and
 * downstream containers so the visual flow looks clean.  X is left unchanged.
 *
 * Call this AFTER computeOrganizedLayout() and BEFORE applyPositionHints() so
 * that explicit YAML position hints can still override the bridge adjustment.
 *
 * @param {Map<string, OrganizeLayoutPosition>} layout - positions from computeOrganizedLayout (mutated in place)
 * @param {OrganizeItem[]} items - the organize items
 * @param {OrganizeEdge[]} edges - the organize edges
 * @returns {void}
 */
export function adjustBridgeNodePositions(layout, items, edges) {
  if (!items || !items.length || !edges || !edges.length) return;

  const itemMap = new Map(items.map((item) => [item.id, item]));

  items.forEach((item) => {
    // Only adjust standalone node items — containers handle their own sizing
    if (item.type !== 'node') return;

    const pos = layout.get(item.id);
    if (!pos) return;

    // Collect connected items: upstream (items that point TO this node)
    // and downstream (items that this node points TO)
    /** @type {number[]} */
    const upstreamCenters = [];
    /** @type {number[]} */
    const downstreamCenters = [];

    edges.forEach((edge) => {
      if (edge.to === item.id) {
        // This node is downstream of edge.from → edge.from is upstream
        const fromItem = itemMap.get(edge.from);
        const fromPos = layout.get(edge.from);
        if (fromItem && fromPos) {
          upstreamCenters.push(fromPos.y + fromItem.height / 2);
        }
      }
      if (edge.from === item.id) {
        // This node is upstream of edge.to → edge.to is downstream
        const toItem = itemMap.get(edge.to);
        const toPos = layout.get(edge.to);
        if (toItem && toPos) {
          downstreamCenters.push(toPos.y + toItem.height / 2);
        }
      }
    });

    // Only adjust nodes that are true bridges (both incoming and outgoing)
    if (upstreamCenters.length === 0 || downstreamCenters.length === 0) return;

    // Ideal center Y = average of all connected container centers
    const allCenters = [...upstreamCenters, ...downstreamCenters];
    const avgCenter = allCenters.reduce((sum, c) => sum + c, 0) / allCenters.length;
    const newY = Math.round(avgCenter - item.height / 2);

    layout.set(item.id, { x: pos.x, y: newY });
  });
}

/**
 * @param {WorkflowContainer} container
 * @param {Map<string, Node>} nodeIndex
 * @returns {OrganizeContext | null}
 */
export function buildMachineOrganizeContext(container, nodeIndex) {
  /** @type {OrganizeItem[]} */
  const items = [];
  /** @type {Map<string, OrganizeItem>} */
  const itemMap = new Map();
  /** @type {Map<string, string>} */
  const nodeToItem = new Map();
  /** @type {Map<string, string>} */
  const positionHints = new Map();

  const customizations = get(containerCustomizations);

  (container.nodes || []).forEach((node) => {
    const current = nodeIndex.get(node.id) || node;
    const width = current.width || DEFAULT_NODE_WIDTH;
    const height = current.height || DEFAULT_NODE_HEIGHT;
    /** @type {OrganizeItem} */
    const item = {
      id: node.id,
      type: 'node',
      width,
      height,
      x: current.x,
      y: current.y,
      nodeIds: [node.id],
    };
    items.push(item);
    itemMap.set(item.id, item);
    nodeToItem.set(node.id, item.id);

    // Collect position hint for this node if present
    const hint = customizations.get(node.id)?.positionHint;
    if (hint) positionHints.set(node.id, hint);
  });

  if (!items.length) {
    return null;
  }

  const edges = buildEdgesForOrganize(container.connections, itemMap, nodeToItem);
  const bounds = container.bounds || computeBoundsFromItems(items);
  const minY = Math.min(...items.map((item) => item.y));
  const minX = Math.min(...items.map((item) => item.x));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));

  // LABEL_OFFSET: container label is a floating tab above the top-right edge,
  // so nodes can start near the top. Small padding for breathing room only.
  const MACHINE_LABEL_OFFSET = 20;

  /** @type {OrganizeContext} */
  const context = {
    items,
    edges,
    options: {
      orientation: 'horizontal',
      horizontalSpacing: ORGANIZE_NODE_HORIZONTAL_SPACING,
      verticalSpacing: ORGANIZE_NODE_VERTICAL_SPACING,
      startX: bounds ? bounds.x + 40 : minX,
      startY: bounds ? bounds.y + MACHINE_LABEL_OFFSET : minY,
      referenceCenterY: bounds ? bounds.y + MACHINE_LABEL_OFFSET + (bounds.height - MACHINE_LABEL_OFFSET) / 2 : (minY + maxY) / 2,
      gridColumns: ORGANIZE_GRID_COLUMNS,
    },
    positionHints,
  };

  return context;
}

/**
 * @param {FactoryContainer} container
 * @param {Map<string, Node>} nodeIndex
 * @returns {OrganizeContext | null}
 */
export function buildFactoryOrganizeContext(container, nodeIndex) {
  /** @type {OrganizeItem[]} */
  const items = [];
  /** @type {Map<string, OrganizeItem>} */
  const itemMap = new Map();
  /** @type {Map<string, string>} */
  const nodeToItem = new Map();
  /** @type {Map<string, string>} */
  const positionHints = new Map();

  const customizations = get(containerCustomizations);

  (container.machines || []).forEach((machine) => {
    const item = createContainerItem(machine, nodeIndex, 'machine');
    if (!item) return;
    items.push(item);
    itemMap.set(item.id, item);
    item.nodeIds.forEach((id) => nodeToItem.set(id, item.id));

    // Collect position hint for this machine if present
    const hint = customizations.get(machine.id)?.positionHint;
    if (hint) positionHints.set(machine.id, hint);
  });

  (container.nodeIds || []).forEach((nodeId) => {
    const node = nodeIndex.get(nodeId);
    if (!node) return;
    /** @type {OrganizeItem} */
    const item = {
      id: nodeId,
      type: 'node',
      width: node.width || DEFAULT_NODE_WIDTH,
      height: node.height || DEFAULT_NODE_HEIGHT,
      x: node.x,
      y: node.y,
      nodeIds: [nodeId],
    };
    items.push(item);
    itemMap.set(item.id, item);
    nodeToItem.set(nodeId, item.id);

    // Collect position hint for this standalone node if present
    const hint = customizations.get(nodeId)?.positionHint;
    if (hint) positionHints.set(nodeId, hint);
  });

  if (!items.length) {
    return null;
  }

  const edges = buildEdgesForOrganize(container.connections, itemMap, nodeToItem);
  const bounds = container.bounds || computeBoundsFromItems(items);
  const minY = Math.min(...items.map((item) => item.y));
  const minX = Math.min(...items.map((item) => item.x));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));

  // When 3+ machines are present, switch to vertical orientation with a
  // 2-column grid so the factory doesn't become an ultra-wide horizontal strip.
  // forceGrid ensures the grid path fires even when connections (edges) exist —
  // which is always the case for .ologic diagramming models.
  const useGrid = items.length >= 3;
  const orientation = useGrid ? 'vertical' : 'horizontal';
  const gridColumns = useGrid ? 2 : 3;

  // LABEL_OFFSET: container label is a floating tab above the top-right edge,
  // so child machines can start near the top. Small padding only.
  const FACTORY_LABEL_OFFSET = 30;

  /** @type {OrganizeContext} */
  const context = {
    items,
    edges,
    options: {
      orientation,
      forceGrid: useGrid,
      horizontalSpacing: ORGANIZE_CONTAINER_HORIZONTAL_SPACING,
      verticalSpacing: ORGANIZE_CONTAINER_VERTICAL_SPACING,
      startX: bounds ? bounds.x + 60 : minX,
      startY: bounds ? bounds.y + FACTORY_LABEL_OFFSET : minY,
      referenceCenterX: bounds ? bounds.x + bounds.width / 2 : (minX + maxX) / 2,
      referenceCenterY: bounds ? bounds.y + bounds.height / 2 : (minY + maxY) / 2,
      gridColumns,
    },
    positionHints,
  };

  return context;
}

/**
 * @param {NetworkContainer} container
 * @param {Map<string, Node>} nodeIndex
 * @returns {OrganizeContext | null}
 */
export function buildNetworkOrganizeContext(container, nodeIndex) {
  /** @type {OrganizeItem[]} */
  const items = [];
  /** @type {Map<string, OrganizeItem>} */
  const itemMap = new Map();
  /** @type {Map<string, string>} */
  const nodeToItem = new Map();
  /** @type {Map<string, string>} */
  const positionHints = new Map();

  const customizations = get(containerCustomizations);

  (container.factories || []).forEach((factory) => {
    const item = createContainerItem(factory, nodeIndex, 'factory');
    if (!item) return;
    items.push(item);
    itemMap.set(item.id, item);
    item.nodeIds.forEach((id) => nodeToItem.set(id, item.id));

    // Collect position hint for this factory if present
    const hint = customizations.get(factory.id)?.positionHint;
    if (hint) positionHints.set(factory.id, hint);
  });

  /** @type {Set<string>} */
  const machinesInFactories = new Set();
  (container.factories || []).forEach((factory) => {
    (factory.machines || []).forEach((machine) => machinesInFactories.add(machine.id));
  });

  (container.machines || []).forEach((machine) => {
    if (machinesInFactories.has(machine.id)) return;
    const item = createContainerItem(machine, nodeIndex, 'machine');
    if (!item) return;
    items.push(item);
    itemMap.set(item.id, item);
    item.nodeIds.forEach((id) => nodeToItem.set(id, item.id));

    // Collect position hint for this standalone machine if present
    const hint = customizations.get(machine.id)?.positionHint;
    if (hint) positionHints.set(machine.id, hint);
  });

  (container.nodeIds || []).forEach((nodeId) => {
    const node = nodeIndex.get(nodeId);
    if (!node) return;
    /** @type {OrganizeItem} */
    const item = {
      id: nodeId,
      type: 'node',
      width: node.width || DEFAULT_NODE_WIDTH,
      height: node.height || DEFAULT_NODE_HEIGHT,
      x: node.x,
      y: node.y,
      nodeIds: [nodeId],
    };
    items.push(item);
    itemMap.set(item.id, item);
    nodeToItem.set(nodeId, item.id);

    // Collect position hint for this standalone node if present
    const hint = customizations.get(nodeId)?.positionHint;
    if (hint) positionHints.set(nodeId, hint);
  });

  if (!items.length) {
    return null;
  }

  const edges = buildEdgesForOrganize(container.connections, itemMap, nodeToItem);
  const bounds = container.bounds || computeBoundsFromItems(items);
  const minY = Math.min(...items.map((item) => item.y));
  const minX = Math.min(...items.map((item) => item.x));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));

  // For networks with 3+ factories (or mixed children), switch to a 2-column
  // vertical grid so the layout doesn't become a single ultra-wide horizontal
  // strip.  forceGrid ensures the grid path fires even when connections (edges)
  // exist — which is always the case for .ologic diagramming models.
  const useGrid = items.length >= 3;
  const orientation = useGrid ? 'vertical' : 'horizontal';
  const gridColumns = useGrid ? 2 : 3;

  // LABEL_OFFSET: container label is a floating tab above the top-right edge,
  // so child factories can start near the top. Small padding only.
  const NETWORK_LABEL_OFFSET = 40;

  /** @type {OrganizeContext} */
  const context = {
    items,
    edges,
    options: {
      orientation,
      forceGrid: useGrid,
      horizontalSpacing: ORGANIZE_CONTAINER_HORIZONTAL_SPACING + 60,
      verticalSpacing: ORGANIZE_CONTAINER_VERTICAL_SPACING + 80,
      startX: bounds ? bounds.x + 80 : minX,
      startY: bounds ? bounds.y + NETWORK_LABEL_OFFSET : minY,
      referenceCenterX: bounds ? bounds.x + bounds.width / 2 : (minX + maxX) / 2,
      referenceCenterY: bounds ? bounds.y + bounds.height / 2 : (minY + maxY) / 2,
      gridColumns,
    },
    positionHints,
  };

  return context;
}

/**
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer | null} container
 * @param {Map<string, Node>} nodeIndex
 * @param {import('../workflows.js').OrganizeItem['type']} type
 * @returns {OrganizeItem | null}
 */
export function createContainerItem(container, nodeIndex, type) {
  if (!container) return null;
  const nodeIds = Array.from(collectAllNodeIds(container));
  if (!nodeIds.length) return null;
  const bounds = container.bounds || computeBoundsFromNodeIds(nodeIds, nodeIndex);
  if (!bounds) return null;
  /** @type {OrganizeItem} */
  const item = {
    id: container.id,
    type,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    nodeIds,
  };

  return item;
}

/**
 * Re-exported helper used internally by createContainerItem
 * This import relies on a type available from workflows.js
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer | null} container
 * @param {Set<string>} [nodeIdSet]
 * @returns {Set<string>}
 */
function collectAllNodeIds(container, nodeIdSet = new Set()) {
  if (!container) return nodeIdSet;
  const c = /** @type {any} */ (container);

  if (
    typeof c.id === 'string' &&
    !Array.isArray(c.nodes) &&
    !Array.isArray(c.nodeIds) &&
    !Array.isArray(c.machines) &&
    !Array.isArray(c.factories)
  ) {
    nodeIdSet.add(c.id);
  }

  if (Array.isArray(c.nodes)) {
    c.nodes.forEach((/** @type {any} */ n) => nodeIdSet.add(n.id));
  }
  if (Array.isArray(c.nodeIds)) {
    c.nodeIds.forEach((/** @type {string} */ id) => nodeIdSet.add(id));
  }
  if (Array.isArray(c.machines)) {
    c.machines.forEach((/** @type {any} */ m) => collectAllNodeIds(m, nodeIdSet));
  }
  if (Array.isArray(c.factories)) {
    c.factories.forEach((/** @type {any} */ f) => collectAllNodeIds(f, nodeIdSet));
  }
  return nodeIdSet;
}

// ---------------------------------------------------------------------------
// Container overlap detection and correction
// ---------------------------------------------------------------------------

/**
 * Returns true if two bounding boxes overlap (or are closer than minGap).
 *
 * @param {{ x: number, y: number, width: number, height: number }} boundsA
 * @param {{ x: number, y: number, width: number, height: number }} boundsB
 * @param {number} [minGap]
 * @returns {boolean}
 */
export function containersOverlap(boundsA, boundsB, minGap = 20) {
  return !(
    boundsA.x + boundsA.width + minGap <= boundsB.x ||
    boundsB.x + boundsB.width + minGap <= boundsA.x ||
    boundsA.y + boundsA.height + minGap <= boundsB.y ||
    boundsB.y + boundsB.height + minGap <= boundsA.y
  );
}

/**
 * Resolve overlapping sibling containers by nudging their nodes apart.
 *
 * This is a post-placement correction pass.  It reads the current (already
 * recalculated) bounds of every container in `containerIds`, sorts them by
 * their top-left corner, and for each overlapping pair it shifts the nodes of
 * the right/lower container just enough to create a minGap clearance.
 *
 * The function returns a flat map of nodeId → {x, y} updates that the caller
 * must apply via nodeActions.bulkMove().
 *
 * @param {string[]} containerIds - IDs of sibling containers to check
 * @param {any[]} allContainers   - Current workflowContainers store value
 * @param {any[]} allNodes        - Current nodes store value
 * @param {number} [minGap]       - Minimum gap to enforce between containers
 * @returns {Map<string, { x: number, y: number }>}  nodeId → new absolute position
 */
export function resolveContainerOverlaps(containerIds, allContainers, allNodes, minGap = 30) {
  if (!containerIds || containerIds.length < 2) return new Map();

  /** @type {Map<string, any>} */
  const containerMap = new Map();
  allContainers.forEach(c => containerMap.set(c.id, c));

  // Build list of {id, bounds, nodeIds} for each sibling that has valid bounds
  /** @type {Array<{ id: string, bounds: {x:number,y:number,width:number,height:number}, nodeIds: string[] }>} */
  const siblings = [];
  containerIds.forEach(cid => {
    const c = containerMap.get(cid);
    if (!c || !c.bounds) return;
    const b = c.bounds;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return;
    const nodeIds = Array.from(collectAllNodeIds(c));
    if (!nodeIds.length) return;
    siblings.push({ id: cid, bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, nodeIds });
  });

  if (siblings.length < 2) return new Map();

  // Build a node index for quick lookup
  /** @type {Map<string, any>} */
  const nodeIndex = new Map(allNodes.map(n => [n.id, n]));

  // Accumulated per-node deltas (dx, dy).  We build these up over all passes
  // so nodes only get moved once at the end.
  /** @type {Map<string, { dx: number, dy: number }>} */
  const nodeDeltas = new Map();

  /**
   * Shift all nodes in a sibling by (dx, dy) and update its working bounds.
   * @param {{ id: string, bounds: {x:number,y:number,width:number,height:number}, nodeIds: string[] }} sibling
   * @param {number} dx
   * @param {number} dy
   */
  const shiftSibling = (sibling, dx, dy) => {
    sibling.bounds = {
      x: sibling.bounds.x + dx,
      y: sibling.bounds.y + dy,
      width: sibling.bounds.width,
      height: sibling.bounds.height,
    };
    sibling.nodeIds.forEach(nid => {
      const existing = nodeDeltas.get(nid) || { dx: 0, dy: 0 };
      nodeDeltas.set(nid, { dx: existing.dx + dx, dy: existing.dy + dy });
    });
  };

  // -----------------------------------------------------------------------
  // Horizontal sweep: sort by X, push right-side container rightward
  // -----------------------------------------------------------------------
  const byX = siblings.slice().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);

  // Multiple passes to handle chain reactions (A pushes B which now overlaps C)
  const MAX_PASSES = 10;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < byX.length - 1; i++) {
      for (let j = i + 1; j < byX.length; j++) {
        const a = byX[i];
        const b = byX[j];
        if (!containersOverlap(a.bounds, b.bounds, minGap)) continue;

        changed = true;

        // Determine primary axis of overlap (push in the axis with less overlap)
        const overlapX = (a.bounds.x + a.bounds.width + minGap) - b.bounds.x;
        const overlapY = (a.bounds.y + a.bounds.height + minGap) - b.bounds.y;

        // If b is mostly to the right of a, push it right; otherwise push it down
        const bIsRight = b.bounds.x >= a.bounds.x;
        const bIsBelow = b.bounds.y >= a.bounds.y;

        if (bIsRight && overlapX > 0 && (overlapX <= overlapY || !bIsBelow)) {
          // Push b to the right
          shiftSibling(b, overlapX, 0);
        } else if (bIsBelow && overlapY > 0) {
          // Push b downward
          shiftSibling(b, 0, overlapY);
        } else if (overlapX > 0) {
          // Fallback: push right
          shiftSibling(b, overlapX, 0);
        }
      }
    }
    if (!changed) break;
  }

  // -----------------------------------------------------------------------
  // Convert accumulated node deltas to absolute positions
  // -----------------------------------------------------------------------
  /** @type {Map<string, { x: number, y: number }>} */
  const result = new Map();
  nodeDeltas.forEach(({ dx, dy }, nodeId) => {
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const node = nodeIndex.get(nodeId);
    if (!node) return;
    result.set(nodeId, { x: Math.round(node.x + dx), y: Math.round(node.y + dy) });
  });

  return result;
}

// ---------------------------------------------------------------------------

/**
 * Union-Find for grouping connected components
 */
class UnionFind {
  /**
   * @param {string[]} elements
   */
  constructor(elements) {
    /** @type {Map<string, string>} */
    this.parent = new Map();
    elements.forEach(el => this.parent.set(el, el));
  }

  /**
   * @param {string} i
   * @returns {string}
   */
  find(i) {
    const parent = this.parent.get(i);
    if (parent === i) {
      return i;
    }
    if (!parent) {
      return i;
    }
    const root = this.find(parent);
    this.parent.set(i, root);
    return root;
  }

  /**
   * @param {string} i
   * @param {string} j
   */
  union(i, j) {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      this.parent.set(rootJ, rootI);
    }
  }
}

/**
 * Global canvas organize - organizes all top-level elements on the canvas
 * @param {Node[]} allNodes - All nodes on canvas
 * @param {Connection[]} allConnections - All connections
 * @param {any[]} containers - All workflow containers (machines, factories, networks)
 * @returns {{ nodeUpdates: Map<string, {x: number, y: number}>, success: boolean }}
 */
export function organizeCanvas(allNodes, allConnections, containers) {
  console.log('🎨 Global canvas organize starting...');

  // Get all node IDs that belong to containers
  const nodesInContainers = new Set();
  containers.forEach(container => {
    collectAllNodeIds(container, nodesInContainers);
  });

  // Find standalone nodes (not in any container)
  const standaloneNodes = allNodes.filter(node => !nodesInContainers.has(node.id));

  // Get top-level containers (not nested inside other containers)
  const topLevelContainers = findTopLevelContainers(containers);

  console.log(`📊 Found ${standaloneNodes.length} standalone nodes, ${topLevelContainers.length} top-level containers`);

  // Build items for organize (standalone nodes + top-level containers)
  /** @type {OrganizeItem[]} */
  const items = [];
  /** @type {Map<string, OrganizeItem>} */
  const itemMap = new Map();
  /** @type {Map<string, string>} */
  const nodeToItem = new Map();

  // Add standalone nodes as items
  standaloneNodes.forEach(node => {
    const width = node.width || DEFAULT_NODE_WIDTH;
    const height = node.height || DEFAULT_NODE_HEIGHT;
    /** @type {OrganizeItem} */
    const item = {
      id: node.id,
      type: 'node',
      width,
      height,
      x: node.x,
      y: node.y,
      nodeIds: [node.id],
    };
    items.push(item);
    itemMap.set(item.id, item);
    nodeToItem.set(node.id, item.id);
  });

  // Add top-level containers as items
  // IMPORTANT: Always recompute bounds fresh from node positions (not container.bounds).
  // container.bounds comes from the derived workflowContainers store which has a 500ms
  // debounce on position changes. If we relied on it here, the layout would be computed
  // from stale bounds (before nodes were moved into place), requiring multiple calls.
  // computeBoundsFromNodeIds reads directly from allNodes so it is always up-to-date.
  const freshNodeIndex = new Map(allNodes.map(n => [n.id, n]));
  topLevelContainers.forEach(container => {
    const nodeIds = Array.from(collectAllNodeIds(container));
    const bounds = computeBoundsFromNodeIds(nodeIds, freshNodeIndex);
    if (!bounds) return;

    const containerType = container.isNetwork ? 'network' : container.isFactory ? 'factory' : 'machine';
    /** @type {OrganizeItem} */
    const item = {
      id: container.id,
      type: /** @type {'machine' | 'factory' | 'network'} */ (containerType),
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      nodeIds,
    };
    items.push(item);
    itemMap.set(item.id, item);
    nodeIds.forEach(nid => nodeToItem.set(nid, item.id));
  });

  if (items.length === 0) {
    console.log('ℹ️ No items to organize on canvas');
    return { nodeUpdates: new Map(), success: false };
  }

  // Build edges between items (based on connections)
  const edges = buildEdgesForOrganize(allConnections, itemMap, nodeToItem);

  // Find connected components using Union-Find
  const itemIds = items.map(item => item.id);
  const uf = new UnionFind(itemIds);

  edges.forEach(edge => {
    if (itemIds.includes(edge.from) && itemIds.includes(edge.to)) {
      uf.union(edge.from, edge.to);
    }
  });

  // Group items by connected component
  /** @type {Map<string, OrganizeItem[]>} */
  const components = new Map();
  items.forEach(item => {
    const root = uf.find(item.id);
    if (!components.has(root)) {
      components.set(root, []);
    }
    components.get(root)?.push(item);
  });

  console.log(`🔗 Found ${components.size} connected components`);

  // Organize each component separately
  /** @type {Map<string, {x: number, y: number}>} */
  const allNodeUpdates = new Map();

  const componentArray = Array.from(components.values());
  const COMPONENT_SPACING = 300; // Space between separate components
  let currentX = 100; // Starting X position

  componentArray.forEach((componentItems, componentIndex) => {
    console.log(`  Component ${componentIndex + 1}: ${componentItems.length} items`);

    // Find edges within this component
    const componentItemIds = new Set(componentItems.map(item => item.id));
    const componentEdges = edges.filter(edge =>
      componentItemIds.has(edge.from) && componentItemIds.has(edge.to)
    );

    // Find the prime node (root with most downstream connections)
    const primeNode = findPrimeNode(componentItems, componentEdges);
    console.log(`    Prime node: ${primeNode?.id || 'none'}`);

    // Compute organized layout for this component
    const layout = computeOrganizedLayout(componentItems, componentEdges, {
      orientation: 'horizontal',
      horizontalSpacing: ORGANIZE_CONTAINER_HORIZONTAL_SPACING,
      verticalSpacing: ORGANIZE_CONTAINER_VERTICAL_SPACING,
      startX: currentX,
      startY: 100,
      gridColumns: ORGANIZE_GRID_COLUMNS,
    });

    // Convert item positions to node positions.
    // Also compute the post-layout bounding box so we can accurately advance currentX.
    let postLayoutMinX = Infinity;
    let postLayoutMaxX = -Infinity;

    layout.forEach((position, itemId) => {
      const item = itemMap.get(itemId);
      if (!item) return;

      const dx = position.x - item.x;
      const dy = position.y - item.y;

      // Track post-layout extents for accurate component width
      postLayoutMinX = Math.min(postLayoutMinX, position.x);
      postLayoutMaxX = Math.max(postLayoutMaxX, position.x + item.width);

      // Update all nodes in this item
      item.nodeIds.forEach(nodeId => {
        const node = allNodes.find(n => n.id === nodeId);
        if (node) {
          allNodeUpdates.set(nodeId, {
            x: Math.round(node.x + dx),
            y: Math.round(node.y + dy),
          });
        }
      });
    });

    // Advance currentX using the ACTUAL post-layout width (not pre-layout bounds)
    if (Number.isFinite(postLayoutMaxX) && Number.isFinite(postLayoutMinX)) {
      currentX = postLayoutMaxX + COMPONENT_SPACING;
    } else {
      currentX += COMPONENT_SPACING;
    }
  });

  console.log(`✅ Global organize complete: ${allNodeUpdates.size} node updates`);
  return { nodeUpdates: allNodeUpdates, success: true, items, itemMap };
}

/**
 * Find top-level containers (not nested inside other containers)
 * @param {any[]} containers
 * @returns {any[]}
 */
function findTopLevelContainers(containers) {
  const allNestedContainerIds = new Set();

  containers.forEach(container => {
    if (Array.isArray(container.machines)) {
      container.machines.forEach((/** @type {any} */ m) => allNestedContainerIds.add(m.id));
    }
    if (Array.isArray(container.factories)) {
      container.factories.forEach((/** @type {any} */ f) => allNestedContainerIds.add(f.id));
    }
  });

  return containers.filter(c => !allNestedContainerIds.has(c.id));
}

/**
 * Find the prime node in a component (root or node with most downstream connections)
 * @param {OrganizeItem[]} items
 * @param {OrganizeEdge[]} edges
 * @returns {OrganizeItem | null}
 */
function findPrimeNode(items, edges) {
  // Build adjacency list and indegree map
  /** @type {Map<string, string[]>} */
  const adjacency = new Map();
  /** @type {Map<string, number>} */
  const indegree = new Map();

  items.forEach(item => {
    adjacency.set(item.id, []);
    indegree.set(item.id, 0);
  });

  edges.forEach(edge => {
    const fromList = adjacency.get(edge.from);
    if (fromList) {
      fromList.push(edge.to);
    }
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
  });

  // Count downstream nodes for each item (DFS from each node)
  /**
   * @param {string} nodeId
   * @param {Set<string>} visited
   * @returns {number}
   */
  const countDownstream = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);

    let count = 0;
    const children = adjacency.get(nodeId) || [];
    children.forEach(childId => {
      count += 1 + countDownstream(childId, visited);
    });
    return count;
  };

  // Find roots (nodes with no inputs)
  const roots = items.filter(item => (indegree.get(item.id) || 0) === 0);

  if (roots.length === 0) {
    // No clear root, just return first item
    return items[0] || null;
  }

  // Among roots, find the one with most downstream connections
  let primeNode = roots[0];
  let maxDownstream = countDownstream(roots[0].id);

  roots.slice(1).forEach(root => {
    const downstream = countDownstream(root.id);
    if (downstream > maxDownstream) {
      maxDownstream = downstream;
      primeNode = root;
    }
  });

  return primeNode;
}
