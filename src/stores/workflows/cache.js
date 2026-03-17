import { computeNetworkBounds, computeFactoryBounds, computeMachineBounds, DEFAULT_BOUNDS } from './bounds.js';

/**
 * @type {{ nodeSignature: string, connectionSignature: string, containers: Array<any> }}
 */
export const structureCache = {
  nodeSignature: '',
  connectionSignature: '',
  containers: [],
};

/**
 * @param {any[]} nodeList
 */
export function computeNodeSignature(nodeList) {
  if (!Array.isArray(nodeList) || nodeList.length === 0) {
    return '';
  }
  return nodeList
    .map((node) => `${node.id}:${node.type || ''}`)
    .sort()
    .join('|');
}

/**
 * @param {any[]} connectionList
 */
export function computeConnectionSignature(connectionList) {
  if (!Array.isArray(connectionList) || connectionList.length === 0) {
    return '';
  }
  return connectionList
    .map((conn) => `${conn.fromId || ''}:${conn.fromPort || ''}->${conn.toId || ''}:${conn.toPort || ''}`)
    .sort()
    .join('|');
}

/**
 * @param {any[]} containers
 */
export function cloneContainersForCache(containers) {
  if (!Array.isArray(containers)) {
    return [];
  }
  return containers.map(cloneContainerForCache);
}

/**
 * @param {any} container
 */
function cloneContainerForCache(container) {
  if (!container || typeof container !== 'object') {
    return container;
  }

  const cloned = {
    ...container,
    nodes: Array.isArray(container.nodes) ? container.nodes.map((/** @type {any} */ node) => ({ ...node })) : undefined,
    nodeIds: Array.isArray(container.nodeIds) ? [...container.nodeIds] : undefined,
    connections: Array.isArray(container.connections) ? container.connections.map((/** @type {any} */ conn) => ({ ...conn })) : undefined,
  };

  if (Array.isArray(container.machines)) {
    cloned.machines = container.machines.map(cloneContainerForCache);
  }
  if (Array.isArray(container.factories)) {
    cloned.factories = container.factories.map(cloneContainerForCache);
  }

  return cloned;
}

/**
 * @param {any[]} containers
 * @param {Map<string, any>} nodeIndex
 */
export function rebuildContainersFromCache(containers, nodeIndex) {
  if (!Array.isArray(containers) || containers.length === 0) {
    return [];
  }

  const memo = new Map();

  const rebuild = (/** @type {any} */ container) => {
    if (!container || typeof container !== 'object') {
      return null;
    }
    if (memo.has(container.id)) {
      return memo.get(container.id);
    }
    let rebuilt;
    if (container.isNetwork) {
      const rebuiltFactories = Array.isArray(container.factories) ? container.factories.map(rebuild).filter(Boolean) : [];
      const rebuiltMachines = Array.isArray(container.machines) ? container.machines.map(rebuild).filter(Boolean) : [];
      const nodeIds = Array.isArray(container.nodeIds) ? [...container.nodeIds] : [];
      const bounds = computeNetworkBounds(rebuiltFactories, rebuiltMachines, nodeIds, nodeIndex, container.bounds);
      rebuilt = { ...container, factories: rebuiltFactories, machines: rebuiltMachines, nodeIds, connections: copyConnections(container.connections), bounds };
    } else if (container.isFactory) {
      const rebuiltMachines = Array.isArray(container.machines) ? container.machines.map(rebuild).filter(Boolean) : [];
      const nodeIds = Array.isArray(container.nodeIds) ? [...container.nodeIds] : [];
      const bounds = computeFactoryBounds(rebuiltMachines, nodeIds, nodeIndex, container.bounds);
      rebuilt = { ...container, machines: rebuiltMachines, nodeIds, connections: copyConnections(container.connections), bounds };
    } else {
      const updatedNodes = Array.isArray(container.nodes) ? container.nodes.map((/** @type {any} */ node) => nodeIndex.get(node.id) || node) : [];
      const bounds = computeMachineBounds(updatedNodes, container.isWorkflow, container.bounds);
      rebuilt = { ...container, nodes: updatedNodes, connections: copyConnections(container.connections), bounds };
    }
    memo.set(container.id, rebuilt);
    return rebuilt;
  };

  return containers.map((c) => rebuild(c)).filter(Boolean);
}

/**
 * @param {any[]} connections
 */
function copyConnections(connections) {
  if (!Array.isArray(connections)) {
    return [];
  }
  return connections.map((conn) => ({ ...conn }));
}
