import { writable, get } from 'svelte/store';
import { NodeData } from '../lib/NodeData.js';
import { NodeTypeRegistry } from '../lib/NodeTypeRegistry.js';
import { parse as yamlParse } from 'yaml';
import { settings, settingsActions } from './settings.js';
import { getNodeMeta, isPassiveType, isInputless } from '../lib/nodeTypes.js';
// Import Rhode API adapter (replaces Wails bindings)
import { readTextFile, selectTextFile, selectPDFFile, readPDFFile } from '../lib/rhodeApi.js';
// Compatibility wrapper
const ReadTextFile = async (path) => (await readTextFile(path)).content;
const SelectTextFile = selectTextFile;
const SelectPDFFile = selectPDFFile;
const ReadPDFText = async (path) => (await readPDFFile(path)).content;

/**
 * @typedef {import('../lib/NodeData.js').ContextChainItem} ContextChainItem
 * @typedef {import('../lib/NodeData.js').StructuredContext} StructuredContext
 * @typedef {import('../lib/NodeData.js').NodeOutput} NodeOutput
 */

/**
 * @typedef {object} CanvasNode
 * @property {string} id
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {string} content
 * @property {string} title
 * @property {number} created
 * @property {boolean} locked
 * @property {{requirements?: string[], nodeType?: string, [key: string]: any}} [config] - Node config including requirements traceability
 */

// History will be imported dynamically to avoid circular deps
/** @type {any} */
let historyActions = null;
/** @type {any} */
let moveDebounceTimer = null;
setTimeout(async () => {
    const module = await import('./canvasHistory.js');
    historyActions = module.historyActions;
}, 0);

/**
 * @typedef {object} Connection
 * @property {string} id
 * @property {string} fromId
 * @property {string} toId
 * @property {any} fromPort
 * @property {any} toPort
 * @property {number} created
 * @property {'normal' | 'loop'} [type] - Connection type: 'normal' (default) or 'loop' (back-edge)
 * @property {number} [loop_count] - Number of iterations for loop connections (default: 1)
 */

// Nodes on the canvas - now with YAML backend
/** @type {import('svelte/store').Writable<CanvasNode[]>} */
export const nodes = writable([]);

// Node data store - maps node IDs to NodeData instances
/** @type {import('svelte/store').Writable<Map<string, NodeData>>} */
export const nodeDataStore = writable(new Map());

// Connections between nodes
/** @type {import('svelte/store').Writable<Connection[]>} */
export const connections = writable([]);

// Cross-machine connections (deferred for factory detection)
// These connections span across YAML machine boundaries and should NOT
// be used by detectMachines() Union-Find, only by detectFactories()
/** @type {import('svelte/store').Writable<Connection[]>} */
export const crossMachineConnections = writable([]);

// Helper function to get next node number
/**
 * @param {CanvasNode[]} nodeList
 */
function getNextNodeNumber(nodeList) {
    const nodeNumbers = nodeList
        .filter(n => n.id && n.id.startsWith('node-'))
        .map(n => parseInt(n.id.split('-')[1]))
        .filter(n => !isNaN(n));
    return nodeNumbers.length > 0 ? Math.max(...nodeNumbers) + 1 : 1;
}

// Helper functions for node operations
export const nodeActions = {
    /**
     * @param {string} type
     * @param {number} x
     * @param {number} y
     * @param {string} [content]
     * @returns {CanvasNode}
     */
    add: (type, x, y, content = '') => {
        const currentNodes = get(nodes);
        const nodeNumber = getNextNodeNumber(currentNodes);
        const id = `node-${nodeNumber}`;

        // Use the NodeTypeRegistry to create both canvas node and NodeData in one call.
        // The registry handles all type-specific defaults, dimensions, and titles.
        const { canvasNode, nodeData } = NodeTypeRegistry.create(type, id, content, x, y);

        // Update stores — single code path for all types
        nodes.update(n => [...n, canvasNode]);
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            newStore.set(id, nodeData);
            return newStore;
        });

        // Run the type's onCreated hook (e.g. file-selection prompts for file source nodes).
        // The hook receives nodeActions so it can call selectFileForTextFileSource etc.
        const onCreated = NodeTypeRegistry.getOnCreatedHook(type);
        if (onCreated) {
            onCreated(id, nodeData, nodeActions);
        }

        // Note: Content staging is handled by the clipboard.js content flow phase.
        // Individual node creation does not trigger any execution or staging.

        // Record action for history AFTER stores have updated
        if (historyActions && !historyActions.isHistoryAction()) {
            // Small delay to ensure stores have propagated
            setTimeout(() => {
                historyActions.record(`Add ${type} node`);
            }, 10);
        }

        return canvasNode;
    },
    
    /**
     * @param {string} id
     * @param {{content?: string, x?: number, y?: number, width?: number, height?: number, title?: string, locked?: boolean}} updates
     */
    update: (id, updates) => {
        // console.log(`Updating node ${id} with:`, updates);
        
        // Update visual node
        nodes.update(n => n.map(node => 
            node.id === id ? { ...node, ...updates } : node
        ));

        // Update YAML backend data if content changed (without triggering auto-execution)
        if (updates.content !== undefined) {
            nodeDataStore.update(store => {
                const newStore = new Map(store);
                const nodeData = newStore.get(id);
                if (nodeData) {
                    // Set content directly without triggering auto-execution
                    nodeData.data.content = String(updates.content ?? nodeData.data.content ?? '');
                    nodeData.data.metadata.version++;
                    nodeData.data.metadata.modified = true;
                    // Manually trigger _updateOutput to rebuild context without auto-execution
                    nodeData._updateOutput();
                    newStore.set(id, nodeData);
                }
                return newStore;
            });
        }
        
        // Record action for history AFTER update completes
        if (updates.content !== undefined && historyActions && !historyActions.isHistoryAction()) {
            setTimeout(() => {
                historyActions.record('Update node content');
            }, 10);
        }
    },
    
    /**
     * @param {string} id
     * @param {number} x
     * @param {number} y
     */
    move: (id, x, y) => {
        nodes.update(n => n.map(node => 
            node.id === id ? { ...node, x, y } : node
        ));
        
        // Record action for history (debounced to avoid recording every pixel)
        if (historyActions && !historyActions.isHistoryAction()) {
            if (moveDebounceTimer) clearTimeout(moveDebounceTimer);
            moveDebounceTimer = setTimeout(() => {
                historyActions.record('Move node');
            }, 500);
        }
    },

    /**
     * @param {Map<string, {x?: number, y?: number, newX?: number, newY?: number}> | Array<{nodeId: string, x?: number, y?: number, newX?: number, newY?: number}>} moves
     */
    bulkMove: (moves) => {
        if (!moves) {
            return;
        }

        /** @type {Map<string, {x?: number, y?: number, newX?: number, newY?: number}>} */
        let moveMap;
        if (moves instanceof Map) {
            moveMap = moves;
        } else if (Array.isArray(moves)) {
            moveMap = new Map();
            moves.forEach(move => {
                if (!move || !move.nodeId) {
                    return;
                }
                const targetX = move.newX ?? move.x;
                const targetY = move.newY ?? move.y;
                if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
                    return;
                }
                moveMap.set(move.nodeId, { x: targetX, y: targetY });
            });
        } else {
            return;
        }

        if (!moveMap || moveMap.size === 0) {
            return;
        }

        let didMutate = false;
        nodes.update(n => {
            if (!Array.isArray(n) || n.length === 0) {
                return n;
            }

            const updated = n.map(node => {
                if (!moveMap.has(node.id)) {
                    return node;
                }

                const target = moveMap.get(node.id);
                const xVal = Number(target?.x);
                const yVal = Number(target?.y);
                if (!Number.isFinite(xVal) || !Number.isFinite(yVal)) {
                    return node;
                }
                const roundedX = Math.round(xVal);
                const roundedY = Math.round(yVal);
                if (!Number.isFinite(roundedX) || !Number.isFinite(roundedY)) {
                    return node;
                }

                if (node.x === roundedX && node.y === roundedY) {
                    return node;
                }

                didMutate = true;
                return { ...node, x: roundedX, y: roundedY };
            });

            return didMutate ? updated : n;
        });

        if (!didMutate) {
            return;
        }

        if (historyActions && !historyActions.isHistoryAction()) {
            if (moveDebounceTimer) clearTimeout(moveDebounceTimer);
            moveDebounceTimer = setTimeout(() => {
                historyActions.record(moveMap.size === 1 ? 'Move node' : 'Move nodes');
            }, 500);
        }
    },
    
    /**
     * @param {string} id
     */
    delete: (id) => {
        console.log('🗑️ Deleting node:', id);
        
        // Remove visual node
        nodes.update(n => n.filter(node => node.id !== id));
        
        // Remove YAML backend data
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            newStore.delete(id);
            return newStore;
        });
        
        // Remove any connections to/from this node (including container connections)
        connections.update(c => {
            const filteredConnections = c.filter(conn => {
                // Remove direct node connections
                if (conn.fromId === id || conn.toId === id) {
                    console.log('🔗 Removing direct connection:', conn.id);
                    return false;
                }
                
                // Remove container-to-node connections where this node is the target
                if (conn.toId === id && (conn.fromId.startsWith('machine-') || 
                                        conn.fromId.startsWith('factory-') || 
                                        conn.fromId.startsWith('network-'))) {
                    console.log('🔗 Removing container connection:', conn.id, 'from', conn.fromId, 'to', id);
                    return false;
                }
                
                // Remove node-to-container connections where this node is the source
                if (conn.fromId === id && (conn.toId.startsWith('machine-') || 
                                          conn.toId.startsWith('factory-') || 
                                          conn.toId.startsWith('network-'))) {
                    console.log('🔗 Removing node-to-container connection:', conn.id, 'from', id, 'to', conn.toId);
                    return false;
                }
                
                return true;
            });
            
            console.log(`🔗 Connection cleanup: ${c.length} -> ${filteredConnections.length}`);
            return filteredConnections;
        });
        
        console.log('✅ Node deletion completed:', id);
        
        // Record action for history AFTER deletion completes
        if (historyActions && !historyActions.isHistoryAction()) {
            setTimeout(() => {
                historyActions.record('Delete node');
            }, 10);
        }
    },

    // Toggle lock state of a node
    /**
     * @param {string} id
     */
    toggleLock: (id) => {
        /** @type {boolean | undefined} */
        let isLocked;
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(id);
            if (nodeData) {
                nodeData.data.metadata.locked = !nodeData.data.metadata.locked;
                isLocked = nodeData.data.metadata.locked;
                newStore.set(id, nodeData);
            }
            return newStore;
        });

        if (isLocked !== undefined) {
            nodes.update(n => n.map(node => 
                node.id === id ? { ...node, locked: !!isLocked } : node
            ));
        }

        if (historyActions && !historyActions.isHistoryAction()) {
            setTimeout(() => {
                historyActions.record(isLocked ? 'Lock node' : 'Unlock node');
            }, 10);
        }
    },

    // Get YAML backend data for a node
    /**
     * @param {string} id
     * @returns {NodeData | undefined}
     */
    getNodeData: (id) => {
        /** @type {NodeData | undefined} */
        let nodeData;
        const unsubscribe = nodeDataStore.subscribe(store => {
            nodeData = store.get(id);
        });
        unsubscribe();
        return nodeData;
    },

    // Export node as YAML
    /**
     * @param {string} id
     * @returns {string | null}
     */
    exportNodeYAML: (id) => {
        const nodeData = nodeActions.getNodeData(id);
        return nodeData ? nodeData.toYAML() : null;
    },

    // Add input to a node (for data flow)
    /**
     * @param {string} nodeId
     * @param {string} sourceId
     * @param {StructuredContext | string | any} data
     * @param {number} [weight]
     * @param {ContextChainItem[] | null} [contextChain]
     * @param {string[] | null} [sources]
     */
    addInput: (nodeId, sourceId, data, weight = 1.0, contextChain = null, sources = null) => {
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(nodeId);
            if (nodeData) {
                try {
                    nodeData.addInput(sourceId, data, weight, contextChain, sources);
                    newStore.set(nodeId, nodeData);
                    
                    // Input nodes should not change their visible content; passive types show received data
                    if (isPassiveType(nodeData.data.node_type) && nodeData.data.node_type !== 'input') {
                        const out = nodeData.data.output;
                        let displayContent = '';
                        if (out && out.type === 'text' && typeof out.value === 'string') {
                            displayContent = out.value;
                        } else if (out && out.type === 'structured_context') {
                            const ctx = /** @type {import('../lib/NodeData.js').StructuredContext} */ (out.value);
                            const facts = Array.isArray(ctx?.facts) ? ctx.facts : [];
                            displayContent = facts.join('\n');
                        }
                        nodes.update(n => n.map(node => 
                            node.id === nodeId ? { ...node, content: displayContent } : node
                        ));
                    }
                    
                    // Propagation is now handled recursively from the initial trigger,
                    // so we don't need to re-trigger it here.
                } catch (/** @type {any} */ error) {
                    console.error(`Error adding input to node ${nodeId}:`, error.message);
                }
            }
            return newStore;
        });
    },

    // Select a PDF for a pdf_file_source node
    /**
     * @param {string} id
     */
    /**
     * @param {string} id
     */
    selectFileForPdfFileSource: async (id) => {
        try {
            // Match text file source desktop detection pattern for reliability
            const isDesktop = typeof window !== 'undefined' && (/** @type {any} */ (window)).go && (/** @type {any} */ (window)).go.app && (/** @type {any} */ (window)).go.app.App;
            const hasBinding = typeof SelectPDFFile === 'function';
            const hasWindowBinding = typeof window !== 'undefined' && (/** @type {any} */ (window)).go && (/** @type {any} */ (window)).go.app && (/** @type {any} */ (window)).go.app.App && typeof (/** @type {any} */ (window)).go.app.App.SelectPDFFile === 'function';

            if (!isDesktop) {
                // Browser mode - we can't reliably parse PDFs; record filename only
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/pdf';
                input.onchange = async () => {
                    const file = input.files && input.files[0];
                    if (file) {
                        nodes.update(n => n.map(node => node.id === id ? { ...node, content: `Selected PDF: ${file.name} (browser mode)` } : node));
                        nodeDataStore.update(store => {
                            const newStore = new Map(store);
                            const nodeData = newStore.get(id);
                            if (nodeData) {
                                nodeData.data.metadata.lastSavedPath = file.name;
                                newStore.set(id, nodeData);
                            }
                            return newStore;
                        });
                    }
                    document.body.removeChild(input);
                };
                document.body.appendChild(input);
                input.click();
            } else {
                // Desktop mode via Wails bindings
                let filePath = '';
                if (hasBinding) {
                    filePath = await SelectPDFFile();
                } else if (hasWindowBinding) {
                    filePath = await (/** @type {any} */ (window)).go.app.App.SelectPDFFile();
                } else {
                    throw new Error('Wails PDF selection binding not available. Run wails dev/build to generate bindings.');
                }
                if (filePath) {
                    // Update last used directory in settings
                    try {
                        const sep = filePath.includes('\\') ? '\\' : '/';
                        const idx = filePath.lastIndexOf(sep);
                        if (idx > 0) {
                            const dir = filePath.slice(0, idx);
                            settingsActions.update('lastFileDirectory', dir);
                        }
                    } catch {}
                    await nodeActions.loadPdfContent(id, filePath);
                }
            }
        } catch (err) {
            console.error('PDF selection error:', err);
            const errMsg = (/** @type {any} */ (err))?.message ?? String(err);
            nodes.update(n => n.map(node => node.id === id ? { ...node, content: `Error: ${errMsg}` } : node));
        }
    },

    // Load PDF content via backend and populate node
    /**
     * @param {string} id
     * @param {string} filePath
     */
    /**
     * @param {string} id
     * @param {string} filePath
     */
    loadPdfContent: async (id, filePath) => {
        try {
            const hasBinding = typeof ReadPDFText === 'function';
            const hasWindowBinding = typeof window !== 'undefined' && (/** @type {any} */ (window)).go && (/** @type {any} */ (window)).go.app && (/** @type {any} */ (window)).go.app.App && typeof (/** @type {any} */ (window)).go.app.App.ReadPDFText === 'function';
            let content = '';
            if (hasBinding) {
                content = await ReadPDFText(filePath);
            } else if (hasWindowBinding) {
                content = await (/** @type {any} */ (window)).go.app.App.ReadPDFText(filePath);
            } else {
                throw new Error('Wails PDF read binding not available. Run wails dev/build to generate bindings.');
            }

            // Update visual node
            nodes.update(n => n.map(node => node.id === id ? { ...node, content } : node));

            // Update NodeData with content and context chain
            nodeDataStore.update(store => {
                const newStore = new Map(store);
                const nodeData = newStore.get(id);
                if (nodeData) {
                    nodeData.data.filePath = filePath;
                    nodeData.data.content = content;
                    nodeData.data.metadata = nodeData.data.metadata || {};
                    nodeData.data.metadata.meta_type = 'file_source';
                    nodeData.data.metadata.file_format = 'pdf';
                    nodeData.data.output = {
                        type: 'structured_context',
                        value: { facts: [content], history: [], task: '' },
                        sources: [id],
                        context_chain: [{
                            node_id: id,
                            type: 'pdf_file_source',
                            contribution: { type: 'fact', content: content },
                            processing: 'pdf_load',
                            timestamp: new Date().toISOString()
                        }]
                    };
                    newStore.set(id, nodeData);
                }
                return newStore;
            });

            // Propagate updated output to all connected downstream nodes
            const conns = get(connections).filter(c => c.fromId === id);
            const out = get(nodeDataStore).get(id)?.data?.output;
            if (out && conns.length > 0) {
                const { type, value, context_chain, sources } = out;
                const inputData = (type === 'structured_context') ? value : { facts: [value], history: [], task: '' };
                conns.forEach(conn => {
                    nodeActions.addInput(conn.toId, id, inputData, 1.0, context_chain, sources);
                });
            }
        } catch (err) {
            const errorContent = `Error loading PDF:\n${filePath}\n\n${err}`;
            nodes.update(n => n.map(node => node.id === id ? { ...node, content: errorContent } : node));
        }
    },

    // Remove input from a node
    /**
     * @param {string} nodeId
     * @param {string} sourceId
     */
    removeInput: (nodeId, sourceId) => {
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(nodeId);
            if (nodeData) {
                nodeData.removeInput(sourceId);
                newStore.set(nodeId, nodeData);
                
                // Update visual node content - for input and passive types, restore with their original content
                if (isPassiveType(nodeData.data.node_type)) {
                    // For input nodes, preserve their original content, don't replace with processed output
                    const displayContent = nodeData.data.node_type === 'input' 
                        ? nodeData.data.content 
                        : (typeof nodeData.data.output.value === 'string' 
                            ? nodeData.data.output.value 
                            : nodeData.data.content);
                    
                    nodes.update(n => n.map(node => 
                        node.id === nodeId ? { ...node, content: displayContent } : node
                    ));
                }
            }
            return newStore;
        });
    },

    // Set node execution state
    /**
     * @param {string} id
     */
    setNodeExecuting: async (id) => {
        // First, check if this is a text_file_output node and ensure file exists
        const nodeData = get(nodeDataStore).get(id);
        if (nodeData && nodeData.data?.node_type === 'text_file_output') {
            console.log('Text file output node is executing, ensuring file exists...');

            try {
                // Get the plugin to call ensureFileExists
                const { pluginRegistry } = await import('../plugins/core/registry.js');
                const plugin = pluginRegistry.getPlugin('text-file-output');
                let ensured = false;

                // Check if this specific plugin has ensureFileExists method
                // @ts-ignore - ensureFileExists is specific to TextGeneratePlugin
                if (plugin && typeof plugin.ensureFileExists === 'function') {
                    console.log('Calling plugin.ensureFileExists...');
                    // @ts-ignore - ensureFileExists is specific to TextGeneratePlugin
                    ensured = await plugin.ensureFileExists(nodeData.data);
                    console.log('ensureFileExists result:', ensured);
                } else {
                    console.warn('Plugin or ensureFileExists method not found; using fallback.');
                }

                // Fallback: ensure via Wails directly if plugin missing/failed
                if (!ensured) {
                    const nd = nodeData.data;
                    const filePath = nd?.metadata?.lastSavedPath || nd?.metadata?.autoSavePath || nd?.filePath;
                    if (filePath && typeof window !== 'undefined' && (/** @type {any} */ (window)).go?.app?.App) {
                        try {
                            await (/** @type {any} */ (window)).go.app.App.ReadTextFile(filePath);
                            console.log(`Fallback: file already exists: ${filePath}`);
                        } catch {
                            try {
                                const placeholder = '# Generated Content\n\nContent will appear here after processing...\n';
                                await (/** @type {any} */ (window)).go.app.App.WriteTextFile(filePath, placeholder);
                                console.log(`Fallback: created placeholder file: ${filePath}`);
                            } catch (e) {
                                console.warn('Fallback ensure failed to create file:', e);
                            }
                        }
                    } else if (!filePath) {
                        console.warn('Fallback ensure skipped: no file path configured for text_file_output node');
                    }
                }
            } catch (error) {
                console.error('Error ensuring file exists:', error);
            }
        }

        // Then update the execution state
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(id);
            if (nodeData) {
                nodeData.setExecuting();
                newStore.set(id, nodeData);
            }
            return newStore;
        });
    },

    /**
     * @param {string} id
     * @param {string | NodeOutput | null | undefined} [result]
     */
    setNodeCompleted: (id, result = null) => {
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(id);
            if (nodeData) {
                // Coerce result to string for NodeData API and UI updates
                /** @type {string | null} */
                let resultString = null;
                if (typeof result === 'string') {
                    resultString = result;
                } else if (result && typeof result === 'object' && 'value' in result) {
                    const candidate = /** @type {any} */ (result).value;
                    resultString = typeof candidate === 'string' ? candidate : null;
                }
                nodeData.setCompleted(resultString);
                newStore.set(id, nodeData);
                
                // Update visual node content for AI nodes and artifact output nodes
                if ((nodeData.data.node_type === 'ai' || nodeData.data.node_type === 'text_file_output') && resultString) {
                    nodes.update(n => n.map(node => 
                        node.id === id ? { ...node, content: resultString } : node
                    ));
                }
            }
            return newStore;
        });
    },

    /**
     * @param {string} id
     * @param {unknown} error
     */
    setNodeError: (id, error) => {
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(id);
            if (nodeData) {
                nodeData.setError(error);
                newStore.set(id, nodeData);
            }
            return newStore;
        });
    },

    // Reset node data to clear accumulated context/history
    // BUT preserve dynamic context from connected sources
    /**
     * @param {string} id
     */
    resetNodeData: (id) => {
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(id);
            if (nodeData) {
                // PRESERVE dynamic inputs from connected sources before reset
                const preservedInputs = nodeData.data.inputs ? nodeData.data.inputs.filter(input => {
                    // Preserve inputs that came from dynamic context flow (have context_chain)
                    return input.context_chain && input.context_chain.length > 0;
                }) : [];
                
                // Reset the node data to initial state based on type
                const nodeType = nodeData.data.node_type;
                const content = nodeData.data.content;
                
                switch (nodeType) {
                    case 'input':
                    case 'static':
                        nodeData.data.output = {
                            type: 'structured_context',
                            value: {
                                facts: content ? [content] : [],
                                history: [],
                                task: ""
                            },
                            sources: [id], // Keep self as source
                            context_chain: [{
                                node_id: id,
                                type: nodeType,
                                contribution: {
                                    type: 'fact',
                                    content: content
                                },
                                processing: 'static',
                                timestamp: new Date().toISOString()
                            }]
                        };
                        break;
                    case 'ai':
                        nodeData.data.output = {
                            type: 'structured_context',
                            value: { facts: [], history: [], task: "" },
                            sources: [],
                            context_chain: []
                        };
                        break;
                }
                
                // Clear inputs and reset execution state
                nodeData.data.inputs = [];
                nodeData.data.execution = {
                    state: 'idle',
                    started_at: null,
                    completed_at: null,
                    error: null
                };
                
                // RESTORE preserved dynamic inputs from connected sources
                if (preservedInputs.length > 0) {
                    nodeData.data.inputs = [...preservedInputs];
                    console.log(`🔄 Preserved ${preservedInputs.length} dynamic inputs for node ${id} during reset`);
                }
                
                newStore.set(id, nodeData);
            }
            return newStore;
        });
    },

    // Apply config from clipboard to a node
    /**
     * @param {string} id
     * @param {any} config
     */
    applyNodeConfig: (id, config) => {
        try {
            // Parse the YAML config if it's a string
            let configData;
            if (typeof config === 'string') {
                // Try concise node YAML first
                try {
                    const parsed = yamlParse(config);
                    if (parsed && parsed.node) {
                        // Patch existing NodeData instead of full overwrite
                        nodeDataStore.update(store => {
                            const newStore = new Map(store);
                            let existing = newStore.get(id);
                            if (!existing) {
                                existing = new NodeData(parsed.node.type || 'static', id);
                            }
                            // Update node type if provided
                            if (parsed.node.type) {
                                existing.data.node_type = parsed.node.type;
                            }
                            // Set content directly without triggering auto-execution
                            if (parsed.node.content !== undefined) {
                                existing.data.content = parsed.node.content || '';
                                existing.data.metadata.version++;
                                existing.data.metadata.modified = true;
                            }
                            // AI node: apply model/temperature overrides from concise config
                            if ((parsed.node.type === 'ai' || existing.data.node_type === 'ai')) {
                                existing.data.processing = existing.data.processing || {};
                                if (parsed.node.model !== undefined) {
                                    if (parsed.node.model) existing.data.processing.model_override = parsed.node.model;
                                    else delete existing.data.processing.model_override;
                                }
                                if (parsed.node.temperature !== undefined) {
                                    existing.data.processing.parameters = existing.data.processing.parameters || {};
                                    existing.data.processing.parameters.temperature = parsed.node.temperature;
                                }
                            }
                            // Map file_path or legacy file_source to filePath for file source nodes (text/pdf)
                            if ((parsed.node.file_path || parsed.node.file_source) && (parsed.node.type === 'text_file_source' || parsed.node.type === 'pdf_file_source' || existing.data.node_type === 'text_file_source' || existing.data.node_type === 'pdf_file_source')) {
                                existing.data.filePath = parsed.node.file_path || parsed.node.file_source;
                            }
                            // Map metadata meta_type and file_format for file source nodes
                            if (parsed.node.metadata && (existing.data.node_type === 'text_file_source' || existing.data.node_type === 'pdf_file_source' || parsed.node.type === 'text_file_source' || parsed.node.type === 'pdf_file_source')) {
                                existing.data.metadata = existing.data.metadata || {};
                                if (parsed.node.metadata.meta_type) {
                                    existing.data.metadata.meta_type = parsed.node.metadata.meta_type;
                                }
                                if (parsed.node.metadata.file_format) {
                                    existing.data.metadata.file_format = parsed.node.metadata.file_format;
                                }
                            }
                            // Map file_path to lastSavedPath for text_file_output nodes
                            if (parsed.node.file_path && (parsed.node.type === 'text_file_output' || existing.data.node_type === 'text_file_output')) {
                                console.log('🔍 Mapping file_path to metadata for text_file_output node:', id, parsed.node.file_path);
                                existing.data.metadata = existing.data.metadata || {};
                                existing.data.metadata.lastSavedPath = parsed.node.file_path;
                                existing.data.metadata.autoSavePath = parsed.node.file_path;
                            }
                            // Preserve existing title/metadata; allow optional title from config
                            if (parsed.node.title) {
                                existing.data.metadata.title = parsed.node.title;
                            }
                            // Ensure ID consistency
                            existing.data.id = id;
                            newStore.set(id, existing);
                            return newStore;
                        });

                        // Simulate execution if node has content (concise YAML path)
                        const current = get(nodeDataStore).get(id);
                        if (current && current.data.content && current.data.content.trim()) {
                            console.log(`🎯 Simulating execution for concise YAML node ${id} with content`);
                            if (isPassiveType(current.data.node_type)) {
                                current.setCompleted();
                                // Update the nodeDataStore with the completed state
                                nodeDataStore.update(store => {
                                    const newStore = new Map(store);
                                    newStore.set(id, current);
                                    return newStore;
                                });
                            }
                        }

                        // Update visual node based on patched data
                        const finalCurrent = get(nodeDataStore).get(id);
                        nodes.update(n => n.map(node => 
                            node.id === id ? { 
                                ...node, 
                                content: String(finalCurrent?.data.content ?? node.content ?? ''),
                                title: String(finalCurrent?.data.metadata.title ?? node.title ?? ''),
                                type: String(finalCurrent?.data.node_type ?? node.type ?? 'static')
                            } : node
                        ));

                        // If this is a text_file_source with a file path, load its content now
                        if (finalCurrent && (finalCurrent.data.node_type === 'text_file_source') && finalCurrent.data.filePath) {
                            setTimeout(() => nodeActions.loadArtifactContent(id, finalCurrent.data.filePath || null), 0);
                        }

                        return { success: true };
                    }
                } catch (e) {
                    // Fall through to full NodeData parsing below
                }

                // Fallback: assume full NodeData YAML
                configData = NodeData.fromYAML(config);
            } else {
                // Already parsed/config object
                configData = config;
            }

            // Update both stores (full overwrite path)
            nodeDataStore.update(store => {
                const newStore = new Map(store);
                // Keep the same ID but apply the config
                configData.data.id = id;
                // Map file_path or legacy file_source to filePath for file source nodes (text/pdf)
                if (configData.data.node_type === 'text_file_source' || configData.data.node_type === 'pdf_file_source') {
                    if (configData.data.file_path) {
                        configData.data.filePath = configData.data.file_path;
                    } else if (configData.data.file_source) {
                        configData.data.filePath = configData.data.file_source;
                    }
                    // Metadata fields
                    if (configData.data.metadata) {
                        if (configData.data.metadata.meta_type) {
                            configData.data.meta_type = configData.data.metadata.meta_type;
                        }
                        if (configData.data.metadata.file_format) {
                            configData.data.fileFormat = configData.data.metadata.file_format;
                        }
                    }
                }
                // Map file_path to lastSavedPath for text_file_output nodes
                if (configData.data.node_type === 'text_file_output' && configData.data.file_path) {
                    configData.data.metadata = configData.data.metadata || {};
                    configData.data.metadata.lastSavedPath = configData.data.file_path;
                    configData.data.metadata.autoSavePath = configData.data.file_path;
                }
                newStore.set(id, configData);
                return newStore;
            });

            // Simulate execution if node has content (for loaded files/pasted configs)
            if (configData.data.content && configData.data.content.trim()) {
                console.log(`🎯 Simulating execution for loaded/pasted node ${id} with content`);
                if (isPassiveType(configData.data.node_type)) {
                    configData.setCompleted();
                    // Update the nodeDataStore again with the completed state
                    nodeDataStore.update(store => {
                        const newStore = new Map(store);
                        newStore.set(id, configData);
                        return newStore;
                    });
                }
            }

            // Update visual node
            nodes.update(n => n.map(node => 
                node.id === id ? { 
                    ...node, 
                    content: configData.data.content,
                    title: configData.data.metadata.title,
                    type: configData.data.node_type
                } : node
            ));

            // If this is a file source with a file path, load its content now
            if (configData.data.filePath && configData.data.node_type === 'text_file_source') {
                setTimeout(() => nodeActions.loadArtifactContent(id, configData.data.filePath), 0);
            } else if (configData.data.filePath && configData.data.node_type === 'pdf_file_source') {
                setTimeout(() => nodeActions.loadPdfContent(id, configData.data.filePath), 0);
            }

            return { success: true };
        } catch (/** @type {any} */ error) {
            console.error('Failed to apply node config:', error);
            return { success: false, error: error.message };
        }
    },

    // Add these new actions specifically for handling artifacts
    /**
     * @param {string} filePath
     * @param {number} x
     * @param {number} y
     */
    addArtifactInputFromPath: async (filePath, x, y) => {
        const currentNodes = get(nodes);
        const nodeNumber = getNextNodeNumber(currentNodes);
        const id = `node-${nodeNumber}`;
        const title = filePath.split(/[/\\]/).pop() || 'Text File';

        // Read the file content first
        let content = '';
        try {
            content = await ReadTextFile(filePath);
        } catch (/** @type {any} */ error) {
            console.error('Failed to read file:', error);
            content = `Error reading file: ${error.message}`;
        }

        // Create an input node with the file content
        const node = { id, type: 'input', x, y, width: 250, height: 150, content, title, created: Date.now(), locked: false };
        const nodeData = NodeData.createInput(id, content, title);

        nodes.update(n => [...n, node]);
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            newStore.set(id, nodeData);
            return newStore;
        });

        // Mark as modified since we just loaded content
        if (!nodeData.data.metadata) {
            nodeData.data.metadata = {};
        }
        nodeData.data.metadata.modified = Date.now();

        if (historyActions && !historyActions.isHistoryAction()) {
            setTimeout(() => historyActions.record('Add text file as input node'), 10);
        }
        return node;
    },

    /**
     * @param {string} id
     */
    selectFileForTextFileSource: async (id) => {
        try {
            // Prefer desktop (Wails) if available; fallback to browser APIs
            const isDesktop = typeof window !== 'undefined' && window.go && window.go?.app && window.go?.app?.App;
            if (!isDesktop) {
                // Browser mode - try File System Access API first, then fallback to input
                if ('showOpenFilePicker' in window && typeof window.showOpenFilePicker === 'function') {
                    try {
                        const [fileHandle] = await window.showOpenFilePicker({
                            types: [
                                {
                                    description: 'Text Files',
                                    accept: {
                                        'text/plain': ['.txt'],
                                        'text/markdown': ['.md'],
                                        'application/json': ['.json'],
                                        'text/yaml': ['.yaml', '.yml']
                                    }
                                }
                            ]
                        });
                        
                        const file = await fileHandle.getFile();
                        const content = await file.text();
                        
                        // Update the node with the file content
                        nodes.update(n => n.map(node => node.id === id ? { ...node, content: content, title: file.name } : node));
                        
                        // Update the NodeData but can't save full file path in browser
                        nodeDataStore.update(store => {
                            const newStore = new Map(store);
                            const nodeData = newStore.get(id);
                            if (nodeData) {
                                // Browsers do not expose full paths; store filename only
                                nodeData.data.filePath = file.name;
                                nodeData.data.content = content;
                                nodeData.data.metadata = nodeData.data.metadata || {};
                                nodeData.data.metadata.meta_type = 'file_source';
                                nodeData.data.metadata.file_format = 'text';
                                // Emit structured context with a context_chain so downstream gets facts
                                nodeData.data.output = {
                                    type: 'structured_context',
                                    value: { facts: [content], history: [], task: '' },
                                    sources: [id],
                                    context_chain: [{
                                        node_id: id,
                                        type: 'text_file_source',
                                        contribution: { type: 'fact', content: content },
                                        processing: 'file_load',
                                        timestamp: new Date().toISOString()
                                    }]
                                };
                                newStore.set(id, nodeData);
                            }
                            return newStore;
                        });
                        return;
                    } catch (/** @type {any} */ error) {
                        if (error.name === 'AbortError') {
                            console.log('File selection cancelled');
                            return;
                        }
                        console.warn('File System Access API failed, falling back to input:', error);
                    }
                }
                
                // Fallback to traditional file input for older browsers
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.txt,.md,.json,.yaml,.yml';
                input.style.display = 'none';
                
                input.onchange = async (/** @type {Event} */ e) => {
                    const target = /** @type {HTMLInputElement} */ (e.target);
                    const file = target?.files?.[0];
                    if (file) {
                        const content = await file.text();
                        
                        // Update the node with the file content
                        nodes.update(n => n.map(node => node.id === id ? { ...node, content: content, title: file.name } : node));
                        
                        // Update the NodeData (no full path available in browser)
                        nodeDataStore.update(store => {
                            const newStore = new Map(store);
                            const nodeData = newStore.get(id);
                            if (nodeData) {
                                nodeData.data.filePath = file.name;
                                nodeData.data.content = content;
                                nodeData.data.metadata = nodeData.data.metadata || {};
                                nodeData.data.metadata.meta_type = 'file_source';
                                nodeData.data.metadata.file_format = 'text';
                                // Emit structured context with a context_chain so downstream gets facts
                                nodeData.data.output = {
                                    type: 'structured_context',
                                    value: { facts: [content], history: [], task: '' },
                                    sources: [id],
                                    context_chain: [{
                                        node_id: id,
                                        type: 'text_file_source',
                                        contribution: { type: 'fact', content: content },
                                        processing: 'file_load',
                                        timestamp: new Date().toISOString()
                                    }]
                                };
                                newStore.set(id, nodeData);
                            }
                            return newStore;
                        });
                    }
                    document.body.removeChild(input);
                };
                
                document.body.appendChild(input);
                input.click();
            } else {
                // Desktop mode - use Wails backend SelectTextFile
                const filePath = await SelectTextFile();
                if (filePath) {
                    // Update last used directory in settings
                    try {
                        const sep = filePath.includes('\\') ? '\\' : '/';
                        const idx = filePath.lastIndexOf(sep);
                        if (idx > 0) {
                            const dir = filePath.slice(0, idx);
                            settingsActions.update('lastFileDirectory', dir);
                        }
                    } catch {}
                    // We have a path, now load its content
                    await nodeActions.loadArtifactContent(id, filePath);
                }
            }
        } catch (/** @type {any} */ err) {
            console.error("File selection error:", err);
            // Update the node with an error message
            nodes.update(n => n.map(node => node.id === id ? { ...node, content: `Error: ${err.message}` } : node));
        }
    },

    /**
     * @param {string} id
     */
    selectSaveLocationForTextGenerate: async (id) => {
        try {
            // Environment detection - same pattern as Canvas.svelte
            function isRunningInBrowser() {
                return typeof window !== 'undefined' && !(/** @type {any} */ (window))['__WAILS_RUNTIME__'];
            }
            
            // Check if we're running in browser
            if (isRunningInBrowser()) {
                // Browser mode - use File System Access API for save dialog
                if ('showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function') {
                    try {
                        const fileHandle = await window.showSaveFilePicker({
                            suggestedName: 'generated_content.md',
                            types: [
                                {
                                    description: 'Markdown Files',
                                    accept: {
                                        'text/markdown': ['.md']
                                    }
                                },
                                {
                                    description: 'Text Files',
                                    accept: {
                                        'text/plain': ['.txt']
                                    }
                                }
                            ]
                        });
                        
                        // Store the file handle for later use
                        nodeDataStore.update(store => {
                            const newStore = new Map(store);
                            const nodeData = newStore.get(id);
                            if (nodeData) {
                                // In browser mode, we only get the filename for security reasons
                                nodeData.data.metadata.lastSavedPath = fileHandle.name; // filename only in browser
                                nodeData.data.metadata.fileHandle = fileHandle; // Store for browser use
                                newStore.set(id, nodeData);
                            }
                            return newStore;
                        });
                        
                        console.log(`📁 Save location set for node ${id}: ${fileHandle.name}`);
                        return;
                    } catch (/** @type {any} */ error) {
                        if (error.name === 'AbortError') {
                            console.log('Save location selection cancelled');
                            return;
                        }
                        console.warn('File System Access API failed:', error);
                    }
                }
                
                // In browser mode without File System Access API, skip initial save dialog
                // User will choose location when they actually save
                console.log('💾 Browser mode: Save location will be chosen when content is saved');
                return;
                
            } else {
                // Desktop mode - use Wails backend SelectSaveFilePath (no write)
                if (!window.go || !(/** @type {any} */ (window.go)).app || !(/** @type {any} */ (window.go)).app.App) {
                    console.log('🌐 Wails not available - skipping file dialog for text generation node');
                    return;
                }
                const defaultFilename = 'generated_content.md';
                const savedPath = await (/** @type {any} */ (window.go)).app.App.SelectSaveFilePath(defaultFilename);
                
                if (savedPath && savedPath.trim() !== '') {
                    // Update the node metadata with the selected path
                    nodeDataStore.update(store => {
                        const newStore = new Map(store);
                        const existingNodeData = newStore.get(id);
                        if (existingNodeData) {
                            existingNodeData.data.metadata.lastSavedPath = savedPath;
                            existingNodeData.data.filePath = savedPath;
                            console.log(`🔧 Updated lastSavedPath to: ${savedPath}`);
                            newStore.set(id, existingNodeData);
                        }
                        return newStore;
                    });
                    console.log(`📁 Save location set for node ${id}: ${savedPath}`);
                } else {
                    console.log(`❌ Save location selection cancelled or empty path returned for node ${id}`);
                }
            }
        } catch (error) {
            console.error("Save location selection error:", error);
        }
    },

    // Load the current contents of a text_file_output's file into the node preview
    /**
     * @param {string} id
     */
    loadOutputPreview: async (id) => {
        try {
            // Only for desktop where we can read files
            if (!(typeof window !== 'undefined' && window.go && window.go?.app && window.go?.app?.App)) return;

            // Find the path from nodeData
            const map = get(nodeDataStore);
            const nd = map.get(id);
            if (!nd) return;
            if (nd.data?.node_type !== 'text_file_output') return;

            // Check multiple locations where the path might be stored
            const path = nd.data.metadata?.lastSavedPath
                || nd.data.metadata?.autoSavePath
                || nd.data.filePath
                || nd.data.filePath;  // Standard NodeData property

            console.log('loadOutputPreview: NodeData structure:', nd);
            console.log('loadOutputPreview: Node metadata:', nd.data.metadata);

            if (!path) {
                console.log('loadOutputPreview: No file path found for node', id);
                return;
            }

            console.log('loadOutputPreview: Attempting to load file from:', path);

            // Read the file and update stores
            const content = await ReadTextFile(path);
            console.log(`loadOutputPreview: Successfully loaded ${content.length} characters from file`);

            // Only update if we actually got content to avoid overwriting with empty
            if (content && content.trim()) {
                nodes.update(n => n.map(node => node.id === id ? { ...node, content } : node));
                nodeDataStore.update(store => {
                    const newStore = new Map(store);
                    const cur = newStore.get(id);
                    if (cur) {
                        cur.data.content = content;
                        newStore.set(id, cur);
                    }
                    return newStore;
                });
            }
        } catch (e) {
            // It's normal for this to fail if the file doesn't exist yet
            console.log('loadOutputPreview: File does not exist yet (this is normal for new files)');
        }
    },

    /**
     * @param {string} id
     * @param {string | null} filePath
     */
    loadArtifactContent: async (id, filePath) => {
        try {
            // Resolve to absolute path if needed using settings.lastFileDirectory
            const isAbsolutePath = (/** @type {string} */ p) => !!p && (/^[a-zA-Z]:\\/.test(p) || /^\\\\/.test(p) || p.startsWith('/'));
            let resolvedPath = filePath;
            if (filePath && !isAbsolutePath(filePath)) {
                try {
                    const st = get(settings);
                    const base = st?.lastFileDirectory || '';
                    if (base) {
                        const sep = base.includes('\\') ? '\\' : '/';
                        resolvedPath = `${base}${sep}${filePath}`;
                    }
                } catch {}
            }

            if (!resolvedPath) {
                throw new Error('No file path provided');
            }
            const content = await ReadTextFile(resolvedPath);
            const title = resolvedPath.split(/[/\\]/).pop() || 'Text File';

            // Update the visual node in the canvas store
            nodes.update(n => n.map(node => node.id === id ? { ...node, content: content, title: title } : node));

            // Update the underlying NodeData object
            nodeDataStore.update(store => {
                const newStore = new Map(store);
                const nodeData = newStore.get(id);
                if (nodeData) {
                    nodeData.data.filePath = resolvedPath || undefined;
                    // Ensure content is persisted in NodeData for context engines
                    nodeData.data.content = content;
                    nodeData.data.metadata = nodeData.data.metadata || {};
                    nodeData.data.metadata.meta_type = 'file_source';
                    nodeData.data.metadata.file_format = 'text';
                    // Emit structured context with a context_chain so downstream gets facts
                    nodeData.data.output = {
                        type: 'structured_context',
                        value: { facts: [content], history: [], task: '' },
                        sources: [id],
                        context_chain: [{
                            node_id: id,
                            type: 'text_file_source',
                            contribution: { type: 'fact', content: content },
                            processing: 'file_load',
                            timestamp: new Date().toISOString()
                        }]
                    };
                    newStore.set(id, nodeData);
                }
                return newStore;
            });
        } catch (err) {
            const errorContent = `Error loading file:\n${filePath}\n\n${err}`;
            nodes.update(n => n.map(node => node.id === id ? { ...node, content: errorContent } : node));
        }
    }
};

// Enhanced node initialization with WorkflowManager context hydration
/**
 * @param {string} nodeId
 * @param {string} nodeType
 * @param {any} content
 * @returns {Promise<void>}
 */
async function initializeNodeState(nodeId, nodeType, content) {
    console.log(`🎯 initializeNodeState called for ${nodeId} (${nodeType}) with content:`, content);
    const nodeData = get(nodeDataStore).get(nodeId);
    if (!nodeData) {
        console.warn(`❌ No nodeData found for ${nodeId}`);
        return;
    }
    
    // Initialize basic state
    console.log(`🎯 Basic initialization for ${nodeType} node ${nodeId} with content: "${content}"`);
    
    // Try to get hydrated context from WorkflowManager if available
    try {
        const { workflowManager } = await import('../lib/WorkflowManager.js');
        
        if (workflowManager.getNodeData(nodeId)) {
            console.log(`💧 Found hydrated context for node ${nodeId}, applying it...`);
            
            /** @type {{ facts?: any[], history?: any[], task?: any }} */
            const hydratedContext = workflowManager.getContextForNode(nodeId);
            const workflowManagerNode = workflowManager.getNodeData(nodeId);
            
            if (workflowManagerNode && workflowManagerNode.data.output) {
                // Apply the hydrated context to the node
                nodeData.data.output = { ...workflowManagerNode.data.output };
                
                console.log(`💧 Applied hydrated context to ${nodeId}:`, {
                    facts: hydratedContext.facts?.length || 0,
                    history: hydratedContext.history?.length || 0,
                    task: hydratedContext.task || 'none'
                });
                
                // For AI nodes with hydrated content, mark as ready
                if (nodeType === 'ai' && hydratedContext && hydratedContext.history && Array.isArray(hydratedContext.history) && hydratedContext.history.length > 0) {
                    nodeData.data.execution.state = 'completed';
                    nodeData.data.execution.completed_at = new Date().toISOString();
                }
            }
        } else {
            console.log(`📝 No hydrated context found for ${nodeId}, using standard initialization`);
        }
    } catch (/** @type {any} */ error) {
        console.log(`📝 WorkflowManager not available or error accessing hydrated context:`, error.message);
    }
    
    // Set content directly without any processing or execution triggers
    if (content && content.trim()) {
        nodeData.data.content = content;
        nodeData.data.metadata.version++;
        nodeData.data.metadata.modified = true;
    }
    
    // All nodes start in idle state - the content staging phase will handle context flow
    nodeData.data.execution.state = 'idle';
    nodeData.data.execution.started_at = null;
    nodeData.data.execution.completed_at = null;
    nodeData.data.execution.error = null;
    
    console.log(`⚪ ${nodeType} node ${nodeId} initialized in idle state, content staging will handle context flow`);
    
    // Update the nodeDataStore to persist changes
    nodeDataStore.update(store => {
        const newStore = new Map(store);
        newStore.set(nodeId, nodeData);
        return newStore;
    });
    
    console.log(`✅ Initialized ${nodeType} node ${nodeId} with proper state and persisted to store`);
}

// Export this so clipboard.js can use it
export { initializeNodeState };

// Helper functions for connection operations
export const connectionActions = {
    /**
     * @param {string} fromId
     * @param {string} toId
     * @param {string} fromPort
     * @param {string} toPort
     * @returns {Promise<Connection | null>}
     */
    add: async (fromId, toId, fromPort, toPort) => {
        // Self-loops are PROHIBITED
        if (fromId === toId) {
            console.warn(`Self-loop rejected: cannot connect node ${fromId} to itself`);
            return /** @type {any} */ (null);
        }

        // Inputless nodes (static) and file-source nodes cannot receive inputs
        const targetNode = get(nodes).find(n => n.id === toId);
        if (targetNode) {
            const targetData = get(nodeDataStore).get(toId);
            const isTargetInputless = isInputless(targetNode.type);
            const isFileSource = targetData?.data?.metadata?.meta_type === 'file_source';
            if (isTargetInputless || isFileSource) {
                console.warn(`Cannot create connection to ${isTargetInputless ? 'inputless' : 'file-source'} node ${toId}`);
                return /** @type {any} */ (null);
            }
        }

        // Detect back-edges for loop connection classification.
        // A back-edge exists when toId is an ancestor of fromId in the current DAG.
        // We do a reachability check: can we reach fromId starting from toId?
        /** @param {string} startId @param {string} targetId @returns {boolean} */
        function isAncestor(startId, targetId) {
            const currentConns = get(connections);
            /** @type {Set<string>} */
            const visited = new Set();
            /** @type {string[]} */
            const queue = [startId];
            while (queue.length > 0) {
                const current = queue.shift();
                if (!current || visited.has(current)) continue;
                visited.add(current);
                if (current === targetId) return true;
                // Find all nodes reachable from current via forward edges (normal connections)
                currentConns.forEach(c => {
                    if (c.fromId === current && (!c.type || c.type === 'normal') && !visited.has(c.toId)) {
                        queue.push(c.toId);
                    }
                });
            }
            return false;
        }

        const isBackEdge = isAncestor(toId, fromId);

        try {
            // Central Ontology Monitor (dynamic to avoid cycles)
            // Only run for normal (non-loop) connections to avoid false violations
            if (!isBackEdge) {
                const [{ OntologyMonitor }, workflowsMod] = await Promise.all([
                    import('../lib/OntologyMonitor.js'),
                    import('./workflows.js')
                ]);
                const containersStore = /** @type {import('svelte/store').Readable<any[]>} */ (workflowsMod.workflowContainers);
                const containers = containersStore ? get(containersStore) : [];
                const conns = get(connections);
                const preflight = OntologyMonitor.wouldBreakOntology(fromId, toId, conns, containers);
                if (preflight?.violates) {
                    console.warn(
                        `Ontology violation: blocking ${fromId} -> ${toId}.` +
                        (preflight?.reason ? ` Reason: ${preflight.reason}` : '')
                    );
                    return /** @type {any} */ (null);
                }
            }
        } catch (e) {
            // If monitor fails for any reason, do not block connection creation
            console.warn('Ontology preflight skipped due to error:', e);
        }

        // This function now ONLY creates the connection structure.
        // It does NOT trigger data flow.
        /** @type {Connection} */
        const connection = {
            id: crypto.randomUUID(),
            fromId,
            toId,
            fromPort,
            toPort,
            created: Date.now(),
            type: isBackEdge ? 'loop' : 'normal',
            ...(isBackEdge && { loop_count: 1 })
        };

        if (isBackEdge) {
            console.log(`🔁 Loop connection detected: ${fromId} → ${toId} (back-edge)`);
        }
        connections.update(c => [...c, connection]);

        // DYNAMIC CONTEXT FLOW: Check if source has existing output to propagate
        // Loop connections (back-edges) do NOT trigger immediate forward propagation —
        // that happens only after all iterations complete in WorkflowManager.
        if (isBackEdge) {
            // Record for history and skip data flow setup
            if (historyActions && !historyActions.isHistoryAction()) {
                setTimeout(() => {
                    historyActions.record('Add loop connection');
                }, 10);
            }
            return connection;
        }
        import('../lib/ContextEngine.js').then(({ ContextEngine }) => {
            // Helper functions for the context engine
            const getNodeData = (/** @type {string} */ nodeId) => get(nodeDataStore).get(nodeId);
            const getContainerOutput = async (/** @type {string} */ containerId) => {
                // Get container output from workflows store (machine/factory/network)
                const workflowsModule = await import('./workflows.js');
                
                // First try to get machine output
                if (workflowsModule.getMachineOutput) {
                    const machineOutput = workflowsModule.getMachineOutput(containerId);
                    if (machineOutput) return machineOutput;
                }
                
                // Then try factory output  
                if (workflowsModule.getFactoryOutput) {
                    // Get factory container first
                    const workflowContainers = await import('./workflows.js').then(m => m.workflowContainers);
                    if (workflowContainers) {
                        const { get } = await import('svelte/store');
                        const containers = get(workflowContainers);
                        const factory = containers.find(c => c.id === containerId && c.isFactory);
                        if (factory) {
                            const factoryOutput = workflowsModule.getFactoryOutput(factory);
                            if (factoryOutput) return factoryOutput;
                        }
                    }
                }
                
                // Finally try network output
                if (workflowsModule.getNetworkOutput) {
                    const workflowContainers = await import('./workflows.js').then(m => m.workflowContainers);
                    if (workflowContainers) {
                        const { get } = await import('svelte/store');
                        const containers = get(workflowContainers);
                        const network = containers.find(c => c.id === containerId && c.isNetwork);
                        if (network) {
                            const networkOutput = workflowsModule.getNetworkOutput(network);
                            if (networkOutput) return networkOutput;
                        }
                    }
                }
                
                return null;
            };
            const updateNodeInput = (/** @type {string} */ targetId, /** @type {string} */ sourceId, /** @type {any} */ value, /** @type {number} */ weight, /** @type {any} */ contextChain, /** @type {string[]} */ sources) => {
                const targetNodeData = get(nodeDataStore).get(targetId);
                if (targetNodeData) {
                    // Use ContextEngine to add input with proper context chain handling
                    ContextEngine.addInput(targetNodeData.data, sourceId, value, weight, contextChain, sources);
                    
                    // Update the store
                    nodeDataStore.update(store => {
                        const newStore = new Map(store);
                        newStore.set(targetId, targetNodeData);
                        return newStore;
                    });
                    
                    console.log(`🔄 Dynamic context added to ${targetId} from ${sourceId}`);
                }
            };
            
            // Check if source has existing output and propagate it
            ContextEngine.hasExistingOutput(fromId, getNodeData, getContainerOutput).then(hasOutput => {
                if (hasOutput) {
                    console.log(`🚀 Triggering dynamic context flow: ${fromId} → ${toId}`);
                    ContextEngine.propagateExistingOutput(fromId, toId, getNodeData, getContainerOutput, updateNodeInput);
                }
            });
        });
        
        // Record action for history AFTER connection is added
        if (historyActions && !historyActions.isHistoryAction()) {
            setTimeout(() => {
                historyActions.record('Add connection');
            }, 10);
        }
        
        // Check if auto-execute is enabled and trigger workflow execution (only once)
        import('svelte/store').then(({ get }) => {
            import('./settings.js').then(({ settings }) => {
                const settingsValue = get(settings);
                if (settingsValue.autoExecuteWorkflows) {
                    // Small delay to ensure workflow containers are updated
                    setTimeout(() => {
                        // Check if the source node has been modified recently (within last 5 seconds)
                        const sourceNodeData = get(nodeDataStore).get(fromId);
                        if (!sourceNodeData) return;
                        
                        const lastModified = new Date(sourceNodeData.data.metadata.created_at).getTime();
                        const now = Date.now();
                        const timeSinceModified = now - lastModified;
                        const version = sourceNodeData.data.metadata.version;
                        
                        const isModified = sourceNodeData.data.metadata.modified || false;
                        
                        console.log(`Auto-execute check - Node ${fromId}: version=${version}, modified=${isModified}, timeSinceModified=${timeSinceModified}ms`);
                        
                        // Only auto-execute if the source node has been modified
                        if (isModified) {
                            // Find workflows that contain either the from or to node
                            import('./workflows.js').then(({ workflowContainers, workflowActions }) => {
                                const containers = get(workflowContainers);
                                containers.forEach(container => {
                                    if (container.nodes && container.nodes.some((/** @type {any} */ node) =>
                                        node.id === fromId || node.id === toId
                                    )) {
                                        console.log('Auto-executing workflow due to new connection with modified input:', container.id);
                                        workflowActions.execute(container.id);
                                    }
                                });
                            });
                        } else {
                            console.log('Skipping auto-execute: source node has not been modified');
                        }
                    }, 100);
                }
            });
        });
        
        return connection;
    },

    /**
     * @param {string} id
     * @returns {void}
     */
    delete: (id) => {
        /** @type {Connection | undefined} */
        let connectionToDelete;
        const unsubscribe = connections.subscribe(c => {
            connectionToDelete = c.find(conn => conn.id === id);
        });
        unsubscribe();
        
        if (connectionToDelete) {
            // When a connection is deleted, the downstream node must have its input removed.
            nodeActions.removeInput(connectionToDelete.toId, connectionToDelete.fromId);
            
            // DYNAMIC CONTEXT FLOW: Clear propagated context
            import('../lib/ContextEngine.js').then(({ ContextEngine }) => {
                const getNodeData = (/** @type {string} */ nodeId) => get(nodeDataStore).get(nodeId);
                const clearNodeInput = (/** @type {string} */ targetId, /** @type {string} */ sourceId) => {
                    // This is already handled by removeInput above, but we call it for completeness
                    nodeActions.removeInput(targetId, sourceId);
                };
                
                console.log(`🧹 Triggering dynamic context cleanup: ${connectionToDelete?.fromId} ⤫ ${connectionToDelete?.toId}`);
                if (connectionToDelete?.fromId && connectionToDelete?.toId) {
                    ContextEngine.clearPropagatedContext(connectionToDelete.fromId, connectionToDelete.toId, getNodeData, clearNodeInput);
                }
            });
        }
        
        connections.update(c => c.filter(conn => conn.id !== id));
        
        // Record action for history AFTER deletion
        if (historyActions && !historyActions.isHistoryAction()) {
            setTimeout(() => {
                historyActions.record('Delete connection');
            }, 10);
        }
    },

    /**
     * Update the loop_count of a loop connection.
     * @param {string} id - Connection ID
     * @param {number} count - Number of iterations (must be >= 1)
     * @returns {boolean} True if updated, false if not a loop connection
     */
    setLoopCount: (id, count) => {
        const n = Math.max(1, Math.floor(count));
        let updated = false;
        connections.update(c => c.map(conn => {
            if (conn.id === id && conn.type === 'loop') {
                updated = true;
                return { ...conn, loop_count: n };
            }
            return conn;
        }));
        if (updated && historyActions && !historyActions.isHistoryAction()) {
            setTimeout(() => {
                historyActions.record('Update loop count');
            }, 10);
        }
        return updated;
    }
};
