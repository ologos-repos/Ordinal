import { getNextMachineId, getNextFactoryId, getNextNetworkId } from './ids.js';

/**
 * YAML network group hints — set by the YAML loader before calling detectContainers.
 * Each entry is an array of factory/node IDs that were declared inside the same
 * YAML `networks: - id: X` block. detectNetworks() pre-unions these IDs so that
 * disconnected standalone nodes declared under the same network container are
 * correctly grouped into one network even when they have no direct edges between them.
 *
 * Format: Array<Array<string>>  e.g. [['client-factory', 'operator-factory', 'marketplace-factory', 'platform-api-gateway', 'platform-event-bus']]
 * @type {Array<Array<string>>}
 */
let _networkGroupHints = [];

/**
 * Set YAML network group hints before loading a model.
 * Each group is an array of IDs (factory IDs + network-level node IDs) that
 * should all be treated as belonging to the same network.
 * @param {Array<Array<string>>} groups
 */
export function setNetworkGroupHints(groups) {
    _networkGroupHints = Array.isArray(groups) ? groups : [];
}

/**
 * Clear network group hints (called after detection completes).
 */
export function clearNetworkGroupHints() {
    _networkGroupHints = [];
}

/**
 * Main detection function - detects all containers following the ontology.
 * @param {Array<any>} nodeList - List of nodes
 * @param {Array<any>} connectionList - List of connections
 */
export function detectContainers(nodeList, connectionList) {
    // Step 1: Detect machines (connected components of nodes)
    const machines = detectMachines(nodeList, connectionList);
    
    // Step 2: Detect factories by treating machines and standalone nodes as vertices
    const factories = detectFactories(machines, connectionList, nodeList);
    
    // Step 3: Detect networks by treating factories and standalone entities as vertices
    const networks = detectNetworks(factories, machines, connectionList, nodeList);

    return { machines, factories, networks };
}

/**
 * Union-Find data structure for grouping entities.
 */
class UnionFind {
    /**
     * @param {Array<any>} elements - Array of elements to initialize
     */
    constructor(elements) {
        this.parent = new Map();
        elements.forEach(/** @param {any} el */ el => this.parent.set(el, el));
    }

    /**
     * @param {any} i - Element to find
     * @returns {any} Root element
     */
    find(i) {
        if (this.parent.get(i) === i) {
            return i;
        }
        const /** @type {any} */ root = this.find(this.parent.get(i));
        this.parent.set(i, root); // Path compression
        return root;
    }

    /**
     * @param {any} i - First element
     * @param {any} j - Second element
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
 * Detects machines as connected components of nodes.
 * Always uses Union-Find — the ontology is the single source of truth.
 * @param {Array<any>} nodeList - List of nodes
 * @param {Array<any>} connectionList - List of connections
 * @returns {Array<any>} Array of machine objects
 */
function detectMachines(nodeList, connectionList) {
    if (!nodeList || nodeList.length === 0) return [];

    const nodeIds = nodeList.map(/** @param {any} n */ n => n.id);
    const uf = new UnionFind(nodeIds);

    connectionList.forEach(conn => {
        if (nodeIds.includes(conn.fromId) && nodeIds.includes(conn.toId)) {
            uf.union(conn.fromId, conn.toId);
        }
    });

    const groups = new Map();
    nodeList.forEach(/** @param {any} node */ node => {
        const root = uf.find(node.id);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(node);
    });

    const /** @type {Array<any>} */ machines = [];
    groups.forEach(nodesInGroup => {
        if (nodesInGroup.length > 1) {
            const machine = createMachine(nodesInGroup, connectionList);
            if (machine) machines.push(machine);
        }
    });

    return /** @type {Array<any>} */ machines;
}

/**
 * Detects factories by treating machines and standalone nodes as a single set of vertices.
 * Always uses Union-Find on cross-machine connections — the ontology is the single source of truth.
 * Cross-machine connections are identified by connections whose fromId or toId starts with 'machine-'.
 * @param {Array<any>} machines - List of machine objects
 * @param {Array<any>} connectionList - List of connections
 * @param {Array<any>} nodeList - List of nodes
 * @returns {Array<any>} Array of factory objects
 */
function detectFactories(machines, connectionList, nodeList) {
    // Run Union-Find on connections to discover connected machine groups
    const nodeToMachine = new Map();
    machines.forEach(/** @param {any} m */ m => m.nodes.forEach(/** @param {any} n */ n => nodeToMachine.set(n.id, m.id)));

    const standaloneNodes = nodeList.filter(/** @param {any} n */ n => !nodeToMachine.has(n.id));
    const factoryVertices = [...machines.map(/** @param {any} m */ m => m.id), ...standaloneNodes.map(/** @param {any} n */ n => n.id)];

    if (factoryVertices.length === 0) return [];

    // Only group machines into factories when there is an explicit cross-machine relation.
    // Do NOT merge machines merely because they share the same input node/container.
    const machineIds = machines.map(m => m.id);
    const uf = new UnionFind(machineIds);

    /** @type {Map<string, string>} */
    const nodeToMachineLocal = nodeToMachine; // alias for clarity
    /** @type {Map<string, Set<string>>} */
    const machineAdj = new Map();
    const addMachineEdge = (/** @type {any} */ a, /** @type {any} */ b) => {
        if (!a || !b || a === b) return;
        if (!machineAdj.has(a)) machineAdj.set(a, new Set());
        if (!machineAdj.has(b)) machineAdj.set(b, new Set());
        machineAdj.get(a)?.add(b);
        machineAdj.get(b)?.add(a);
    };
    // Build machine-to-machine adjacency only when a connection bridges two different machines
    (connectionList || []).forEach(conn => {
        const fromM = nodeToMachineLocal.get(conn.fromId) || (typeof conn.fromId === 'string' && conn.fromId.startsWith('machine-') ? conn.fromId : null);
        const toM = nodeToMachineLocal.get(conn.toId) || (typeof conn.toId === 'string' && conn.toId.startsWith('machine-') ? conn.toId : null);
        if (fromM && toM && fromM !== toM) addMachineEdge(fromM, toM);
    });
    // Union machines based on explicit cross-machine edges
    machineAdj.forEach((neighbors, mid) => {
        neighbors.forEach(n => uf.union(mid, n));
    });

    const groups = new Map();
    // Initialize groups by machine components only
    machineIds.forEach(/** @param {any} id */ id => {
        const root = uf.find(id);
        if (!groups.has(root)) groups.set(root, { machines: [], nodes: [] });
        groups.get(root).machines.push(id);
    });
    // Attach standalone nodes to a group only if all of their adjacent machines belong to the same group
    const machineIdToRoot = new Map();
    machineIds.forEach(/** @param {any} id */ id => machineIdToRoot.set(id, uf.find(id)));
    standaloneNodes.forEach(/** @param {any} node */ node => {
        /** @type {Set<string>} */
        const adjacentMachines = new Set();
        (connectionList || []).forEach(/** @param {any} conn */ conn => {
            if (conn.fromId === node.id) {
                const tm = nodeToMachineLocal.get(conn.toId) || (typeof conn.toId === 'string' && conn.toId.startsWith('machine-') ? conn.toId : null);
                if (tm) adjacentMachines.add(tm);
            } else if (conn.toId === node.id) {
                const fm = nodeToMachineLocal.get(conn.fromId) || (typeof conn.fromId === 'string' && conn.fromId.startsWith('machine-') ? conn.fromId : null);
                if (fm) adjacentMachines.add(fm);
            }
        });
        if (adjacentMachines.size === 0) return;
        /** @type {Set<string>} */
        const roots = new Set(Array.from(adjacentMachines).map(mId => machineIdToRoot.get(mId)));
        if (roots.size === 1) {
            const [root] = Array.from(roots);
            if (!groups.has(root)) groups.set(root, { machines: [], nodes: [] });
            groups.get(root).nodes.push(node.id);
        }
        // If the node touches machines across multiple groups, don't use it to bridge groups.
    });

    const machineMap = new Map(machines.map(m => [m.id, m]));
    const /** @type {Array<any>} */ factories = [];
    groups.forEach(group => {
        // A factory is formed if it contains more than one machine,
        // OR at least one machine connected to a standalone node (legacy tolerance).
        if (group.machines.length > 1 || (group.machines.length > 0 && group.nodes.length > 0)) {
            const machinesInGroup = group.machines.map((/** @type {any} */ id) => machineMap.get(id)).filter(Boolean);
            const factory = createFactory(machinesInGroup, group.nodes, connectionList, nodeList);
            if (factory) factories.push(factory);
        }
    });

    return /** @type {Array<any>} */ factories;
}

/**
 * Detects networks by treating factories and standalone entities as vertices.
 * Always uses Union-Find — the ontology is the single source of truth.
 * @param {Array<any>} factories - List of factory objects
 * @param {Array<any>} machines - List of machine objects
 * @param {Array<any>} connectionList - List of connections
 * @param {Array<any>} nodeList - List of nodes
 * @returns {Array<any>} Array of network objects
 */
function detectNetworks(factories, machines, connectionList, nodeList) {
    const machineToFactory = new Map();
    factories.forEach(/** @param {any} f */ f => f.machines.forEach(/** @param {any} m */ m => machineToFactory.set(m.id, f.id)));
    
    const standaloneMachines = machines.filter(/** @param {any} m */ m => !machineToFactory.has(m.id));
    
    const allEntitiesInContainers = new Set();
    machines.forEach(/** @param {any} m */ m => m.nodes.forEach(/** @param {any} n */ n => allEntitiesInContainers.add(n.id)));
    factories.forEach(f => {
        f.machines.forEach(/** @param {any} m */ m => allEntitiesInContainers.add(m.id));
        (f.nodeIds || []).forEach(/** @param {any} nid */ nid => allEntitiesInContainers.add(nid));
    });
    const standaloneNodes = nodeList.filter(/** @param {any} n */ n => !allEntitiesInContainers.has(n.id));

    const networkVertices = [
        ...factories.map(/** @param {any} f */ f => f.id),
        ...standaloneMachines.map(/** @param {any} m */ m => m.id),
        ...standaloneNodes.map(/** @param {any} n */ n => n.id)
    ];

    if (networkVertices.length === 0) return [];

    const uf = new UnionFind(networkVertices);

    // Pre-union groups from YAML network declarations.
    // When a .ologic file declares multiple factories and standalone nodes under
    // the same `networks: - id: X` block, those IDs should form a single network
    // regardless of whether their edges create a connected graph in Union-Find.
    // The YAML hierarchy is the ground truth — we honour it here.
    //
    // IMPORTANT: Factory IDs in the hints are YAML IDs (e.g. "client-factory") but
    // networkVertices uses generated IDs (e.g. "factory-1"). We resolve via:
    //  1. Standalone node IDs (e.g. "platform-api-gateway") are preserved verbatim —
    //     direct match in networkVertices works since standaloneNodes keeps YAML IDs.
    //  2. For factory/machine YAML IDs: find the generated factory/machine vertex that
    //     contains a node whose ID matches (walk factory.nodeIds and machine.nodes).
    //  3. Fall back to checking if any networkVertex starts with or equals the hintId.
    if (_networkGroupHints.length > 0) {
        const networkVertexSet = new Set(networkVertices);

        // Build a comprehensive map: any YAML entity ID → network vertex ID.
        // Standalone node IDs map to themselves; sub-factory entity IDs map to their factory.
        /** @type {Map<string, string>} */
        const yamlIdToVertex = new Map();
        // Direct: any networkVertex maps to itself (includes standalone node YAML IDs)
        networkVertices.forEach(vid => yamlIdToVertex.set(vid, vid));
        // Factory members: nodeIds and machine nodes map to the factory vertex
        factories.forEach(f => {
            (f.nodeIds || []).forEach(/** @param {any} nid */ nid => yamlIdToVertex.set(nid, f.id));
            (f.machines || []).forEach(/** @param {any} m */ m => {
                if (m.id) yamlIdToVertex.set(m.id, f.id);  // also map machine YAML id if it survived
                (m.nodeIds || []).forEach(/** @param {any} nid */ nid => yamlIdToVertex.set(nid, f.id));
                (m.nodes || []).forEach(/** @param {any} n */ n => { if (n && n.id) yamlIdToVertex.set(n.id, f.id); });
            });
        });
        standaloneMachines.forEach(/** @param {any} m */ m => {
            (m.nodeIds || []).forEach(/** @param {any} nid */ nid => yamlIdToVertex.set(nid, m.id));
            (m.nodes || []).forEach(/** @param {any} n */ n => { if (n && n.id) yamlIdToVertex.set(n.id, m.id); });
        });

        _networkGroupHints.forEach(group => {
            if (!Array.isArray(group) || group.length < 2) return;
            // Resolve each hint ID to a network vertex
            /** @type {string[]} */
            const resolvedGroup = group.map(hintId => {
                if (yamlIdToVertex.has(hintId)) return yamlIdToVertex.get(hintId) || null;
                return null;
            }).filter(/** @param {any} v */ v => v !== null && networkVertexSet.has(v));
            // Deduplicate
            const uniqueResolved = [...new Set(resolvedGroup)];
            // Union all resolved vertices in this group together
            for (let i = 1; i < uniqueResolved.length; i++) {
                uf.union(uniqueResolved[0], uniqueResolved[i]);
            }
        });
    }

    // Build undirected adjacency across all IDs to support deeper traversal from parent containers
    /** @type {Map<string, Set<string>>} */
    const adj = new Map();
    const addEdge = (/** @type {any} */ a, /** @type {any} */ b) => {
        if (!a || !b) return;
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a)?.add(b);
        adj.get(b)?.add(a);
    };
    (connectionList || []).forEach(conn => {
        if (!conn || typeof conn.fromId !== 'string' || typeof conn.toId !== 'string') return;
        addEdge(conn.fromId, conn.toId);
    });

    // Add containment edges to allow traversing up to parents and back down via container-level connections
    // machine <-> node
    (machines || []).forEach(/** @param {any} m */ m => {
        (m.nodes || []).forEach(/** @param {any} n */ n => { if (n && typeof n.id === 'string') addEdge(m.id, n.id); });
        (m.nodeIds || []).forEach(/** @param {any} nid */ nid => { if (typeof nid === 'string') addEdge(m.id, nid); });
    });
    // factory <-> machine, factory <-> node
    (factories || []).forEach(/** @param {any} f */ f => {
        (f.machines || []).forEach(/** @param {any} m */ m => { if (m && typeof m.id === 'string') addEdge(f.id, m.id); });
        (f.nodeIds || []).forEach(/** @param {any} nid */ nid => { if (typeof nid === 'string') addEdge(f.id, nid); });
    });

    const resolveEntityToVertex = (/** @type {any} */ id) => {
        if (networkVertices.includes(id)) return id;
        for (const f of factories) {
            if (f.id === id || (f.machines || []).some(/** @param {any} m */ m => m.id === id) || (f.nodeIds || []).includes(id)) return f.id;
            for(const m of (f.machines || [])) {
                if((m.nodes || []).some(/** @param {any} n */ n => n.id === id)) return f.id;
            }
        }
        for (const m of standaloneMachines) {
            if (m.id === id || (m.nodes || []).some(/** @param {any} n */ n => n.id === id)) return m.id;
        }
        return null;
    };
    
    // First pass: union direct edges between resolved vertices
    connectionList.forEach(conn => {
        const fromVertex = resolveEntityToVertex(conn.fromId);
        const toVertex = resolveEntityToVertex(conn.toId);

        if (fromVertex && toVertex && fromVertex !== toVertex) {
            uf.union(fromVertex, toVertex);
        }
    });

    // Second pass: climb to parent factory for origins and traverse down to include downstream connectivity
    // Seed from each factory's internal members (machines' nodes and factory nodeIds)
    /** @type {Map<string, Set<string>>} */
    const factorySeeds = new Map();
    factories.forEach(f => {
        const seeds = new Set();
        (f.nodeIds || []).forEach(/** @param {any} nid */ nid => seeds.add(nid));
        (f.machines || []).forEach(/** @param {any} m */ m => {
            if (!m) return;
            if (typeof m.id === 'string') seeds.add(m.id);
            (m.nodeIds || []).forEach(/** @param {any} nid */ nid => seeds.add(nid));
            (m.nodes || []).forEach(/** @param {any} n */ n => { if (n && typeof n.id === 'string') seeds.add(n.id); });
        });
        factorySeeds.set(f.id, seeds);
    });

    const bfsReachableVerticesFromSeeds = (/** @type {any} */ seedIds) => {
        /** @type {Set<string>} */
        const visited = new Set();
        /** @type {string[]} */
        const queue = [];
        seedIds.forEach(/** @param {any} id */ id => { if (typeof id === 'string') { visited.add(id); queue.push(id); } });
        /** @type {Set<string>} */
        const reachedVertices = new Set();
        while (queue.length) {
            const /** @type {string} */ cur = queue.shift() || '';
            const neigh = adj.get(cur);
            if (!neigh) continue;
            for (const nxt of neigh) {
                if (!visited.has(nxt)) {
                    visited.add(nxt);
                    queue.push(nxt);
                }
                const vtx = resolveEntityToVertex(nxt);
                if (vtx) reachedVertices.add(vtx);
            }
        }
        return reachedVertices;
    };

    // For each factory, union it with any vertex reachable from its internal seeds
    factories.forEach(f => {
        const seeds = factorySeeds.get(f.id) || new Set();
        if (seeds.size === 0) return;
        const reached = bfsReachableVerticesFromSeeds(seeds);
        reached.forEach(v => {
            if (v && v !== f.id) {
                uf.union(f.id, v);
            }
        });
    });

    // Additionally, from each standalone machine, union with any reachable vertex to capture downstream traversal
    const standaloneMachineSet = new Set(standaloneMachines.map(/** @param {any} m */ m => m.id));
    standaloneMachines.forEach(/** @param {any} m */ m => {
        /** @type {Set<string>} */
        const seeds = new Set();
        if (typeof m.id === 'string') seeds.add(m.id);
        (m.nodeIds || []).forEach(/** @param {any} nid */ nid => seeds.add(nid));
        (m.nodes || []).forEach(/** @param {any} n */ n => { if (n && typeof n.id === 'string') seeds.add(n.id); });
        const reached = bfsReachableVerticesFromSeeds(seeds);
        reached.forEach(v => {
            if (v && v !== m.id && !standaloneMachineSet.has(v)) {
                uf.union(m.id, v);
            }
        });
    });

    const groups = new Map();
    networkVertices.forEach(id => {
        const root = uf.find(id);
        if (!groups.has(root)) groups.set(root, { factories: [], machines: [], nodes: [] });
        const group = groups.get(root);
        if (id.startsWith('factory-')) group.factories.push(id);
        else if (id.startsWith('machine-')) group.machines.push(id);
        else group.nodes.push(id);
    });

    const factoryMap = new Map(factories.map(/** @param {any} f */ f => [f.id, f]));
    const machineMap = new Map(machines.map(m => [m.id, m]));
    const /** @type {Array<any>} */ networks = [];
    groups.forEach(group => {
        // A network is formed if it contains multiple factories OR a factory connected to standalone entities.
        if (group.factories.length > 1 || (group.factories.length > 0 && (group.machines.length > 0 || group.nodes.length > 0))) {
             const factoriesInGroup = group.factories.map(/** @param {any} id */ id => factoryMap.get(id)).filter(Boolean);
            const machinesInGroup = group.machines.map((/** @type {any} */ id) => machineMap.get(id)).filter(Boolean);
            const network = createNetwork(factoriesInGroup, machinesInGroup, group.nodes, connectionList, nodeList);
            if (network) networks.push(network);
        }
    });

    return /** @type {Array<any>} */ networks;
}


// --- Container Creation Functions (with bounds) ---

/**
 * @param {Array<any>} nodes - Array of node objects
 * @param {Array<any>} connectionList - Array of connection objects
 */
function createMachine(nodes, connectionList) {
    if (!nodes || nodes.length < 2) return null;
    const nodeIds = nodes.map(/** @param {any} n */ n => n.id);
    const connections = connectionList.filter(/** @param {any} conn */ conn => nodeIds.includes(conn.fromId) && nodeIds.includes(conn.toId));

    const padding = 20;
    // playButtonSpace reserves top space inside the container for the container label
    // (36px font + 8px top offset + breathing room = ~60px; round to 80 for safety)
    const playButtonSpace = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    nodes.forEach(/** @param {any} node */ node => {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + (node.width || 250));
        maxY = Math.max(maxY, node.y + (node.height || 120));
    });

    return {
        id: getNextMachineId(nodes),
        nodes,
        nodeIds,
        connections,
        bounds: {
            x: minX - padding,
            y: minY - padding - playButtonSpace,
            width: maxX - minX + 2 * padding,
            height: maxY - minY + 2 * padding + playButtonSpace
        },
        isWorkflow: true,
        isMachine: true,
    };
}

/**
 * @param {Array<any>} machines - Array of machine objects
 * @param {Array<any>} standaloneNodeIds - Array of standalone node IDs
 * @param {Array<any>} connectionList - Array of connection objects
 * @param {Array<any>} nodeList - Array of node objects
 */
function createFactory(machines, standaloneNodeIds, connectionList, nodeList) {
    if ((!machines || machines.length === 0) && (!standaloneNodeIds || standaloneNodeIds.length === 0)) return null;

    const machineIds = machines.map(m => m.id);
    const allInternalNodeIds = new Set(standaloneNodeIds);
    machines.forEach(/** @param {any} m */ m => (m.nodeIds || []).forEach(/** @param {any} nid */ nid => allInternalNodeIds.add(nid)));
    const allInternalEntityIds = new Set([...machineIds, ...standaloneNodeIds]);

    const connections = connectionList.filter(conn => {
        const fromInFactory = allInternalEntityIds.has(conn.fromId) || allInternalNodeIds.has(conn.fromId);
        const toInFactory = allInternalEntityIds.has(conn.toId) || allInternalNodeIds.has(conn.toId);
        return fromInFactory && toInFactory;
    });

    const padding = 30;
    // playButtonSpace reserves top space inside the container for the container label
    const playButtonSpace = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    machines.forEach(/** @param {any} machine */ machine => {
        minX = Math.min(minX, machine.bounds.x);
        minY = Math.min(minY, machine.bounds.y);
        maxX = Math.max(maxX, machine.bounds.x + machine.bounds.width);
        maxY = Math.max(maxY, machine.bounds.y + machine.bounds.height);
    });
    standaloneNodeIds.forEach(nodeId => {
        const node = nodeList.find(n => n.id === nodeId);
        if (node) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + (node.width || 250));
            maxY = Math.max(maxY, node.y + (node.height || 120));
        }
    });

    return {
        id: getNextFactoryId(new Set(machineIds.concat(standaloneNodeIds))),
        machines,
        nodeIds: standaloneNodeIds,
        connections,
        bounds: {
            x: minX - padding,
            y: minY - padding - playButtonSpace,
            width: maxX - minX + 2 * padding,
            height: maxY - minY + 2 * padding + playButtonSpace
        },
        isFactory: true,
        isWorkflow: false,
    };
}

/**
 * @param {Array<any>} factories - Array of factory objects
 * @param {Array<any>} standaloneMachines - Array of standalone machine objects
 * @param {Array<any>} standaloneNodeIds - Array of standalone node IDs
 * @param {Array<any>} connectionList - Array of connection objects
 * @param {Array<any>} nodeList - Array of node objects
 */
function createNetwork(factories, standaloneMachines, standaloneNodeIds, connectionList, nodeList) {
    if ((!factories || factories.length === 0) && (!standaloneMachines || standaloneMachines.length === 0) && (!standaloneNodeIds || standaloneNodeIds.length === 0)) return null;

    const factoryIds = factories.map(/** @param {any} f */ f => f.id);
    const machineIds = standaloneMachines.map(/** @param {any} m */ m => m.id);
    const allInternalNodeIds = new Set(standaloneNodeIds);
    factories.forEach(f => {
        (f.machines || []).forEach(/** @param {any} m */ m => (m.nodeIds || []).forEach(/** @param {any} nid */ nid => allInternalNodeIds.add(nid)));
        (f.nodeIds || []).forEach(/** @param {any} nid */ nid => allInternalNodeIds.add(nid));
    });
    standaloneMachines.forEach(/** @param {any} m */ m => (m.nodeIds || []).forEach(/** @param {any} nid */ nid => allInternalNodeIds.add(nid)));
    const allInternalEntityIds = new Set([...factoryIds, ...machineIds, ...standaloneNodeIds]);

    const connections = connectionList.filter(conn => {
        const fromInNetwork = allInternalEntityIds.has(conn.fromId) || allInternalNodeIds.has(conn.fromId);
        const toInNetwork = allInternalEntityIds.has(conn.toId) || allInternalNodeIds.has(conn.toId);
        return fromInNetwork && toInNetwork;
    });

    const padding = 40;
    // playButtonSpace reserves top space inside the container for the container label
    const playButtonSpace = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    [...factories, ...standaloneMachines].forEach(container => {
        if (container.bounds) {
            minX = Math.min(minX, container.bounds.x);
            minY = Math.min(minY, container.bounds.y);
            maxX = Math.max(maxX, container.bounds.x + container.bounds.width);
            maxY = Math.max(maxY, container.bounds.y + container.bounds.height);
        }
    });
    standaloneNodeIds.forEach(nodeId => {
        const node = nodeList.find(n => n.id === nodeId);
        if (node) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + (node.width || 250));
            maxY = Math.max(maxY, node.y + (node.height || 120));
        }
    });

    return {
        id: getNextNetworkId(new Set(factoryIds.concat(machineIds, standaloneNodeIds))),
        factories,
        machines: standaloneMachines,
        nodeIds: standaloneNodeIds,
        connections,
        bounds: {
            x: minX - padding,
            y: minY - padding - playButtonSpace,
            width: maxX - minX + 2 * padding,
            height: maxY - minY + 2 * padding + playButtonSpace
        },
        isNetwork: true,
        isWorkflow: false,
    };
}
