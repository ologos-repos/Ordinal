import { writable, get } from 'svelte/store';

// Canvas-based counters that reset on new canvas
export const machineCounter = writable(0);
export const factoryCounter = writable(0);
export const networkCounter = writable(0);

// Track created container IDs to avoid duplicates during reactive recomputation
const createdContainerIds = new Set();

// Maintain signature->ID maps to preserve container identity across recomputes (legacy compat)
/** @type {Map<string, string>} */
export const factorySignatureToId = new Map();
/** @type {Map<string, string>} */
export const machineSignatureToId = new Map();

// Helper functions for generating container IDs
/**
 * @param {any[]} nodeGroup
 */
export function getNextMachineId(nodeGroup) {
  // Create a stable signature for this container based on its nodes
  // Use | as separator to avoid conflicts with node IDs that contain dashes
  const signature = nodeGroup.map((n) => n.id).sort().join('|');
  const nodeIds = new Set(nodeGroup.map((n) => n.id));

  // First check for exact match (existing behavior)
  for (const id of createdContainerIds) {
    if (id.includes(signature)) {
      const machineId = id.split('-')[0] + '-' + id.split('-')[1]; // Extract just "machine-N"
      return machineId;
    }
  }

  // Check if this is an extension of an existing machine (superset of nodes)
  for (const id of createdContainerIds) {
    if (id.startsWith('machine-')) {
      const dashIndex = id.indexOf('-', 8); // Find dash after "machine-N"
      if (dashIndex > 0) {
        const originalSignature = id.substring(dashIndex + 1);
        const originalNodeIds = new Set(originalSignature.split('|'));
        const isSuperset = [...originalNodeIds].every((nodeId) => nodeIds.has(nodeId));
        const hasNewNodes = nodeIds.size > originalNodeIds.size;
        const machineId = id.substring(0, dashIndex);
        if (isSuperset && hasNewNodes) {
          // Update the stored signature to the new one
          createdContainerIds.delete(id);
          createdContainerIds.add(`${machineId}-${signature}`);
          return machineId;
        }
      }
    }
  }

  // This is a truly new container, increment counter
  machineCounter.update((n) => n + 1);
  const newId = `machine-${get(machineCounter)}`;
  // Remember this container
  createdContainerIds.add(`${newId}-${signature}`);
  return newId;
}

/**
 * @param {Set<string>} entityGroup
 */
export function getNextFactoryId(entityGroup) {
  const signature = entityGroup ? Array.from(entityGroup).sort().join('|') : '';

  // Look for exact match of this factory signature
  for (const id of createdContainerIds) {
    if (id.startsWith('factory-')) {
      const dashIndex = id.indexOf('-', 8); // Find dash after "factory-N"
      if (dashIndex > 0) {
        const storedSignature = id.substring(dashIndex + 1);
        if (storedSignature === signature) {
          const factoryId = id.substring(0, dashIndex);
          return factoryId;
        }
      }
    }
  }

  // Extension of existing factory (superset of entities)
  if (entityGroup && entityGroup.size > 0) {
    const newEntitySet = new Set(Array.from(entityGroup));
    for (const id of createdContainerIds) {
      if (id.startsWith('factory-')) {
        const dashIndex = id.indexOf('-', 8); // after 'factory-N'
        if (dashIndex > 0) {
          const originalSignature = id.substring(dashIndex + 1);
          const originalEntities = originalSignature ? originalSignature.split('|') : [];
          const originalMachineEntities = originalEntities.filter((/** @type {string} */ e) => e.startsWith('machine'));
          const originalSet = new Set(originalMachineEntities);
          const isSuperset = [...originalSet].every((e) => newEntitySet.has(e));
          const hasNewEntities = newEntitySet.size > originalSet.size;
          if (isSuperset && hasNewEntities) {
            const factoryId = id.substring(0, dashIndex);
            createdContainerIds.delete(id);
            createdContainerIds.add(`${factoryId}-${signature}`);
            return factoryId;
          }
        }
      }
    }
  }

  factoryCounter.update((n) => n + 1);
  const newId = `factory-${get(factoryCounter)}`;
  createdContainerIds.add(`${newId}-${signature}`);
  return newId;
}

/**
 * @param {Set<string>} entityGroup
 */
export function getNextNetworkId(entityGroup) {
  const signature = entityGroup ? Array.from(entityGroup).sort().join('|') : '';

  // Look for exact match of this network signature
  for (const id of createdContainerIds) {
    if (id.startsWith('network-')) {
      const dashIndex = id.indexOf('-', 8); // Find dash after "network-N"
      if (dashIndex > 0) {
        const storedSignature = id.substring(dashIndex + 1);
        if (storedSignature === signature) {
          const networkId = id.substring(0, dashIndex);
          return networkId;
        }
      }
    }
  }
  networkCounter.update((n) => n + 1);
  const newId = `network-${get(networkCounter)}`;
  createdContainerIds.add(`${newId}-${signature}`);
  return newId;
}

// Reset all counters (called by New Canvas)
export function resetContainerCounters() {
  machineCounter.set(0);
  factoryCounter.set(0);
  networkCounter.set(0);
  createdContainerIds.clear();
}
