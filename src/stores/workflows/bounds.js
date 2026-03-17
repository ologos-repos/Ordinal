// Bounds and layout constants used across containers
import { get } from 'svelte/store';
import { appMode } from '../mode.js';

export const DEFAULT_NODE_WIDTH = 250;
export const DEFAULT_NODE_HEIGHT = 120;
export const DEFAULT_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };

/** Returns 0 in diagramming mode (no play button), 50 otherwise. */
function getPlayButtonSpace() {
  return get(appMode) === 'diagramming' ? 0 : 50;
}

/**
 * @param {any[]} nodes
 * @param {boolean} isWorkflow
 * @param {{x:number,y:number,width:number,height:number}|undefined} fallbackBounds
 */
export function computeMachineBounds(nodes, isWorkflow, fallbackBounds) {
  if (!nodes || nodes.length === 0) {
    return fallbackBounds ? { ...fallbackBounds } : { ...DEFAULT_BOUNDS };
  }

  const padding = 20;
  const portMargin = 14;
  const playButtonSpace = isWorkflow ? getPlayButtonSpace() : 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    if (!node) return;
    const width = node.width || DEFAULT_NODE_WIDTH;
    const height = node.height || DEFAULT_NODE_HEIGHT;
    minX = Math.min(minX, node.x - portMargin);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + width + portMargin);
    maxY = Math.max(maxY, node.y + height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return fallbackBounds ? { ...fallbackBounds } : { ...DEFAULT_BOUNDS };
  }

  return {
    x: minX - padding,
    y: minY - padding - playButtonSpace,
    width: Math.max(1, maxX - minX + 2 * padding),
    height: Math.max(1, maxY - minY + 2 * padding + playButtonSpace),
  };
}

/**
 * @param {any[]} machines
 * @param {string[]} nodeIds
 * @param {Map<string, any>} nodeIndex
 * @param {{x:number,y:number,width:number,height:number}|undefined} fallbackBounds
 */
export function computeFactoryBounds(machines, nodeIds, nodeIndex, fallbackBounds) {
  const padding = 30;
  const playButtonSpace = getPlayButtonSpace();
  const nodePortMargin = 14;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  (machines || []).forEach((machine) => {
    if (!machine || !machine.bounds) return;
    minX = Math.min(minX, machine.bounds.x);
    minY = Math.min(minY, machine.bounds.y);
    maxX = Math.max(maxX, machine.bounds.x + machine.bounds.width);
    maxY = Math.max(maxY, machine.bounds.y + machine.bounds.height);
  });

  (nodeIds || []).forEach((nodeId) => {
    const node = nodeIndex.get(nodeId);
    if (!node) return;
    const width = node.width || DEFAULT_NODE_WIDTH;
    const height = node.height || DEFAULT_NODE_HEIGHT;
    minX = Math.min(minX, node.x - nodePortMargin);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + width + nodePortMargin);
    maxY = Math.max(maxY, node.y + height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return fallbackBounds ? { ...fallbackBounds } : { ...DEFAULT_BOUNDS };
  }

  return {
    x: minX - padding,
    y: minY - padding - playButtonSpace,
    width: Math.max(1, maxX - minX + 2 * padding),
    height: Math.max(1, maxY - minY + 2 * padding + playButtonSpace),
  };
}

/**
 * @param {any[]} factories
 * @param {any[]} machines
 * @param {string[]} nodeIds
 * @param {Map<string, any>} nodeIndex
 * @param {{x:number,y:number,width:number,height:number}|undefined} fallbackBounds
 */
export function computeNetworkBounds(factories, machines, nodeIds, nodeIndex, fallbackBounds) {
  const padding = 40;
  const playButtonSpace = getPlayButtonSpace();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  (factories || []).forEach((factory) => {
    if (!factory || !factory.bounds) return;
    minX = Math.min(minX, factory.bounds.x);
    minY = Math.min(minY, factory.bounds.y);
    maxX = Math.max(maxX, factory.bounds.x + factory.bounds.width);
    maxY = Math.max(maxY, factory.bounds.y + factory.bounds.height);
  });

  (machines || []).forEach((machine) => {
    if (!machine || !machine.bounds) return;
    minX = Math.min(minX, machine.bounds.x);
    minY = Math.min(minY, machine.bounds.y);
    maxX = Math.max(maxX, machine.bounds.x + machine.bounds.width);
    maxY = Math.max(maxY, machine.bounds.y + machine.bounds.height);
  });

  (nodeIds || []).forEach((nodeId) => {
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
    return fallbackBounds ? { ...fallbackBounds } : { ...DEFAULT_BOUNDS };
  }

  return {
    x: minX - padding,
    y: minY - padding - playButtonSpace,
    width: Math.max(1, maxX - minX + 2 * padding),
    height: Math.max(1, maxY - minY + 2 * padding + playButtonSpace),
  };
}
