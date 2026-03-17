// @ts-nocheck
/**
 * Clipboard utilities for copy/paste operations with node configs and text
 */

import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { UniversalContainer, UniversalConnector } from './UniversalContainer.js';
import { get } from 'svelte/store';
import { containerCustomizations } from '../stores/workflows.js';

// ── .ologic ontology constants — imported from canonical source ──
// VALID_NODE_TYPES and VALID_MODES are now defined in OlogicValidator.js.
// validateOlogicSyntax is imported for local use AND re-exported for external consumers.
import { VALID_NODE_TYPES, VALID_MODES, validateOlogicSyntax } from './OlogicValidator.js';
export { VALID_NODE_TYPES, VALID_MODES, validateOlogicSyntax };

// ── YAML network group hints ──
// Imported lazily (inside the YAML loader) to avoid circular import issues.
// Used to pre-union factory/node IDs from the same YAML network declaration.

// Helper function to get current workflow containers
async function getCurrentContainers() {
    const { workflowContainers } = await import('../stores/workflows.js');
    const { get } = await import('svelte/store');
    return get(workflowContainers);
}

/**
 * Merge a patch YAML into an existing container YAML.
 * Supports roots: network, factory, machine. Merges arrays by id.
 * - Nodes: update fields present in patch; union inputs/outputs; preserve coords/content unless overridden
 * - Machines/Factories: merge children by id, add new ones
 * Returns merged YAML preserving the original root.
 */
export function mergeContainerYaml(baseYaml, patchYaml) {
    try {
        const baseObj = yamlParse(String(baseYaml || '')) || {};
        const patchObj = yamlParse(String(patchYaml || '')) || {};

        const root = detectRootKey(baseObj) || detectRootKey(patchObj);
        if (!root) throw new Error('Unknown YAML root. Expected one of: logic, canvas, network, factory, machine.');

        const merged = {};
        if (root === 'logic') {
            // New logic: format - unwrap and merge content, then re-wrap
            const baseLogic = baseObj.logic || {};
            const patchLogic = patchObj.logic || {};

            // Preserve mode and version from base (or patch if base is empty)
            const mode = baseLogic.mode || patchLogic.mode || 'knowledge';
            const version = baseLogic.version || patchLogic.version || '2.0';

            // Detect inner structure (networks, factories, machines, nodes)
            const innerMerged = {};
            if (baseLogic.networks || patchLogic.networks) {
                innerMerged.networks = mergeArrayById(baseLogic.networks, patchLogic.networks, mergeNetwork);
            } else if (baseLogic.factories || patchLogic.factories) {
                innerMerged.factories = mergeArrayById(baseLogic.factories, patchLogic.factories, mergeFactory);
            } else if (baseLogic.machines || patchLogic.machines) {
                innerMerged.machines = mergeArrayById(baseLogic.machines, patchLogic.machines, mergeMachine);
            } else if (baseLogic.nodes || patchLogic.nodes) {
                innerMerged.nodes = mergeArrayById(baseLogic.nodes, patchLogic.nodes, mergeNode);
            }

            merged.logic = { mode, version, ...innerMerged };
        } else if (root === 'canvas') {
            // Legacy canvas: format - maintain for backward compatibility
            merged.canvas = { ...(baseObj.canvas || {}), ...(patchObj.canvas || {}) };
        } else if (root === 'network') {
            merged.network = mergeNetwork(baseObj.network || {}, patchObj.network || {});
        } else if (root === 'factory') {
            merged.factory = mergeFactory(baseObj.factory || {}, patchObj.factory || {});
        } else if (root === 'machine') {
            merged.machine = mergeMachine(baseObj.machine || {}, patchObj.machine || {});
        } else if (root === 'node') {
            // For node, shallow merge with inputs/outputs union
            merged.node = mergeNode(baseObj.node || {}, patchObj.node || {});
        } else {
            throw new Error(`Unsupported root: ${root}`);
        }

        return yamlStringify(merged, { indent: 2, lineWidth: 0, minContentWidth: 0 });
    } catch (e) {
        console.error('mergeContainerYaml failed:', e);
        // Fall back to base yaml if merge fails
        return String(baseYaml || '');
    }
}

function detectRootKey(obj) {
    if (!obj || typeof obj !== 'object') return null;
    // Check for new logic: format first (canonical root)
    if (obj.logic) return 'logic';
    // Backward compatibility: check for old canvas: format
    if (obj.canvas) return 'canvas';
    // Legacy individual root keys
    if (obj.network) return 'network';
    if (obj.factory) return 'factory';
    if (obj.machine) return 'machine';
    if (obj.node) return 'node';
    return null;
}

function mergeNetwork(base = {}, patch = {}) {
    const out = { ...base };
    // color/label or other top-level props
    if (patch.color) out.color = patch.color;
    if (patch.label) out.label = patch.label;
    // factories, machines, nodes
    out.factories = mergeArrayById(base.factories, patch.factories, mergeFactory);
    out.machines = mergeArrayById(base.machines, patch.machines, mergeMachine);
    out.nodes = mergeArrayById(base.nodes, patch.nodes, mergeNode);
    return out;
}

function mergeFactory(base = {}, patch = {}) {
    const out = { ...base };
    if (patch.id) out.id = patch.id; // typically same
    if (patch.color) out.color = patch.color;
    if (patch.label) out.label = patch.label;
    out.machines = mergeArrayById(base.machines, patch.machines, mergeMachine);
    out.nodes = mergeArrayById(base.nodes, patch.nodes, mergeNode);
    return out;
}

function mergeMachine(base = {}, patch = {}) {
    const out = { ...base };
    if (patch.id) out.id = patch.id;
    // Merge nodes by id
    out.nodes = mergeArrayById(base.nodes, patch.nodes, mergeNode);
    return out;
}

function mergeNode(base = {}, patch = {}) {
    // Shallow copy then selective overrides
    const out = { ...base };
    if (patch.id) out.id = patch.id;
    if (patch.type) out.type = patch.type;
    if (patch.content !== undefined) out.content = patch.content;
    if (typeof patch.x === 'number') out.x = patch.x; else if (out.x === undefined) out.x = 0;
    if (typeof patch.y === 'number') out.y = patch.y; else if (out.y === undefined) out.y = 0;
    if (patch.model) out.model = patch.model;
    if (typeof patch.temperature === 'number') out.temperature = patch.temperature;
    // Inputs/Outputs: union unique preserving order (base first)
    out.inputs = mergeUniqueStrings(out.inputs, patch.inputs);
    out.outputs = mergeUniqueStrings(out.outputs, patch.outputs);
    return out;
}

function mergeArrayById(baseArr, patchArr, mergeItemFn) {
    const b = Array.isArray(baseArr) ? baseArr : [];
    const p = Array.isArray(patchArr) ? patchArr : [];
    if (p.length === 0) return b.slice();
    const map = new Map();
    // Seed with base
    b.forEach(item => { if (item && item.id) map.set(item.id, item); });
    // Apply patches
    p.forEach(patchItem => {
        if (patchItem && patchItem.id) {
            if (map.has(patchItem.id)) {
                const merged = mergeItemFn(map.get(patchItem.id), patchItem);
                map.set(patchItem.id, merged);
            } else {
                map.set(patchItem.id, patchItem);
            }
        }
    });
    // Preserve base order, then append new ids in patch order
    const baseIds = b.map(i => i && i.id).filter(Boolean);
    const patchIds = p.map(i => i && i.id).filter(Boolean).filter(id => !baseIds.includes(id));
    return [...baseIds.map(id => map.get(id)).filter(Boolean), ...patchIds.map(id => map.get(id)).filter(Boolean)];
}

function mergeUniqueStrings(baseList, patchList) {
    const a = Array.isArray(baseList) ? baseList.filter(x => x && x !== 'none') : [];
    const b = Array.isArray(patchList) ? patchList.filter(x => x && x !== 'none') : [];
    const set = new Set(a);
    b.forEach(v => set.add(v));
    return Array.from(set);
}

/**
 * Generate configuration YAML without copying to clipboard or mutating internal clipboard state.
 * Mirrors copyConfig but returns the config only.
 */
export async function generateConfig(entityData, entityType = null, connectionData = null, nodeDataMap = null, nodesList = null, visualContent = null) {
    if (!entityData) {
        return { success: false, error: 'No entity data provided' };
    }
    try {
        // Auto-detect entity type if not provided
        if (!entityType) {
            if (entityData.data) {
                entityType = 'node';
            } else if (entityData.isNetwork) {
                entityType = 'network';
            } else if (entityData.isFactory) {
                entityType = 'factory';
            } else if (entityData.machines) {
                entityType = 'factory';
            } else {
                entityType = 'machine';
            }
        }

        // Gather all container connections for universal resolution
        const allContainerConnections = await getAllContainerConnections(entityData, entityType);

        let config;
        switch (entityType) {
            case 'node':
                config = await copyNodeHierarchy(entityData, connectionData, visualContent, allContainerConnections);
                break;
            case 'machine':
                config = await copyMachineHierarchy(entityData, nodeDataMap, nodesList, allContainerConnections);
                break;
            case 'factory':
                config = await copyFactoryHierarchy(entityData, nodeDataMap, nodesList, allContainerConnections);
                break;
            case 'network':
                config = await copyNetworkHierarchy(entityData, nodeDataMap, nodesList, allContainerConnections);
                break;
            default:
                throw new Error(`Unknown entity type: ${entityType}`);
        }

        return { success: true, config };
    } catch (error) {
        console.error('generateConfig error:', error);
        return { success: false, error: error.message };
    }
}

// Helper function to get node coordinates
function getNodeCoordinates(nodeId, nodesList) {
    if (!nodesList) return { x: 0, y: 0 };
    const node = nodesList.find(n => n.id === nodeId);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
}

// Universal coordinate calculation system
class CoordinateCalculator {
    // Calculate the bounding box of a config
    static getBounds(config) {
        const coords = [];
        
        const extractCoords = (obj) => {
            if (obj.x !== undefined && obj.y !== undefined) {
                coords.push({ x: obj.x, y: obj.y });
            }
            
            // Handle nested structures
            if (obj.nodes) {
                obj.nodes.forEach(extractCoords);
            }
            if (obj.machines) {
                obj.machines.forEach(extractCoords);
            }
            if (obj.factories) {
                obj.factories.forEach(extractCoords);
            }
        };
        
        extractCoords(config);
        
        if (coords.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
        }
        
        const minX = Math.min(...coords.map(c => c.x));
        const minY = Math.min(...coords.map(c => c.y));
        const maxX = Math.max(...coords.map(c => c.x));
        const maxY = Math.max(...coords.map(c => c.y));
        
        return {
            minX, minY, maxX, maxY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }
    
    // Calculate smart paste coordinates
    static calculatePasteCoordinates(config, targetX = 400, targetY = 300) {
        const bounds = this.getBounds(config);
        
        // If the config has no coordinates or extreme coordinates, center at target
        if (bounds.width === 0 && bounds.height === 0) {
            return { offsetX: targetX, offsetY: targetY };
        }
        
        // Check for extreme coordinates (likely from copy/paste iterations)
        const hasExtremeCoords = bounds.minX > 10000 || bounds.minY > 10000 || 
                                bounds.maxX < -10000 || bounds.maxY < -10000;
        
        if (hasExtremeCoords) {
            console.log('⚠️ Extreme coordinates detected, centering at target');
            return { offsetX: targetX, offsetY: targetY };
        }
        
        // Calculate offset to center the config at the target point
        const offsetX = targetX - bounds.centerX;
        const offsetY = targetY - bounds.centerY;
        
        console.log('📍 Calculated paste offset:', {
            originalBounds: bounds,
            target: { x: targetX, y: targetY },
            offset: { x: offsetX, y: offsetY }
        });
        
        return { offsetX, offsetY };
    }
    
    // Get canvas center coordinates (fallback when no target specified)
    static getCanvasCenter() {
        // Try to get current canvas viewport
        try {
            // This would need to be imported from canvas store
            return { x: 400, y: 300 }; // Default center
        } catch (error) {
            return { x: 400, y: 300 }; // Safe fallback
        }
    }
}

// Helper function to create node config with coordinates
// Reworked to de-duplicate inputs and outputs to fix "stacked" connections in YAML.
function createNodeConfig(node, nodeData, nodesList, connections = [], containerContext = null) {
    const coords = node ? { x: node.x, y: node.y } : getNodeCoordinates(node?.id, nodesList);
    
    // Base node config
    const nodeConfig = {
        id: node?.id,
        type: nodeData.data.node_type,
        x: coords.x,
        y: coords.y
    };

    // Use file_path for file-based nodes; content for others
    if (nodeData.data.node_type === 'text_file_source' || nodeData.data.node_type === 'pdf_file_source' || nodeData.data.node_type === 'text_source') {
        nodeConfig.file_path = nodeData.data.filePath || "";
    } else if (nodeData.data.node_type === 'text_file_output') {
        nodeConfig.file_path = nodeData.data.metadata?.lastSavedPath || nodeData.data.metadata?.autoSavePath || "";
    } else {
        nodeConfig.content = nodeData.data.content || "";
        // Include optional overrides for AI nodes
        if (nodeData.data.node_type === 'ai') {
            const proc = nodeData.data.processing || {};
            if (proc.model_override) nodeConfig.model = proc.model_override;
            const temp = proc.parameters?.temperature;
            if (typeof temp === 'number' && temp !== 0.7) nodeConfig.temperature = temp;
        }
    }

    // Add context/inputs for non-source nodes only
    const isFileSource = nodeData.data.node_type === 'text_file_source' || nodeData.data.node_type === 'pdf_file_source' || (nodeData.data.metadata && nodeData.data.metadata.meta_type === 'file_source');
    if (!isFileSource) {
        // PRIORITIZE CONNECTIONS OVER nodeData for cross-hierarchy connections
        const incomingConnections = connections.filter(conn => conn.toId === node?.id);
        const uniqueIncomingIds = [...new Set(incomingConnections.map(conn => conn.fromId))];

        if (uniqueIncomingIds.length > 0) {
            nodeConfig.inputs = uniqueIncomingIds;
        } else if (nodeData.data.inputs && nodeData.data.inputs.length > 0) {
            const uniqueSourceIds = [...new Set(nodeData.data.inputs.map(input => input.source_id))];
            if (uniqueSourceIds.length > 0) {
                nodeConfig.inputs = uniqueSourceIds;
            }
        }
        // No need for "none" - missing inputs array means no inputs
    }

    // De-duplicate and add outputs
    const outgoingConnections = connections.filter(conn => conn.fromId === node?.id);
    if (outgoingConnections.length > 0) {
        const uniqueOutgoingIds = [...new Set(outgoingConnections.map(conn => conn.toId))];
        if (uniqueOutgoingIds.length > 0) {
            nodeConfig.outputs = uniqueOutgoingIds;
        }
    }
    
    return nodeConfig;
}

// REPLACE THE OLD FUNCTIONS WITH THIS ENTIRE BLOCK

// Generic connection function - object agnostic
async function createConnection(fromId, toId, connectionSet, createdConnections) {
    if (!fromId || !toId) return false;
    
    const key = `${fromId}->${toId}`;
    if (connectionSet.has(key)) return false; // Already exists
    
    const { connectionActions } = await import('../stores/nodes.js');
    connectionActions.add(fromId, toId, 'output', 'input');
    createdConnections.push({ fromId, toId });
    connectionSet.add(key);
    return true;
}

// Helper functions to create nodes/containers from configs
// === LEGACY HELPER FUNCTIONS REMOVED ===
// The following functions have been removed as they're no longer needed:
// - createNodeFromConfig
// - createMachineFromConfig  
// - createFactoryFromConfig
// - createNetworkFromConfig
// These have been replaced by the universal paste system using UniversalContainer

// Legacy helper functions have been completely removed:
// - createNodeFromConfig (replaced by UniversalContainer node creation)
// - createMachineFromConfig (replaced by UniversalContainer machine creation)
// - createFactoryFromConfig (replaced by UniversalContainer factory creation) 
// - createNetworkFromConfig (replaced by UniversalContainer network creation)
// These functions are no longer needed as the universal paste system handles all entity types.

// Internal clipboard for configs (fallback when system clipboard fails)
let internalClipboard = {
    type: null,
    data: null,
    timestamp: null
};

/**
 * Copy text to system clipboard
 */
export async function copyText(text) {
    try {
        // Browser mode: use native Clipboard API
        
        // Fallback to browser clipboard API
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return { success: true, method: 'browser' };
        } else {
            // Final fallback for non-secure contexts
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const success = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            return { success, method: 'execCommand' };
        }
    } catch (error) {
        console.error('Failed to copy text:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Read text from system clipboard
 */
export async function readText() {
    try {
        // Browser mode: use native Clipboard API
        
        // Fallback to browser clipboard API
        if (navigator.clipboard && window.isSecureContext) {
            const text = await navigator.clipboard.readText();
            return { success: true, text, method: 'browser' };
        } else {
            // Can't read from clipboard in non-secure contexts without Wails
            return { success: false, error: 'Clipboard read not available in non-secure context' };
        }
    } catch (error) {
        console.error('Failed to read clipboard:', error);
        return { success: false, error: error.message };
    }
}


/**
 * Copy node metadata (full technical details)
 */
export async function copyNodeMetadata(nodeData) {
    if (!nodeData) {
        return { success: false, error: 'No node data provided' };
    }
    
    try {
        // Use clean YAML without verbose history for metadata
        const yamlConfig = nodeData.toCleanYAML();
        console.log('Copying metadata to clipboard:', yamlConfig);
        
        // Copy the raw YAML to system clipboard
        const result = await copyText(yamlConfig);
        
        // Store structured data in internal clipboard for paste operations
        const configData = {
            type: 'node_metadata',
            version: '1.0',
            timestamp: new Date().toISOString(),
            config: yamlConfig,
            nodeType: nodeData.data.node_type,
            nodeId: nodeData.data.id
        };
        
        internalClipboard = {
            type: 'node_metadata',
            data: configData,
            timestamp: Date.now()
        };
        
        return { 
            success: result.success, 
            method: result.method,
            yamlConfig,
            internal: true
        };
    } catch (error) {
        console.error('Failed to copy node metadata:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Copy node configuration (concise format)
 * @param {NodeData} nodeData - Node data to copy
 * @param {array} connections - Connection data for outputs (optional)
 * @param {string} visualContent - Visual content from the node (optional)
 * @returns {Promise<{success: boolean, config?: string, error?: string}>}
 */
// Universal copy function - handles any entity type (node, machine, factory, network)
export async function copyConfig(entityData, entityType = null, connectionData = null, nodeDataMap = null, nodesList = null, visualContent = null) {
    if (!entityData) {
        return { success: false, error: 'No entity data provided' };
    }
    
    try {
        // Auto-detect entity type if not provided
        if (!entityType) {
            if (entityData.data) {
                entityType = 'node';
            } else if (entityData.isNetwork) {
                entityType = 'network';
            } else if (entityData.isFactory) {
                entityType = 'factory';
            } else if (entityData.machines) {
                entityType = 'factory';
            } else {
                entityType = 'machine';
            }
        }
        
        // Gather all container connections for universal resolution
        const allContainerConnections = await getAllContainerConnections(entityData, entityType);
        
        let config;
        let internalType;
        
        switch (entityType) {
            case 'node':
                config = await copyNodeHierarchy(entityData, connectionData, visualContent, allContainerConnections);
                internalType = 'node_config';
                break;
            case 'machine':
                config = await copyMachineHierarchy(entityData, nodeDataMap, nodesList, allContainerConnections);
                internalType = 'machine_config';
                break;
            case 'factory':
                config = await copyFactoryHierarchy(entityData, nodeDataMap, nodesList, allContainerConnections);
                internalType = 'factory_config';
                break;
            case 'network':
                config = await copyNetworkHierarchy(entityData, nodeDataMap, nodesList, allContainerConnections);
                internalType = 'network_config';
                break;
            default:
                throw new Error(`Unknown entity type: ${entityType}`);
        }
        
        console.log(`📋 Universal copy (${entityType}):`, config);
        
        // Copy the YAML to system clipboard
        const result = await copyText(config);
        
        // Store structured data in internal clipboard for paste operations
        const configData = {
            type: internalType,
            version: '1.0',
            timestamp: new Date().toISOString(),
            config: config,
            entityType: entityType
        };
        
        internalClipboard = {
            type: internalType,
            data: configData,
            timestamp: Date.now()
        };
        
        return { 
            success: result.success, 
            method: result.method,
            config,
            internal: true
        };
    } catch (error) {
        console.error('Universal copy error:', error);
        return { success: false, error: error.message };
    }
}

// Helper function to gather all container connections for universal resolution
async function getAllContainerConnections(entityData, entityType) {
    try {
        // Import workflow containers to access all connection data
        const { workflowContainers } = await import('../stores/workflows.js');
        const { get } = await import('svelte/store');
        
        const containers = get(workflowContainers);
        const allConnections = [];
        
        // Collect connections from all container levels
        for (const container of containers) {
            if (container.connections) {
                for (const connection of container.connections) {
                    allConnections.push({
                        ...connection,
                        containerLevel: container.isNetwork ? 'network' : container.isFactory ? 'factory' : 'machine',
                        containerId: container.id
                    });
                }
            }
        }
        
        const DEBUG_CLIPBOARD_CONNECTIONS = false;
        if (DEBUG_CLIPBOARD_CONNECTIONS) {
            console.log(`🔗 Gathered ${allConnections.length} container connections for ${entityType} copy`);
        }
        return allConnections;
    } catch (error) {
        console.warn('Could not gather container connections:', error);
        return [];
    }
}

// Universal Connection Resolution System
class UniversalConnectionResolver {
    static getAllRelevantConnections(entityId, entityType, allContainers) {
        const relevantConnections = [];
        
        // Find all containers in the hierarchy
        const allContainersList = this.flattenAllContainers(allContainers);
        
        // Collect connections from all levels that could affect this entity
        for (const container of allContainersList) {
            if (!container.connections) continue;
            
            for (const connection of container.connections) {
                if (this.connectionAffectsEntity(connection, entityId, entityType, allContainersList)) {
                    relevantConnections.push({
                        ...connection,
                        sourceLevel: container.type,
                        resolved: this.resolveConnectionEndpoints(connection, allContainersList)
                    });
                }
            }
        }
        
        return relevantConnections;
    }
    
    static connectionAffectsEntity(connection, entityId, entityType, allContainers) {
        // Direct match
        if (connection.fromId === entityId || connection.toId === entityId) {
            return true;
        }
        
        // Check if entity is contained within connected containers
        const sourceContainer = this.findContainerById(connection.fromId, allContainers);
        const targetContainer = this.findContainerById(connection.toId, allContainers);
        
        if (sourceContainer && this.containerContainsEntity(sourceContainer, entityId)) {
            return true;
        }
        
        if (targetContainer && this.containerContainsEntity(targetContainer, entityId)) {
            return true;
        }
        
        return false;
    }
    
    static resolveConnectionEndpoints(connection, allContainers) {
        const sourceContainer = this.findContainerById(connection.fromId, allContainers);
        const targetContainer = this.findContainerById(connection.toId, allContainers);
        
        if (!sourceContainer || !targetContainer) {
            return { sourceId: connection.fromId, targetId: connection.toId };
        }
        
        const sourceConnector = sourceContainer.getOutputConnector();
        const targetConnector = targetContainer.getInputConnector();
        
        return {
            sourceId: sourceConnector,
            targetId: targetConnector,
            sourceContainer: sourceContainer.id,
            targetContainer: targetContainer.id
        };
    }
    
    static flattenAllContainers(allContainers) {
        const flattened = [];
        
        const flatten = (containers) => {
            for (const container of containers) {
                flattened.push(container);
                if (container.children && container.children.length > 0) {
                    flatten(container.children);
                }
                if (container.machines) {
                    flatten(container.machines);
                }
                if (container.factories) {
                    flatten(container.factories);
                }
            }
        };
        
        flatten(allContainers);
        return flattened;
    }
    
    static findContainerById(id, allContainers) {
        for (const container of allContainers) {
            if (container.id === id) {
                return container;
            }
            
            // Search recursively
            const found = this.findContainerInHierarchy(container, id);
            if (found) return found;
        }
        return null;
    }
    
    static findContainerInHierarchy(container, id) {
        if (container.id === id) {
            return container;
        }
        
        if (container.children) {
            for (const child of container.children) {
                const found = this.findContainerInHierarchy(child, id);
                if (found) return found;
            }
        }
        
        return null;
    }
    
    static containerContainsEntity(container, entityId) {
        if (container.id === entityId) {
            return true;
        }
        
        if (container.children) {
            for (const child of container.children) {
                if (this.containerContainsEntity(child, entityId)) {
                    return true;
                }
            }
        }
        
        return false;
    }
}

// Single source of truth for machine configuration generation
function createMachineConfigObject(machineContainer, nodeDataMap, nodesList, allContainerConnections) {
    // Get custom properties for this machine
    const customizations = get(containerCustomizations);
    const customization = customizations.get(machineContainer.id) || {};
    
    // Create an array of node configuration OBJECTS
    const nodes = (machineContainer.nodes || []).map((node, index) => {
        const nodeData = nodeDataMap.get(node.id);
        if (!nodeData) return null;

        // Use the complete connection list to create the base config
        let nodeConfig = createNodeConfig(node, nodeData, nodesList, allContainerConnections);

        // **CRUCIAL LOGIC FOR MACHINE ENTRY POINT**
        // If this is the first node and it has no direct inputs...
        if (index === 0 && (!nodeConfig.inputs || nodeConfig.inputs.length === 0)) {
            // ...check for an incoming connection to this machine's container ID.
            const incomingConnectionToContainer = allContainerConnections.find(conn => conn.toId === machineContainer.id);
            if (incomingConnectionToContainer) {
                // If found, add this as an input for the entry node.
                nodeConfig.inputs = nodeConfig.inputs || [];
                nodeConfig.inputs.push(incomingConnectionToContainer.fromId);
                console.log(`🔗 Machine entry input resolved: ${machineContainer.id} <- ${incomingConnectionToContainer.fromId}`);
            }
        }
        
        return nodeConfig;
    }).filter(Boolean);

    // Return the JavaScript object for the machine
    const machineConfig = {
        id: machineContainer.id,
        nodes: nodes
    };
    
    // Add custom properties if they exist
    if (customization.customColor) {
        machineConfig.color = customization.customColor;
    }
    if (customization.customLabel) {
        machineConfig.label = customization.customLabel;
    }
    
    return machineConfig;
}

// Hierarchical copy functions
async function copyNodeHierarchy(nodeData, connections = [], visualContent = null, allContainerConnections = []) {
    // For file-based nodes, ignore visualContent to prevent content fields
    const nt = nodeData?.data?.node_type;
    const nodeId = nodeData?.data?.id;
    const vc = (nt === 'text_file_output' || nt === 'text_file_source' || nt === 'text_source') ? null : visualContent;

    // Special handling: ensure we pull the freshest file path from the store for file nodes
    if (nt === 'text_file_output') {
        const { get } = await import('svelte/store');
        const { nodeDataStore } = await import('../stores/nodes.js');
        const latest = get(nodeDataStore).get(nodeId);
        const path = latest?.data?.metadata?.lastSavedPath || latest?.data?.metadata?.autoSavePath || latest?.data?.filePath || '';
        const obj = { node: { id: nodeId, type: nt, file_path: path } };
        // Optional fields from processing
        const proc = latest?.data?.processing || {};
        if (proc.user_instructions) obj.node.instructions = proc.user_instructions;
        const maxu = proc.user_max_tokens;
        if (maxu) obj.node.max_tokens = maxu;
        if (proc.model_override) obj.node.model = proc.model_override;
        const temp = proc.parameters?.temperature;
        if (typeof temp === 'number' && temp !== 0.3) obj.node.temperature = temp;
        // Add outputs if any connections provided
        if (connections && connections.length > 0) {
            const outgoingConnections = connections.filter(conn => conn.fromId === nodeId);
            if (outgoingConnections.length > 0) {
                obj.node.outputs = outgoingConnections.map(conn => conn.toId);
            }
        }
        return yamlStringify(obj, { indent: 2, lineWidth: 0, minContentWidth: 0 });
    }

    if (nt === 'text_file_source' || nt === 'text_source') {
        const { get } = await import('svelte/store');
        const { nodeDataStore } = await import('../stores/nodes.js');
        const latest = get(nodeDataStore).get(nodeId);
        const path = latest?.data?.filePath || '';
        const obj = { node: { id: nodeId, type: nt, file_path: path } };
        return yamlStringify(obj, { indent: 2, lineWidth: 0, minContentWidth: 0 });
    }

    // Get clean config without execution state for other nodes
    let config = nodeData.toConfig(vc);
    
    // Add outputs from connections
    const outgoingConnections = connections.filter(conn => conn.fromId === nodeId);
    
    if (outgoingConnections.length > 0) {
        const configData = yamlParse(config);
        configData.node.outputs = outgoingConnections.map(conn => conn.toId);
        config = yamlStringify(configData, { 
            indent: 2,
            lineWidth: 0,
            minContentWidth: 0
        });
    }
    
    return config;
}

async function copyMachineHierarchy(container, nodeDataMap, nodesList = null, allContainerConnections = []) {
    // 1. Get the machine config object from our new, single source of truth.
    const machineConfigObject = createMachineConfigObject(container, nodeDataMap, nodesList, allContainerConnections);

    // 2. Wrap it in the top-level "machine:" key for the final YAML.
    const finalConfig = {
        machine: machineConfigObject
    };

    // 3. Stringify to YAML.
    return yamlStringify(finalConfig, { 
        indent: 2,
        lineWidth: 0,
        minContentWidth: 0
    });
}

async function copyFactoryHierarchy(container, nodeDataMap, nodesList = null, allContainerConnections = []) {
    // Get custom properties for this factory
    const customizations = get(containerCustomizations);
    const customization = customizations.get(container.id) || {};
    
    // Get machines with their nested nodes
    const machines = (container.machines || []).map(machine => {
        // Use the new helper function to ensure consistent logic
        return createMachineConfigObject(machine, nodeDataMap, nodesList, allContainerConnections);
    });
    
    // Add standalone nodes in the factory (not in machines)
    const standaloneNodes = (container.nodeIds || [])
        .filter(nodeId => {
            const isInMachine = container.machines && container.machines.some(machine => 
                machine.nodes && machine.nodes.some(node => node.id === nodeId)
            );
            return !isInMachine;
        })
        .map(nodeId => {
            const nodeData = nodeDataMap.get(nodeId);
            const node = nodesList ? nodesList.find(n => n.id === nodeId) : null;
            if (!nodeData || !node) return null;
            return createNodeConfig(node, nodeData, nodesList, allContainerConnections);
        })
        .filter(Boolean);
    
    const factoryConfig = {
        factory: {
            id: container.id,
            machines,
            ...(standaloneNodes.length > 0 && { nodes: standaloneNodes })
        }
    };
    
    // Add custom properties if they exist
    if (customization.customColor) {
        factoryConfig.factory.color = customization.customColor;
    }
    if (customization.customLabel) {
        factoryConfig.factory.label = customization.customLabel;
    }
    
    return yamlStringify(factoryConfig, { 
        indent: 2,
        lineWidth: 0,
        minContentWidth: 0
    });
}

async function copyNetworkHierarchy(container, nodeDataMap, nodesList = null, allContainerConnections = []) {
    // Get custom properties for this network
    const customizations = get(containerCustomizations);
    const networkCustomization = customizations.get(container.id) || {};
    
    // Get factories
    const factories = (container.factories || []).map(factory => {
        // Get custom properties for this factory
        const factoryCustomization = customizations.get(factory.id) || {};
        
        // Each factory has machines with nodes
        const machines = (factory.machines || []).map(machine => {
            // Use the new helper function for machines inside factories
            return createMachineConfigObject(machine, nodeDataMap, nodesList, allContainerConnections);
        });
        
        // Get standalone nodes in the factory (not in machines)
        const factoryStandaloneNodes = (factory.nodeIds || [])
            .filter(nodeId => {
                const isInMachine = factory.machines && factory.machines.some(machine => 
                    machine.nodes && machine.nodes.some(node => node.id === nodeId)
                );
                return !isInMachine;
            })
            .map(nodeId => {
                const nodeData = nodeDataMap.get(nodeId);
                const node = nodesList ? nodesList.find(n => n.id === nodeId) : null;
                if (!nodeData || !node) return null;
                return createNodeConfig(node, nodeData, nodesList, allContainerConnections);
            })
            .filter(Boolean);
        
        const factoryConfig = { 
            id: factory.id, 
            machines,
            ...(factoryStandaloneNodes.length > 0 && { nodes: factoryStandaloneNodes })
        };
        
        // Add factory custom properties if they exist
        if (factoryCustomization.customColor) {
            factoryConfig.color = factoryCustomization.customColor;
        }
        if (factoryCustomization.customLabel) {
            factoryConfig.label = factoryCustomization.customLabel;
        }
        
        return factoryConfig;
    });
    
    // Get standalone machines (not in factories)
    const standaloneMachines = (container.machines || [])
        .filter(machine => {
            const isInFactory = container.factories && container.factories.some(factory => 
                factory.machines && factory.machines.some(m => m.id === machine.id)
            );
            return !isInFactory;
        })
        .map(machine => {
            // Use the new helper function for standalone machines in the network
            return createMachineConfigObject(machine, nodeDataMap, nodesList, allContainerConnections);
        });
    
    // Get standalone nodes (not in machines or factories)
    const standaloneNodes = (container.nodeIds || [])
        .filter(nodeId => {
            const isInMachine = (container.machines || []).some(machine => 
                machine.nodes && machine.nodes.some(node => node.id === nodeId)
            );
            const isInFactory = (container.factories || []).some(factory =>
                factory.machines && factory.machines.some(machine =>
                    machine.nodes && machine.nodes.some(node => node.id === nodeId)
                )
            );
            return !isInMachine && !isInFactory;
        })
        .map(nodeId => {
            const nodeData = nodeDataMap.get(nodeId);
            const node = nodesList ? nodesList.find(n => n.id === nodeId) : null;
            if (!nodeData || !node) return null;
            return createNodeConfig(node, nodeData, nodesList, allContainerConnections);
        })
        .filter(Boolean);
    
    const networkConfig = {
        network: {
            id: container.id,
            ...(factories.length > 0 && { factories }),
            ...(standaloneMachines.length > 0 && { machines: standaloneMachines }),
            ...(standaloneNodes.length > 0 && { nodes: standaloneNodes })
        }
    };
    
    // Add network custom properties if they exist
    if (networkCustomization.customColor) {
        networkConfig.network.color = networkCustomization.customColor;
    }
    if (networkCustomization.customLabel) {
        networkConfig.network.label = networkCustomization.customLabel;
    }
    
    return yamlStringify(networkConfig, { 
        indent: 2,
        lineWidth: 0,
        minContentWidth: 0
    });
}

/**
 * Generate complete canvas configuration as YAML
 * This creates the definitive structure that can be saved and loaded
 */
export async function generateCanvasConfig() {
    try {
        console.log('📋 Generating complete canvas configuration');

        // Import required stores and functions
        const { get } = await import('svelte/store');
        const { workflowContainers } = await import('../stores/workflows.js');
        const { nodes, connections, nodeDataStore } = await import('../stores/nodes.js');
        const { appMode } = await import('../stores/mode.js');
        
        const allContainers = get(workflowContainers);
        const allNodes = get(nodes);
        const allConnections = get(connections);
        const currentNodeDataStore = get(nodeDataStore);
        const currentMode = get(appMode);
        
        console.log('📊 Canvas state:', {
            containers: allContainers.length,
            nodes: allNodes.length,
            connections: allConnections.length
        });
        
        // Find all networks
        const networks = allContainers.filter(c => c.isNetwork);
        
        if (networks.length === 0) {
            // No networks - check for factories and create a single network
            const factories = allContainers.filter(c => c.isFactory);
            if (factories.length === 0) {
                // No structured workflow - just individual nodes or machines
                // Create a simple network with all machines/nodes
                const machines = allContainers.filter(c => !c.isFactory && !c.isNetwork);
                
                if (machines.length === 0 && allNodes.length > 0) {
                    // Individual nodes only - create a simple structure
                    console.log('📝 Creating simple node-only configuration');
                    const nodesConfig = [];
                    
                    for (const node of allNodes) {
                        const nodeData = currentNodeDataStore.get(node.id);
                        if (nodeData) {
                            const inputs = allConnections
                                .filter(c => c.toId === node.id)
                                .map(c => c.fromId);
                            const outputs = allConnections
                                .filter(c => c.fromId === node.id)
                                .map(c => c.toId);
                            
                            const baseNode = {
                                id: node.id,
                                type: node.type,
                                x: node.x,
                                y: node.y,
                                ...(inputs.length > 0 && { inputs }),
                                ...(outputs.length > 0 && { outputs })
                            };
                            if (node.type === 'text_file_output') {
                                nodesConfig.push({
                                    ...baseNode,
                                    file_path: nodeData.data.metadata?.lastSavedPath || nodeData.data.metadata?.autoSavePath || ''
                                });
                            } else if (node.type === 'text_file_source' || node.type === 'pdf_file_source' || node.type === 'text_source') {
                                nodesConfig.push({
                                    ...baseNode,
                                    file_path: nodeData.data.filePath || ''
                                });
                            } else {
                                nodesConfig.push({
                                    ...baseNode,
                                    content: nodeData.data.content
                                });
                            }
                        }
                    }
                    
                    return {
                        success: true,
                        config: yamlStringify({
                            logic: {
                                mode: currentMode || 'knowledge',
                                version: "2.0",
                                networks: [{
                                    id: 'network-1',
                                    nodes: nodesConfig
                                }]
                            }
                        })
                    };
                }
                
                // Create a network from existing machines using concise machine configs
                const machineConfigObjects = [];
                for (const m of machines) {
                    const obj = createMachineConfigObject(m, currentNodeDataStore, allNodes, allConnections);
                    machineConfigObjects.push(obj);
                }
                return {
                    success: true,
                    config: yamlStringify({
                        logic: {
                            mode: currentMode || 'knowledge',
                            version: "2.0",
                            networks: [{
                                id: 'network-1',
                                machines: machineConfigObjects
                            }]
                        }
                    })
                };
            }
            
            // Create network from factories using copyConfig and wrap in logic format
            const result = await copyConfig(factories[0], 'network', allConnections, currentNodeDataStore, allNodes);
            if (result.success) {
                // Parse the single network and wrap it in logic format
                const singleNetworkYaml = yamlParse(result.config);
                return {
                    success: true,
                    config: yamlStringify({
                        logic: {
                            mode: currentMode || 'knowledge',
                            version: "2.0",
                            networks: [singleNetworkYaml.network]
                        }
                    })
                };
            }
            return result;
        }
        
        // Multiple networks found - save all of them
        console.log(`🌐 Found ${networks.length} networks:`, networks.map(n => n.id));
        
        const networksConfig = [];
        
        for (const network of networks) {
            console.log(`📋 Processing network: ${network.id}`);
            const result = await copyConfig(network, 'network', allConnections, currentNodeDataStore, allNodes);
            if (result.success) {
                // Parse the network YAML and extract the network object
                const networkYaml = yamlParse(result.config);
                networksConfig.push(networkYaml.network);
            } else {
                console.error(`❌ Failed to process network ${network.id}:`, result.error);
                return { success: false, error: `Failed to process network ${network.id}: ${result.error}` };
            }
        }
        
        return {
            success: true,
            config: yamlStringify({
                logic: {
                    mode: currentMode || 'knowledge',
                    version: "2.0",
                    networks: networksConfig
                }
            })
        };
        
    } catch (error) {
        console.error('❌ Failed to generate canvas config:', error);
        return { success: false, error: error.message };
    }
}

// Legacy wrapper for backwards compatibility
export async function copyNodeConfig(nodeData, connections = [], visualContent = null) {
    return copyConfig(nodeData, 'node', connections, null, null, visualContent);
}

// Legacy wrapper for backwards compatibility  
export async function copyMachineConfig(container, nodeDataMap, nodesList = null) {
    return copyConfig(container, 'machine', null, nodeDataMap, nodesList);
}
// Legacy wrapper for backwards compatibility  
export async function copyNetworkConfig(container, nodeDataMap, nodesList = null) {
    return copyConfig(container, 'network', null, nodeDataMap, nodesList);
}

/**
 * Copy machine metadata (full technical details)
 */
export async function copyMachineMetadata(container, nodeDataMap) {
    if (!container || !nodeDataMap) {
        return { success: false, error: 'No container or node data provided' };
    }
    
    try {
        let allNodes = [];
        let configType = 'machine_metadata';
        
        if (container.isFactory) {
            configType = 'factory_metadata';
            if (container.machines) {
                container.machines.forEach(machine => {
                    if (machine.nodes) {
                        allNodes.push(...machine.nodes);
                    }
                });
            }
        } else {
            allNodes = container.nodes || [];
        }
        
        // Create clean node configs (without verbose history)
        const nodeConfigs = allNodes.map(node => {
            const nodeData = nodeDataMap.get(node.id);
            if (!nodeData) return null;
            
            // Create clean version without verbose history
            const cleanData = {
                node_type: nodeData.data.node_type,
                id: nodeData.data.id,
                content: nodeData.data.content,
                metadata: {
                    title: nodeData.data.metadata.title,
                    created_at: nodeData.data.metadata.created_at,
                    version: nodeData.data.metadata.version
                },
                inputs: nodeData.data.inputs,
                processing: nodeData.data.processing,
                output: nodeData.data.output,
                execution: nodeData.data.execution
            };
            
            return cleanData;
        }).filter(Boolean);
        
        // Create metadata config
        const config = {
            type: configType,
            version: '1.0',
            timestamp: new Date().toISOString(),
            [container.isFactory ? 'factory' : 'machine']: {
                id: container.id,
                nodeCount: allNodes.length,
                isWorkflow: container.isWorkflow,
                isFactory: container.isFactory,
                bounds: container.bounds
            },
            nodes: nodeConfigs,
            connections: container.connections || [],
            metadata: {
                total_nodes: nodeConfigs.length,
                node_types: [...new Set(nodeConfigs.map(n => n.node_type))]
            }
        };
        
        const configYaml = yamlStringify(config, { 
            indent: 2,
            lineWidth: 0,
            minContentWidth: 0
        });
        
        const result = await copyText(configYaml);
        
        internalClipboard = {
            type: configType,
            data: config,
            timestamp: Date.now()
        };
        
        return { 
            success: true, 
            method: result.method,
            config,
            configYaml,
            internal: true
        };
    } catch (error) {
        console.error('Failed to copy machine metadata:', error);
        return { success: false, error: error.message };
    }
}



/**
 * Copy network metadata (full technical details)
 */
export async function copyNetworkMetadata(container, nodeDataMap) {
    if (!container || !nodeDataMap) {
        return { success: false, error: 'No container or node data provided' };
    }

    try {
        // Detailed factory analysis
        const allFactories = container.factories || [];
        const factoryConfigs = allFactories.map(factory => {
            const machineConfigs = (factory.machines || []).map(machine => {
                return {
                    id: machine.id,
                    nodeCount: (machine.nodes || []).length,
                    nodeTypes: [...new Set((machine.nodes || []).map(node => {
                        const nodeData = nodeDataMap.get(node.id);
                        return nodeData ? nodeData.data.node_type : 'unknown';
                    }))],
                    bounds: machine.bounds
                };
            });
            
            const factoryStandaloneNodes = (factory.nodeIds || []).filter(nodeId => {
                const isInMachine = factory.machines && factory.machines.some(machine => 
                    machine.nodes && machine.nodes.some(node => node.id === nodeId)
                );
                return !isInMachine;
            });
            
            return {
                id: factory.id,
                machineCount: machineConfigs.length,
                standaloneNodeCount: factoryStandaloneNodes.length,
                totalNodeCount: (factory.nodeIds || []).length,
                machines: machineConfigs,
                standaloneNodes: factoryStandaloneNodes.map(nodeId => {
                    const nodeData = nodeDataMap.get(nodeId);
                    return nodeData ? {
                        id: nodeId,
                        type: nodeData.data.node_type,
                        title: nodeData.data.metadata.title,
                        version: nodeData.data.metadata.version
                    } : { id: nodeId, type: 'unknown' };
                }),
                bounds: factory.bounds
            };
        });

        // Network-level machines (from factory-to-machine connections)
        const networkMachines = (container.machines || []).map(machine => {
            return {
                id: machine.id,
                nodeCount: (machine.nodes || []).length,
                nodeTypes: [...new Set((machine.nodes || []).map(node => {
                    const nodeData = nodeDataMap.get(node.id);
                    return nodeData ? nodeData.data.node_type : 'unknown';
                }))],
                nodes: (machine.nodes || []).map(node => {
                    const nodeData = nodeDataMap.get(node.id);
                    return nodeData ? {
                        id: node.id,
                        type: nodeData.data.node_type,
                        title: nodeData.data.metadata.title,
                        version: nodeData.data.metadata.version
                    } : { id: node.id, type: 'unknown' };
                }),
                bounds: machine.bounds
            };
        });

        // Network-level standalone nodes
        const networkStandaloneNodes = (container.nodeIds || [])
            .filter(nodeId => {
                const isInFactory = container.factories && container.factories.some(factory => 
                    factory.nodeIds && factory.nodeIds.includes(nodeId)
                );
                const isInNetworkMachine = container.machines && container.machines.some(machine =>
                    machine.nodes && machine.nodes.some(node => node.id === nodeId)
                );
                return !isInFactory && !isInNetworkMachine;
            })
            .map(nodeId => {
                const nodeData = nodeDataMap.get(nodeId);
                return nodeData ? {
                    id: nodeId,
                    type: nodeData.data.node_type,
                    title: nodeData.data.metadata.title,
                    content: nodeData.data.content,
                    version: nodeData.data.metadata.version,
                    inputs: (nodeData.data.inputs || []).map(input => ({
                        sourceId: input.source_id,
                        weight: input.weight
                    })),
                    execution: nodeData.data.execution
                } : { id: nodeId, type: 'unknown' };
            });

        // Calculate total statistics
        const allNodeIds = new Set();
        allFactories.forEach(factory => {
            (factory.nodeIds || []).forEach(nodeId => allNodeIds.add(nodeId));
        });
        networkMachines.forEach(machine => {
            (machine.nodes || []).forEach(node => allNodeIds.add(node.id));
        });
        (container.nodeIds || []).forEach(nodeId => allNodeIds.add(nodeId));

        const config = {
            type: 'network_metadata',
            version: '1.0',
            timestamp: new Date().toISOString(),
            network: { 
                id: container.id, 
                factoryCount: allFactories.length,
                machineCount: networkMachines.length,
                standaloneNodeCount: networkStandaloneNodes.length,
                totalNodeCount: allNodeIds.size,
                bounds: container.bounds
            },
            factories: factoryConfigs,
            machines: networkMachines,
            networkStandaloneNodes: networkStandaloneNodes,
            connections: container.connections || [],
            metadata: {
                total_factories: allFactories.length,
                total_machines: allFactories.reduce((sum, f) => sum + (f.machines || []).length, 0) + networkMachines.length,
                total_nodes: allNodeIds.size,
                connection_count: (container.connections || []).length,
                hierarchy_depth: 3, // Network -> Factory -> Machine -> Node
                container_types: ['network', 'factory', 'machine'],
                analysis: {
                    factories_with_machines: allFactories.filter(f => (f.machines || []).length > 0).length,
                    factories_with_standalone_nodes: allFactories.filter(f => {
                        const standaloneCount = (f.nodeIds || []).filter(nodeId => {
                            const isInMachine = f.machines && f.machines.some(machine => 
                                machine.nodes && machine.nodes.some(node => node.id === nodeId)
                            );
                            return !isInMachine;
                        }).length;
                        return standaloneCount > 0;
                    }).length,
                    network_level_machines: networkMachines.length,
                    network_standalone_nodes: networkStandaloneNodes.length
                }
            }
        };
        
        const configYaml = yamlStringify(config, { indent: 2, lineWidth: 0 });
        const result = await copyText(configYaml);

        return { success: true, method: result.method, config, configYaml };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Universal paste and create function using the new container system
 */
export async function pasteAndCreateConfigUniversal(targetX = null, targetY = null, templateConfig = null) {
    try {
        // Set loading mode to prevent auto-execution during initialization
        window.ordinalLoadingMode = true;
        console.log('🔍 Starting universal paste operation with target:', { targetX, targetY });

        // Track the active canvas mode for this paste operation.
        // Captured here (function scope) so createNodesRecursive can access it even
        // after execution leaves the `if (config.parsedYaml.logic)` block.
        let pasteMode = null;
        
        let config;
        if (templateConfig) {
            // Use provided template config - parse YAML if it's a string
            let parsedYaml;
            if (typeof templateConfig === 'string') {
                try {
                    parsedYaml = yamlParse(templateConfig);
                    console.log('📋 Using template config (parsed from string):', templateConfig);
                } catch (error) {
                    console.error('❌ Failed to parse template YAML:', error);
                    return { success: false, error: `Failed to parse YAML: ${error.message}` };
                }
            } else {
                parsedYaml = templateConfig;
                console.log('📋 Using template config (already parsed):', templateConfig);
            }
            config = { parsedYaml };
        } else {
            // Use clipboard config
            const pasteResult = await pasteConfig();
            console.log('📋 Paste result:', pasteResult);
            
            if (!pasteResult.success) {
                console.warn('❌ No valid config in clipboard');
                return { success: false, error: 'No valid config in clipboard' };
            }
            config = pasteResult.data;
        }
        
        // Import required functions
        const { get } = await import('svelte/store');
        const { workflowContainers } = await import('../stores/workflows.js');
        
        if (!config.parsedYaml) {
            return { success: false, error: 'No parsed YAML config found' };
        }

        // ── .ologic syntax validation ──
        const ologicErrors = validateOlogicSyntax(config.parsedYaml);
        if (ologicErrors.length > 0) {
            const msg = `Invalid .ologic syntax:\n${ologicErrors.map(e => `  • ${e}`).join('\n')}`;
            console.error(`❌ ${msg}`);
            return { success: false, error: msg };
        }

        // Set mode from top-level `mode:` key (flat format YAML) before branching
        // This ensures isDiagrammingMode etc. are set regardless of whether `logic:` wrapper exists
        {
            const topMode = config.parsedYaml.mode || (config.parsedYaml.logic && config.parsedYaml.logic.mode);
            if (topMode && VALID_MODES.has(topMode)) {
                const { appMode } = await import('../stores/mode.js');
                appMode.set(topMode);
                pasteMode = topMode;
                console.log(`📌 Mode set from YAML: ${topMode}`);
            }
        }

        // Check if this is the logic: format (.ologic files MUST use logic: wrapper)
        if (config.parsedYaml.logic) {
            console.log('🧠 Detected logic: format with mode:', config.parsedYaml.logic.mode || 'unknown');
            const logic = config.parsedYaml.logic;

            // Import mode store to potentially set mode from loaded config
            const { appMode } = await import('../stores/mode.js');
            if (logic.mode && (logic.mode === 'knowledge' || logic.mode === 'automation' || logic.mode === 'diagramming')) {
                appMode.set(logic.mode);
                pasteMode = logic.mode; // Capture at function scope for createNodesRecursive
                console.log(`📌 Mode set to: ${logic.mode}`);
            }

            // Extract networks from logic: format and process like canvas format
            if (logic.networks && Array.isArray(logic.networks)) {
                console.log(`📊 Loading ${logic.networks.length} networks from logic format`);

                // Build YAML network group hints so detectNetworks() can pre-union
                // all factories and network-level nodes declared in the same network
                // block — even when they're not graph-connected to each other.
                try {
                    const { setNetworkGroupHints } = await import('../stores/workflows/ontology.js');
                    const networkHints = logic.networks.map(network => {
                        const ids = [];
                        // For each factory, push a representative NODE ID (not the factory's
                        // YAML ID, which won't survive into detectNetworks' generated IDs).
                        // The first node of the first machine is a reliable representative
                        // that WILL be in the factory's nodeIds array.
                        (network.factories || []).forEach(f => {
                            const machines = f.machines || [];
                            if (machines.length > 0) {
                                const nodes = machines[0].nodes || [];
                                if (nodes.length > 0 && nodes[0].id) {
                                    ids.push(nodes[0].id);  // first node of first machine
                                }
                            }
                            // Also include factory-level standalone nodes
                            (f.nodes || []).forEach(n => { if (n.id) ids.push(n.id); });
                        });
                        // Collect first node from network-level standalone machines
                        (network.machines || []).forEach(m => {
                            const nodes = m.nodes || [];
                            if (nodes.length > 0 && nodes[0].id) ids.push(nodes[0].id);
                        });
                        // Collect all standalone node IDs at the network level
                        (network.nodes || []).forEach(n => { if (n.id) ids.push(n.id); });
                        return ids;
                    }).filter(group => group.length >= 2);
                    if (networkHints.length > 0) {
                        setNetworkGroupHints(networkHints);
                        console.log(`🔗 Set ${networkHints.length} network group hint(s) for ontology detection`);
                    }
                } catch (hintErr) {
                    console.warn('[clipboard] Failed to set network group hints:', hintErr);
                }

                let totalCreatedNodes = [];
                let totalCreatedConnections = [];
                let allContainerIds = [];

                const placedNetworkBounds = [];
                const NETWORK_SPACING = 100;

                for (let i = 0; i < logic.networks.length; i++) {
                    const network = logic.networks[i];
                    console.log(`🌐 Processing network ${i + 1}/${logic.networks.length}: ${network.id}`);

                    const networkBounds = CoordinateCalculator.getBounds({ network });
                    const networkWidth = networkBounds.width || 800;
                    const networkHeight = networkBounds.height || 600;

                    let networkTargetX = targetX !== null ? targetX : 400;
                    let networkTargetY = targetY !== null ? targetY : 300;

                    if (i > 0 && placedNetworkBounds.length > 0) {
                        const rightmostBound = Math.max(...placedNetworkBounds.map(b => b.maxX));
                        networkTargetX = rightmostBound + NETWORK_SPACING + (networkWidth / 2);

                        const MAX_CANVAS_WIDTH = 3000;
                        if (networkTargetX + (networkWidth / 2) > MAX_CANVAS_WIDTH) {
                            const bottommostBound = Math.max(...placedNetworkBounds.map(b => b.maxY));
                            networkTargetX = 400;
                            networkTargetY = bottommostBound + NETWORK_SPACING + (networkHeight / 2);
                        }

                        console.log(`📍 Positioning network ${i + 1} at (${networkTargetX}, ${networkTargetY}) to avoid overlap`);
                    }

                    const singleNetworkConfig = { network };
                    const networkResult = await pasteAndCreateConfigUniversal(networkTargetX, networkTargetY, singleNetworkConfig);

                    if (!networkResult.success) {
                        console.error(`❌ Failed to load network ${network.id}:`, networkResult.error);
                        return { success: false, error: `Failed to load network ${network.id}: ${networkResult.error}` };
                    }

                    if (networkResult.createdNodes && networkResult.createdNodes.length > 0) {
                        const nodeXs = networkResult.createdNodes.map(n => n.x);
                        const nodeYs = networkResult.createdNodes.map(n => n.y);
                        placedNetworkBounds.push({
                            minX: Math.min(...nodeXs) - 50,
                            maxX: Math.max(...nodeXs) + 304,
                            minY: Math.min(...nodeYs) - 50,
                            maxY: Math.max(...nodeYs) + 176
                        });
                    }

                    totalCreatedNodes.push(...(networkResult.createdNodes || []));
                    totalCreatedConnections.push(...(networkResult.createdConnections || []));
                    if (networkResult.containerId) {
                        allContainerIds.push(networkResult.containerId);
                    }

                    console.log(`✅ Network ${network.id} loaded successfully`);
                }

                // Handle top-level standalone nodes alongside networks
                if (logic.nodes && Array.isArray(logic.nodes) && logic.nodes.length > 0) {
                    console.log(`⚪ Processing ${logic.nodes.length} standalone nodes alongside networks`);
                    const standaloneConfig = { nodes: logic.nodes };
                    const standaloneResult = await pasteAndCreateConfigUniversal(targetX !== null ? targetX : 400, targetY !== null ? targetY : 300, standaloneConfig);
                    if (standaloneResult && standaloneResult.success) {
                        totalCreatedNodes.push(...(standaloneResult.createdNodes || []));
                        totalCreatedConnections.push(...(standaloneResult.createdConnections || []));
                        console.log(`✅ Standalone nodes loaded successfully: ${standaloneResult.createdNodes?.length || 0} nodes`);
                    } else {
                        console.warn(`⚠️ Standalone nodes failed to load:`, standaloneResult?.error);
                    }
                }

                // Clear the network group hints — they were only needed during detection.
                try {
                    const { clearNetworkGroupHints } = await import('../stores/workflows/ontology.js');
                    clearNetworkGroupHints();
                } catch (_) {}

                console.log(`🎉 Logic format loaded successfully: ${logic.networks.length} networks, ${totalCreatedNodes.length} nodes, ${totalCreatedConnections.length} connections`);

                return {
                    success: true,
                    createdNodes: totalCreatedNodes,
                    createdConnections: totalCreatedConnections,
                    configType: 'logic',
                    containerIds: allContainerIds,
                    networksCount: logic.networks.length,
                    mode: logic.mode
                };
            }

            // Handle single machine/factory/node in logic format
            if (logic.machines || logic.factories || logic.nodes) {
                // Unwrap and process as individual components
                const unwrappedConfig = {};
                if (logic.machines) unwrappedConfig.machines = logic.machines;
                if (logic.factories) unwrappedConfig.factories = logic.factories;
                if (logic.nodes) unwrappedConfig.nodes = logic.nodes;

                // Continue processing with unwrapped config
                config.parsedYaml = unwrappedConfig;
            }
        }

        // Check if this is a multi-network canvas format (legacy backward compatibility)
        if (config.parsedYaml.canvas && config.parsedYaml.canvas.networks) {
            console.log('🎨 Detected multi-network canvas format (legacy)');
            const canvas = config.parsedYaml.canvas;
            const networks = canvas.networks;
            
            console.log(`📊 Loading ${networks.length} networks from canvas`);
            
            let totalCreatedNodes = [];
            let totalCreatedConnections = [];
            let allContainerIds = [];
            
            // Track bounds of all placed networks to prevent overlap
            const placedNetworkBounds = [];
            const NETWORK_SPACING = 100; // Minimum spacing between networks
            
            // Process each network sequentially with smart positioning
            for (let i = 0; i < networks.length; i++) {
                const network = networks[i];
                console.log(`🌐 Processing network ${i + 1}/${networks.length}: ${network.id}`);
                
                // Calculate bounds of the current network
                const networkBounds = CoordinateCalculator.getBounds({ network });
                const networkWidth = networkBounds.width || 800; // Default width if empty
                const networkHeight = networkBounds.height || 600; // Default height if empty
                
                // Calculate position for this network to avoid overlap
                let networkTargetX = targetX !== null ? targetX : 400;
                let networkTargetY = targetY !== null ? targetY : 300;
                
                if (i > 0 && placedNetworkBounds.length > 0) {
                    // For subsequent networks, calculate offset to avoid overlap
                    // Place to the right of all previously placed networks
                    const rightmostBound = Math.max(...placedNetworkBounds.map(b => b.maxX));
                    networkTargetX = rightmostBound + NETWORK_SPACING + (networkWidth / 2);
                    
                    // If it would go too far right, wrap to next row
                    const MAX_CANVAS_WIDTH = 3000;
                    if (networkTargetX + (networkWidth / 2) > MAX_CANVAS_WIDTH) {
                        // Start a new row below all existing networks
                        const bottommostBound = Math.max(...placedNetworkBounds.map(b => b.maxY));
                        networkTargetX = 400; // Reset to left side
                        networkTargetY = bottommostBound + NETWORK_SPACING + (networkHeight / 2);
                    }
                    
                    console.log(`📍 Positioning network ${i + 1} at (${networkTargetX}, ${networkTargetY}) to avoid overlap`);
                }
                
                // Create a single network config in the old format for processing
                const singleNetworkConfig = { network };
                
                // Recursively call pasteAndCreateConfigUniversal for each network
                const networkResult = await pasteAndCreateConfigUniversal(networkTargetX, networkTargetY, singleNetworkConfig);
                
                if (!networkResult.success) {
                    console.error(`❌ Failed to load network ${network.id}:`, networkResult.error);
                    return { success: false, error: `Failed to load network ${network.id}: ${networkResult.error}` };
                }
                
                // Calculate actual bounds of placed network from created nodes
                if (networkResult.createdNodes && networkResult.createdNodes.length > 0) {
                    const nodeXs = networkResult.createdNodes.map(n => n.x);
                    const nodeYs = networkResult.createdNodes.map(n => n.y);
                    placedNetworkBounds.push({
                        minX: Math.min(...nodeXs) - 50, // Add padding
                        maxX: Math.max(...nodeXs) + 304, // Node width + padding
                        minY: Math.min(...nodeYs) - 50,
                        maxY: Math.max(...nodeYs) + 176 // Node height + padding
                    });
                }
                
                // Accumulate results
                totalCreatedNodes.push(...(networkResult.createdNodes || []));
                totalCreatedConnections.push(...(networkResult.createdConnections || []));
                if (networkResult.containerId) {
                    allContainerIds.push(networkResult.containerId);
                }
                
                console.log(`✅ Network ${network.id} loaded successfully`);
            }
            
            console.log(`🎉 Multi-network canvas loaded successfully: ${networks.length} networks, ${totalCreatedNodes.length} nodes, ${totalCreatedConnections.length} connections`);
            
            return {
                success: true,
                createdNodes: totalCreatedNodes,
                createdConnections: totalCreatedConnections,
                configType: 'canvas',
                containerIds: allContainerIds,
                networksCount: networks.length
            };
        }
        
        // Handle legacy single-network format for backward compatibility
        console.log('📝 Processing single network or legacy format');

        // ===== PHASE 1: ID ISOLATION SYSTEM =====
        console.log('🔒 Phase 1: Starting ID isolation for paste operation');
        const pasteSessionId = `paste_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log('🆔 Paste session ID:', pasteSessionId);
        
        // Deep scan to find ALL IDs in the config
        const originalIds = new Set();
        const scanForIds = (obj, path = '') => {
            if (!obj || typeof obj !== 'object') return;
            
            // Scan for direct ID properties
            if (obj.id) {
                originalIds.add(obj.id);
                console.log(`📝 Found ID: ${obj.id} at ${path}.id`);
            }
            
            // Scan for input/output references (arrays of IDs)
            if (Array.isArray(obj.inputs)) {
                obj.inputs.forEach((inputId, idx) => {
                    if (inputId && inputId !== 'none') {
                        originalIds.add(inputId);
                        console.log(`📝 Found input reference: ${inputId} at ${path}.inputs[${idx}]`);
                    }
                });
            }
            
            if (Array.isArray(obj.outputs)) {
                obj.outputs.forEach((outputId, idx) => {
                    if (outputId && outputId !== 'none') {
                        originalIds.add(outputId);
                        console.log(`📝 Found output reference: ${outputId} at ${path}.outputs[${idx}]`);
                    }
                });
            }

            // Recursively scan nested objects and arrays
            if (Array.isArray(obj)) {
                obj.forEach((item, idx) => scanForIds(item, `${path}[${idx}]`));
            } else {
                Object.keys(obj).forEach(key => {
                    if (key !== 'id' && key !== 'inputs' && key !== 'outputs') { // Already handled above
                        scanForIds(obj[key], path ? `${path}.${key}` : key);
                    }
                });
            }
        };
        
        scanForIds(config.parsedYaml);
        console.log(`🔍 Found ${originalIds.size} unique IDs to remap:`, Array.from(originalIds));
        
        // Create comprehensive ID mapping (original -> unique)
        const idRemapping = new Map();
        originalIds.forEach(originalId => {
            const newId = `${originalId}_${pasteSessionId}`;
            idRemapping.set(originalId, newId);
            console.log(`🗺️ ID mapping: ${originalId} -> ${newId}`);
        });
        
        // ===== PHASE 2: CONFIG TRANSFORMATION =====
        console.log('🔄 Phase 2: Transforming config with new IDs');
        
        const transformConfig = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;
            
            if (Array.isArray(obj)) {
                return obj.map(item => transformConfig(item));
            }
            
            const transformed = {};
            Object.keys(obj).forEach(key => {
                let value = obj[key];
                
                if (key === 'id' && idRemapping.has(value)) {
                    // Transform direct ID references
                    const newId = idRemapping.get(value);
                    transformed[key] = newId;
                    console.log(`🔧 Transformed ID: ${value} -> ${newId}`);
                } else if (key === 'inputs' && Array.isArray(value)) {
                    // Transform input arrays
                    transformed[key] = value.map(inputId => {
                        if (inputId && inputId !== 'none' && idRemapping.has(inputId)) {
                            const newId = idRemapping.get(inputId);
                            console.log(`🔗 Transformed input: ${inputId} -> ${newId}`);
                            return newId;
                        }
                        return inputId;
                    });
                } else if (key === 'outputs' && Array.isArray(value)) {
                    // Transform output arrays
                    transformed[key] = value.map(outputId => {
                        if (outputId && outputId !== 'none' && idRemapping.has(outputId)) {
                            const newId = idRemapping.get(outputId);
                            console.log(`🔗 Transformed output: ${outputId} -> ${newId}`);
                            return newId;
                        }
                        return outputId;
                    });
                } else if (key === 'position' && typeof value === 'string') {
                    // Transform position hint anchor ID — "below ingestion" → "below ingestion_paste_xxx"
                    const posMatch = value.match(/^(below|above|right-of|left-of)\s+(\S+)$/);
                    if (posMatch) {
                        const [, direction, anchorId] = posMatch;
                        const newAnchorId = idRemapping.has(anchorId) ? idRemapping.get(anchorId) : anchorId;
                        transformed[key] = `${direction} ${newAnchorId}`;
                        console.log(`🔗 Transformed position hint: "${value}" -> "${transformed[key]}"`);
                    } else {
                        transformed[key] = value;
                    }
                } else {
                    // Recursively transform nested objects
                    transformed[key] = transformConfig(value);
                }
            });
            
            return transformed;
        };
        
        const transformedConfig = transformConfig(config.parsedYaml);
        // Build reverse ID map: transformed -> original
        const reverseIdMap = new Map(Array.from(idRemapping.entries()).map(([orig, mapped]) => [mapped, orig]));
        console.log('✅ Phase 2 complete: Config transformed with isolated IDs');
        console.log('🔍 Transformed config:', JSON.stringify(transformedConfig, null, 2));
        
        // Replace the original config with the transformed one
        config.parsedYaml = transformedConfig;

        // Calculate smart paste coordinates
        const target = {
            x: targetX !== null ? targetX : CoordinateCalculator.getCanvasCenter().x,
            y: targetY !== null ? targetY : CoordinateCalculator.getCanvasCenter().y
        };
        
        const { offsetX, offsetY } = CoordinateCalculator.calculatePasteCoordinates(
            config.parsedYaml, 
            target.x, 
            target.y
        );

        // ===== PHASE 3: ISOLATED CREATION =====
        console.log('🏗️ Phase 3: Creating entities with isolated IDs');
        console.log('🔒 ISOLATED CONFIG (all IDs unique to this paste):', JSON.stringify(config.parsedYaml, null, 2));
        
        const universalContainer = UniversalContainer.fromConfig(config.parsedYaml, offsetX, offsetY);
        console.log('✨ Created isolated universal container:', universalContainer.type, universalContainer.id);
        
        // Log the complete universal container structure
        console.log('🏗️ UNIVERSAL CONTAINER STRUCTURE:');
        console.log('   Type:', universalContainer.type);
        console.log('   ID:', universalContainer.id);
        console.log('   Children:', universalContainer.children.length);
        
        const logContainer = (container, depth = 0) => {
            const indent = '  '.repeat(depth + 1);
            console.log(`${indent}📦 ${container.type}: ${container.id}`);
            if (container.config) {
                if (container.config.outputs) console.log(`${indent}  outputs: [${container.config.outputs.join(', ')}]`);
                if (container.config.inputs) console.log(`${indent}  inputs: [${container.config.inputs.join(', ')}]`);
            }
            container.children.forEach(child => logContainer(child, depth + 1));
        };
        
        logContainer(universalContainer);

        // Create actual nodes using the universal system
        const { nodeActions, connectionActions } = await import('../stores/nodes.js');
        const createdNodes = [];
        const createdConnections = [];
        
        // Phase 1: Create all nodes and build ID mapping
        let actualIdMap = new Map(); // originalId -> actualNodeId
        
        // Calculate bounds of all nodes to center the structure
        const allNodes = universalContainer.flattenByType('node');
        const bounds = {
            minX: Math.min(...allNodes.map(n => n.coordinates.x)),
            maxX: Math.max(...allNodes.map(n => n.coordinates.x)),
            minY: Math.min(...allNodes.map(n => n.coordinates.y)),
            maxY: Math.max(...allNodes.map(n => n.coordinates.y))
        };
        const structureCenter = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2
        };

        const createNodesRecursive = async (container) => {
            if (container.type === 'node') {
                const relativeX = container.coordinates.x - structureCenter.x;
                const relativeY = container.coordinates.y - structureCenter.y;
                const finalX = target.x + relativeX;
                const finalY = target.y + relativeY;

                // Create the basic node
                const node = nodeActions.add(
                    container.config.nodeType,
                    finalX,
                    finalY,
                    container.config.content || ''
                );

                // Sync diagram mode dimensions into the node store BEFORE organize runs.
                // Node.svelte renders nodes at 140×130 (no content) or 260×200 (with content)
                // via inline CSS, but ConnectionLine.svelte and organize.js read from node.width/height.
                // By setting the correct dimensions here, all consumers (ConnectionLine, organize,
                // bounds) get the right values from the start.
                // NOTE: use pasteMode (function-scope) not `logic` (block-scoped, out of scope here).
                if (pasteMode === 'diagramming') {
                    const hasDiagramContent = !!(
                        container.config.content &&
                        container.config.content !== 'Click to edit...' &&
                        container.config.content !== 'Waiting for input...' &&
                        container.config.content.trim().length > 0
                    );
                    const diagramW = hasDiagramContent ? 260 : 140;
                    const diagramH = hasDiagramContent ? 200 : 130;
                    const { nodes: nodesStore } = await import('../stores/nodes.js');
                    nodesStore.update(allNodes => allNodes.map(n =>
                        n.id === node.id ? { ...n, width: diagramW, height: diagramH } : n
                    ));
                    node.width = diagramW;
                    node.height = diagramH;
                    console.log(`📐 Diagram mode: set node ${node.id} dimensions to ${diagramW}×${diagramH}`);
                }

                // Apply .ologic title override: write back into the nodes store so Node.svelte
                // displayTitle (which reads node.title) shows the YAML title instead of the
                // generic type label that nodeActions.add() assigns by default.
                if (container.config.title) {
                    const { nodes: nodesStore } = await import('../stores/nodes.js');
                    nodesStore.update(allNodes => allNodes.map(n =>
                        n.id === node.id ? { ...n, title: container.config.title } : n
                    ));
                    node.title = container.config.title; // keep local reference in sync
                    console.log(`🏷️ Applied .ologic title to node ${node.id}: "${container.config.title}"`);
                }

                // Apply .ologic icon override: write onto the node object so Node.svelte
                // iconSvg reactive block (which reads node.icon) prefers this over nodeMeta.iconName.
                if (container.config.icon) {
                    const { nodes: nodesStore } = await import('../stores/nodes.js');
                    nodesStore.update(allNodes => allNodes.map(n =>
                        n.id === node.id ? { ...n, icon: container.config.icon } : n
                    ));
                    node.icon = container.config.icon; // keep local reference in sync
                    console.log(`🎨 Applied .ologic icon to node ${node.id}: "${container.config.icon}"`);
                }

                // Mark this node to skip any file selection prompt that might be scheduled by creation
                if (typeof window !== 'undefined') {
                    if (!window.ordinalSkipFilePromptIds) {
                        window.ordinalSkipFilePromptIds = new Set();
                    }
                    window.ordinalSkipFilePromptIds.add(node.id);
                }
                
                // If the config contains a filePath and this is a file-based node, set it immediately
                if ((container.config.nodeType === 'text_file_output' || container.config.nodeType === 'text_file_source' || container.config.nodeType === 'pdf_file_source') && container.config.filePath) {
                    const { nodeDataStore } = await import('../stores/nodes.js');
                    const { get } = await import('svelte/store');
                    const storeMap = get(nodeDataStore);
                    const nodeData = storeMap.get(node.id);
                    if (nodeData) {
                        if (container.config.nodeType === 'text_file_output') {
                            nodeData.data.metadata.lastSavedPath = container.config.filePath;
                            nodeData.data.metadata.autoSavePath = container.config.filePath;
                            nodeData.data.filePath = container.config.filePath;
                        } else if (container.config.nodeType === 'text_file_source') {
                            nodeData.data.filePath = container.config.filePath;
                            // Attempt to auto-load content (works in browser mode with file path)
                            try {
                                const { nodeActions } = await import('../stores/nodes.js');
                                await nodeActions.loadArtifactContent(node.id, container.config.filePath);
                            } catch (e) {
                                console.warn('Auto-load of text_file_source failed:', e);
                            }
                        } else if (container.config.nodeType === 'pdf_file_source') {
                            nodeData.data.filePath = container.config.filePath;
                            // Attempt to auto-load PDF content (works in browser mode with file path)
                            try {
                                const { nodeActions } = await import('../stores/nodes.js');
                                await nodeActions.loadPdfContent(node.id, container.config.filePath);
                            } catch (e) {
                                console.warn('Auto-load of pdf_file_source failed:', e);
                            }
                        }
                        // Push update back to store
                        nodeDataStore.update(store => {
                            const newStore = new Map(store);
                            newStore.set(node.id, nodeData);
                            return newStore;
                        });
                    }
                }

                // Apply AI overrides immediately if present in concise config
                if (container.config.nodeType === 'ai' && (container.config.model || container.config.temperature !== undefined)) {
                    const { nodeDataStore } = await import('../stores/nodes.js');
                    const { get } = await import('svelte/store');
                    const storeMap = get(nodeDataStore);
                    const nodeData = storeMap.get(node.id);
                    if (nodeData) {
                        nodeData.data.processing = nodeData.data.processing || {};
                        if (container.config.model) {
                            nodeData.data.processing.model_override = container.config.model;
                        }
                        if (container.config.temperature !== undefined && container.config.temperature !== null) {
                            nodeData.data.processing.parameters = nodeData.data.processing.parameters || {};
                            nodeData.data.processing.parameters.temperature = container.config.temperature;
                        }
                        nodeDataStore.update(store => {
                            const ns = new Map(store);
                            ns.set(node.id, nodeData);
                            return ns;
                        });
                    }
                }

                // Store requirements traceability array in nodeData metadata
                if (container.config.requirements && container.config.requirements.length > 0) {
                    const { nodeDataStore } = await import('../stores/nodes.js');
                    const { get } = await import('svelte/store');
                    const storeMap = get(nodeDataStore);
                    const nodeData = storeMap.get(node.id);
                    if (nodeData) {
                        nodeData.data.metadata = nodeData.data.metadata || {};
                        nodeData.data.metadata.requirements = container.config.requirements;
                        nodeDataStore.update(store => {
                            const ns = new Map(store);
                            ns.set(node.id, nodeData);
                            return ns;
                        });
                        console.log(`📋 Node ${node.id} requirements: [${container.config.requirements.join(', ')}]`);
                    }
                }

                // Store node for later initialization after hydration
                createdNodes.push(node);
                actualIdMap.set(container.metadata.originalId, node.id);
                console.log(`✅ Created node: ${container.metadata.originalId} -> ${node.id}`);
            }

            for (const child of container.children) {
                await createNodesRecursive(child);
            }
        };
        
        await createNodesRecursive(universalContainer);

        // Phase 1.15: Store position hints from YAML into containerCustomizations.
        // The organize system reads hints from containerCustomizations.get(id)?.positionHint
        // when buildXxxOrganizeContext() is called. We walk the transformed config (with
        // remapped IDs) and map each entity's transformed ID → its runtime container ID.
        // For containers (machines/factories/networks), the transformed ID IS the runtime
        // container ID (ontology detection uses the same ID). For nodes, the actualIdMap
        // maps originalId → runtimeId.
        try {
            const { containerActions: pasteContainerActions } = await import('../stores/workflows.js');

            /**
             * Walk a config object and store position hints for any entity that declares one.
             * @param {any} obj
             */
            const storePositionHints = (obj) => {
                if (!obj || typeof obj !== 'object') return;

                if (Array.isArray(obj)) {
                    obj.forEach(item => storePositionHints(item));
                    return;
                }

                // If this entity has a position hint and an id, record it
                if (obj.position && typeof obj.position === 'string' && obj.id) {
                    const posMatch = obj.position.match(/^(below|above|right-of|left-of)\s+(\S+)$/);
                    if (posMatch) {
                        // For containers (machines, factories, networks) the transformed id is
                        // the store id. For nodes we look up via actualIdMap.
                        const entityId = actualIdMap.get(obj.id) || obj.id;
                        pasteContainerActions.setPositionHint(entityId, obj.position);
                        console.log(`📐 Position hint stored: ${entityId} → "${obj.position}"`);
                    }
                }

                // Recurse into child arrays
                const childKeys = ['nodes', 'machines', 'factories', 'networks'];
                childKeys.forEach(key => {
                    if (Array.isArray(obj[key])) {
                        obj[key].forEach(child => storePositionHints(child));
                    }
                });
            };

            storePositionHints(config.parsedYaml);
        } catch (hintErr) {
            console.warn('⚠️ Could not store position hints:', hintErr);
        }

        // Phase 1.25: Apply file paths from transformed config to created nodes and optionally load content
        const applyFilePathsFromConfig = async (cfg, reverseIdMap) => {
            // Helper: detect absolute path (Windows drive, UNC, or POSIX root)
            const isAbsolutePath = (p) => !!p && (/^[a-zA-Z]:\\/.test(p) || /^\\\\/.test(p) || p.startsWith('/'));
            const getDir = (p) => {
                if (!p) return '';
                const sep = p.includes('\\') ? '\\' : '/';
                const idx = p.lastIndexOf(sep);
                return idx >= 0 ? p.slice(0, idx) : '';
            };

            // Collect potential base directories from config (e.g., text_file_output paths)
            const baseDirs = new Set();
            const collectBaseDirsFromList = (nodesList = []) => {
                nodesList.forEach(n => {
                    const p = n.file_path || n.file_source || '';
                    if (isAbsolutePath(p)) baseDirs.add(getDir(p));
                });
            };

            if (cfg.node) collectBaseDirsFromList([cfg.node]);
            if (cfg.machine && Array.isArray(cfg.machine.nodes)) collectBaseDirsFromList(cfg.machine.nodes);
            if (cfg.factory) {
                if (Array.isArray(cfg.factory.nodes)) collectBaseDirsFromList(cfg.factory.nodes);
                if (Array.isArray(cfg.factory.machines)) cfg.factory.machines.forEach(m => collectBaseDirsFromList(m.nodes || []));
            }
            if (cfg.network) {
                if (Array.isArray(cfg.network.nodes)) collectBaseDirsFromList(cfg.network.nodes);
                if (Array.isArray(cfg.network.machines)) cfg.network.machines.forEach(m => collectBaseDirsFromList(m.nodes || []));
                if (Array.isArray(cfg.network.factories)) cfg.network.factories.forEach(f => {
                    collectBaseDirsFromList(f.nodes || []);
                    (f.machines || []).forEach(m => collectBaseDirsFromList(m.nodes || []));
                });
            }

            const applyForNodeList = async (nodeList = []) => {
                for (const n of nodeList) {
                    // Map transformed ID back to original, then to actual runtime ID
                    const originalId = reverseIdMap.get(n.id) || n.id;
                    const actualNodeId = actualIdMap.get(originalId);
                    if (!actualNodeId) continue;

                    let filePath = n.file_path || n.file_source || '';
                    // If relative, try to resolve using any collected base directory
                    if (filePath && !isAbsolutePath(filePath) && baseDirs.size > 0) {
                        const [firstBase] = Array.from(baseDirs);
                        const sep = firstBase.includes('\\') ? '\\' : '/';
                        filePath = `${firstBase}${sep}${filePath}`;
                    }
                    // Fallback: resolve using lastFileDirectory from settings
                    if (filePath && !isAbsolutePath(filePath)) {
                        try {
                            const { settings } = await import('../stores/settings.js');
                            const { get } = await import('svelte/store');
                            const st = get(settings);
                            const base = st?.lastFileDirectory || '';
                            if (base) {
                                const sep = base.includes('\\') ? '\\' : '/';
                                filePath = `${base}${sep}${filePath}`;
                            }
                        } catch {}
                    }
                    if (!filePath || String(filePath).trim() === '') continue;

                    const { nodeDataStore, nodes: nodesStore } = await import('../stores/nodes.js');
                    const { get } = await import('svelte/store');
                    const storeMap = get(nodeDataStore);
                    const nodeData = storeMap.get(actualNodeId);
                    if (!nodeData) continue;

                    if (n.type === 'text_file_output') {
                        nodeData.data.metadata.lastSavedPath = filePath;
                        nodeData.data.metadata.autoSavePath = filePath;
                        nodeData.data.filePath = filePath;
                        // Desktop: proactively ensure file exists with placeholder
                        try {
                            if (typeof window !== 'undefined' && (/** @type {any} */ (window)).go?.app?.App) {
                                try {
                                    await (/** @type {any} */ (window)).go.app.App.ReadTextFile(filePath);
                                } catch {
                                    const placeholder = '# Generated Content\n\nContent will appear here after processing...\n';
                                    await (/** @type {any} */ (window)).go.app.App.WriteTextFile(filePath, placeholder);
                                    console.log(`📄 Created placeholder output file: ${filePath}`);
                                }
                            }
                        } catch (e) {
                            console.warn('Could not ensure output file exists:', e);
                        }
                        // Try to load current file content into preview (desktop only)
                        try {
                            const { nodeActions } = await import('../stores/nodes.js');
                            await nodeActions.loadOutputPreview(actualNodeId);
                        } catch (e) {
                            console.warn('Could not load output file content for preview:', e);
                        }
                    } else if (n.type === 'text_file_source') {
                        nodeData.data.filePath = filePath;
                        // Attempt to auto-load content
                        try {
                            const { nodeActions } = await import('../stores/nodes.js');
                            await nodeActions.loadArtifactContent(actualNodeId, filePath);
                            // After loading content, proactively propagate to direct targets
                            try {
                                const { connections: connStore, nodeDataStore: ndStore } = await import('../stores/nodes.js');
                                const { get } = await import('svelte/store');
                                const conns = get(connStore).filter(c => c.fromId === actualNodeId);
                                const latestND = get(ndStore).get(actualNodeId);
                                const output = latestND?.data?.output;
                                if (output && conns.length > 0) {
                                    const { nodeActions: na2 } = await import('../stores/nodes.js');
                                    for (const c of conns) {
                                        na2.addInput(c.toId, actualNodeId, output.value, 1.0, output.context_chain, output.sources);
                                    }
                                }
                            } catch (e) {
                                console.warn('Direct context propagation after load failed:', e);
                            }
                        } catch (e) {
                            console.warn('Auto-load of text_file_source failed:', e);
                        }
                    } else if (n.type === 'pdf_file_source') {
                        nodeData.data.filePath = filePath;
                        // Attempt to auto-load PDF content
                        try {
                            const { nodeActions } = await import('../stores/nodes.js');
                            await nodeActions.loadPdfContent(actualNodeId, filePath);
                            // After loading content, proactively propagate to direct targets
                            try {
                                const { connections: connStore, nodeDataStore: ndStore } = await import('../stores/nodes.js');
                                const { get } = await import('svelte/store');
                                const conns = get(connStore).filter(c => c.fromId === actualNodeId);
                                const latestND = get(ndStore).get(actualNodeId);
                                const output = latestND?.data?.output;
                                if (output && conns.length > 0) {
                                    const { nodeActions: na2 } = await import('../stores/nodes.js');
                                    for (const c of conns) {
                                        na2.addInput(c.toId, actualNodeId, output.value, 1.0, output.context_chain, output.sources);
                                    }
                                }
                            } catch (e) {
                                console.warn('Direct context propagation after load failed:', e);
                            }
                        } catch (e) {
                            console.warn('Auto-load of pdf_file_source failed:', e);
                        }
                    }

                    // Push update back to store
                    nodeDataStore.update(store => {
                        const newStore = new Map(store);
                        newStore.set(actualNodeId, nodeData);
                        return newStore;
                    });
                }
            };

            if (cfg.node) {
                await applyForNodeList([cfg.node]);
            }
            if (cfg.machine && Array.isArray(cfg.machine.nodes)) {
                await applyForNodeList(cfg.machine.nodes);
            }
            if (cfg.factory) {
                if (Array.isArray(cfg.factory.nodes)) await applyForNodeList(cfg.factory.nodes);
                if (Array.isArray(cfg.factory.machines)) {
                    for (const m of cfg.factory.machines) {
                        if (Array.isArray(m.nodes)) await applyForNodeList(m.nodes);
                    }
                }
            }
            if (cfg.network) {
                if (Array.isArray(cfg.network.nodes)) await applyForNodeList(cfg.network.nodes);
                if (Array.isArray(cfg.network.machines)) {
                    for (const m of cfg.network.machines) {
                        if (Array.isArray(m.nodes)) await applyForNodeList(m.nodes);
                    }
                }
                if (Array.isArray(cfg.network.factories)) {
                    for (const f of cfg.network.factories) {
                        if (Array.isArray(f.nodes)) await applyForNodeList(f.nodes);
                        if (Array.isArray(f.machines)) {
                            for (const m of f.machines) {
                                if (Array.isArray(m.nodes)) await applyForNodeList(m.nodes);
                            }
                        }
                    }
                }
            }
        }

        await applyFilePathsFromConfig(config.parsedYaml, reverseIdMap);

        // Phase 1.5: Hydrate workflow context using WorkflowManager
        console.log('🎯 PHASE 1.5: Hydrating workflow context...');
        
        // Import and initialize WorkflowManager
        const { workflowManager } = await import('./WorkflowManager.js');
        
        // Function to hydrate workflow context using WorkflowManager
        const hydrateWorkflowContext = async (container, idMap) => {
            console.log('💧 Starting WorkflowManager hydration...');
            
            // Import NodeActions to get current node data
            const { nodeActions } = await import('../stores/nodes.js');
            
            // Build workflow configuration for WorkflowManager
            const workflowConfig = {
                nodes: [],
                connections: [],
                machines: [],
                factories: [],
                networks: []
            };
            
            // Collect nodes and their configurations for WorkflowManager
            const collectNodesAndConnections = (container) => {
                if (container.type === 'node') {
                    const actualId = idMap.get(container.metadata.originalId);
                    if (actualId) {
                        // Get the actual NodeData to build configuration
                        const nodeData = nodeActions.getNodeData(actualId);
                        if (nodeData) {
                            // Build node configuration for WorkflowManager
                            const nodeConfig = {
                                id: actualId,
                                node_type: nodeData.data.node_type,
                                content: nodeData.data.content,
                                metadata: nodeData.data.metadata,
                                processing: nodeData.data.processing,
                                purpose: nodeData.data.purpose,
                                execution: nodeData.data.execution
                            };
                            
                            // For AI nodes, include any saved content from original config
                            if (nodeData.data.node_type === 'ai' && container.config.content) {
                                nodeConfig.content = container.config.content;
                                if (!nodeConfig.execution) nodeConfig.execution = {};
                                nodeConfig.execution.result_string = container.config.content;
                            }
                            
                            workflowConfig.nodes.push(nodeConfig);
                        }
                        
                        // Add connections from outputs
                        if (container.config.outputs) {
                            container.config.outputs.forEach(outputId => {
                                const actualOutputId = idMap.get(outputId);
                                if (actualOutputId) {
                                    workflowConfig.connections.push({
                                        fromId: actualId,
                                        toId: actualOutputId,
                                        from: actualId,
                                        to: actualOutputId
                                    });
                                }
                            });
                        }
                    }
                }
                
                // Collect container information
                if (container.type === 'machine' && container.metadata?.originalId) {
                    const machineConfig = {
                        id: container.metadata.originalId,
                        nodes: [],
                        connections: []
                    };
                    
                    // Add child nodes to machine
                    const collectMachineNodes = (child) => {
                        if (child.type === 'node') {
                            const actualId = idMap.get(child.metadata.originalId);
                            if (actualId) {
                                machineConfig.nodes.push(actualId);
                            }
                        }
                        child.children.forEach(collectMachineNodes);
                    };
                    
                    container.children.forEach(collectMachineNodes);
                    workflowConfig.machines.push(machineConfig);
                }
                
                container.children.forEach(child => collectNodesAndConnections(child));
            };
            
            collectNodesAndConnections(container);
            
            console.log('📋 Built workflow config for WorkflowManager:', {
                nodeCount: workflowConfig.nodes.length,
                connectionCount: workflowConfig.connections.length,
                machineCount: workflowConfig.machines.length
            });
            
            // Use WorkflowManager to hydrate the workflow context
            workflowManager.loadAndHydrate(workflowConfig);
            
            // Apply hydrated context back to the actual NodeData instances
            for (const nodeConfig of workflowConfig.nodes) {
                const nodeData = nodeActions.getNodeData(nodeConfig.id);
                if (nodeData) {
                    const hydratedContext = workflowManager.getContextForNode(nodeConfig.id);
                    
                    console.log(`💧 Applying hydrated context to ${nodeConfig.id}:`, {
                        facts: hydratedContext.facts?.length || 0,
                        history: hydratedContext.history?.length || 0,
                        task: hydratedContext.task || 'none'
                    });
                    
                    // Update the node's output with the hydrated context
                    if (Object.keys(hydratedContext).length > 0) {
                        const workflowManagerNode = workflowManager.getNodeData(nodeConfig.id);
                        if (workflowManagerNode && workflowManagerNode.data.output) {
                            // Copy the complete output from WorkflowManager
                            nodeData.data.output = { ...workflowManagerNode.data.output };
                            
                            // For AI nodes with content, make sure execution state reflects completion
                            if (nodeData.data.node_type === 'ai' && hydratedContext.history?.length > 0) {
                                nodeData.data.execution.state = 'completed';
                                nodeData.data.execution.completed_at = new Date().toISOString();
                            }
                        }
                    }
                }
            }
            
            console.log('✅ WorkflowManager hydration completed successfully');
        };
        
        await hydrateWorkflowContext(universalContainer, actualIdMap);
        
        // Phase 1.6: Initialize all nodes with hydrated context
        console.log('🎯 PHASE 1.6: Initializing nodes with hydrated context...');
        
        const initializeCreatedNodes = async (container, idMap) => {
            const { initializeNodeState } = await import('../stores/nodes.js');
            
            const initializeNodesRecursive = async (container) => {
                if (container.type === 'node') {
                    const actualId = idMap.get(container.metadata.originalId);
                    if (actualId) {
                        console.log(`🔧 Initializing node ${actualId} with hydrated context...`);
                        await initializeNodeState(actualId, container.config.nodeType, container.config.content);
                    }
                }
                
                for (const child of container.children) {
                    await initializeNodesRecursive(child);
                }
            };
            
            await initializeNodesRecursive(container);
        };
        
        await initializeCreatedNodes(universalContainer, actualIdMap);

        // Phase 1.65: After initialization, hotload output previews so initialization doesn't overwrite them
        const hotloadOutputPreviews = async (container) => {
            if (container.type === 'node' && container.config?.nodeType === 'text_file_output') {
                const actualId = actualIdMap.get(container.metadata.originalId);
                if (actualId) {
                    try {
                        const { nodeActions } = await import('../stores/nodes.js');
                        await nodeActions.loadOutputPreview(actualId);
                    } catch (e) {
                        console.warn('Hotload preview failed:', e);
                    }
                }
            }
            for (const child of container.children) {
                await hotloadOutputPreviews(child);
            }
        };
        await hotloadOutputPreviews(universalContainer);
        
        // Phase 2: Create machine-level connections (node-to-node via outputs/inputs)
        // NOW WITH CONNECTION CLASSIFICATION: intra-machine vs cross-machine
        console.log('🔧 PHASE 2: Creating classified connections...');
        const createMachineConnections = async (container) => {
            if (container.type === 'node') {
                const actualNodeId = actualIdMap.get(container.metadata.originalId);

                if (!actualNodeId) {
                    console.warn(`⚠️ Phase 2: Node ID mapping failed for '${container.metadata.originalId}'`);
                    return;
                }

                // Handle outputs (node-to-node connections within machines)
                // Only process outputs to avoid duplicate connections (following factory pattern)
                if (container.config.outputs && Array.isArray(container.config.outputs)) {
                    for (const outputId of container.config.outputs) {
                        const targetNodeId = actualIdMap.get(outputId);
                        if (targetNodeId && actualNodeId) {
                            // Check if this connection already exists to prevent duplicates
                            if (createdConnections.some(conn => conn.fromId === actualNodeId && conn.toId === targetNodeId)) {
                                console.log(`⏭️ Skipping duplicate machine connection: ${container.metadata.originalId}(${actualNodeId}) -> ${outputId}(${targetNodeId})`);
                                continue;
                            }

                            try {
                                // Node-to-node connections are intra-machine.
                                // Cross-machine connections (machine→node) are handled in Phase 5.
                                console.log(`🔗 Node connection: ${container.metadata.originalId}(${actualNodeId}) -> ${outputId}(${targetNodeId})`);
                                connectionActions.add(actualNodeId, targetNodeId, 'output', 'input');
                                createdConnections.push({ fromId: actualNodeId, toId: targetNodeId });
                            } catch (error) {
                                console.error(`❌ Failed to create connection ${actualNodeId} -> ${targetNodeId}:`, error);
                            }
                        } else {
                            console.warn(`⚠️ Phase 2: Failed to resolve output connection '${container.metadata.originalId}' -> '${outputId}' (target: ${targetNodeId})`);
                        }
                    }
                }

                // Also process inputs — create connections from source → this node
                // Only if that connection wasn't already created via the source's outputs
                if (container.config.inputs && Array.isArray(container.config.inputs)) {
                    for (const inputId of container.config.inputs) {
                        const sourceNodeId = actualIdMap.get(inputId);
                        if (sourceNodeId && actualNodeId) {
                            // Check if this connection already exists (may have been created via outputs)
                            if (createdConnections.some(conn => conn.fromId === sourceNodeId && conn.toId === actualNodeId)) {
                                console.log(`⏭️ Skipping duplicate input connection: ${inputId}(${sourceNodeId}) -> ${container.metadata.originalId}(${actualNodeId})`);
                                continue;
                            }

                            try {
                                // Node-to-node connections are intra-machine.
                                // If inputId is a machine/factory, actualIdMap won't have it — that's handled in Phase 5/6.
                                console.log(`🔗 Node connection (from input): ${inputId}(${sourceNodeId}) -> ${container.metadata.originalId}(${actualNodeId})`);
                                connectionActions.add(sourceNodeId, actualNodeId, 'output', 'input');
                                createdConnections.push({ fromId: sourceNodeId, toId: actualNodeId });
                            } catch (error) {
                                console.error(`❌ Failed to create input connection ${sourceNodeId} -> ${actualNodeId}:`, error);
                            }
                        } else {
                            // Check if inputId is a container reference (machine/factory/network) —
                            // those are intentionally deferred to Phase 5/6 and not a warning.
                            const inputContainerRef = universalContainer.findById(inputId);
                            if (inputContainerRef && inputContainerRef.type !== 'node') {
                                console.log(`ℹ️ Phase 2: Deferring container input '${inputId}' (${inputContainerRef.type}) -> '${container.metadata.originalId}' to Phase 5/6`);
                            } else {
                                console.warn(`⚠️ Phase 2: Failed to resolve input connection '${inputId}' -> '${container.metadata.originalId}' (source: ${sourceNodeId})`);
                            }
                        }
                    }
                }
            }

            for (const child of container.children) {
                await createMachineConnections(child);
            }
        };

        await createMachineConnections(universalContainer);

        // Phase 2.1: Ensure context propagation for sources after async loads
        try {
            const { nodeDataStore, connections: connStore } = await import('../stores/nodes.js');
            const { get } = await import('svelte/store');
            const storeMap = get(nodeDataStore);
            const conns = get(connStore);
            // For each connection, if source has output, propagate explicitly
            const { ContextEngine } = await import('./ContextEngine.js');
            const getNodeData = (nid) => get(nodeDataStore).get(nid);
            const getContainerOutput = () => null; // not used in this context
            const updateNodeInput = async (targetId, sourceId, value, weight, contextChain, sources) => {
                const { nodeActions } = await import('../stores/nodes.js');
                nodeActions.addInput(targetId, sourceId, value, weight ?? 1.0, contextChain, sources);
            };
            for (const c of conns) {
                const nd = storeMap.get(c.fromId);
                if (!nd) continue;
                const hasOutput = await ContextEngine.hasExistingOutput(c.fromId, getNodeData, getContainerOutput);
                if (hasOutput) {
                    await ContextEngine.propagateExistingOutput(c.fromId, c.toId, getNodeData, getContainerOutput, updateNodeInput);
                }
            }
        } catch (e) {
            console.warn('Post-connection context propagation pass failed:', e);
        }

        // Phase 3: Detect containers (machines)
        console.log('🔍 PHASE 3: Detecting containers after machine connections...');
        let currentContainers = [];
        let attempts = 0;
        // Allow more time for large pastes to stabilize container detection
        const maxAttempts = 15;

        // Get all created node IDs
        const allCreatedNodeIds = new Set(actualIdMap.values());
        console.log('📝 All created node IDs:', Array.from(allCreatedNodeIds));
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            currentContainers = get(workflowContainers);
            console.log(`🔍 Container detection attempt ${attempts + 1}: Found ${currentContainers.length} containers`);
            
            // Log container details and ensure flags are set
            currentContainers.forEach((container, index) => {
                // Ensure machine containers have the isMachine flag
                if (container.id && container.id.startsWith('machine-') && !container.isFactory && !container.isNetwork) {
                    container.isMachine = true;
                }
                console.log(`   Container ${index}: ${container.id} (isMachine: ${container.isMachine}, isFactory: ${container.isFactory}, isNetwork: ${container.isNetwork})`);
                console.log(`     Nodes: [${container.nodes ? container.nodes.map(n => n.id).join(', ') : 'none'}]`);
            });
            
            // Check if any container has our nodes
            const containsOurNodes = currentContainers.some(container => 
                container.nodes && container.nodes.some(node => allCreatedNodeIds.has(node.id)) ||
                container.nodeIds && container.nodeIds.some(nodeId => allCreatedNodeIds.has(nodeId))
            );
            if (containsOurNodes) {
                console.log('✅ Found containers containing our nodes, proceeding with mapping');
                break;
            }
            
            attempts++;
        }
        
        if (attempts >= maxAttempts) {
            console.log('⚠️ Max container detection attempts reached, proceeding anyway...');
        }
        
        // Phase 4: Map container IDs
        let containerIdMap = new Map();
        
        const mapContainerIds = (universalCont) => {
            if (universalCont.type === 'machine' || universalCont.type === 'factory' || universalCont.type === 'network') {
                console.log(`🔍 Trying to map container: ${universalCont.metadata.originalId} (type: ${universalCont.type})`);
                
                // Find matching container by checking if it contains our nodes
                const expectedNodeIds = universalCont.flattenByType('node')
                    .map(nodeContainer => actualIdMap.get(nodeContainer.metadata.originalId))
                    .filter(Boolean);
                
                console.log(`📋 Expected node IDs for ${universalCont.metadata.originalId}:`, expectedNodeIds);
                
                /**
                 * Collect ALL node IDs reachable from a detected container (deep traversal).
                 * Machines: container.nodes[].id + container.nodeIds[]
                 * Factories: standalone nodeIds + machines[].nodes[].id + machines[].nodeIds[]
                 * Networks: all of the above from factories + standalone machines + nodeIds
                 */
                const getDeepNodeIds = (cont) => {
                    const ids = new Set();
                    // Direct nodes array (machines have this)
                    if (cont.nodes && Array.isArray(cont.nodes)) cont.nodes.forEach(n => n.id && ids.add(n.id));
                    // Direct nodeIds (standalone nodes)
                    if (cont.nodeIds && Array.isArray(cont.nodeIds)) cont.nodeIds.forEach(id => ids.add(id));
                    // Machine sub-containers (factories have machines[])
                    if (cont.machines && Array.isArray(cont.machines)) {
                        cont.machines.forEach(m => {
                            if (m.nodes && Array.isArray(m.nodes)) m.nodes.forEach(n => n.id && ids.add(n.id));
                            if (m.nodeIds && Array.isArray(m.nodeIds)) m.nodeIds.forEach(id => ids.add(id));
                        });
                    }
                    // Factory sub-containers (networks have factories[])
                    if (cont.factories && Array.isArray(cont.factories)) {
                        cont.factories.forEach(f => getDeepNodeIds(f).forEach(id => ids.add(id)));
                    }
                    return ids;
                };

                const matchingContainer = currentContainers.find(container => {
                    // Type check: containers may not have the right type flags yet if detection
                    // hasn't caught up (e.g., networks require cross-factory connections).
                    // Skip strict type filtering — just match by node set containment.
                    if (universalCont.type === 'machine' && container.isFactory) return false;
                    if (universalCont.type === 'machine' && container.isNetwork) return false;
                    if (universalCont.type === 'factory' && container.isNetwork) return false;
                    // Note: we allow matching a machine-typed universalCont against a detected isMachine,
                    // and factory/network against the appropriate detected type.
                    // But if the flag isn't set yet (timing), we still try node-based matching.
                    if (universalCont.type === 'machine' && container.isFactory) return false;

                    const containerNodeIds = getDeepNodeIds(container);
                    if (containerNodeIds.size === 0 && expectedNodeIds.length > 0) return false;

                    const matches = expectedNodeIds.length > 0 && expectedNodeIds.every(nodeId => containerNodeIds.has(nodeId));
                    if (matches) {
                        console.log(`✅ Container ${container.id} matches ${universalCont.metadata.originalId} (type: ${universalCont.type})`);
                    }
                    return matches;
                });
                
                if (matchingContainer) {
                    containerIdMap.set(universalCont.metadata.originalId, matchingContainer.id);
                    console.log(`🏗️ Mapped container: ${universalCont.metadata.originalId} -> ${matchingContainer.id}`);
                } else {
                    console.warn(`⚠️ No matching container found for ${universalCont.metadata.originalId}`);
                }
            }
            
            for (const child of universalCont.children) {
                mapContainerIds(child);
            }
        };
        
        mapContainerIds(universalContainer);

        // Phase 4.5: Apply .ologic container labels via containerCustomizations
        // UniversalContainer.createMachine/createFactory/createNetwork now store
        // label (from YAML label or title field) in container.config.label.
        // WorkflowContainer.svelte reads displayLabel = customization.customLabel || getDefaultLabel().
        // We need to call containerActions.setCustomLabel() for any container that has a label.
        //
        // For explicit mode (factories/networks with YAML-declared IDs), the container ID in
        // workflowContainers IS the YAML-declared originalId — so we can fall back to using it directly.
        console.log('🏷️ PHASE 4.5: Applying container labels from .ologic config...');
        try {
            const { containerActions } = await import('../stores/workflows.js');
            const applyContainerLabel = (universalCont) => {
                if ((universalCont.type === 'machine' || universalCont.type === 'factory' || universalCont.type === 'network')
                    && universalCont.config && universalCont.config.label) {
                    // Use containerIdMap to get the actual generated container ID
                    const actualContainerId = containerIdMap.get(universalCont.metadata.originalId);
                    if (actualContainerId) {
                        containerActions.setCustomLabel(actualContainerId, universalCont.config.label);
                        console.log(`🏷️ Applied label to container ${actualContainerId}: "${universalCont.config.label}"`);
                    }
                }
                for (const child of universalCont.children) {
                    applyContainerLabel(child);
                }
            };
            applyContainerLabel(universalContainer);
        } catch (e) {
            console.warn('⚠️ Phase 4.5 container label application failed (non-critical):', e);
        }

        // Phase 5: Create factory-level connections (machine context to nodes)
        console.log('🏭 PHASE 5: Creating factory-level connections...');
        console.log('🗺️ Current ID mappings:');
        console.log('   Node IDs:', Array.from(actualIdMap.entries()));
        console.log('   Container IDs:', Array.from(containerIdMap.entries()));
        let allIdMap = new Map([...actualIdMap, ...containerIdMap]);

        /**
         * Resolve a connection from a container (machine/factory) to a target node.
         *
         * Strategy (in order):
         * 1. Use allIdMap (from containerIdMap built in Phase 4) — most reliable
         * 2. Search workflowContainers for the machine whose nodes include the terminal node —
         *    this gives us the actual machine-ID so factory detection still works
         * 3. Fall back to node-to-node via the container's terminal node (least preferred —
         *    doesn't trigger factory detection, but at least shows a connection)
         *
         * @param {string} inputId - original container ID (before suffixing)
         * @param {any} inputContainer - UniversalContainer for the machine/factory
         * @param {string} actualNodeId - actual (suffixed) target node ID
         * @param {string} phase - label for logging
         */
        const connectContainerToNode = async (inputId, inputContainer, actualNodeId, phase) => {
            let sourceId = allIdMap.get(inputId);

            if (!sourceId) {
                // Strategy 2: Find the detected machine/factory container via workflowContainers.
                // The terminal node of the inputContainer is already in actualIdMap — find which
                // detected machine/factory in the store owns that node.
                const lastNode = inputContainer.getLastNode && inputContainer.getLastNode();
                const mappedLastNodeId = lastNode ? actualIdMap.get(lastNode.metadata.originalId) : null;

                if (mappedLastNodeId) {
                    const currentContainersNow = get(workflowContainers);
                    // Find the machine container that owns the terminal node
                    const owningMachine = currentContainersNow.find(c =>
                        c.isMachine && c.nodes && c.nodes.some(n => n.id === mappedLastNodeId)
                    );
                    if (owningMachine) {
                        sourceId = owningMachine.id;
                        // Also update containerIdMap and allIdMap so later phases benefit
                        containerIdMap.set(inputId, owningMachine.id);
                        allIdMap.set(inputId, owningMachine.id);
                        console.log(` 🔍 [${phase}] Resolved container '${inputId}' via terminal-node machine lookup: ${owningMachine.id}`);
                    } else if (inputContainer.type === 'factory') {
                        // For factory-type containers, look for a factory container that owns the terminal node
                        const owningFactory = currentContainersNow.find(c =>
                            c.isFactory && (
                                (c.machines || []).some(m => m.nodes && m.nodes.some(n => n.id === mappedLastNodeId)) ||
                                (c.nodeIds || []).includes(mappedLastNodeId)
                            )
                        );
                        if (owningFactory) {
                            sourceId = owningFactory.id;
                            containerIdMap.set(inputId, owningFactory.id);
                            allIdMap.set(inputId, owningFactory.id);
                            console.log(` 🔍 [${phase}] Resolved factory '${inputId}' via terminal-node factory lookup: ${owningFactory.id}`);
                        }
                    }
                }
            }

            if (sourceId) {
                // Container ID is mapped — create a direct container→node connection
                if (createdConnections.some(conn => conn.fromId === sourceId && conn.toId === actualNodeId)) {
                    console.log(` ⏭️ [${phase}] Skipping duplicate connection: ${inputId}(${sourceId}) -> ${actualNodeId}`);
                    return;
                }
                console.log(` [${phase}] Container connection: ${inputId}(${sourceId}) -> ${actualNodeId}`);
                const { connectionActions } = await import('../stores/nodes.js');
                connectionActions.add(sourceId, actualNodeId, 'output', 'input');
                createdConnections.push({ fromId: sourceId, toId: actualNodeId });
            } else {
                // Strategy 3: node-to-node fallback (less ideal — won't trigger factory detection)
                const lastNode = inputContainer.getLastNode && inputContainer.getLastNode();
                const mappedLastNodeId = lastNode ? actualIdMap.get(lastNode.metadata.originalId) : null;
                if (mappedLastNodeId) {
                    if (!createdConnections.some(conn => conn.fromId === mappedLastNodeId && conn.toId === actualNodeId)) {
                        console.log(` 🧩 [${phase}] Fallback terminal-node connection: ${mappedLastNodeId} (terminal of ${inputId}) -> ${actualNodeId}`);
                        const { connectionActions } = await import('../stores/nodes.js');
                        connectionActions.add(mappedLastNodeId, actualNodeId, 'output', 'input');
                        createdConnections.push({ fromId: mappedLastNodeId, toId: actualNodeId });
                    }
                } else {
                    console.warn(` ⚠️ [${phase}] Could not resolve container '${inputId}' — no container mapping and no terminal node found`);
                }
            }
        };

        const createFactoryConnections = async (container) => {
            if (container.type === 'node') {
                const actualNodeId = actualIdMap.get(container.metadata.originalId);

                // Handle inputs from machines (factory-level connections)
                if (container.config.inputs && Array.isArray(container.config.inputs)) {
                    for (const inputId of container.config.inputs) {
                        if (inputId && inputId !== 'none') {
                            // Check if input refers to a machine
                            const inputContainer = universalContainer.findById(inputId);
                            if (inputContainer && inputContainer.type === 'machine') {
                                let sourceId = allIdMap.get(inputId);

                                // Create a connection from machine to node for factory detection
                                if (sourceId && actualNodeId) {
                                    // Check if this connection already exists to prevent duplicates
                                    if (createdConnections.some(conn => conn.fromId === sourceId && conn.toId === actualNodeId)) {
                                        console.log(` ⏭️ Skipping duplicate factory connection: ${inputId}(${sourceId}) -> ${container.metadata.originalId}(${actualNodeId})`);
                                        continue;
                                    }

                                    console.log(` Factory input assignment: ${container.metadata.originalId}(${actualNodeId}) input = ${inputId}(${sourceId})`);

                                    // Create actual connection from machine to node
                                    const { connectionActions } = await import('../stores/nodes.js');
                                    connectionActions.add(sourceId, actualNodeId, 'output', 'input');
                                    createdConnections.push({ fromId: sourceId, toId: actualNodeId });

                                    // Get the machine's output and propagate it to the node
                                    const { getMachineOutput } = await import('../stores/workflows.js');
                                    const machineOutput = getMachineOutput(sourceId);

                                    if (machineOutput) {
                                        // Use nodeActions.addInput which properly handles context chains
                                        const { nodeActions } = await import('../stores/nodes.js');
                                        console.log(`🔗 Adding machine output to node: context chain length: ${machineOutput.context_chain?.length || 0}`);
                                        nodeActions.addInput(actualNodeId, sourceId, machineOutput.value, 1.0, machineOutput.context_chain, machineOutput.sources);
                                    }
                                } else if (actualNodeId) {
                                    // Fallback: container mapping not ready — use terminal node directly
                                    await connectContainerToNode(inputId, inputContainer, actualNodeId, 'Phase 5');
                                }
                            }
                        }
                    }
                }

                // Handle outputs to machines (factory-level connections)
                if (container.config.outputs && Array.isArray(container.config.outputs)) {
                    for (const outputId of container.config.outputs) {
                        if (outputId && outputId !== 'none') {
                            const outputContainer = universalContainer.findById(outputId);
                            if (outputContainer && outputContainer.type === 'machine') {
                                let targetId = allIdMap.get(outputId);

                                if (targetId && actualNodeId) {
                                    if (createdConnections.some(conn => conn.fromId === actualNodeId && conn.toId === targetId)) {
                                        console.log(` ⏭️ Skipping duplicate factory output connection`);
                                        continue;
                                    }

                                    console.log(` Factory output assignment: ${container.metadata.originalId}(${actualNodeId}) output = ${outputId}(${targetId})`);

                                    const { connectionActions } = await import('../stores/nodes.js');
                                    connectionActions.add(actualNodeId, targetId, 'output', 'input');
                                    createdConnections.push({ fromId: actualNodeId, toId: targetId });
                                } else if (actualNodeId) {
                                    await connectContainerToNode(outputId, outputContainer, actualNodeId, 'Phase 5 output');
                                }
                            }
                        }
                    }
                }
            }

            for (const child of container.children) {
                await createFactoryConnections(child);
            }
        };

await createFactoryConnections(universalContainer);

        // Phase 5.5: Wait for factory detection
        console.log('🏭 PHASE 5.5: Waiting for factory detection...');
        let factoryAttempts = 0;
        // Allow more time for factory detection on large graphs
        const maxFactoryAttempts = 15;
        
        while (factoryAttempts < maxFactoryAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const currentFactoryContainers = get(workflowContainers);
            const detectedFactories = currentFactoryContainers.filter(c => c.isFactory);
            
            console.log(`🔍 Factory detection attempt ${factoryAttempts + 1}: Found ${detectedFactories.length} factories`);
            
            if (detectedFactories.length > 0) {
                console.log('✅ Found factories, proceeding with network connections');
                
                // Update container ID mapping with newly detected factories
                for (const factory of detectedFactories) {
                    const matchingFactory = universalContainer.flattenByType('factory').find(f => {
                        const expectedNodeIds = f.flattenByType('node').map(n => actualIdMap.get(n.metadata.originalId)).filter(Boolean);
                        const factoryNodeIds = new Set([
                            ...(factory.machines || []).flatMap(m => m.nodes ? m.nodes.map(n => n.id) : []),
                            ...(factory.nodeIds || [])
                        ]);
                        return expectedNodeIds.some(nodeId => factoryNodeIds.has(nodeId));
                    });
                    
                    if (matchingFactory && !containerIdMap.has(matchingFactory.metadata.originalId)) {
                        containerIdMap.set(matchingFactory.metadata.originalId, factory.id);
                        console.log(`🏭 Mapped factory: ${matchingFactory.metadata.originalId} -> ${factory.id}`);
                    }
                }
                
                // Update allIdMap with new factory mappings
                allIdMap = new Map([...actualIdMap, ...containerIdMap]);
                break;
            }
            
            factoryAttempts++;
        }
        
        if (factoryAttempts >= maxFactoryAttempts) {
            console.log('⚠️ Max factory detection attempts reached, proceeding anyway...');
        }

        // Reconciliation after factory detection: ensure machine->node links exist
        console.log('🧮 PHASE 5R: Reconciling factory (machine→node) links after detection...');
        try {
            const { connections: connStore } = await import('../stores/nodes.js');
            const { get } = await import('svelte/store');
            const ensureMachineContainerLink = async (container) => {
                if (container.type === 'node') {
                    const actualNodeId = actualIdMap.get(container.metadata.originalId);
                    if (container.config.inputs && Array.isArray(container.config.inputs)) {
                        for (const inputId of container.config.inputs) {
                            const inputContainer = universalContainer.findById(inputId);
                            if (inputContainer && inputContainer.type === 'machine') {
                                const mappedMachineId = containerIdMap.get(inputId);
                                if (mappedMachineId && actualNodeId) {
                                    const existing = get(connStore).some(c => c.fromId === mappedMachineId && c.toId === actualNodeId);
                                    if (!existing) {
                                        const { connectionActions } = await import('../stores/nodes.js');
                                        console.log(`🔗 Reconciling machine container link: ${mappedMachineId} -> ${actualNodeId}`);
                                        connectionActions.add(mappedMachineId, actualNodeId, 'output', 'input');
                                        createdConnections.push({ fromId: mappedMachineId, toId: actualNodeId });
                                    }
                                }
                            }
                        }
                    }
                    // Reconcile outputs to machines (node -> machine) for factory detection
                    if (container.config.outputs && Array.isArray(container.config.outputs)) {
                        for (const outputId of container.config.outputs) {
                            const outputContainer = universalContainer.findById(outputId);
                            if (outputContainer && outputContainer.type === 'machine') {
                                const mappedMachineId = containerIdMap.get(outputId);
                                if (mappedMachineId && actualNodeId) {
                                    const existing = get(connStore).some(c => c.fromId === actualNodeId && c.toId === mappedMachineId);
                                    if (!existing && !createdConnections.some(c => c.fromId === actualNodeId && c.toId === mappedMachineId)) {
                                        const { connectionActions } = await import('../stores/nodes.js');
                                        console.log(`🔗 Reconciling machine output container link: ${actualNodeId} -> ${mappedMachineId}`);
                                        connectionActions.add(actualNodeId, mappedMachineId, 'output', 'input');
                                        createdConnections.push({ fromId: actualNodeId, toId: mappedMachineId });
                                    }
                                }
                            }
                        }
                    }
                }
                for (const child of container.children) {
                    await ensureMachineContainerLink(child);
                }
            };
            await ensureMachineContainerLink(universalContainer);
        } catch (e) {
            console.warn('PHASE 5R reconciliation failed:', e);
        }

        // Phase 6: Create network-level connections (factory-to-node)
        console.log('🌐 PHASE 6: Creating network-level connections...');
        
        const createNetworkConnections = async (container) => {
            if (container.type === 'node') {
                const actualNodeId = actualIdMap.get(container.metadata.originalId);
                
                // Handle inputs from factories (network-level connections)
                if (container.config.inputs && Array.isArray(container.config.inputs)) {
                    for (const inputId of container.config.inputs) {
                        if (inputId && inputId !== 'none') {
                            // Check if input refers to a factory or machine
                            const inputContainer = universalContainer.findById(inputId);
                            if (inputContainer && (inputContainer.type === 'factory' || inputContainer.type === 'machine')) {
                                let sourceId = allIdMap.get(inputId);

                                if (actualNodeId) {
                                    // Create a connection from factory/machine to node for network detection
                                    if (sourceId) {
                                        // Check if this connection already exists to prevent duplicates
                                        if (createdConnections.some(conn => conn.fromId === sourceId && conn.toId === actualNodeId)) {
                                            console.log(` ⏭️ Skipping duplicate network connection: ${inputId}(${sourceId}) -> ${container.metadata.originalId}(${actualNodeId})`);
                                            continue;
                                        }

                                        console.log(` 🌐 Network input assignment: ${container.metadata.originalId}(${actualNodeId}) input = ${inputId}(${sourceId})`);

                                        // Create actual connection from factory/machine to node
                                        const { connectionActions } = await import('../stores/nodes.js');
                                        connectionActions.add(sourceId, actualNodeId, 'output', 'input');
                                        createdConnections.push({ fromId: sourceId, toId: actualNodeId });

                                        if (inputContainer.type === 'factory') {
                                            // Get the factory's output and propagate it to the node
                                            const { getFactoryOutput, workflowContainers } = await import('../stores/workflows.js');
                                            const { get } = await import('svelte/store');
                                            const containers = get(workflowContainers);
                                            const factoryContainer = containers.find(c => c.id === sourceId && c.isFactory);

                                            if (factoryContainer) {
                                                const factoryOutput = getFactoryOutput(factoryContainer);
                                                if (factoryOutput) {
                                                    // Use nodeActions.addInput which properly handles context chains
                                                    const { nodeActions } = await import('../stores/nodes.js');
                                                    console.log(`🔗 Adding factory output to node: context chain length: ${factoryOutput.context_chain?.length || 0}`);
                                                    nodeActions.addInput(actualNodeId, sourceId, factoryOutput.value, 1.0, factoryOutput.context_chain, factoryOutput.sources);
                                                }
                                            }
                                        } else if (inputContainer.type === 'machine') {
                                            // Get the machine's output and propagate it to the node
                                            const { getMachineOutput } = await import('../stores/workflows.js');
                                            const machineOutput = getMachineOutput(sourceId);
                                            if (machineOutput) {
                                                const { nodeActions } = await import('../stores/nodes.js');
                                                console.log(`🔗 Adding machine output to network-level node: context chain length: ${machineOutput.context_chain?.length || 0}`);
                                                nodeActions.addInput(actualNodeId, sourceId, machineOutput.value, 1.0, machineOutput.context_chain, machineOutput.sources);
                                            }
                                        }
                                    } else {
                                        // Container not yet mapped — fall back to terminal node
                                        await connectContainerToNode(inputId, inputContainer, actualNodeId, 'Phase 6');
                                    }
                                }
                            }
                        }
                    }
                }

                // Handle outputs to factories/machines (network-level connections)
                if (container.config.outputs && Array.isArray(container.config.outputs)) {
                    for (const outputId of container.config.outputs) {
                        if (outputId && outputId !== 'none') {
                            const outputContainer = universalContainer.findById(outputId);
                            if (outputContainer && (outputContainer.type === 'factory' || outputContainer.type === 'machine')) {
                                let targetId = allIdMap.get(outputId);

                                if (targetId && actualNodeId) {
                                    if (createdConnections.some(conn => conn.fromId === actualNodeId && conn.toId === targetId)) {
                                        console.log(` ⏭️ Skipping duplicate network output connection`);
                                        continue;
                                    }

                                    console.log(` 🌐 Network output assignment: ${container.metadata.originalId}(${actualNodeId}) output = ${outputId}(${targetId})`);

                                    const { connectionActions } = await import('../stores/nodes.js');
                                    connectionActions.add(actualNodeId, targetId, 'output', 'input');
                                    createdConnections.push({ fromId: actualNodeId, toId: targetId });
                                } else if (actualNodeId) {
                                    await connectContainerToNode(outputId, outputContainer, actualNodeId, 'Phase 6 output');
                                }
                            }
                        }
                    }
                }
            }

            for (const child of container.children) {
                await createNetworkConnections(child);
            }
        };

        await createNetworkConnections(universalContainer);

        // Reconciliation after network detection: ensure factory->node container links exist
        // Also rebuild allIdMap with any newly mapped containers from Phase 5.5
        allIdMap = new Map([...actualIdMap, ...containerIdMap]);
        console.log('🧮 PHASE 6R: Reconciling network (factory→node) links after detection...');
        try {
            const { connections: connStore } = await import('../stores/nodes.js');
            const { get } = await import('svelte/store');
            const ensureFactoryContainerLink = async (container) => {
                if (container.type === 'node') {
                    const actualNodeId = actualIdMap.get(container.metadata.originalId);
                    if (container.config.inputs && Array.isArray(container.config.inputs)) {
                        for (const inputId of container.config.inputs) {
                            const inputContainer = universalContainer.findById(inputId);
                            if (inputContainer && (inputContainer.type === 'factory' || inputContainer.type === 'machine')) {
                                const mappedContainerId = containerIdMap.get(inputId);
                                if (mappedContainerId && actualNodeId) {
                                    const exists = get(connStore).some(c => c.fromId === mappedContainerId && c.toId === actualNodeId);
                                    if (!exists) {
                                        const { connectionActions } = await import('../stores/nodes.js');
                                        console.log(`🔗 Reconciling ${inputContainer.type} container link: ${mappedContainerId} -> ${actualNodeId}`);
                                        connectionActions.add(mappedContainerId, actualNodeId, 'output', 'input');
                                        createdConnections.push({ fromId: mappedContainerId, toId: actualNodeId });
                                    }
                                } else if (!mappedContainerId && actualNodeId) {
                                    // Container still not mapped — check if we already have a terminal-node connection
                                    const lastNode = inputContainer.getLastNode && inputContainer.getLastNode();
                                    const mappedLastNodeId = lastNode ? actualIdMap.get(lastNode.metadata.originalId) : null;
                                    if (mappedLastNodeId) {
                                        const exists = get(connStore).some(c => c.fromId === mappedLastNodeId && c.toId === actualNodeId);
                                        if (!exists && !createdConnections.some(c => c.fromId === mappedLastNodeId && c.toId === actualNodeId)) {
                                            const { connectionActions } = await import('../stores/nodes.js');
                                            console.log(`🧩 Phase 6R: Terminal-node fallback: ${mappedLastNodeId} (terminal of ${inputId}) -> ${actualNodeId}`);
                                            connectionActions.add(mappedLastNodeId, actualNodeId, 'output', 'input');
                                            createdConnections.push({ fromId: mappedLastNodeId, toId: actualNodeId });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // Reconcile outputs to factories/machines (node -> factory/machine)
                    if (container.config.outputs && Array.isArray(container.config.outputs)) {
                        for (const outputId of container.config.outputs) {
                            const outputContainer = universalContainer.findById(outputId);
                            if (outputContainer && (outputContainer.type === 'factory' || outputContainer.type === 'machine')) {
                                const mappedContainerId = containerIdMap.get(outputId);
                                if (mappedContainerId && actualNodeId) {
                                    const exists = get(connStore).some(c => c.fromId === actualNodeId && c.toId === mappedContainerId);
                                    if (!exists && !createdConnections.some(c => c.fromId === actualNodeId && c.toId === mappedContainerId)) {
                                        const { connectionActions } = await import('../stores/nodes.js');
                                        console.log(`🔗 Reconciling network output container link: ${actualNodeId} -> ${mappedContainerId}`);
                                        connectionActions.add(actualNodeId, mappedContainerId, 'output', 'input');
                                        createdConnections.push({ fromId: actualNodeId, toId: mappedContainerId });
                                    }
                                }
                            }
                        }
                    }
                }
                for (const child of container.children) {
                    await ensureFactoryContainerLink(child);
                }
            };
            await ensureFactoryContainerLink(universalContainer);
        } catch (e) {
            console.warn('PHASE 6R reconciliation failed:', e);
        }

        // Phase 6.5: Wait for network detection to stabilize
        console.log('🌐 PHASE 6.5: Waiting for network detection...');
        let networkAttempts = 0;
        const maxNetworkAttempts = 15;
        while (networkAttempts < maxNetworkAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const containersNow = get(workflowContainers);
            const detectedNetworks = containersNow.filter(c => c.isNetwork);
            console.log(`🔍 Network detection attempt ${networkAttempts + 1}: Found ${detectedNetworks.length} networks`);

            // Basic stability check: if we have at least one network or no networks were expected
            const expectedNetworks = universalContainer.flattenByType('factory').length > 0 ? 1 : 0;
            if (detectedNetworks.length >= expectedNetworks) {
                break;
            }
            networkAttempts++;
        }
        if (networkAttempts >= maxNetworkAttempts) {
            console.log('⚠️ Max network detection attempts reached, proceeding anyway...');
        }

        // Wait for factory detection and re-map containers if we have factories
        if (universalContainer.type === 'factory' || universalContainer.type === 'network') {
            await new Promise(resolve => setTimeout(resolve, 300));

            // Re-detect and map factory containers
            const { get } = await import('svelte/store');
            const { workflowContainers } = await import('../stores/workflows.js');
            const updatedContainers = get(workflowContainers);
            const factoryContainers = updatedContainers.filter(c => c.isFactory);

            // Map any newly created factory containers
            for (const factoryContainer of factoryContainers) {
                if (!containerIdMap.has(factoryContainer.id)) {
                    // Find the matching factory in the universal container
                    const findFactoryById = (container, targetId) => {
                        if (container.type === 'factory' && container.metadata.originalId === targetId) {
                            return container;
                        }
                        for (const child of container.children) {
                            const found = findFactoryById(child, targetId);
                            if (found) return found;
                        }
                        return null;
                    };

                    const matchingFactory = findFactoryById(universalContainer, factoryContainer.id);
                    if (matchingFactory) {
                        containerIdMap.set(matchingFactory.metadata.originalId, factoryContainer.id);
                        console.log(`🏭 Mapped newly detected factory: ${matchingFactory.metadata.originalId} -> ${factoryContainer.id}`);
                    }
                }
            }

            // Update the allIdMap with new container mappings
            allIdMap = new Map([...actualIdMap, ...containerIdMap]);
        }

        // Phase 7: Auto-organize containers (networks → factories → machines)
        console.log('📐 PHASE 7: Auto-organizing containers...');
        try {
            const { workflowContainers, workflowActions } = await import('../stores/workflows.js');

            // Wait a bit more for organize to have stable container data
            await new Promise(resolve => setTimeout(resolve, 300));

            // workflowContainers is a flat array: [...networks, ...factories, ...machines]
            const containersArr = get(workflowContainers);
            const networks = containersArr.filter(c => c.isNetwork);
            const factories = containersArr.filter(c => c.isFactory);
            const machines = containersArr.filter(c => c.isMachine);

            // Organize networks first (outermost), then factories, then machines
            if (networks.length > 0) {
                console.log(`📐 Organizing ${networks.length} network(s)...`);
                for (const network of networks) {
                    workflowActions.organize(network.id);
                }
            } else if (factories.length > 0) {
                console.log(`📐 Organizing ${factories.length} factory(ies)...`);
                for (const factory of factories) {
                    workflowActions.organize(factory.id);
                }
            } else if (machines.length > 0) {
                console.log(`📐 Organizing ${machines.length} machine(s)...`);
                for (const machine of machines) {
                    workflowActions.organize(machine.id);
                }
            } else {
                console.log('📐 No containers to organize');
            }

            // Wait for organize to settle
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log('✅ Auto-organize complete');
        } catch (e) {
            console.warn('⚠️ Auto-organize failed (non-critical):', e);
        }

        return {
            success: true,
            createdNodes,
            createdConnections,
            configType: universalContainer.type,
            containerId: containerIdMap.get(universalContainer.metadata.originalId)
        };
    } catch (error) {
        console.error('❌ Failed to paste using universal system:', error);
        console.error('❌ Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return { success: false, error: error.message };
    } finally {
        // Always clear loading mode when done
        window.ordinalLoadingMode = false;
        console.log('✅ Cleared loading mode - auto-execution re-enabled');
    }
}

// Legacy paste function removed - now using pasteAndCreateConfigUniversal

/**
 * Paste configuration from clipboard
 */
export async function pasteConfig() {
    try {
        // First try to read from system clipboard
        const systemResult = await readText();
        
        if (systemResult.success) {
            const clipboardText = systemResult.text.trim();
            
            // Try to parse as JSON first (structured config)
            try {
                const data = JSON.parse(clipboardText);
                if (data.type === 'node_config' || data.type === 'machine_config' || data.type === 'factory_config' || data.type === 'network_config') {
                    return {
                        success: true,
                        type: data.type,
                        data: data,
                        method: 'system'
                    };
                }
            } catch (parseError) {
                // Not JSON, try as YAML
                try {
                    const yamlData = yamlParse(clipboardText);
                    
                    // Check if it's a config YAML (logic, node, machine, factory, or network)
                    if (yamlData && (yamlData.logic || yamlData.node_type || yamlData.node || yamlData.machine || yamlData.factory || yamlData.network)) {
                        return {
                            success: true,
                            type: 'raw_yaml',
                            data: { config: clipboardText, parsedYaml: yamlData },
                            method: 'system'
                        };
                    }
                    
                    // Check if it's a machine/factory config (YAML with type field)
                    if (yamlData && (yamlData.type === 'machine_config' || yamlData.type === 'factory_config')) {
                        return {
                            success: true,
                            type: yamlData.type,
                            data: yamlData,
                            method: 'system'
                        };
                    }
                } catch (yamlError) {
                    // Not valid YAML either
                }
            }
        }
        
        // Fall back to internal clipboard
        if (internalClipboard.type && internalClipboard.data) {
            const age = Date.now() - internalClipboard.timestamp;
            // Only use internal clipboard if it's less than 1 hour old
            if (age < 3600000) {
                return {
                    success: true,
                    type: internalClipboard.type,
                    data: internalClipboard.data,
                    method: 'internal'
                };
            }
        }
        
        return { success: false, error: 'No valid config found in clipboard' };
    } catch (error) {
        console.error('Failed to paste config:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Check if there's a valid config in clipboard
 */
export async function hasConfig() {
    const result = await pasteConfig();
    return result.success;
}

/**
 * Clear internal clipboard
 */
export function clearClipboard() {
    internalClipboard = {
        type: null,
        data: null,
        timestamp: null
    };
}

/**
 * Get clipboard status
 */
export function getClipboardStatus() {
    return {
        hasInternal: internalClipboard.type !== null,
        internalType: internalClipboard.type,
        internalAge: internalClipboard.timestamp ? Date.now() - internalClipboard.timestamp : null,
        isSecure: navigator.clipboard && window.isSecureContext
    };
}
