/**
 * @fileoverview WorkflowManager - Handles workflow state rehydration and context management
 * Provides on-load context rehydration for workflow configurations without execution
 */

import { ContextEngine } from './ContextEngine.js';
import { NodeData } from './NodeData.js';

/**
 * @typedef {import('./NodeData.js').NodeInput} NodeInput
 * @typedef {import('./NodeData.js').StructuredContext} StructuredContext
 * @typedef {import('./NodeData.js').ContextChainItem} ContextChainItem
 */

/**
 * @typedef {object} WorkflowConfiguration
 * @property {Array<object>} nodes - Array of node configurations
 * @property {Array<object>} connections - Array of connection configurations
 * @property {Array<object>} [machines] - Array of machine configurations
 * @property {Array<object>} [factories] - Array of factory configurations
 * @property {Array<object>} [networks] - Array of network configurations
 */

/**
 * WorkflowManager - Manages workflow state rehydration and context caching
 */
export class WorkflowManager {
    constructor() {
        // Map of node ID -> NodeData instance
        /** @type {Map<string, NodeData>} */
        this.nodes = new Map();
        
        // Map of node ID -> array of parent node IDs
        /** @type {Map<string, string[]>} */
        this.parentMap = new Map();
        
        // Cache of node ID -> fully hydrated context
        /** @type {Map<string, any>} */
        this.contextCache = new Map();
        
        // Map of container ID -> container configuration
        /** @type {Map<string, Record<string, any>>} */
        this.containers = new Map();
        
        // Connection information
        /** @type {Array<Record<string, any>>} */
        this.connections = [];
        
        // Flag to prevent execution during hydration
        this.isHydrating = false;
    }

    /**
     * Main entry point for rehydration. Parses the config, sorts the graph,
     * and simulates the data flow to build the context for every node.
     * @param {WorkflowConfiguration} config - The workflow configuration
     */
    loadAndHydrate(config) {
        console.log('🔄 Starting workflow rehydration...');
        this.isHydrating = true;
        
        try {
            // 1. Clear existing state
            this._clearState();
            
            // 2. Initialize from configuration
            this._initializeFromConfig(config);
            
            // 3. Build dependency mapping
            this._buildDependencyMap();
            
            // 4. Perform topological sort to get processing order
            const sortedNodeIds = this._topologicalSort();
            
            // 5. Hydrate context for each node in dependency order
            this._hydrateContexts(sortedNodeIds);
            
            console.log(`✅ Workflow rehydration completed. ${this.nodes.size} nodes hydrated.`);
            
        } finally {
            this.isHydrating = false;
        }
    }

    /**
     * Get the fully hydrated context for a specific node
     * @param {string} nodeId - The node ID
     * @returns {object} The complete context for the node
     */
    getContextForNode(nodeId) {
        return this.contextCache.get(nodeId) || {};
    }

    /**
     * Get a NodeData instance by ID
     * @param {string} nodeId - The node ID
     * @returns {NodeData|null} The NodeData instance or null if not found
     */
    getNodeData(nodeId) {
        return this.nodes.get(nodeId) || null;
    }

    /**
     * Check if the manager is currently hydrating
     * @returns {boolean} True if currently hydrating
     */
    isCurrentlyHydrating() {
        return this.isHydrating;
    }

    /**
     * Clear all internal state
     * @private
     */
    _clearState() {
        this.nodes.clear();
        this.parentMap.clear();
        this.contextCache.clear();
        this.containers.clear();
        this.connections = [];
    }

    /**
     * Initialize state from workflow configuration
     * @param {WorkflowConfiguration} config - The workflow configuration
     * @private
     */
    _initializeFromConfig(config) {
        console.log(`📋 Initializing from config with ${config.nodes?.length || 0} nodes`);
        
        // Initialize nodes
        if (config.nodes) {
            for (const nodeConfig of config.nodes) {
                const typedNodeConfig = /** @type {Record<string, any>} */ (nodeConfig);
                let nodeData;
                
                // Create NodeData instance based on type
                switch (typedNodeConfig.node_type) {
                    case 'static':
                        nodeData = NodeData.createStatic(
                            typedNodeConfig.id, 
                            typedNodeConfig.content || '', 
                            typedNodeConfig.metadata?.title
                        );
                        break;
                    case 'input':
                        nodeData = NodeData.createInput(
                            typedNodeConfig.id, 
                            typedNodeConfig.content || '', 
                            typedNodeConfig.metadata?.title
                        );
                        if (typedNodeConfig.purpose) {
                            nodeData.data.purpose = typedNodeConfig.purpose;
                        }
                        break;
                    case 'ai':
                        nodeData = NodeData.createAI(
                            typedNodeConfig.id, 
                            typedNodeConfig.metadata?.title
                        );
                        // For AI nodes, the content is typically in the output or result
                        if (typedNodeConfig.content) {
                            nodeData.data.output.value = typedNodeConfig.content;
                        }
                        // Also check for execution result
                        if (typedNodeConfig.execution?.result_string) {
                            nodeData.data.execution.result_string = typedNodeConfig.execution.result_string;
                            nodeData.data.output.value = typedNodeConfig.execution.result_string;
                        }
                        break;
                    default:
                        // Generic node creation
                        nodeData = new NodeData(
                            typedNodeConfig.node_type, 
                            typedNodeConfig.id, 
                            typedNodeConfig.content || '', 
                            typedNodeConfig.metadata?.title
                        );
                }
                
                // Apply any additional configuration
                if (typedNodeConfig.metadata) {
                    Object.assign(nodeData.data.metadata, typedNodeConfig.metadata);
                }
                
                if (typedNodeConfig.processing) {
                    Object.assign(nodeData.data.processing, typedNodeConfig.processing);
                }
                
                this.nodes.set(typedNodeConfig.id, nodeData);
                this.parentMap.set(typedNodeConfig.id, []);
            }
        }

        // Store connections
        this.connections = Array.isArray(config.connections) ? [...config.connections] : [];

        // Store container configurations
        if (config.machines) {
            config.machines.forEach(machine => {
                const typedMachine = /** @type {Record<string, any>} */ (machine);
                this.containers.set(typedMachine.id, { ...typedMachine, type: 'machine' });
            });
        }
        
        if (config.factories) {
            config.factories.forEach(factory => {
                const typedFactory = /** @type {Record<string, any>} */ (factory);
                this.containers.set(typedFactory.id, { ...typedFactory, type: 'factory' });
            });
        }
        
        if (config.networks) {
            config.networks.forEach(network => {
                const typedNetwork = /** @type {Record<string, any>} */ (network);
                this.containers.set(typedNetwork.id, { ...typedNetwork, type: 'network' });
            });
        }
    }

    /**
     * Build dependency mapping from connections
     * @private
     */
    _buildDependencyMap() {
        console.log(`🔗 Building dependency map from ${this.connections.length} connections`);
        
        for (const connection of this.connections) {
            const typedConnection = /** @type {Record<string, any>} */ (connection);
            const fromId = typedConnection.fromId || typedConnection.from;
            const toId = typedConnection.toId || typedConnection.to;

            if (fromId && toId && this.parentMap.has(toId)) {
                // Only add direct node-to-node dependencies
                if (this.nodes.has(fromId)) {
                    const parents = this.parentMap.get(toId);
                    if (parents) {
                        parents.push(fromId);
                    }
                }
            }
        }
        
        // Log dependency information
        this.parentMap.forEach((parents, nodeId) => {
            if (parents.length > 0) {
                console.log(`  ${nodeId} depends on: ${parents.join(', ')}`);
            }
        });
    }

    /**
     * Perform topological sort using Kahn's algorithm
     * @returns {string[]} Array of node IDs in execution order
     * @private
     */
    _topologicalSort() {
        console.log('📊 Performing topological sort...');
        
        const nodeIds = Array.from(this.nodes.keys());
        /** @type {Map<string, number>} */
        const inDegree = new Map();
        /** @type {Map<string, string[]>} */
        const adjList = new Map();
        
        // Initialize in-degree and adjacency list
        nodeIds.forEach(nodeId => {
            inDegree.set(nodeId, 0);
            adjList.set(nodeId, []);
        });
        
        // Build adjacency list and calculate in-degrees
        this.parentMap.forEach((parents, nodeId) => {
            parents.forEach(parentId => {
                const dependentList = adjList.get(parentId);
                if (dependentList) {
                    dependentList.push(nodeId);
                    inDegree.set(nodeId, (inDegree.get(nodeId) || 0) + 1);
                }
            });
        });
        
        // Find nodes with no dependencies (in-degree = 0)
        /** @type {string[]} */
        const queue = nodeIds.filter(nodeId => (inDegree.get(nodeId) || 0) === 0);
        /** @type {string[]} */
        const sorted = [];
        
        while (queue.length > 0) {
            const currentId = queue.shift();
            if (!currentId) {
                continue;
            }
            sorted.push(currentId);

            // Process all dependent nodes
            const dependents = /** @type {string[]} */ (adjList.get(currentId) || []);
            dependents.forEach((dependentId) => {
                const remaining = (inDegree.get(dependentId) || 0) - 1;
                inDegree.set(dependentId, remaining);
                if (remaining === 0) {
                    queue.push(dependentId);
                }
            });
        }
        
        // Check for cycles
        if (sorted.length !== nodeIds.length) {
            const unprocessed = nodeIds.filter(id => !sorted.includes(id));
            console.error('⚠️ Cycle detected in workflow graph! Unprocessed nodes:', unprocessed);
            // Return partial sort to allow processing of acyclic parts
        }
        
        console.log('📋 Topological order:', sorted.join(' → '));
        return sorted;
    }

    /**
     * Hydrate context for all nodes in dependency order
     * @param {string[]} sortedNodeIds - Node IDs in topological order
     * @private
     */
    _hydrateContexts(sortedNodeIds) {
        console.log('💧 Hydrating contexts...');
        
        for (const nodeId of sortedNodeIds) {
            const nodeData = this.nodes.get(nodeId);
            if (!nodeData) continue;
            
            console.log(`  💧 Hydrating context for ${nodeId} (${nodeData.data.node_type})`);
            
            // Get parent contexts
            const parentIds = this.parentMap.get(nodeId) || [];
            /** @type {StructuredContext[]} */
            const parentContexts = [];

            // Build inputs array for ContextEngine
            /** @type {import('./NodeData.js').NodeInput[]} */
            const inputs = [];
            parentIds.forEach(parentId => {
                const parentContext = this.contextCache.get(parentId);
                const parentNodeData = this.nodes.get(parentId);

                if (parentContext && parentNodeData) {
                    // Build structured input for ContextEngine
                    inputs.push({
                        source_id: parentId,
                        data: parentContext,
                        context_chain: parentNodeData.data.output?.context_chain || [],
                        sources: parentNodeData.data.output?.sources || [parentId],
                        weight: 1.0,
                        received_at: new Date().toISOString()
                    });

                    // Also collect for simple merging
                    parentContexts.push(/** @type {StructuredContext} */ (parentContext));
                }
            });
            
            // Build context chain using ContextEngine
            const contextChain = ContextEngine.buildContextChain(nodeData.data, inputs);
            
            // Build structured context from context chain
            const structuredContext = ContextEngine.buildStructuredContext(contextChain);

            // Create the final hydrated context by merging parent contexts with node's own content
            /** @type {StructuredContext} */
            let finalContext = { ...structuredContext };
            
            // Add the node's own content based on type
            const nodeContent = this._getNodeContent(nodeData);
            if (nodeContent && typeof nodeContent === 'object' && !Array.isArray(nodeContent)) {
                finalContext = { ...finalContext, .../** @type {StructuredContext} */ (nodeContent) };
            } else if (nodeContent) {
                // For simple content, add as facts
                if (!Array.isArray(finalContext.facts)) finalContext.facts = [];
                const contentString = /** @type {string} */ (nodeContent);
                if (!finalContext.facts.includes(contentString)) {
                    finalContext.facts.push(contentString);
                }
            }
            
            // Store the hydrated context
            this.contextCache.set(nodeId, finalContext);
            
            // Update the node's output with the hydrated context
            this._updateNodeOutput(nodeData, finalContext, contextChain);
            
            console.log(`    ✅ Context hydrated for ${nodeId}:`, {
                facts: finalContext.facts?.length || 0,
                history: finalContext.history?.length || 0,
                task: finalContext.task || 'none'
            });
        }
    }

    /**
     * Get node content for context hydration
     * @param {NodeData} nodeData - The NodeData instance
     * @returns {any} The node's content
     * @private
     */
    _getNodeContent(nodeData) {
        switch (nodeData.data.node_type) {
            case 'static':
            case 'input':
                return nodeData.data.content;
                
            case 'ai':
                // For AI nodes, prefer execution result, then output value, then content
                return nodeData.data.execution?.result_string || 
                       nodeData.data.output?.value || 
                       nodeData.data.content;
                       
            default:
                return nodeData.data.content;
        }
    }

    /**
     * Update node output with hydrated context
     * @param {NodeData} nodeData - The NodeData instance
     * @param {StructuredContext} hydratedContext - The hydrated context
     * @param {ContextChainItem[]} contextChain - The context chain
     * @private
     */
    _updateNodeOutput(nodeData, hydratedContext, contextChain) {
        // Update the node's output with structured context
        nodeData.data.output = {
            type: 'structured_context',
            value: hydratedContext,
            sources: ContextEngine.collectSources(contextChain),
            context_chain: contextChain
        };
        
        // For AI nodes, also update execution state if content exists
        if (nodeData.data.node_type === 'ai' && hydratedContext.history?.length > 0) {
            nodeData.data.execution.state = 'completed';
        }
    }
}

// Export singleton instance
export const workflowManager = new WorkflowManager();
