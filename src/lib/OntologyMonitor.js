// OntologyMonitor.js
// Centralized ontology guard for container hierarchy connections
// Location: frontend/src/lib/OntologyMonitor.js

/**
 * @typedef {import('svelte/store').Readable<any[]>} ReadableContainers
 */

export const OntologyMonitor = {
  /**
   * Determine if creating a connection would break ontology rules.
   * Current rule set:
   * - If a parent factory F already connects to a target node T outside F,
   *   then any descendant (machine or node) of F cannot also connect to T.
   * - Machines that merely share the same upstream input are NOT considered related
   *   for ontology purposes; shared input alone does not justify merging nor does it
   *   create an implicit ancestor/descendant relationship.
   * - We enforce ancestor/descendant duplication only based on explicit connections
   *   present in the canvas graph (including container→node links), not inferred
   *   via shared inputs.
   *
   * @param {string} fromId
   * @param {string} toId
   * @param {Array<any>} connectionList
   * @param {Array<any>} containers
   * @returns {{ violates: boolean, reason?: string, parentId?: string }}
   */
  wouldBreakOntology(fromId, toId, connectionList, containers) {
    if (!fromId || !toId || !Array.isArray(connectionList) || !Array.isArray(containers)) {
      return { violates: false };
    }

    /** @param {string} id */
    const isNode = (id) => typeof id === 'string' && id.startsWith('node-');
    /** @param {string} id */
    const isMachine = (id) => typeof id === 'string' && id.startsWith('machine-');
    /** @param {string} id */
    const isFactory = (id) => typeof id === 'string' && id.startsWith('factory-');

    // Helper: find parent factory of a machine
    /** @param {string} machineId */
    const findFactoryForMachine = (machineId) => {
      for (const c of containers) {
        if (c?.isFactory && Array.isArray(c.machines) && c.machines.some((/** @type {any} */ m) => m?.id === machineId)) {
          return c;
        }
      }
      return null;
    };

    // Helper: find parent machine of a node
    /** @param {string} nodeId */
    const findMachineForNode = (nodeId) => {
      // Search inside factories first
      for (const c of containers) {
        if (!c?.isFactory || !Array.isArray(c.machines)) continue;
        for (const m of c.machines) {
          if (m && Array.isArray(m.nodes) && m.nodes.some((/** @type {any} */ n) => n?.id === nodeId)) {
            return m;
          }
        }
      }
      // Fallback: some UIs may list top-level machines
      for (const c of containers) {
        if (c?.isMachine && Array.isArray(c.nodes) && c.nodes.some((/** @type {any} */ n) => n?.id === nodeId)) {
          return c;
        }
      }
      return null;
    };

    // Helper: find parent factory of a node
    /** @param {string} nodeId */
    const findFactoryForNode = (nodeId) => {
      for (const c of containers) {
        if (!c?.isFactory) continue;
        const direct = Array.isArray(c.nodeIds) && c.nodeIds.includes(nodeId);
        if (direct) return c;
        const inChildMachine = Array.isArray(c.machines) && c.machines.some((/** @type {any} */ m) => Array.isArray(m.nodes) && m.nodes.some((/** @type {any} */ n) => n?.id === nodeId));
        if (inChildMachine) return c;
      }
      return null;
    };

    // Helper: is node inside a given factory
    /** @param {any} factory @param {string} nodeId */
    const isNodeInsideFactory = (factory, nodeId) => {
      if (!factory) return false;
      const direct = Array.isArray(factory.nodeIds) && factory.nodeIds.includes(nodeId);
      if (direct) return true;
      return Array.isArray(factory.machines) && factory.machines.some((/** @type {any} */ m) => Array.isArray(m.nodes) && m.nodes.some((/** @type {any} */ n) => n?.id === nodeId));
    };

    // Build directed adjacency for reachability (fromId -> Set(toIds))
    /** @type {Map<string, Set<string>>} */
    const outEdges = new Map();
    for (const c of connectionList) {
      const a = c?.fromId;
      const b = c?.toId;
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      if (!outEdges.has(a)) outEdges.set(a, new Set());
      outEdges.get(a)?.add(b);
    }

    /**
     * BFS to collect all reachable node IDs starting from a given start ID
     * @param {string} start
     * @returns {Set<string>}
     */
    const reachableNodesFrom = (start) => {
      /** @type {Set<string>} */
      const visited = new Set();
      /** @type {string[]} */
      const queue = [start];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (!cur || visited.has(cur)) continue;
        visited.add(cur);
        const outs = outEdges.get(cur);
        if (outs) {
          for (const nxt of outs) {
            if (!visited.has(nxt)) queue.push(nxt);
          }
        }
      }
      // Only care about nodes, filter to node-* ids
      const onlyNodes = new Set(Array.from(visited).filter((id) => isNode(id)));
      return onlyNodes;
    };

    // Resolve parent factory and machine for fromId
    /** @type {any | null} */
    let parentFactory = null;
    /** @type {any | null} */
    let parentMachine = null;
    if (isFactory(fromId)) {
      parentFactory = containers.find((c) => c?.isFactory && c.id === fromId) || null;
    } else if (isMachine(fromId)) {
      parentFactory = findFactoryForMachine(fromId);
      parentMachine = containers.find((c) => c?.isMachine && c.id === fromId) || { id: fromId };
    } else if (isNode(fromId)) {
      parentFactory = findFactoryForNode(fromId);
      parentMachine = findMachineForNode(fromId);
    }

    if (!parentFactory) {
      return { violates: false }; // No parent factory context => no rule applied (network-level or standalone)
    }

    // Allow node -> machine to support auto-merge behavior upstream.

    // Only enforce node-target rules when the target is a node
    if (isNode(toId)) {
      // Machine-level protection: parent machine connects to same node or to the target's machine
      if (parentMachine?.id) {
        // Resolve target machine
        const targetMachine = findMachineForNode(toId);
        // Direct machine->machine block
        if (targetMachine?.id) {
          const hasMachineToMachine = connectionList.some((c) => c?.fromId === parentMachine.id && c?.toId === targetMachine.id);
          if (hasMachineToMachine) {
            return {
              violates: true,
              parentId: parentMachine.id,
              reason: `Parent machine ${parentMachine.id} already connects to ${targetMachine.id}`,
            };
          }
        }

        // Downstream from machine-level edges
        const parentDirectTargetsM = connectionList
          .filter((c) => c?.fromId === parentMachine.id)
          .map((c) => c.toId)
          .filter((id) => typeof id === 'string');

        const blocksM = (() => {
          if (parentDirectTargetsM.includes(toId)) return true;
          for (const t of parentDirectTargetsM) {
            const reach = reachableNodesFrom(t);
            if (reach.has(toId)) return true;
          }
          return false;
        })();

        if (blocksM) {
          return {
            violates: true,
            parentId: parentMachine.id,
            reason: `Parent machine ${parentMachine.id} already connects upstream of ${toId}`,
          };
        }
      }

      // Factory-level protection applies only when target is outside the same factory
      // Note: Shared inputs do not trigger protection; only explicit factory→... edges in the graph do.
      const inSameFactory = isNodeInsideFactory(parentFactory, toId);
      if (!inSameFactory && parentFactory?.id) {
        const parentDirectTargetsF = connectionList
          .filter((c) => c?.fromId === parentFactory.id)
          .map((c) => c.toId)
          .filter((id) => typeof id === 'string');

        const blocksF = (() => {
          if (parentDirectTargetsF.includes(toId)) return true;
          for (const t of parentDirectTargetsF) {
            const reach = reachableNodesFrom(t);
            if (reach.has(toId)) return true;
          }
          return false;
        })();

        if (blocksF) {
          return {
            violates: true,
            parentId: parentFactory.id,
            reason: `Parent factory ${parentFactory.id} already connects upstream of ${toId}`,
          };
        }
      }

    }

    // Future extensions:
    // - Consider parent connecting to the target's machine container
    // - Consider a higher-level network parent and generalized ancestor/descendant checks

    return { violates: false };
  },
};
