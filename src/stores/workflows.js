import { writable, get, derived } from 'svelte/store';
import { tick } from 'svelte';
import { nodeActions, nodes, connections, crossMachineConnections, nodeDataStore } from './nodes.js';
import { ContextEngine } from '../lib/ContextEngine.js';
import { settings } from './settings.js';
import { aiComplete, createTask, streamTask } from '../lib/rhodeApi.js';
import { automationSubMode } from './automationSubMode.js';
import { machineCounter, factoryCounter, networkCounter, getNextMachineId, getNextFactoryId, getNextNetworkId, resetContainerCounters } from './workflows/ids.js';
import { containerCustomizations, containerActions } from './workflows/customizations.js';
import { computeMachineBounds, computeFactoryBounds, computeNetworkBounds, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, DEFAULT_BOUNDS } from './workflows/bounds.js';
import { structureCache, computeNodeSignature, computeConnectionSignature, cloneContainersForCache, rebuildContainersFromCache } from './workflows/cache.js';
import { detectContainers } from './workflows/ontology.js';
import { computeOrganizedLayout, applyPositionHints, adjustBridgeNodePositions, buildMachineOrganizeContext, buildFactoryOrganizeContext, buildNetworkOrganizeContext, organizeCanvas, resolveContainerOverlaps } from './workflows/organize.js';
import { ORGANIZE_CONTAINER_HORIZONTAL_SPACING, ORGANIZE_CONTAINER_VERTICAL_SPACING } from './workflows/organize.js';
export { machineCounter, factoryCounter, networkCounter, getNextMachineId, getNextFactoryId, getNextNetworkId, resetContainerCounters, containerCustomizations, containerActions };

// Layout defaults for auto-organize feature
// Moved detailed spacing constants to './workflows/organize.js'.
const ORGANIZE_BOUNDS_DELAY = 40;

/**
 * @param {number} ms
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));


/**
 * @typedef {import('../lib/NodeData.js').NodeData} NodeData
 * @typedef {import('../lib/NodeData.js').NodeOutput} NodeOutput
 * @typedef {import('../lib/NodeData.js').ContextChainItem} ContextChainItem
 * @typedef {import('../lib/NodeData.js').StructuredContext} StructuredContext
 */

/**
 * @typedef {object} Node
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {string} type
 * @property {string} content
 * @property {string} title
 * @property {string} [purpose]
 * @property {boolean} [isWorkflow]
 * @property {boolean} [isFactory]
 * @property {boolean} [isNetwork]
 */

/**
 * @typedef {object} Connection
 * @property {string} id
 * @property {string} fromId
 * @property {string} toId
 * @property {string} fromSide
 * @property {string} toSide
 * @property {boolean} fromMachine
 * @property {any=} fromPort
 * @property {any=} toPort
 * @property {number=} created
 */

/**
 * @typedef {object} WorkflowContainer
 * @property {string} id
 * @property {Node[]} [nodes]
 * @property {string[]} [nodeIds]
 * @property {Connection[]} connections
 * @property {ContainerBounds} bounds
 * @property {boolean} isWorkflow
 * @property {boolean} [isMachine]
 * @property {boolean} [isFactory]
 * @property {boolean} [isNetwork]
 * @property {'idle' | 'running' | 'completed' | 'error'} executionState
 * @property {number | null} lastExecuted
 * @property {WorkflowContainer[]} [machines]
 * @property {FactoryContainer[]} [factories]
 */

/**
 * @typedef {object} FactoryContainer
 * @property {string} id
 * @property {WorkflowContainer[]} machines
 * @property {FactoryContainer[]} [factories]
 * @property {string[]} nodeIds
 * @property {Connection[]} connections
 * @property {ContainerBounds} bounds
 * @property {boolean} isFactory
 * @property {boolean} isWorkflow
 * @property {boolean} [isNetwork]
 * @property {Node[]} [nodes]
 * @property {'idle' | 'running' | 'completed' | 'error'} executionState
 * @property {number | null} lastExecuted
 */

/**
 * @typedef {object} NetworkContainer
 * @property {string} id
 * @property {FactoryContainer[]} factories
 * @property {WorkflowContainer[]} [machines]
 * @property {string[]} nodeIds
 * @property {Connection[]} connections
 * @property {ContainerBounds} bounds
 * @property {boolean} isNetwork
 * @property {boolean} isWorkflow
 * @property {boolean} [isFactory]
 * @property {Node[]} [nodes]
 * @property {'idle' | 'running' | 'completed' | 'error'} executionState
 * @property {number | null} lastExecuted
 */

/**
 * @typedef {{ id: string, type: 'machine' | 'node' }} FactoryTerminalEntity
 */

/**
 * @typedef {{ id: string, type: 'factory' | 'node' }} NetworkTerminalEntity
 */

/**
 * @typedef {WorkflowContainer | FactoryContainer | NetworkContainer | Node} ExecutableEntity
 */

/**
 * @typedef {object} ContainerTraversalOptions
 * @property {boolean} [skipHistory]
 * @property {boolean} [deep]
 * @property {Set<string>} [visited]
 * @property {boolean} [skipBounds]
 */

/**
 * @typedef {object} ExecutionOptions
 * @property {boolean} [clearContext]
 */

/**
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer | null | undefined} container
 * @returns {container is NetworkContainer}
 */
function isNetworkContainerEntity(container) {
    return Boolean(container && container.isNetwork);
}

/**
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer | null | undefined} container
 * @returns {container is FactoryContainer}
 */
function isFactoryContainerEntity(container) {
    return Boolean(container && container.isFactory);
}

/**
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer | null | undefined} container
 * @returns {container is WorkflowContainer}
 */
function isWorkflowContainerEntity(container) {
    if (!container) {
        return false;
    }
    if ('isMachine' in container && container.isMachine) {
        return true;
    }
    return Boolean(!container.isFactory && !container.isNetwork);
}

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} ContainerBounds
 */

/**
 * Represents an item participating in workflow auto-organize layout.
 * @typedef {object} OrganizeItem
 * @property {string} id
 * @property {'node' | 'machine' | 'factory' | 'network'} type
 * @property {number} width
 * @property {number} height
 * @property {number} x
 * @property {number} y
 * @property {string[]} nodeIds
 */

/**
 * @typedef {{ from: string, to: string }} OrganizeEdge
 */

/**
 * @typedef {object} OrganizeOptions
 * @property {'horizontal' | 'vertical'} [orientation]
 * @property {number} [horizontalSpacing]
 * @property {number} [verticalSpacing]
 * @property {number} [startX]
 * @property {number} [startY]
 * @property {number} [referenceCenterX]
 * @property {number} [referenceCenterY]
 * @property {number} [gridColumns]
 * @property {boolean} [forceGrid]  - When true, use grid layout even when edges exist (used for factory/network level)
 */

/**
 * @typedef {{ x: number, y: number }} OrganizeLayoutPosition
 */

/**
 * @typedef {{ items: OrganizeItem[], edges: OrganizeEdge[], options: OrganizeOptions, positionHints?: Map<string, string> }} OrganizeContext
 */

/**
 * Merge context artifacts from a node output into the provided accumulators.
 * @param {NodeOutput | null | undefined} output
 * @param {StructuredContext} accumulator
 * @param {Set<string>} sourceSet
 * @param {ContextChainItem[]} contextChain
 * @param {Set<string>} seenContextItems
 */
function mergeContextFromOutput(output, accumulator, sourceSet, contextChain, seenContextItems) {
    if (!output) return;

    const { type, value, sources, context_chain } = output;

    if (type === 'structured_context' && value && typeof value === 'object') {
        const structuredValue = /** @type {StructuredContext} */ (value);

        if (Array.isArray(structuredValue.facts)) {
            structuredValue.facts.forEach(fact => {
                if (typeof fact === 'string' && fact.length > 0) {
                    accumulator.facts.push(fact);
                }
            });
        }

        if (Array.isArray(structuredValue.history)) {
            structuredValue.history.forEach(historyItem => {
                if (historyItem && typeof historyItem === 'object' && typeof historyItem.content === 'string') {
                    accumulator.history.push(historyItem);
                }
            });
        }

        if (typeof structuredValue.task === 'string' && structuredValue.task) {
            accumulator.task = structuredValue.task;
        }
    }

    if (Array.isArray(sources)) {
        sources.forEach(sourceId => {
            if (typeof sourceId === 'string') {
                sourceSet.add(sourceId);
            }
        });
    }

    if (Array.isArray(context_chain)) {
        context_chain.forEach(item => {
            if (item && typeof item.node_id === 'string' && !seenContextItems.has(item.node_id)) {
                contextChain.push(item);
                seenContextItems.add(item.node_id);
            }
        });
    }
}

// A derived store that creates a key representing the state of all nodes.
// This forces the workflowContainers store to update when a node's properties change.
// Uses debouncing to avoid regenerating during drag operations.
/** @type {any} */
let nodeStateDebounceTimeout;
let lastNodeCount = 0;
const nodeStateKey = derived(nodes, ($nodes, set) => {
    const newState = $nodes.map(n => `${n.id}:${n.x}:${n.y}:${n.width}:${n.height}`).join(',');
    const currentNodeCount = $nodes.length;
    
    // Clear existing timeout
    if (nodeStateDebounceTimeout) {
        clearTimeout(nodeStateDebounceTimeout);
    }
    
    // If node count changed, update immediately (new nodes/deleted nodes)
    // Otherwise, debounce position/size changes
    if (currentNodeCount !== lastNodeCount) {
        lastNodeCount = currentNodeCount;
        set(newState);
    } else {
        // Debounce position/size changes for 500ms
        nodeStateDebounceTimeout = setTimeout(() => {
            set(newState);
            nodeStateDebounceTimeout = null;
        }, 500);
    }
}, '');

// Workflow containers - groups of connected nodes
// NOW INCLUDES CROSS-MACHINE CONNECTIONS for proper ontology detection
export const workflowContainers = derived([nodes, connections, crossMachineConnections, nodeStateKey], ([$nodes, $connections, $crossMachineConnections]) => {
    if ($nodes.length === 0) {
        structureCache.nodeSignature = '';
        structureCache.connectionSignature = '';
        structureCache.containers = [];
        return [];
    }

    const nodeIndex = new Map($nodes.map(node => [node.id, node]));
    const nodeSignature = computeNodeSignature($nodes);
    // Include cross-machine connections in signature to trigger recomputation when they change
    const allConnections = [...$connections, ...$crossMachineConnections];
    const connectionSignature = computeConnectionSignature(allConnections);

    if (
        structureCache.nodeSignature === nodeSignature &&
        structureCache.connectionSignature === connectionSignature
    ) {
        return rebuildContainersFromCache(structureCache.containers, nodeIndex);
    }

    // The ontology is the single source of truth.
    // detectMachines() uses Union-Find on node connections — only intra-machine connections
    // (node→node) are included, so machines are correctly isolated connected components.
    // Cross-machine connections use machine-ID endpoints (machine-xxx) and are picked up
    // by detectFactories() which checks for conn.fromId.startsWith('machine-').
    // detectNetworks() unions factories connected via cross-factory connections.
    const { machines: allMachines, factories: allFactories, networks: allNetworks } = detectContainers($nodes, allConnections);

    // Combine all detected containers for rendering.
    let combined = [...allNetworks, ...allFactories, ...allMachines];

    // Final caching and return step
    // Guarantee: any container ID referenced by a connection must exist in combined containers.
    // If missing, attempt to revive from cache using current nodeIndex to recompute bounds.
    try {
        /** @type {Set<string>} */
        const referencedContainerIds = new Set();
        ($connections || []).forEach((/** @type {any} */ conn) => {
            if (typeof conn.fromId === 'string' && (conn.fromId.startsWith('factory-') || conn.fromId.startsWith('machine-') || conn.fromId.startsWith('network-'))) referencedContainerIds.add(conn.fromId);
            if (typeof conn.toId === 'string' && (conn.toId.startsWith('factory-') || conn.toId.startsWith('machine-') || conn.toId.startsWith('network-'))) referencedContainerIds.add(conn.toId);
        });
        // Also include container IDs referenced by node inputs (e.g., first nodes consuming factory or machine)
        try {
            const ndStore = get(nodeDataStore);
            if (ndStore && typeof ndStore.forEach === 'function') {
                ndStore.forEach((/** @type {any} */ nd) => {
                    const inputs = nd?.data?.inputs;
                    if (Array.isArray(inputs)) {
                        inputs.forEach((inp) => {
                            const sid = inp?.source_id;
                            if (typeof sid === 'string' && (sid.startsWith('factory-') || sid.startsWith('machine-') || sid.startsWith('network-'))) {
                                referencedContainerIds.add(sid);
                            }
                        });
                    }
                });
            }
        } catch {}

        /** @type {Set<string>} */
        const presentIds = new Set(combined.map((/** @type {any} */ c) => c.id));
        const missingIds = Array.from(referencedContainerIds).filter(id => !presentIds.has(id));
        if (missingIds.length > 0 && Array.isArray(structureCache.containers) && structureCache.containers.length > 0) {
            const cachedMap = new Map(structureCache.containers.map((/** @type {any} */ c) => [c.id, c]));
            const revived = missingIds
                .map(id => cachedMap.get(id))
                .filter(Boolean)
                .map((/** @type {any} */ c) => c);
            if (revived.length > 0) {
                let rebuilt = rebuildContainersFromCache(revived, nodeIndex);
                // Filter out stale machines that are strict subsets of current machines
                const presentMachines = combined.filter((/** @type {any} */ c) => c && c.isMachine);
                const presentMachineNodeSets = presentMachines.map((/** @type {any} */ m) => new Set((m.nodes || []).map((/** @type {any} */ n) => n?.id).filter(Boolean)));
                // Also compute present factories for stale overlap filtering
                const presentFactories = combined.filter((/** @type {any} */ c) => c && c.isFactory);
                const presentFactoryMachineSets = presentFactories.map((/** @type {any} */ f) => new Set((f.machines || []).map((/** @type {any} */ m) => m?.id).filter(Boolean)));

                rebuilt = rebuilt.filter((/** @type {any} */ c) => {
                    if (!c) return false;
                    if (c.isMachine) {
                        if (!Array.isArray(c.nodes)) return true;
                        const candidate = new Set(c.nodes.map((/** @type {any} */ n) => n?.id).filter(Boolean));
                        // skip revival if any present machine fully contains this candidate
                        return !presentMachineNodeSets.some(set => candidate.size > 0 && [...candidate].every(id => set.has(id)));
                    }
                    if (c.isFactory) {
                        const candSet = new Set((c.machines || []).map((/** @type {any} */ m) => m?.id).filter(Boolean));
                        const subsetOfPresent = presentFactoryMachineSets.some(set => candSet.size > 0 && [...candSet].every(id => set.has(id)));
                        const overlapsPresent = presentFactoryMachineSets.some(set => [...candSet].some(id => set.has(id)));
                        return !(subsetOfPresent || overlapsPresent);
                    }
                    return true;
                });
                if (rebuilt.length > 0) {
                    console.log('♻️ Revived container(s) from cache to satisfy referenced connections:', rebuilt.map(c => c.id));
                    combined = [...combined, ...rebuilt];
                }
            }
            // After attempting revival, if some container IDs are still missing, remap connection endpoints
            {
                const presentIds2 = new Set(combined.map((/** @type {any} */ c) => c.id));
                const stillMissingAll = Array.from(referencedContainerIds).filter(id => !presentIds2.has(id) && typeof id === 'string');
                const stillMissingMachines = stillMissingAll.filter(id => id.startsWith('machine-'));
                const stillMissingFactories = stillMissingAll.filter(id => id.startsWith('factory-'));
                if (stillMissingMachines.length > 0 || stillMissingFactories.length > 0) {
                    const cachedMachines = structureCache.containers.filter((/** @type {any} */ c) => c && c.isMachine);
                    /** @type {Map<string, any>} */
                    const oldMachineMap = new Map(cachedMachines.map((/** @type {any} */ m) => [m.id, m]));
                    const cachedFactories = structureCache.containers.filter((/** @type {any} */ c) => c && c.isFactory);
                    /** @type {Map<string, any>} */
                    const oldFactoryMap = new Map(cachedFactories.map((/** @type {any} */ f) => [f.id, f]));
                    /** @type {Map<string, Set<string>>} */
                    const presentMachineNodes = new Map(
                        combined
                            .filter((/** @type {any} */ c) => c && c.isMachine)
                            .map((/** @type {any} */ m) => [m.id, new Set((m.nodes || []).map((/** @type {any} */ n) => n?.id).filter(Boolean))])
                    );
                    /** @type {Map<string, Set<string>>} */
                    const presentFactoryMachines = new Map(
                        combined
                            .filter((/** @type {any} */ c) => c && c.isFactory)
                            .map((/** @type {any} */ f) => [f.id, new Set((f.machines || []).map((/** @type {any} */ m) => m?.id).filter(Boolean))])
                    );
                    // Also compute, per factory, the node sets of its machines to detect absorbed machines
                    /** @type {Map<string, Array<Set<string>>>} */
                    const presentFactoryMachineNodeSets = new Map(
                        combined
                            .filter((/** @type {any} */ c) => c && c.isFactory)
                            .map((/** @type {any} */ f) => {
                                const sets = (f.machines || []).map((/** @type {any} */ m) => new Set((m.nodes || []).map((/** @type {any} */ n) => n?.id).filter(Boolean)));
                                return [f.id, sets];
                            })
                    );

                    /** @type {Map<string, string>} */
                    const remap = new Map();
                    for (const oldId of stillMissingMachines) {
                        const oldM = oldMachineMap.get(oldId);
                        if (!oldM || !Array.isArray(oldM.nodes)) continue;
                        const oldSet = new Set(oldM.nodes.map((/** @type {any} */ n) => n?.id).filter(Boolean));
                        // find a present machine that fully contains the old node set
                        for (const [newId, newSet] of presentMachineNodes.entries()) {
                            if (oldSet.size > 0) {
                                let contained = true;
                                for (const nid of oldSet) { if (!newSet.has(nid)) { contained = false; break; } }
                                if (contained) { remap.set(oldId, newId); break; }
                            }
                        }
                    }
                    // Remap missing factories to a present factory that fully contains their machines
                    for (const oldId of stillMissingFactories) {
                        const oldF = oldFactoryMap.get(oldId);
                        if (!oldF || !Array.isArray(oldF.machines)) continue;
                        // Old factory may have machines whose IDs disappeared (absorbed into merged machines).
                        // Build node sets for old machines and check coverage by any machine within a present factory.
                        const oldMachineNodeSets = (oldF.machines || [])
                            .map((/** @type {any} */ m) => {
                                const oldM = oldMachineMap.get(m?.id);
                                const nodes = (oldM && Array.isArray(oldM.nodes)) ? oldM.nodes : (m?.nodes || []);
                                return new Set((nodes || []).map((/** @type {any} */ n) => n?.id).filter(Boolean));
                            })
                            .filter(((/** @type {Set<string>} */ s) => s && s.size > 0));

                        // Try to find a present factory whose machines cover all old machines (by ID or by node-set superset)
                        let mapped = false;
                        for (const [newId, newIdSet] of presentFactoryMachines.entries()) {
                            // Fast path: all old machine IDs still present in this factory
                            const oldIdSet = new Set((oldF.machines || []).map((/** @type {any} */ m) => m?.id).filter(Boolean));
                            let allIdsPresent = true;
                            for (const mid of oldIdSet) { if (!newIdSet.has(mid)) { allIdsPresent = false; break; } }
                            if (oldIdSet.size > 0 && allIdsPresent) { remap.set(oldId, newId); mapped = true; break; }

                            // Fallback: coverage by node sets (absorbed machines)
                            const candidateSets = presentFactoryMachineNodeSets.get(newId) || [];
                            let allCovered = true;
                            for (const oldSet of oldMachineNodeSets) {
                                let covered = false;
                                for (const newSet of candidateSets) {
                                    let ok = true;
                                    for (const nid of oldSet) { if (!newSet.has(nid)) { ok = false; break; } }
                                    if (ok) { covered = true; break; }
                                }
                                if (!covered) { allCovered = false; break; }
                            }
                            if (allCovered && oldMachineNodeSets.length > 0) { remap.set(oldId, newId); mapped = true; break; }
                        }
                        if (!mapped) {
                            // As a last resort, if there is only one present factory, remap to it to avoid orphaning
                            const candidates = Array.from(presentFactoryMachines.keys());
                            if (candidates.length === 1) remap.set(oldId, candidates[0]);
                        }
                    }

                    if (remap.size > 0) {
                        console.log('🔁 Remapping stale container references in connections:', Array.from(remap.entries()))
                        connections.update((list) => list.map((c) => {
                            if (!c) return c;
                            const from = remap.get(c.fromId);
                            const to = remap.get(c.toId);
                            if (from || to) {
                                return { ...c, fromId: from || c.fromId, toId: to || c.toId };
                            }
                            return c;
                        }));
                        // Also remap NodeData inputs so first nodes keep factory/machine inputs after merges
                        nodeDataStore.update((store) => {
                            const next = new Map(store);
                            for (const [nid, nd] of next.entries()) {
                                try {
                                    if (!nd || !Array.isArray(nd.data?.inputs)) continue;
                                    let changed = false;
                                    for (const inp of nd.data.inputs) {
                                        if (inp && typeof inp.source_id === 'string' && remap.has(inp.source_id)) {
                                            const newSourceId = remap.get(inp.source_id);
                                            if (newSourceId) {
                                                inp.source_id = newSourceId;
                                                changed = true;
                                            }
                                        }
                                    }
                                    if (changed && typeof nd._updateOutput === 'function') {
                                        nd._updateOutput();
                                        next.set(nid, nd);
                                    }
                                } catch {}
                            }
                            return next;
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Container revive step skipped:', e);
    }

    structureCache.nodeSignature = nodeSignature;
    structureCache.connectionSignature = connectionSignature;
    structureCache.containers = cloneContainersForCache(combined);

    return combined;
});

/**
 * Detects connected components in the node graph
 * Returns array of workflow containers, each containing connected nodes
 * @param {any[]} nodeList
 * @param {any[]} connectionList
 */
function detectConnectedComponents(nodeList, connectionList) {
    if (nodeList.length === 0) return [];
    
    // Use the new ontology-based container detection
    const { machines, factories, networks } = detectContainers(nodeList, connectionList);
    
    return [...machines, ...factories, ...networks];
}

function createExecutionState() {
    const { subscribe, set, update } = writable({
        activeWorkflows: new Set(),
        completedWorkflows: new Set(), // Track completed containers
        activeNodes: new Set(),
        completedNodes: new Set(),
        results: new Map(),
        generatedArtifacts: new Map(), // Add this line
    });

    return {
        subscribe,
        // Add new actions for managing generated content
        /**
         * @param {string} nodeId
         * @param {any} content
         */
        setGeneratedArtifact: (nodeId, content) => update(state => {
            state.generatedArtifacts.set(nodeId, content);
            return state;
        }),
        /**
         * @param {string} nodeId
         */
        clearGeneratedArtifact: (nodeId) => update(state => {
            state.generatedArtifacts.delete(nodeId);
            return state;
        }),
        // Keep existing update method for backward compatibility
        update
    };
}

export const executionState = createExecutionState();

/**
 * Oracle gate store — when an oracle node is executing, this holds the node's
 * prompt and a resolver function. UI components subscribe and show an input dialog.
 * @type {import('svelte/store').Writable<{nodeId: string, prompt: string, upstreamContext: string, resolve: function(string): void, reject: function(Error): void} | null>}
 */
export const pendingOracleNode = writable(null);

/**
 * Finds any executable entity (Node, Machine, Factory, Network) by its ID.
 * @param {string} id
 */
function getExecutableEntity(id) {
    const allContainers = get(workflowContainers);
    const container = allContainers.find(c => c.id === id);
    if (container) return container;

    // Fallback to finding a node if no container matches
    return get(nodes).find(n => n.id === id);
}

/**
 * Recursively collects all node IDs from a container and its children.
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer | Node | null | undefined} container - A machine, factory, or network container.
 * @param {Set<string>} [nodeIdSet] - The set to add node IDs to.
 * @returns {Set<string>} A set of all node IDs.
 */
function collectAllNodeIds(container, nodeIdSet = new Set()) {
    if (!container) {
        return nodeIdSet;
    }

    /** @type {any} */
    const c = container;

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
        c.nodeIds.forEach((/** @type {any} */ id) => nodeIdSet.add(id));
    }
    if (Array.isArray(c.machines)) {
        c.machines.forEach((/** @type {any} */ m) => collectAllNodeIds(m, nodeIdSet));
    }
    if (Array.isArray(c.factories)) {
        c.factories.forEach((/** @type {any} */ f) => collectAllNodeIds(f, nodeIdSet));
    }
    return nodeIdSet;
}

/**
 * @param {ExecutableEntity | undefined} value
 * @returns {value is WorkflowContainer | FactoryContainer | NetworkContainer}
 */
function isContainerEntity(value) {
    return Boolean(value && (value.isNetwork || value.isFactory || value.isWorkflow));
}

/**
 * @param {any} container
 * @param {Map<string, any>} nodeIndex
 * @returns {any[]}
 */
function collectAINodesFromContainer(container, nodeIndex) {
    if (!container || !nodeIndex) {
        return [];
    }

    /** @type {any[]} */
    const aiNodes = [];
    const nodeIds = collectAllNodeIds(container);
    nodeIds.forEach(nodeId => {
        const node = nodeIndex.get(nodeId);
        if (node && node.type === 'ai') {
            aiNodes.push(node);
        }
    });

    return aiNodes;
}

/**
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer | null | undefined} container
 * @param {Map<string, Node>} nodeIndex
 * @returns {OrganizeContext | null}
 */
function buildOrganizeContext(container, nodeIndex) {
    if (!container) return null;
    if (isNetworkContainerEntity(container)) {
        return buildNetworkOrganizeContext(container, nodeIndex);
    }
    if (isFactoryContainerEntity(container)) {
        return buildFactoryOrganizeContext(container, nodeIndex);
    }
    if (isWorkflowContainerEntity(container)) {
        return buildMachineOrganizeContext(container, nodeIndex);
    }
    return null;
}
// organize helpers now imported from './workflows/organize.js'

function forceContainerBoundsRecalc() {
    console.log('🔄 Forcing container bounds recalculation');

    if (nodeStateDebounceTimeout) {
        clearTimeout(nodeStateDebounceTimeout);
        nodeStateDebounceTimeout = null;
    }

    const currentNodes = get(nodes);
    console.log('📐 Current nodes for recalculation:', currentNodes.map(n => `${n.id}: ${n.width}x${n.height}`));
    nodes.update(n => [...n]);
}

/**
 * @param {string} containerId
 * @param {ContainerTraversalOptions} [options]
 */
async function organizeContainer(containerId, options = {}) {
    const {
        skipHistory = false,
        deep = true,
        visited: providedVisited,
        skipBounds = false
    } = options;

    if (!containerId) return;

    const visited = providedVisited instanceof Set ? providedVisited : new Set();
    if (visited.has(containerId)) {
        return;
    }
    visited.add(containerId);

    const allContainers = get(workflowContainers);
    const targetContainer = allContainers.find(c => c.id === containerId);
    if (!targetContainer) {
        console.warn('🔍 organize: container not found for id:', containerId);
        return;
    }

    const nodeList = get(nodes);
    /** @type {Map<string, Node>} */
    const nodeIndex = new Map(nodeList.map(node => [node.id, node]));

    const context = buildOrganizeContext(targetContainer, nodeIndex);
    if (!context || !context.items || context.items.length === 0) {
        console.log('ℹ️ organize: nothing to arrange for container:', containerId);
        if (deep) {
            await organizeChildContainers(containerId, { skipHistory: true, deep: true, visited, skipBounds });
        }
        return;
    }

    const layout = computeOrganizedLayout(context.items, context.edges, context.options || {});
    if (!layout || layout.size === 0) {
        console.log('ℹ️ organize: layout produced no positional changes for:', containerId);
        if (deep) {
            await organizeChildContainers(containerId, { skipHistory: true, deep: true, visited, skipBounds });
        }
        return;
    }

    // Adjust bridge node Y positions — centers standalone bridge nodes vertically
    // between their upstream and downstream containers. Runs before position hints
    // so explicit YAML hints can still override the automatic adjustment.
    adjustBridgeNodePositions(layout, context.items, context.edges);

    // Apply YAML position hints (if any) — overrides auto-layout positions
    if (context.positionHints && context.positionHints.size > 0) {
        const hintedLayout = applyPositionHints(
            layout,
            context.items,
            context.positionHints,
            context.options?.horizontalSpacing ?? ORGANIZE_CONTAINER_HORIZONTAL_SPACING,
            context.options?.verticalSpacing ?? ORGANIZE_CONTAINER_VERTICAL_SPACING
        );
        hintedLayout.forEach((pos, id) => layout.set(id, pos));
    }

    /** @type {Map<string, OrganizeItem>} */
    const itemMap = new Map(context.items.map(item => [item.id, item]));
    /** @type {Map<string, { dx: number, dy: number }>} */
    const itemDeltas = new Map();

    layout.forEach((position, itemId) => {
        const item = itemMap.get(itemId);
        if (!item) {
            return;
        }
        const dx = position.x - item.x;
        const dy = position.y - item.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            itemDeltas.set(itemId, { dx, dy });
        }
    });

    /** @type {Map<string, { dx: number, dy: number }>} */
    const nodeDeltas = new Map();
    let hasConflict = false;

    itemDeltas.forEach(({ dx, dy }, itemId) => {
        const item = itemMap.get(itemId);
        if (!item) return;
        (item.nodeIds || []).forEach(nodeId => {
            if (nodeDeltas.has(nodeId)) {
                const existing = nodeDeltas.get(nodeId);
                if (!existing) {
                    return;
                }
                if (Math.abs(existing.dx - dx) > 0.5 || Math.abs(existing.dy - dy) > 0.5) {
                    console.warn('⚠️ organize: conflicting movement detected for node:', nodeId, 'deltas:', existing, { dx, dy });
                    hasConflict = true;
                }
                return;
            }
            nodeDeltas.set(nodeId, { dx, dy });
        });
    });

    if (hasConflict) {
        console.warn('⚠️ organize: skipping layout due to conflicting node assignments in container:', containerId);
        return;
    }

    /** @type {{ nodeId: string, x: number, y: number }[]} */
    const pendingMoves = [];
    nodeDeltas.forEach(({ dx, dy }, nodeId) => {
        const original = nodeIndex.get(nodeId);
        if (!original) return;
        const newX = Math.round(original.x + dx);
        const newY = Math.round(original.y + dy);
        if (Math.abs(newX - original.x) < 1 && Math.abs(newY - original.y) < 1) {
            return;
        }
        pendingMoves.push({ nodeId, x: newX, y: newY });
    });

    let historyModule = null;
    let macroStarted = false;

    if (!skipHistory) {
        try {
            historyModule = await import('./canvasHistory.js');
            const historyAPI = historyModule?.historyActions;
            if (historyAPI && typeof historyAPI.isHistoryAction === 'function' && !historyAPI.isHistoryAction()) {
                await historyAPI.startMacro(`Organize ${containerId}`);
                macroStarted = true;
            }
        } catch (historyError) {
            const errorMessage = historyError instanceof Error ? historyError.message : String(historyError);
            console.warn('ℹ️ organize: history macro unavailable:', errorMessage);
        }
    }

    if (pendingMoves.length) {
        nodeActions.bulkMove(pendingMoves);
    }

    if (!skipBounds) {
        forceContainerBoundsRecalc();
        await delay(ORGANIZE_BOUNDS_DELAY);
    }

    if (deep) {
        await organizeChildContainers(containerId, {
            skipHistory: true,
            deep: true,
            visited,
            skipBounds: false
        });
    }

    if (!skipBounds) {
        forceContainerBoundsRecalc();
    }

    if (macroStarted && historyModule?.historyActions) {
        try {
            await historyModule.historyActions.endMacro();
        } catch (macroError) {
            const errorMessage = macroError instanceof Error ? macroError.message : String(macroError);
            console.warn(' organize: failed to finalize history macro:', errorMessage);
        }
    }
}

/**
 * @param {string} parentContainerId
 * @param {ContainerTraversalOptions} [options]
 */
async function organizeChildContainers(parentContainerId, options = {}) {
    const { visited } = options;
    await delay(ORGANIZE_BOUNDS_DELAY);

    const allContainers = get(workflowContainers);
    const parentContainer = allContainers.find(c => c.id === parentContainerId);
    if (!parentContainer) {
        return;
    }

    /** @type {string[]} */
    const childIds = [];
    if (Array.isArray(parentContainer.factories)) {
        parentContainer.factories.forEach(/** @param {any} factory */ (factory) => childIds.push(factory.id));
    }
    if (Array.isArray(parentContainer.machines)) {
        parentContainer.machines.forEach(/** @param {any} machine */ (machine) => childIds.push(machine.id));
    }

    for (const childId of childIds) {
        await organizeContainer(childId, {
            ...options,
            skipHistory: true,
            deep: true,
            visited
        });
    }

    // After all children are organized, resolve any remaining sibling overlaps.
    // We need up-to-date bounds, so force a recalc first, then check overlaps.
    if (childIds.length >= 2) {
        forceContainerBoundsRecalc();
        await delay(ORGANIZE_BOUNDS_DELAY);

        const containersAfter = get(workflowContainers);
        const nodesAfter = get(nodes);
        const overlapFixes = resolveContainerOverlaps(childIds, containersAfter, nodesAfter, 30);

        if (overlapFixes.size > 0) {
            console.log(`🔧 organize: resolving ${overlapFixes.size} node positions to fix sibling overlaps inside ${parentContainerId}`);
            /** @type {{ nodeId: string, x: number, y: number }[]} */
            const moves = [];
            overlapFixes.forEach((pos, nodeId) => moves.push({ nodeId, x: pos.x, y: pos.y }));
            nodeActions.bulkMove(moves);

            // Recalc bounds again after the correction
            forceContainerBoundsRecalc();
            await delay(ORGANIZE_BOUNDS_DELAY);
        }
    }
}

/**
 * @param {string} containerId
 * @param {ContainerTraversalOptions} [options]
 */
async function resetContainerAINodes(containerId, options = {}) {
    const opts = /** @type {ContainerTraversalOptions} */ (options);
    opts.skipHistory = true;
    opts.deep = true;
    opts.visited = opts.visited || new Set();

    if (!containerId) {
        return;
    }

    const allContainers = get(workflowContainers);
    const targetContainer = allContainers.find(c => c.id === containerId);
    if (!targetContainer) {
        console.warn(' reset: container not found for id:', containerId);
        return;
    }

    const nodeList = get(nodes);
    const nodeIndex = new Map(nodeList.map(node => [node.id, node]));
    const aiNodes = collectAINodesFromContainer(targetContainer, nodeIndex);

    if (aiNodes.length === 0) {
        if (opts.deep) {
            await resetChildContainerAINodes(containerId, {
                ...opts,
                skipHistory: true,
                deep: true,
                visited: opts.visited
            });
        }
        return;
    }

    let historyModule = null;
    let macroStarted = false;

    if (!opts.skipHistory) {
        try {
            historyModule = await import('./canvasHistory.js');
            const historyAPI = historyModule?.historyActions;
            if (historyAPI && typeof historyAPI.isHistoryAction === 'function' && !historyAPI.isHistoryAction()) {
                await historyAPI.startMacro(`Reset AI Nodes ${containerId}`);
                macroStarted = true;
            }
        } catch (error) {
            console.error(' reset: Error during container reset:', /** @type {any} */ (error)?.message || error);
        }
    }

    const aiNodeIds = new Set();
    aiNodes.forEach(node => {
        aiNodeIds.add(node.id);
        try {
            nodeActions.resetNodeData(node.id);
        } catch (resetError) {
            console.warn('♻️ reset: failed to reset node data for', node.id, resetError);
        }
        nodeActions.update(node.id, { content: '' });
    });

    if (aiNodeIds.size > 0) {
        executionState.update(state => {
            const updatedResults = new Map(state.results);
            const updatedActiveNodes = new Set(state.activeNodes);
            const updatedCompletedNodes = new Set(state.completedNodes);
            const updatedGeneratedArtifacts = new Map(state.generatedArtifacts);

            aiNodeIds.forEach(nodeId => {
                updatedResults.delete(nodeId);
                updatedActiveNodes.delete(nodeId);
                updatedCompletedNodes.delete(nodeId);
                updatedGeneratedArtifacts.delete(nodeId);
            });

            return {
                ...state,
                activeNodes: updatedActiveNodes,
                completedNodes: updatedCompletedNodes,
                results: updatedResults,
                generatedArtifacts: updatedGeneratedArtifacts
            };
        });
    }

    if (opts.deep) {
        await resetChildContainerAINodes(containerId, {
            skipHistory: true,
            deep: true,
            visited: opts.visited
        });
    }

    if (macroStarted && historyModule?.historyActions) {
        try {
            await historyModule.historyActions.endMacro();
        } catch (macroError) {
            console.warn('♻️ reset: failed to finalize history macro:', /** @type {any} */ (macroError)?.message || macroError);
        }
    }

    forceContainerBoundsRecalc();
}

/**
 * @param {string} parentContainerId
 * @param {any} options
 */
async function resetChildContainerAINodes(parentContainerId, options = {}) {
    const { visited } = options;
    const allContainers = get(workflowContainers);
    const parentContainer = allContainers.find(c => c.id === parentContainerId);
    if (!parentContainer) {
        return;
    }

    /** @type {string[]} */
    const childIds = [];
    if (Array.isArray(parentContainer.factories)) {
        parentContainer.factories.forEach(/** @param {any} factory */ (factory) => childIds.push(factory.id));
    }
    if (Array.isArray(parentContainer.machines)) {
        parentContainer.machines.forEach(/** @param {any} machine */ (machine) => childIds.push(machine.id));
    }

    for (const childId of childIds) {
        await resetContainerAINodes(childId, {
            ...options,
            skipHistory: true,
            visited
        });
    }
}

/**
 * The master execution function. Can execute any container recursively.
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer} container
 */
// Simple semaphore to cap concurrent async operations
class Semaphore {
    /**
     * @param {number} limit
     */
    constructor(limit) {
        /** @type {number} */
        this.limit = Math.max(1, limit || 1);
        /** @type {number} */
        this.active = 0;
        /** @type {Function[]} */
        this.queue = [];
    }
    acquire() {
        return new Promise(resolve => {
            const tryAcquire = () => {
                if (this.active < this.limit) {
                    this.active += 1;
                    resolve(() => {
                        this.active -= 1;
                        if (this.queue.length > 0) {
                            const next = this.queue.shift();
                            if (next) next();
                        }
                    });
                } else {
                    this.queue.push(tryAcquire);
                }
            };
            tryAcquire();
        });
    }
    /**
     * @param {number} newLimit
     */
    setLimit(newLimit) {
        this.limit = Math.max(1, newLimit || 1);
        while (this.queue.length > 0 && this.active < this.limit) {
            const next = this.queue.shift();
            if (next) next();
        }
    }
}

// Global AI-call limiter shared across executions
/** @type {Semaphore | null} */
let aiSemaphore = null;

/**
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer} container
 * @param {any} [options]
 */
async function executeContainer(container, options = {}) {
    console.log(`🚀 EXECUTING CONTAINER: ${container.id} (Type: ${container.isNetwork ? 'Network' : container.isFactory ? 'Factory' : 'Machine'})`);
    executionState.update(state => ({
        ...state,
        activeWorkflows: new Set([...state.activeWorkflows, container.id]),
    }));

    /** @type {Array<WorkflowContainer | FactoryContainer | NetworkContainer | Node>} */
    let children = [];
    /** @type {Connection[]} */
    let connections = [];
    if (container.isNetwork) {
        const standaloneNodes = (container.nodeIds || []).map(/** @param {string} id */ (id) => get(nodes).find(n => n.id === id)).filter(/** @param {any} n */ (n) => n !== undefined);
        children = [...(container.factories || []), ...(container.machines || []), ...(/** @type {Node[]} */ (standaloneNodes))];
        connections = Array.isArray(container.connections) ? container.connections : [];
    } else if (container.isFactory) {
        const standaloneNodes = (container.nodeIds || []).map(/** @param {string} id */ (id) => get(nodes).find(n => n.id === id)).filter(/** @param {any} n */ (n) => n !== undefined);
        children = [...(container.machines || []), ...(/** @type {Node[]} */ (standaloneNodes))];
        connections = Array.isArray(container.connections) ? container.connections : [];
    } else { // It's a Machine
        children = Array.isArray(container.nodes) ? container.nodes : [];
        connections = Array.isArray(container.connections) ? container.connections : [];
    }

    // Build complete dependency graph that considers ALL input dependencies
    const containerType = container.isNetwork ? 'network' : container.isFactory ? 'factory' : 'machine';
    console.log(`🔧 Using enhanced dependency order for ${containerType}: ${container.id}`);
    console.log(`🔧 Children:`, children.map(c => `${c.id}(${c.isFactory ? 'factory' : c.isWorkflow ? 'machine' : 'node'})`));
    // Filter children to only include containers for dependency ordering
    /** @type {Array<WorkflowContainer | FactoryContainer | NetworkContainer>} */
    const containerChildren = /** @type {Array<WorkflowContainer | FactoryContainer | NetworkContainer>} */ (
        children.filter(/** @param {any} child */ (child) => 
            child && (child.isFactory || child.isWorkflow || child.isNetwork || 
            ('machines' in child && Array.isArray(child.machines)) ||
            ('factories' in child && Array.isArray(child.factories)) ||
            ('nodes' in child && Array.isArray(child.nodes)))
        )
    );
    const executionOrder = buildCompleteDependencyOrder(containerChildren, connections, container);
    console.log('📊 Execution Order:', executionOrder.join(' -> '));

    const currentSettings = get(settings);
    // Provider defaults to 'gemini' if not configured — Rhode backend handles API keys
    const activeProvider = currentSettings.activeMode || 'gemini';
    const activeModel = currentSettings.story_processing_model_id || '';
    // API keys are managed server-side (GEMINI_API_KEY env var etc.) — no frontend key check needed

    // NOTE: Sequential execution has been removed - using concurrent execution below

    // Kahn-style concurrent scheduler for children within this container
    // Build child-level dependency graph for concurrent scheduling
    /** @type {Map<string, Set<string>>} */
    const dependencyGraph = new Map(); // id -> Set(dependents)
    /** @type {Map<string, number>} */
    const inDegree = new Map(); // id -> prerequisites count
    /** @type {Map<string, string>} */
    const entityToContainerMap = new Map();
    for (const childItem of children) {
        const child = /** @type {WorkflowContainer | FactoryContainer | NetworkContainer | Node} */ (childItem);
        dependencyGraph.set(child.id, new Set());
        inDegree.set(child.id, 0);
        entityToContainerMap.set(child.id, child.id);
        const allNodeIds = collectAllNodeIds(child);
        allNodeIds.forEach(id => entityToContainerMap.set(id, child.id));
    }
    // Check if we're dealing with individual nodes or containers
    const hasIndividualNodes = children.some(child => !('nodes' in child || 'machines' in child || 'factories' in child));

    if (hasIndividualNodes) {
        // Build dependencies directly between nodes
        console.log('🔗 Building node-level dependencies for concurrent execution');
        for (const conn of connections) {
            // Check if both nodes are in our children list
            const fromExists = children.some(c => c.id === conn.fromId);
            const toExists = children.some(c => c.id === conn.toId);

            if (fromExists && toExists) {
                const fromDependencies = dependencyGraph.get(conn.fromId);
                if (fromDependencies && !fromDependencies.has(conn.toId)) {
                    fromDependencies.add(conn.toId);
                    const currentDegree = inDegree.get(conn.toId) ?? 0;
                    inDegree.set(conn.toId, currentDegree + 1);
                    console.log(`   ✅ Added node dependency: ${conn.fromId} -> ${conn.toId}`);
                }
            }
        }
    } else {
        // Original container-based dependency logic
        for (const conn of connections) {
            const fromContainerId = entityToContainerMap.get(conn.fromId);
            const toContainerId = entityToContainerMap.get(conn.toId);
            if (fromContainerId && toContainerId && fromContainerId !== toContainerId) {
                const fromDependencies = dependencyGraph.get(fromContainerId);
                if (
                    fromDependencies &&
                    dependencyGraph.has(toContainerId) &&
                    !fromDependencies.has(toContainerId)
                ) {
                    fromDependencies.add(toContainerId);
                    const currentDegree = inDegree.get(toContainerId) ?? 0;
                    inDegree.set(toContainerId, currentDegree + 1);
                } else if (!dependencyGraph.has(fromContainerId) || !dependencyGraph.has(toContainerId)) {
                    console.log(`   ⚠️  Skipped resolved connection: ${fromContainerId} -> ${toContainerId} (one or both containers not in dependency graph)`);
                }
            }
        }
    }

    // Concurrency limits
    const execLimit = Math.max(1, currentSettings.maxConcurrentExecutions || 3);
    console.log(`🔧 Concurrency settings - Execution limit: ${execLimit}, AI request limit: ${currentSettings.maxConcurrentAIRequests || 3}`);
    if (!aiSemaphore) {
        aiSemaphore = new Semaphore(Math.max(1, currentSettings.maxConcurrentAIRequests || 3));
    } else {
        aiSemaphore.setLimit(Math.max(1, currentSettings.maxConcurrentAIRequests || 3));
    }
    const activeSemaphore = aiSemaphore;
    if (!activeSemaphore) {
        throw new Error('AI semaphore initialization failed');
    }

    // Helper to execute a single entity, preserving semantics
    /**
     * @param {string} entityId
     */
    const runEntity = async (entityId) => {
        const entity = /** @type {ExecutableEntity | undefined} */ (
            children.find(child => child && child.id === entityId)
        );
        if (!entity) return;

        const entityIsContainer = isContainerEntity(entity);

        // Skip locked nodes
        if (!entityIsContainer) {
            const nodeData = nodeActions.getNodeData(entityId);
            if (nodeData && nodeData.data.metadata.locked) {
                console.log(`[Execution] ⏩ Skipping locked node: ${entityId}`);
                workflowActions.setNodeCompleted(entityId);
                nodeActions.setNodeCompleted(entityId);
                return;
            }
        }

        console.log(`--- Executing Entity: ${('title' in entity ? entity.title : null) || entity.id} ---`);
        workflowActions.setNodeExecuting(entityId);
        await nodeActions.setNodeExecuting(entityId);

        // Build external inputs directed to internal target nodes
        const allNodeIdsInEntity = collectAllNodeIds(entity);
        const externalConnections = connections.filter(conn =>
            allNodeIdsInEntity.has(conn.toId) && !allNodeIdsInEntity.has(conn.fromId)
        );
        for (const conn of externalConnections) {
            const parentEntity = getExecutableEntity(conn.fromId);
            if (!parentEntity) continue;
            let parentOutput;
            if (parentEntity.isNetwork) parentOutput = getNetworkOutput(parentEntity);
            else if (parentEntity.isFactory) parentOutput = getFactoryOutput(parentEntity);
            else if (parentEntity.isWorkflow) parentOutput = getMachineOutput(conn.fromId);
            else parentOutput = nodeActions.getNodeData(conn.fromId)?.data.output;
            if (parentOutput) {
                console.log(`   - Receiving external input at node '${conn.toId}' from: ${conn.fromId}`);
                const { type, value, context_chain, sources } = parentOutput;
                const inputData = (type === 'structured_context') ? value : { facts: [value], history: [], task: '' };
                nodeActions.addInput(conn.toId, conn.fromId, inputData, 1.0, context_chain, sources);
            } else {
                console.warn(`   ⚠️  Missing output from parent entity '${conn.fromId}' for node '${conn.toId}'.`);
            }
        }

        // If this entity is a node inside a machine, also pull inputs from internal parent nodes
        if (!entityIsContainer) {
            const parentConnections = connections.filter(c => c.toId === entityId);
            for (const conn of parentConnections) {
                // Only consider parents within the same machine (which is already true for machine-level connections)
                const parentNodeData = /** @type {NodeData | undefined} */ (
                    nodeActions.getNodeData(conn.fromId) ?? undefined
                );
                if (parentNodeData?.data?.output) {
                    const { type, value, context_chain, sources } = parentNodeData.data.output;
                    const inputData = (type === 'structured_context') ? value : { facts: [value], history: [], task: '' };
                    nodeActions.addInput(entityId, conn.fromId, inputData, 1.0, context_chain, sources);
                }
            }
        }

        // Execute entity
        if (entityIsContainer) {
            await executeContainer(entity, { ...options, clearContext: false });
        } else if (entity.type === 'ai') {
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            const inputText = entityData?.getProcessedInput ? entityData.getProcessedInput() : '';
            if (inputText && inputText.trim()) {
                const maxRetries = 3;
                const baseDelay = 1000;
                let lastError = null;
                let success = false;
                for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
                    let release = null;
                    try {
                        console.log(`   - Calling AI for: ${entity.id} (attempt ${attempt}/${maxRetries})`);
                        release = await activeSemaphore.acquire();
                        const nd = nodeActions.getNodeData(entityId);
                        const model = nd?.data?.processing?.model_override || currentSettings.story_processing_model_id;
                        const response = await aiComplete(inputText, '', activeProvider, model || undefined);
                        const responseText = response?.text || response?.content;
                        if (response && responseText) {
                            nodeActions.setNodeCompleted(entityId, responseText);
                            success = true;
                        } else { throw new Error('No content returned'); }
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        lastError = err;
                        if (attempt < maxRetries) {
                            const delay = baseDelay * Math.pow(2, attempt - 1);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    } finally {
                        if (typeof release === 'function') release();
                    }
                }
                if (!success) nodeActions.setNodeError(entityId, lastError || new Error('AI call failed after retries'));
            } else {
                const entityData = /** @type {NodeData | undefined} */ (
                    nodeActions.getNodeData(entityId) ?? undefined
                );
                nodeActions.setNodeCompleted(entityId, entityData?.data?.content);
            }
        } else if (entity.type === 'text_file_output') {
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            if (entityData && entityData.data.processing?.type === 'ai_completion') {
                const processedInput = entityData?.getProcessedInput ? entityData.getProcessedInput() : '';
                let success = false;
                let lastError = null;
                const maxRetries = 3;
                for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
                    let release = null;
                    try {
                        release = await activeSemaphore.acquire();
                        const nd = nodeActions.getNodeData(entityId);
                        const model = nd?.data?.processing?.model_override || currentSettings.story_processing_model_id;
                        const response = await aiComplete(processedInput, '', activeProvider, model || undefined);
                        const responseText = response?.text || response?.content;
                        if (response && responseText) {
                            executionState.setGeneratedArtifact(entityId, responseText);
                            nodeActions.setNodeCompleted(entityId, responseText);

                            // Autosave generated text if enabled in settings
                            console.log(`🔍 Starting autosave check for entity: ${entityId}`);
                            try {
                                const entityNodeData = /** @type {NodeData | undefined} */ (
                                    nodeActions.getNodeData(entityId) ?? undefined
                                );
                                const isTextFileOutput = entityNodeData?.data?.node_type === 'text_file_output';

                                console.log(`🔍 Autosave check - Node type: ${entityNodeData?.data?.node_type}, Is text_file_output: ${isTextFileOutput}`);
                                console.log(`🔍 Autosave check - Settings enabled: ${currentSettings.autosaveOnTextGenerate}`);
                                console.log(`🔍 Autosave check - Node metadata:`, entityNodeData?.data?.metadata);
                                console.log(`🔍 Autosave check - Full node data:`, entityNodeData?.data);
                                console.log(`🔍 Autosave check - Top-level node structure:`, entityNodeData);
                                console.log(`🔍 Autosave check - Entity object:`, entity);

                                if (currentSettings.autosaveOnTextGenerate && isTextFileOutput) {
                                    // Check multiple locations where the path might be stored
                                    const savedPath = entityNodeData?.data?.metadata?.lastSavedPath
                                        || entityNodeData?.data?.metadata?.autoSavePath
                                        || entityNodeData?.data?.filePath;  // From NodeData
                                    const fileHandle = entityNodeData?.data?.metadata?.fileHandle;
                                    console.log(`🔍 Autosave check - Saved path: ${savedPath}, File handle exists: ${!!fileHandle}`);

                                    // Environment detection: desktop if Wails runtime is available
                                    const isDesktopEnv = () => !!((/** @type {any} */ (window)).go?.app?.App);
                                    const hasWriteTextFile = typeof (/** @type {any} */ (window)).go?.app?.App?.WriteTextFile === 'function';
                                    console.log(`🔍 Autosave check - Is desktop env: ${isDesktopEnv()}, Has WriteTextFile: ${hasWriteTextFile}`);

                                    // Prefer browser handle if it exists (even if Wails bindings are available in dev)
                                    if (fileHandle && typeof fileHandle.createWritable === 'function') {
                                        const writable = await fileHandle.createWritable();
                                        await writable.write(response.Content);
                                        await writable.close();
                                        console.log('💾 Autosaved generated text (browser) via File System Access handle.');
                                    } else if (savedPath && String(savedPath).startsWith('/') && responseText && responseText.trim()) {
                                        // Server-side absolute path — use Rhode files/write API
                                        console.log(`💾 Autosaving via server files/write to: ${savedPath}`);
                                        try {
                                            const writeResp = await fetch('/ordinal/api/files/write', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ path: savedPath, content: responseText }),
                                            });
                                            if (writeResp.ok) {
                                                console.log(`💾 Server autosave complete: ${savedPath}`);
                                            } else {
                                                console.warn(`⚠️ Server files/write failed: HTTP ${writeResp.status}`);
                                            }
                                        } catch (writeErr) {
                                            console.warn('Server files/write error:', writeErr);
                                        }
                                    } else if (isDesktopEnv()
                                        && savedPath
                                        && !String(savedPath).startsWith('[Browser]')
                                        && typeof (/** @type {any} */ (window)).go?.app?.App?.WriteTextFile === 'function') {
                                        try {
                                            console.log(`🔍 Attempting to write to path: "${savedPath}"`);
                                            console.log(`🔍 Content length to write: ${response.Content?.length || 0} characters`);

                                            // Only write if we have content to avoid blanking existing files
                                            if (response.Content && response.Content.trim()) {
                                                await (/** @type {any} */ (window)).go.app.App.WriteTextFile(savedPath, response.Content);
                                                console.log(`💾 Autosaved generated text (desktop) to: ${savedPath}`);
                                            } else {
                                                console.warn(`⚠️ Skipping autosave - no content to write`);
                                            }
                                        } catch (writeErr) {
                                            console.error(`❌ Failed to write file to "${savedPath}":`, writeErr);
                                            // Try to provide helpful error info
                                            if (writeErr instanceof Error && writeErr.message?.includes('cannot find the path')) {
                                                console.error('💡 The directory might not exist. Make sure the parent directory exists.');
                                            }
                                            throw writeErr;
                                        }
                                    } else if (!fileHandle && isDesktopEnv() && savedPath && String(savedPath).startsWith('[Browser]')) {
                                        console.log('ℹ️ Autosave skipped: savedPath indicates a browser-selected file ("[Browser] ..."), but no fileHandle is available.');
                                    } else if (!fileHandle && !isDesktopEnv()) {
                                        console.log('ℹ️ Autosave skipped (browser): no fileHandle set for this text_file_output node.');
                                    } else if (!savedPath && isDesktopEnv()) {
                                        console.log('ℹ️ Autosave skipped (desktop): savedPath is not set on node metadata.');
                                    } else {
                                        console.warn('⚠️ Autosave skipped: No suitable write method available (missing fileHandle and/or App.WriteTextFile).');
                                    }
                                }
                            } catch (autosaveErr) {
                                console.warn('Autosave handling error:', autosaveErr);
                            }

                            success = true;
                        } else { throw new Error(response.Error || 'No content returned'); }
                    } catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        lastError = err;
                        if (attempt < maxRetries) {
                            const delay = attempt * 2000;
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    } finally {
                        if (typeof release === 'function') release();
                    }
                }
                if (!success) nodeActions.setNodeError(entityId, lastError || new Error('Artifact generation failed after retries'));
            } else {
                nodeActions.setNodeCompleted(entityId, entityData?.data.content);
            }
        } else if (entity.type === 'bash') {
            // Bash node — execute command via server-side sandbox endpoint
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            const command = entityData?.data?.content || entity.content || '';
            // Collect upstream text as context
            const upstreamText = entityData?.getProcessedInput ? entityData.getProcessedInput() : '';
            try {
                const resp = await fetch('/ordinal/api/exec/bash', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        command,
                        timeout: 30,
                        upstream_context: upstreamText,
                    }),
                });
                if (!resp.ok) {
                    throw new Error(`exec/bash HTTP ${resp.status}`);
                }
                const result = await resp.json();
                if (result.exit_code !== 0) {
                    const errMsg = result.stderr || `Exit code ${result.exit_code}`;
                    nodeActions.setNodeError(entityId, new Error(errMsg));
                } else {
                    nodeActions.setNodeCompleted(entityId, result.stdout);
                }
            } catch (err) {
                nodeActions.setNodeError(entityId, err instanceof Error ? err : new Error(String(err)));
            }

        } else if (entity.type === 'python') {
            // Python node — execute script via server-side sandbox endpoint
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            const script = entityData?.data?.content || entity.content || '';
            const upstreamText = entityData?.getProcessedInput ? entityData.getProcessedInput() : '';
            try {
                const resp = await fetch('/ordinal/api/exec/python', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        script,
                        timeout: 30,
                        upstream_context: upstreamText,
                    }),
                });
                if (!resp.ok) {
                    throw new Error(`exec/python HTTP ${resp.status}`);
                }
                const result = await resp.json();
                if (result.exit_code !== 0) {
                    const errMsg = result.stderr || `Exit code ${result.exit_code}`;
                    nodeActions.setNodeError(entityId, new Error(errMsg));
                } else {
                    nodeActions.setNodeCompleted(entityId, result.stdout);
                }
            } catch (err) {
                nodeActions.setNodeError(entityId, err instanceof Error ? err : new Error(String(err)));
            }

        } else if (entity.type === 'text_file_source' || entity.type === 'pdf_file_source') {
            // File source nodes — read file from server filesystem
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            const filePath = entityData?.data?.filePath || entityData?.data?.content || '';
            if (!filePath || filePath.startsWith('Select')) {
                // No file selected — pass through placeholder
                nodeActions.setNodeCompleted(entityId, entityData?.data?.content || '');
            } else {
                try {
                    const resp = await fetch('/ordinal/api/files/read', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: filePath,
                            format: entity.type === 'pdf_file_source' ? 'pdf' : 'text',
                        }),
                    });
                    if (!resp.ok) {
                        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
                        nodeActions.setNodeError(entityId, new Error(err.error || `files/read failed`));
                    } else {
                        const result = await resp.json();
                        nodeActions.setNodeCompleted(entityId, result.content || '');
                    }
                } catch (err) {
                    nodeActions.setNodeError(entityId, err instanceof Error ? err : new Error(String(err)));
                }
            }

        } else if (entity.type === 'worker' || entity.type === 'orchestrator') {
            // ── Agent Graph: Worker / Orchestrator nodes → Rhode Task API ──
            // Only executes when in automation / agent sub-mode. Falls through to
            // content passthrough in other modes.
            const currentSubMode = get(automationSubMode);
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            const nodeContent = entityData?.data?.content || entity.content || '';
            const upstreamText = entityData?.getProcessedInput ? entityData.getProcessedInput() : '';

            // Build the task prompt: node content + upstream context (if any)
            const prompt = upstreamText
                ? `${nodeContent}\n\nContext from upstream nodes:\n${upstreamText}`
                : nodeContent;

            if (!prompt.trim() || currentSubMode !== 'agent') {
                // No prompt or not in agent mode — pass through
                nodeActions.setNodeCompleted(entityId, nodeContent || upstreamText || '');
            } else {
                try {
                    console.log(`   🤖 ${entity.type} node ${entityId}: creating Rhode task...`);
                    const task = await createTask(prompt);
                    console.log(`   🤖 Task created: id=${task.id}, status=${task.status}`);

                    // Collect streamed content chunks for display
                    let accumulatedContent = '';

                    const finalResult = await streamTask(task.id, (event) => {
                        if (event.type === 'message' && event.content) {
                            accumulatedContent += event.content;
                            // Update visual node content live so the UI shows streaming progress
                            nodes.update(ns => ns.map(n =>
                                n.id === entityId ? { ...n, content: accumulatedContent } : n
                            ));
                        } else if (event.type === 'completed' && event.result) {
                            accumulatedContent = event.result;
                        } else if (event.type === 'heartbeat') {
                            console.log(`   💓 Task ${task.id} heartbeat`);
                        }
                    });

                    const result = finalResult || accumulatedContent;
                    console.log(`   ✅ ${entity.type} node ${entityId} task completed (${result.length} chars)`);
                    nodeActions.setNodeCompleted(entityId, result);
                } catch (err) {
                    console.error(`   ❌ ${entity.type} node ${entityId} task failed:`, err);
                    nodeActions.setNodeError(entityId, err instanceof Error ? err : new Error(String(err)));
                }
            }

        } else if (entity.type === 'oracle') {
            // ── Agent Graph: Oracle node → human-in-the-loop gate ──
            // Pauses execution and waits for the user to provide input via the UI.
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            const oraclePrompt = entityData?.data?.content || entity.content || 'Waiting for human input...';
            const upstreamText = entityData?.getProcessedInput ? entityData.getProcessedInput() : '';

            try {
                console.log(`   🔮 Oracle node ${entityId}: waiting for user input...`);
                // Expose a promise that the UI resolves when the user submits their answer
                const userInput = await new Promise((resolve, reject) => {
                    pendingOracleNode.set({
                        nodeId: entityId,
                        prompt: oraclePrompt,
                        upstreamContext: upstreamText,
                        resolve,
                        reject,
                    });
                });
                pendingOracleNode.set(null);
                console.log(`   ✅ Oracle node ${entityId} received user input (${userInput.length} chars)`);
                nodeActions.setNodeCompleted(entityId, userInput);
            } catch (err) {
                pendingOracleNode.set(null);
                nodeActions.setNodeError(entityId, err instanceof Error ? err : new Error(String(err)));
            }

        } else if (entity.type === 'process') {
            // ── Agent Graph: Process node → passthrough (routes upstream context unchanged) ──
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            const upstreamText = entityData?.getProcessedInput ? entityData.getProcessedInput() : '';
            const passthrough = upstreamText || entityData?.data?.content || '';
            nodeActions.setNodeCompleted(entityId, passthrough);

        } else {
            const entityData = /** @type {NodeData | undefined} */ (
                nodeActions.getNodeData(entityId) ?? undefined
            );
            nodeActions.setNodeCompleted(entityId, entityData?.data?.content);
        }
        workflowActions.setNodeCompleted(entityId);
    };

    // Run with a small pool
    /** @type {string[]} */
    const ready = [];
    inDegree.forEach((deg, id) => { if (deg === 0) ready.push(id); });
    console.log(`🎯 Initial ready queue: [${ready.join(', ')}]`);

    // Fallback: if no items are ready (graph issue), run sequentially by prior order
    if (ready.length === 0 && children.length > 0) {
        console.warn('⚠️ No ready items found; falling back to sequential execution');
        for (const id of executionOrder) {
            await runEntity(id);
        }
        executionState.update(state => {
            const newActive = new Set(state.activeWorkflows);
            newActive.delete(container.id);
            const newCompleted = new Set(state.completedWorkflows);
            newCompleted.add(container.id);
            return { ...state, activeWorkflows: newActive, completedWorkflows: newCompleted };
        });
        console.log(`✅ Container execution completed (sequential fallback): ${container.id}`);
        return;
    }
    const inFlight = new Map(); // id -> Promise
    const startIfPossible = () => {
        console.log(`🔄 Concurrency check - Ready: ${ready.length}, In flight: ${inFlight.size}, Exec limit: ${execLimit}`);
        while (ready.length > 0 && inFlight.size < execLimit) {
            const nextId = ready.shift();
            if (typeof nextId !== 'string') {
                continue;
            }
            console.log(`🚀 Starting concurrent execution for: ${nextId} (${inFlight.size + 1}/${execLimit})`);
            const p = runEntity(nextId).then(() => ({ id: nextId })).catch(() => ({ id: nextId }));
            inFlight.set(nextId, p);
        }
    };
    startIfPossible();
    while (inFlight.size > 0) {
        const results = Array.from(inFlight.values());
        const finished = await Promise.race(results);
        console.log(`✅ Entity completed: ${finished.id}, In flight remaining: ${inFlight.size - 1}`);
        inFlight.delete(finished.id);
        const dependents = dependencyGraph.get(finished.id);
        if (dependents) {
            for (const depId of dependents) {
                const currentDegree = inDegree.get(depId);
                if (typeof currentDegree === 'number') {
                    const nextDegree = currentDegree - 1;
                    inDegree.set(depId, nextDegree);
                    if (nextDegree === 0) {
                        ready.push(depId);
                        console.log(`📋 Added ${depId} to ready queue (dependencies satisfied)`);
                    }
                }
            }
        }
        startIfPossible();
    }

    executionState.update(state => {
        const newActive = new Set(state.activeWorkflows);
        newActive.delete(container.id);
        const newCompleted = new Set(state.completedWorkflows);
        newCompleted.add(container.id);
        return { ...state, activeWorkflows: newActive, completedWorkflows: newCompleted };
    });
    console.log(`✅ Container execution completed: ${container.id}`);
}

/**
 * Recursively collects all container IDs from a container and its children.
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer | null | undefined} container - A machine, factory, or network container.
 * @param {Set<string>} [containerIdSet] - The set to add container IDs to.
 * @returns {Set<string>} A set of all container IDs.
 */
function collectAllContainerIds(container, containerIdSet = new Set()) {
    if (!container || typeof container.id !== 'string') {
        return containerIdSet;
    }

    containerIdSet.add(container.id);

    if (Array.isArray(container.machines)) {
        container.machines.forEach(m => collectAllContainerIds(m, containerIdSet));
    }
    if (Array.isArray(container.factories)) {
        container.factories.forEach(f => collectAllContainerIds(f, containerIdSet));
    }

    return containerIdSet;
}

/**
 * Finds the parent container of a given entity (node or container).
 * @param {string} entityId - The ID of the entity to find the parent for.
 * @returns {WorkflowContainer | FactoryContainer | NetworkContainer | null} The parent container or null if not found.
 */
function findParentContainer(entityId) {
    /** @type {(WorkflowContainer | FactoryContainer | NetworkContainer)[]} */
    const allContainers = get(workflowContainers);

    /**
     * @param {WorkflowContainer | FactoryContainer | NetworkContainer} container
     * @returns {WorkflowContainer | FactoryContainer | NetworkContainer | null}
     */
    function search(container) {
        /** @type {string[]} */
        const childIds = [];

        if (Array.isArray(container.machines)) {
            container.machines.forEach(m => childIds.push(m.id));
        }
        if (Array.isArray(container.factories)) {
            container.factories.forEach(f => childIds.push(f.id));
        }
        if (Array.isArray(container.nodes)) {
            container.nodes.forEach(n => childIds.push(n.id));
        }
        if (Array.isArray(container.nodeIds)) {
            container.nodeIds.forEach(id => childIds.push(id));
        }

        if (childIds.includes(entityId)) {
            return container;
        }

        /** @type {(WorkflowContainer | FactoryContainer)[]} */
        const childContainers = [];
        if (Array.isArray(container.machines)) {
            childContainers.push(...container.machines);
        }
        if (Array.isArray(container.factories)) {
            childContainers.push(...container.factories);
        }

        for (const child of childContainers) {
            const found = search(child);
            if (found) {
                return found;
            }
        }

        return null;
    }

    for (const containerItem of allContainers) {
        const found = search(containerItem);
        if (found) {
            return found;
        }
    }

    return null;
}

// Helper functions for workflow execution
export const workflowActions = {
    /**
     * @param {string} containerId
     * @param {ExecutionOptions & Record<string, unknown>} [options]
     */
    execute: async (containerId, options = {}) => {
        const { clearContext = true } = options;
        console.log('workflowActions.execute called for:', containerId);
        
        // Skip execution if we're in loading/initialization mode
        // @ts-ignore - ordinalLoadingMode is a custom property we add
        if (window.ordinalLoadingMode) {
            console.log(`🚫 Skipping execution of ${containerId} - in loading mode`);
            return;
        }
        
        const container = getExecutableEntity(containerId);
        if (!container) {
            console.error('Container not found for execution:', containerId);
            return;
        }
        
        // Reset node and container states within this container before execution
        const allNodeIds = collectAllNodeIds(container);
        const allContainerIds = collectAllContainerIds(container);

        const isTopLevel = !findParentContainer(containerId);

        if (clearContext && isTopLevel) {
            console.log('Clearing context for top-level container:', containerId);
            allNodeIds.forEach(id => {
                nodeActions.resetNodeData(id);
            });
        } else {
            console.log('Preserving context for nested or isolated run:', containerId);
        }

        executionState.update(s => {
            allNodeIds.forEach(id => {
                s.activeNodes.delete(id);
                s.completedNodes.delete(id);
            });
            allContainerIds.forEach(id => {
                s.completedWorkflows.delete(id); // Reset completion status
            });
            return s;
        });

        try {
            await executeContainer(container, options);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('Error during container execution:', err);
            executionState.update(state => {
                const newActive = new Set(state.activeWorkflows);
                newActive.delete(containerId);
                return {
                    ...state,
                    activeWorkflows: newActive
                };
            });
        }
    },
    
    /**
     * @param {string} workflowId
     */
    stop: (workflowId) => {
        executionState.update(state => {
            const newActive = new Set(state.activeWorkflows);
            newActive.delete(workflowId);
            return {
                ...state,
                activeWorkflows: newActive,
                activeNodes: new Set(),
                completedNodes: new Set()
            };
        });
    },

    /**
     * @param {string} nodeId
     */
    setNodeExecuting: (nodeId) => {
        executionState.update(state => ({
            ...state,
            activeNodes: new Set([...state.activeNodes, nodeId])
        }));
    },

    /**
     * @param {string} nodeId
     */
    setNodeCompleted: (nodeId) => {
        executionState.update(state => {
            const newActive = new Set(state.activeNodes);
            newActive.delete(nodeId);
            return {
                ...state,
                activeNodes: newActive,
                completedNodes: new Set([...state.completedNodes, nodeId])
            };
        });
    },

    /**
     * @param {string} containerId
     * @param {ContainerTraversalOptions} [options]
     */
    organize: (containerId, options) => organizeContainer(containerId, options),

    /**
     * Global canvas organize - organizes all top-level elements.
     * Runs in a convergence loop until the layout is fully stable (total movement
     * delta falls below threshold) or a maximum iteration count is reached.
     */
    organizeCanvas: async () => {
        console.log('🎨 Starting global canvas organize (convergence loop)...');

        const CONVERGENCE_THRESHOLD = 5;  // px total movement to consider stable
        const MAX_ITERATIONS = 5;
        const PASS_DELAY = 50;            // ms between passes for Svelte reactivity

        // Start history macro (wraps all passes as one undo step)
        let historyModule = null;
        let macroStarted = false;

        try {
            historyModule = await import('./canvasHistory.js');
            const historyAPI = historyModule?.historyActions;
            if (historyAPI && typeof historyAPI.isHistoryAction === 'function' && !historyAPI.isHistoryAction()) {
                await historyAPI.startMacro('Organize Canvas');
                macroStarted = true;
            }
        } catch (historyError) {
            const errorMessage = historyError instanceof Error ? historyError.message : String(historyError);
            console.warn('ℹ️ organizeCanvas: history macro unavailable:', errorMessage);
        }

        let totalMoved = 0;

        try {
            for (let i = 1; i <= MAX_ITERATIONS; i++) {
                const nodeList = get(nodes);
                const connectionList = get(connections);
                const allContainers = get(workflowContainers);

                const result = organizeCanvas(nodeList, connectionList, allContainers);

                if (!result.success || result.nodeUpdates.size === 0) {
                    console.log(`🎨 Organize pass ${i}: no changes — layout already stable`);
                    break;
                }

                // Apply YAML position hints for top-level items on the canvas.
                // organizeCanvas() does not call applyPositionHints itself, so we do
                // it here — mirroring what organizeContainer() does for nested containers.
                if (result.items && result.items.length > 0) {
                    const customizations = get(containerCustomizations);
                    /** @type {Map<string, string>} */
                    const canvasHints = new Map();
                    result.items.forEach((item) => {
                        const hint = customizations.get(item.id)?.positionHint;
                        if (hint) canvasHints.set(item.id, hint);
                    });

                    if (canvasHints.size > 0) {
                        // Build a layout map from the post-organizeCanvas item positions
                        // (i.e. the positions the items will have after nodeUpdates are applied).
                        // We reconstruct these from the delta already computed by organizeCanvas.
                        /** @type {Map<string, {x: number, y: number}>} */
                        const canvasLayout = new Map();
                        result.items.forEach((item) => {
                            // Find any node in this item to get the post-move position
                            const representativeNodeId = item.nodeIds[0];
                            if (representativeNodeId && result.nodeUpdates.has(representativeNodeId)) {
                                const nodePos = result.nodeUpdates.get(representativeNodeId);
                                // nodePos is the absolute post-move position of that node.
                                // item.x/y is the pre-move item origin, so dx/dy is the shift.
                                const origNode = nodeList.find(n => n.id === representativeNodeId);
                                if (origNode && nodePos) {
                                    const dx = nodePos.x - (origNode.x ?? 0);
                                    const dy = nodePos.y - (origNode.y ?? 0);
                                    canvasLayout.set(item.id, {
                                        x: item.x + dx,
                                        y: item.y + dy,
                                    });
                                }
                            }
                            // If no nodeUpdate exists for this item, use its current position
                            if (!canvasLayout.has(item.id)) {
                                canvasLayout.set(item.id, { x: item.x, y: item.y });
                            }
                        });

                        const hintedLayout = applyPositionHints(
                            canvasLayout,
                            result.items,
                            canvasHints,
                            ORGANIZE_CONTAINER_HORIZONTAL_SPACING,
                            ORGANIZE_CONTAINER_VERTICAL_SPACING
                        );

                        // Merge hinted positions back into nodeUpdates
                        hintedLayout.forEach((hintedPos, itemId) => {
                            const origPos = canvasLayout.get(itemId);
                            if (!origPos) return;
                            const dxHint = hintedPos.x - origPos.x;
                            const dyHint = hintedPos.y - origPos.y;
                            if (Math.abs(dxHint) < 0.5 && Math.abs(dyHint) < 0.5) return;

                            // Shift all nodes in this item by the hint delta
                            const item = result.itemMap?.get(itemId);
                            if (!item) return;
                            item.nodeIds.forEach((nodeId) => {
                                const existing = result.nodeUpdates.get(nodeId);
                                const origNode = nodeList.find(n => n.id === nodeId);
                                if (!origNode) return;
                                const baseX = existing ? existing.x : (origNode.x ?? 0);
                                const baseY = existing ? existing.y : (origNode.y ?? 0);
                                result.nodeUpdates.set(nodeId, {
                                    x: Math.round(baseX + dxHint),
                                    y: Math.round(baseY + dyHint),
                                });
                            });
                        });
                    }
                }

                // Compute total movement delta before applying
                const currentNodes = get(nodes);
                const nodeMap = new Map(currentNodes.map(n => [n.id, n]));
                let totalDelta = 0;
                result.nodeUpdates.forEach((position, nodeId) => {
                    const node = nodeMap.get(nodeId);
                    if (node) {
                        const dx = position.x - (node.x ?? 0);
                        const dy = position.y - (node.y ?? 0);
                        totalDelta += Math.sqrt(dx * dx + dy * dy);
                    }
                });

                console.log(`🎨 Organize pass ${i}: totalDelta=${totalDelta.toFixed(1)}px`);

                // Apply node updates
                /** @type {{ nodeId: string, x: number, y: number }[]} */
                const pendingMoves = [];
                result.nodeUpdates.forEach((position, nodeId) => {
                    pendingMoves.push({ nodeId, x: position.x, y: position.y });
                });

                if (pendingMoves.length > 0) {
                    nodeActions.bulkMove(pendingMoves);
                    totalMoved += pendingMoves.length;
                    // Let Svelte recompute reactive container bounds before next pass
                    await tick();
                }

                // Force container bounds recalculation after each pass
                forceContainerBoundsRecalc();
                await delay(ORGANIZE_BOUNDS_DELAY);
                forceContainerBoundsRecalc();

                // Converged — no need for another pass
                if (totalDelta <= CONVERGENCE_THRESHOLD) {
                    console.log(`🎨 Converged after ${i} pass(es) (delta=${totalDelta.toFixed(1)}px ≤ ${CONVERGENCE_THRESHOLD}px)`);
                    break;
                }

                // Wait between passes to let Svelte reactivity propagate
                if (i < MAX_ITERATIONS) {
                    await delay(PASS_DELAY);
                }
            }
        } finally {
            // End history macro regardless of how the loop exits
            if (macroStarted && historyModule?.historyActions) {
                try {
                    await historyModule.historyActions.endMacro();
                } catch (macroError) {
                    const errorMessage = macroError instanceof Error ? macroError.message : String(macroError);
                    console.warn('⚠️ organizeCanvas: failed to finalize history macro:', errorMessage);
                }
            }
        }

        console.log(`✅ Global canvas organize complete: moved ${totalMoved} node positions across all passes`);
    },

    /**
     * @param {string} containerId
     * @param {ContainerTraversalOptions} [options]
     */
    resetAINodes: (containerId, options) => resetContainerAINodes(containerId, options),

    recalculateContainerBounds: () => {
        forceContainerBoundsRecalc();
    }
};

// (Removed unused executeWorkflow; execution entrypoints are workflowActions.execute -> executeContainer)


// Build complete dependency order that considers ALL input dependencies
/**
 * @param {(WorkflowContainer | FactoryContainer | NetworkContainer)[]} children
 * @param {Connection[]} connections
 * @param {WorkflowContainer | FactoryContainer | NetworkContainer} container
 * @returns {string[]}
 */
function buildCompleteDependencyOrder(children, connections, container) {
    console.log(`🔧 buildCompleteDependencyOrder called for container: ${container.id}`);
    
    /**
     * Helper to recursively collect all node IDs from a container and its children.
     * @param {WorkflowContainer | FactoryContainer | NetworkContainer | Node} container - A machine, factory, or network container.
     * @param {Set<string>} [nodeIdSet] - The set to add node IDs to.
     * @returns {Set<string>} A set of all node IDs.
     */
    function collectAllNodeIds(container, nodeIdSet = new Set()) {
        // If it's a simple node (has id but no container properties), just add its ID
        if (
            typeof container.id === 'string' &&
            !('nodes' in container) &&
            !('nodeIds' in container) &&
            !('machines' in container) &&
            !('factories' in container)
        ) {
            nodeIdSet.add(container.id);
        }
        
        // Handle WorkflowContainer (machines)
        if ('nodes' in container && Array.isArray(container.nodes)) {
            container.nodes.forEach(/** @param {any} n */ (n) => nodeIdSet.add(n.id));
        }
        
        // Handle containers with nodeIds
        if ('nodeIds' in container && Array.isArray(container.nodeIds)) {
            container.nodeIds.forEach(/** @param {string} id */ (id) => nodeIdSet.add(id));
        }
        
        // Handle FactoryContainer and NetworkContainer with machines
        if ('machines' in container && Array.isArray(container.machines)) {
            container.machines.forEach(/** @param {any} m */ (m) => collectAllNodeIds(m, nodeIdSet));
        }
        
        // Handle NetworkContainer with factories
        if ('factories' in container && Array.isArray(container.factories)) {
            container.factories.forEach(/** @param {any} f */ (f) => collectAllNodeIds(f, nodeIdSet));
        }
        
        return nodeIdSet;
    }

    /** @type {Map<string, Set<string>>} */
    const dependencyGraph = new Map();
    /** @type {Map<string, number>} */
    const inDegree = new Map();
    
    for (const childItem of children) {
        const child = /** @type {WorkflowContainer | FactoryContainer | NetworkContainer} */ (childItem);
        dependencyGraph.set(child.id, new Set());
        inDegree.set(child.id, 0);
    }

    // Build a map of all entities (nodes and containers) to their top-level container in this context
    /** @type {Map<string, string>} */
    const entityToContainerMap = new Map();
    for (const childItem of children) {
        const child = /** @type {WorkflowContainer | FactoryContainer | NetworkContainer} */ (childItem);
        entityToContainerMap.set(child.id, child.id); // The container maps to itself
        const allNodeIds = collectAllNodeIds(child);
        allNodeIds.forEach(nodeId => {
            entityToContainerMap.set(nodeId, child.id);
        });
    }

    console.log(`🔗 Processing ${connections.length} explicit connections with container resolution`);
    try {
        for (const conn of connections) {
            const fromContainerId = entityToContainerMap.get(conn.fromId);
            const toContainerId = entityToContainerMap.get(conn.toId);

            // Add a dependency if it's between two different top-level containers in this context
            if (fromContainerId && toContainerId && fromContainerId !== toContainerId) {
                const fromDependencies = dependencyGraph.get(fromContainerId);
                const toDependencies = dependencyGraph.get(toContainerId);
                if (fromDependencies && toDependencies) {
                    // Check to avoid adding duplicate dependencies which would skew inDegree
                    if (!fromDependencies.has(toContainerId)) {
                        fromDependencies.add(toContainerId);
                        const currentDegree = inDegree.get(toContainerId) ?? 0;
                        inDegree.set(toContainerId, currentDegree + 1);
                        console.log(`   ✅ Added resolved explicit dependency: ${fromContainerId} -> ${toContainerId} (from connection ${conn.fromId} -> ${conn.toId})`);
                    }
                } else {
                    console.log(`   ⚠️  Skipped resolved connection: ${fromContainerId} -> ${toContainerId} (one or both containers not in dependency graph)`);
                }
            }
        }
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ Error processing connections:`, err);
    }

    // The implicit dependency check can remain as a fallback, though the explicit check should now handle most cases.
    for (const childItem of children) {
        const child = /** @type {WorkflowContainer | FactoryContainer | NetworkContainer} */ (childItem);
        const allChildNodeIds = collectAllNodeIds(child);
        for (const nodeId of allChildNodeIds) {
            const nodeData = /** @type {NodeData | undefined} */ (nodeActions.getNodeData(nodeId) ?? undefined);
            const inputs = Array.isArray(nodeData?.data?.inputs) ? nodeData.data.inputs : [];

            for (const input of inputs) {
                const sourceId = input?.source_id;
                if (typeof sourceId !== 'string') {
                    continue;
                }

                const sourceContainerId = entityToContainerMap.get(sourceId);
                if (
                    sourceContainerId &&
                    sourceContainerId !== child.id &&
                    dependencyGraph.has(sourceContainerId) &&
                    dependencyGraph.has(child.id)
                ) {
                    const sourceDependencies = dependencyGraph.get(sourceContainerId);
                    if (sourceDependencies && !sourceDependencies.has(child.id)) {
                        sourceDependencies.add(child.id);
                        const currentDegree = inDegree.get(child.id) ?? 0;
                        inDegree.set(child.id, currentDegree + 1);
                        console.log(`   ✅ Added implicit dependency: ${sourceContainerId} -> ${child.id} (from input ${sourceId} -> ${nodeId})`);
                    }
                }
            }
        }
    }
    
    // Debug: Show final dependency graph
    console.log('🔗 Final dependency graph:');
    dependencyGraph.forEach((dependencies, fromId) => {
        if (dependencies.size > 0) {
            console.log(`   ${fromId} -> [${Array.from(dependencies).join(', ')}]`);
        }
    });
    console.log('📊 In-degrees:', Array.from(inDegree.entries()));
    
    // Perform topological sort with enhanced dependency graph
    /** @type {string[]} */
    const queue = [];
    inDegree.forEach((degree, childId) => {
        if (degree === 0) {
            queue.push(childId);
        }
    });
    
    /** @type {string[]} */
    const sortedOrder = [];
    while (queue.length > 0) {
        const currentId = queue.shift();
        if (!currentId) {
            continue;
        }
        sortedOrder.push(currentId);

        if (dependencyGraph.has(currentId)) {
            const dependents = dependencyGraph.get(currentId);
            if (!dependents) continue;
            for (const dependentId of dependents) {
                const currentDegree = inDegree.get(dependentId);
                if (typeof currentDegree === 'number') {
                    const nextDegree = currentDegree - 1;
                    inDegree.set(dependentId, nextDegree);
                    if (nextDegree === 0) {
                        queue.push(dependentId);
                    }
                }
            }
        }
    }
    
    if (sortedOrder.length !== children.length) {
        const unprocessed = children.filter(c => !sortedOrder.includes(c.id)).map(c => c.id);
        console.error(`Cycle detected in enhanced dependency graph! Unprocessed: ${unprocessed.join(', ')}`);
        return sortedOrder;
    }
    
    return sortedOrder;
}

// (Removed unused topologicalSort; execution flow uses executeContainer + buildCompleteDependencyOrder)

/**
 * Get machine output data (from outmost nodes)
 * @param {string} machineId
 * @returns {NodeOutput | null}
 */
export function getMachineOutput(machineId) {
    /** @type {WorkflowContainer | undefined} */
    let machine;
    const unsubscribe = workflowContainers.subscribe(containers => {
        machine = containers.find(c => c.id === machineId);
    });
    unsubscribe();

    const workflowMachine = machine;
    if (!workflowMachine) {
        console.warn(`🔍 getMachineOutput: Container '${machineId}' not found`);
        return null;
    }

    // Type-aware dispatch: if the found container is a factory or network, delegate to the
    // appropriate output function rather than expecting a flat `nodes` array.
    if (workflowMachine.isFactory) {
        console.log(`🔍 getMachineOutput: '${machineId}' is a factory — delegating to getFactoryOutput`);
        return getFactoryOutput(/** @type {FactoryContainer} */ (/** @type {any} */ (workflowMachine)));
    }

    if (workflowMachine.isNetwork) {
        console.log(`🔍 getMachineOutput: '${machineId}' is a network — delegating to getNetworkOutput`);
        return getNetworkOutput(/** @type {NetworkContainer} */ (/** @type {any} */ (workflowMachine)));
    }

    if (!Array.isArray(workflowMachine.nodes)) {
        console.warn(`🔍 getMachineOutput: Machine '${machineId}' not found or has no nodes`);
        return null;
    }

    const machineNodes = workflowMachine.nodes;
    const machineConnections = Array.isArray(workflowMachine.connections)
        ? workflowMachine.connections
        : [];
    
    // Find nodes that have no outgoing connections (output nodes)
    const outputNodes = machineNodes.filter(node => {
        return !machineConnections.some(conn => conn.fromId === node.id);
    });
    
    if (outputNodes.length === 0) {
        console.warn(`🔍 getMachineOutput: Machine '${machineId}' has no output nodes`);
        return null;
    }

    console.log(`🔍 getMachineOutput: Machine '${machineId}' has ${outputNodes.length} output nodes:`, outputNodes.map(n => `${n.id}(${n.type})`));
    
    // Check if output nodes have actual output data
    const nodesWithOutput = outputNodes.filter(node => {
        const nodeData = /** @type {NodeData | undefined} */ (nodeActions.getNodeData(node.id) ?? undefined);
        return Boolean(nodeData?.data?.output);
    });
    
    if (nodesWithOutput.length === 0) {
        console.warn(`🔍 getMachineOutput: None of the output nodes in machine '${machineId}' have output data`);
        outputNodes.forEach(node => {
            const nodeData = /** @type {NodeData | undefined} */ (nodeActions.getNodeData(node.id) ?? undefined);
            const hasOutput = nodeData?.data?.output ? 'HAS OUTPUT' : 'NO OUTPUT';
            console.warn(`  - Node '${node.id}' (${node.type}): ${nodeData ? hasOutput : 'NO NODE DATA'}`);
        });
        return null;
    }

    console.log(`🔍 getMachineOutput: ${nodesWithOutput.length}/${outputNodes.length} output nodes have data`);

    // Get the merged output from terminal nodes
    const mergedOutput = /** @type {NodeOutput | null} */ (
        ContextEngine.mergeWorkflowOutputs(outputNodes, nodeActions.getNodeData)
    );

    if (!mergedOutput) {
        console.warn(`🔍 getMachineOutput: Failed to merge outputs for machine '${machineId}'`);
        return null;
    }

    /** @type {StructuredContext} */
    const aggregatedValue = { facts: [], history: [], task: '' };
    /** @type {ContextChainItem[]} */
    const allContextChain = [];
    /** @type {Set<string>} */
    const seenContextItems = new Set();

    const initialSources = Array.isArray(mergedOutput.sources)
        ? mergedOutput.sources.filter(source => typeof source === 'string')
        : [];
    /** @type {Set<string>} */
    const allSources = new Set(initialSources);

    mergeContextFromOutput(mergedOutput, aggregatedValue, allSources, allContextChain, seenContextItems);
    
    // Collect context chain from ALL nodes in the machine to get full upstream context
    machineNodes.forEach(node => {
        const nodeData = /** @type {NodeData | undefined} */ (nodeActions.getNodeData(node.id) ?? undefined);
        mergeContextFromOutput(nodeData?.data?.output, aggregatedValue, allSources, allContextChain, seenContextItems);
    });
    
    // Rebuild structured context from the complete context chain
    const fullStructuredContext = /** @type {StructuredContext} */ (
        ContextEngine.buildStructuredContext(allContextChain)
    );

    const mergedStructuredValue =
        mergedOutput.type === 'structured_context' &&
        mergedOutput.value &&
        typeof mergedOutput.value === 'object'
            ? /** @type {StructuredContext} */ (mergedOutput.value)
            : { facts: [], history: [], task: '' };
    
    console.log(`🔍 getMachineOutput: Enhanced context for ${machineId}:`, {
        originalFacts: mergedStructuredValue.facts?.length || 0,
        fullContextFacts: fullStructuredContext.facts?.length || 0,
        originalHistory: mergedStructuredValue.history?.length || 0,
        fullContextHistory: fullStructuredContext.history?.length || 0,
        contextChainLength: allContextChain.length,
        totalSources: allSources.size
    });
    
    // Return enhanced output with full context chain
    return {
        type: 'structured_context',
        value: fullStructuredContext,
        sources: Array.from(allSources),
        context_chain: allContextChain
    };
}

/**
 * Get factory output data by merging outputs of its terminal machines/nodes
 * @param {FactoryContainer} factory
 * @returns {NodeOutput | null}
 */
export function getFactoryOutput(factory) {
    if (!factory || (!factory.machines && !factory.nodeIds)) {
        console.warn(`🔍 getFactoryOutput: Factory '${factory?.id}' not found or has no machines/nodes`);
        return null;
    }

    // Find terminal entities (machines or nodes) within the factory
    /** @type {FactoryTerminalEntity[]} */
    const terminalEntities = [];
    (factory.machines || []).forEach(machine => {
        if (!factory.connections.some(conn => conn.fromId === machine.id)) {
            terminalEntities.push({ id: machine.id, type: 'machine' });
        }
    });
    (factory.nodeIds || []).forEach(nodeId => {
        if (!factory.connections.some(conn => conn.fromId === nodeId)) {
            terminalEntities.push({ id: nodeId, type: 'node' });
        }
    });

    if (terminalEntities.length === 0) {
        console.warn(`🔍 getFactoryOutput: Factory '${factory.id}' has no terminal entities`);
        return null;
    }

    console.log(`🔍 getFactoryOutput: Factory '${factory.id}' has ${terminalEntities.length} terminal entities:`, terminalEntities.map(e => `${e.id}(${e.type})`));

    /** @type {(NodeOutput | null)[]} */
    const candidateOutputs = terminalEntities.map(entity => {
        if (entity.type === 'machine') return getMachineOutput(entity.id);
        if (entity.type === 'node') {
            const nodeData = nodeActions.getNodeData(entity.id);
            return nodeData ? nodeData.data.output : null;
        }
        return null;
    });

    const terminalOutputs = /** @type {NodeOutput[]} */ (candidateOutputs.filter(Boolean));

    if (terminalOutputs.length === 0) {
        console.warn(`🔍 getFactoryOutput: None of the terminal entities in factory '${factory.id}' have output data`);
        return null;
    }

    console.log(`🔍 getFactoryOutput: ${terminalOutputs.length}/${terminalEntities.length} terminal entities have output data`);
    
    // ENHANCEMENT: Collect full context chain from ALL entities in the factory, not just terminal entities
    // This ensures that when factory output is used for context propagation, it includes
    // the complete accumulated context from the entire workflow that led to this factory
    /** @type {ContextChainItem[]} */
    const allContextChain = [];
    /** @type {Set<string>} */
    const seenContextItems = new Set();
    /** @type {Set<string>} */
    const allSources = new Set();
    /** @type {StructuredContext} */
    const mergedValue = { facts: [], history: [], task: '' };

    // Collect context chain from ALL machines in the factory to get full upstream context
    (factory.machines || []).forEach(machine => {
        const machineOutput = getMachineOutput(machine.id);
        mergeContextFromOutput(machineOutput, mergedValue, allSources, allContextChain, seenContextItems);
    });

    // Also collect context from standalone nodes in the factory
    (factory.nodeIds || []).forEach(nodeId => {
        const nodeData = /** @type {NodeData | undefined} */ (nodeActions.getNodeData(nodeId) ?? undefined);
        mergeContextFromOutput(nodeData?.data?.output, mergedValue, allSources, allContextChain, seenContextItems);
    });
    
    // Rebuild structured context from the complete context chain
    const fullStructuredContext = /** @type {StructuredContext} */ (
        ContextEngine.buildStructuredContext(allContextChain)
    );
    
    console.log(`🔍 getFactoryOutput: Enhanced context for ${factory.id}:`, {
        mergedFacts: mergedValue.facts?.length || 0,
        fullContextFacts: fullStructuredContext.facts?.length || 0,
        mergedHistory: mergedValue.history?.length || 0, 
        fullContextHistory: fullStructuredContext.history?.length || 0,
        contextChainLength: allContextChain.length,
        totalSources: allSources.size
    });
    
    // Return enhanced output with full context chain
    return {
        type: 'structured_context',
        value: fullStructuredContext,
        sources: Array.from(allSources),
        context_chain: allContextChain
    };
}

/**
 * Get network output data by merging outputs of its terminal factories/nodes
 * @param {NetworkContainer} network
 * @returns {NodeOutput | null}
 */
export function getNetworkOutput(network) {
    if (!network || (!network.factories && !network.nodeIds)) {
        console.warn(`🔍 getNetworkOutput: Network '${network?.id}' not found or has no factories/nodes`);
        return null;
    }
    
    /** @type {NetworkTerminalEntity[]} */
    const terminalEntities = [];
    (network.factories || []).forEach(factory => {
        if (!network.connections.some(conn => conn.fromId === factory.id)) {
            terminalEntities.push({ id: factory.id, type: 'factory' });
        }
    });
    (network.nodeIds || []).forEach(nodeId => {
        if (!network.connections.some(conn => conn.fromId === nodeId)) {
            terminalEntities.push({ id: nodeId, type: 'node' });
        }
    });

    if (terminalEntities.length === 0) {
        console.warn(`🔍 getNetworkOutput: Network '${network.id}' has no terminal entities`);
        return null;
    }

    console.log(`🔍 getNetworkOutput: Network '${network.id}' has ${terminalEntities.length} terminal entities:`, terminalEntities.map(e => `${e.id}(${e.type})`));

    /** @type {(NodeOutput | null)[]} */
    const candidateOutputs = terminalEntities.map(entity => {
        if (entity.type === 'factory') {
            const factory = get(workflowContainers).find(c => c.id === entity.id);
            return (factory && factory.isFactory) ? getFactoryOutput(/** @type {FactoryContainer} */ (factory)) : null;
        }
        if (entity.type === 'node') {
             const nodeData = nodeActions.getNodeData(entity.id);
             return nodeData ? nodeData.data.output : null;
        }
        return null;
    });

    const terminalOutputs = /** @type {NodeOutput[]} */ (candidateOutputs.filter(Boolean));

    if (terminalOutputs.length === 0) {
        console.warn(`🔍 getNetworkOutput: None of the terminal entities in network '${network.id}' have output data`);
        return null;
    }

    console.log(`🔍 getNetworkOutput: ${terminalOutputs.length}/${terminalEntities.length} terminal entities have output data`);
    
    // ENHANCEMENT: Collect full context chain from ALL entities in the network, not just terminal entities
    // This ensures that when network output is used for context propagation, it includes
    // the complete accumulated context from the entire workflow that led to this network
    /** @type {ContextChainItem[]} */
    const allContextChain = [];
    /** @type {Set<string>} */
    const seenContextItems = new Set();
    /** @type {Set<string>} */
    const allSources = new Set();
    /** @type {StructuredContext} */
    const mergedValue = { facts: [], history: [], task: '' };

    // Collect context chain from ALL factories in the network to get full upstream context
    (network.factories || []).forEach(factory => {
        const factoryOutput = getFactoryOutput(factory);
        mergeContextFromOutput(factoryOutput, mergedValue, allSources, allContextChain, seenContextItems);
    });

    // Also collect context from any standalone machines in the network
    (network.machines || []).forEach(machine => {
        const machineOutput = getMachineOutput(machine.id);
        mergeContextFromOutput(machineOutput, mergedValue, allSources, allContextChain, seenContextItems);
    });

    // Also collect context from standalone nodes in the network
    (network.nodeIds || []).forEach(nodeId => {
        const nodeData = /** @type {NodeData | undefined} */ (nodeActions.getNodeData(nodeId) ?? undefined);
        mergeContextFromOutput(nodeData?.data?.output, mergedValue, allSources, allContextChain, seenContextItems);
    });

    // Rebuild structured context from the complete context chain
    const fullStructuredContext = /** @type {StructuredContext} */ (
        ContextEngine.buildStructuredContext(allContextChain)
    );
    
    console.log(`🔍 getNetworkOutput: Enhanced context for ${network.id}:`, {
        mergedFacts: mergedValue.facts?.length || 0,
        fullContextFacts: fullStructuredContext.facts?.length || 0,
        mergedHistory: mergedValue.history?.length || 0, 
        fullContextHistory: fullStructuredContext.history?.length || 0,
        contextChainLength: allContextChain.length,
        totalSources: allSources.size
    });
    
    // Return enhanced output with full context chain
    return {
        type: 'structured_context',
        value: fullStructuredContext,
        sources: Array.from(allSources),
        context_chain: allContextChain
    };
}

