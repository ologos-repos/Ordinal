/**
 * @fileoverview RuntimeContext - Handles runtime state and context processing for workflows
 * Provides a lightweight runtime view for workflow execution without relying on global stores.
 */

import { ContextEngine } from './ContextEngine.js';

/**
 * @typedef {import('./NodeData.js').NodeOutput} NodeOutput
 * @typedef {import('./NodeData.js').ContextChainItem} ContextChainItem
 * @typedef {import('./NodeData.js').ContextContribution} ContextContribution
 * @typedef {import('./NodeData.js').StructuredContext} StructuredContext
 * @typedef {import('./NodeData.js').NodeData} NodeDataClass
 */

/**
 * @typedef {object} WorkflowConnection
 * @property {string} fromId
 * @property {string} toId
 * @property {string=} from
 * @property {string=} to
 */

/**
 * @typedef {object} RuntimeInput
 * @property {string} source_id
 * @property {any} data
 * @property {number} weight
 * @property {string} received_at
 * @property {string[]=} sources
 * @property {ContextChainItem[]=} context_chain
 */

export class RuntimeContext {
    /**
     * @param {string} workflowId
     */
    constructor(workflowId) {
        this.workflowId = workflowId;
        /** @type {Map<string, NodeOutput>} */
        this.nodeOutputs = new Map();
        /** @type {Map<string, RuntimeInput[]>} */
        this.nodeInputs = new Map();
        /** @type {Map<string, ContextChainItem[]>} */
        this.nodeContextChains = new Map();
    }

    /**
     * Process a node's input based on its configuration and current runtime state
     * @param {NodeDataClass} nodeConfig
     * @param {WorkflowConnection[]} connections
     * @param {Map<string, NodeDataClass> | Record<string, NodeDataClass>} allNodeConfigs
     * @returns {string | StructuredContext | null}
     */
    processNodeInput(nodeConfig, connections, allNodeConfigs) {
        const { id, node_type, content } = nodeConfig.data;

        if (node_type === 'static') {
            const output = this._createStructuredOutput([content ?? ''], [], '');
            this.nodeOutputs.set(id, output);
            return content;
        }

        const inputData = this._gatherInputData(id, connections);
        this.nodeInputs.set(id, inputData);

        if (node_type === 'input') {
            const processed = this._processInputNode(nodeConfig, inputData);
            this.nodeOutputs.set(id, processed.output);
            this.nodeContextChains.set(id, processed.output.context_chain || []);
            return processed.processedText;
        }

        if (node_type === 'ai') {
            const contextChain = this._buildContextChain(id, inputData);
            const structuredContext = ContextEngine.buildStructuredContext(contextChain);
            this.nodeContextChains.set(id, contextChain);
            this.nodeOutputs.set(id, /** @type {NodeOutput} */ ({
                type: 'structured_context',
                value: structuredContext,
                sources: this._collectSources(contextChain),
                context_chain: contextChain
            }));
            return this._buildAIPrompt(nodeConfig, structuredContext);
        }

        // Default: return existing content (if any)
        return content ?? null;
    }

    /**
     * Store the result of AI processing for an AI node
     * @param {string} nodeId
     * @param {string} result
     * @returns {void}
     */
    storeNodeResult(nodeId, result) {
        const contextChain = this.nodeContextChains.get(nodeId) || [];
        /** @type {ContextChainItem} */
        const contribution = {
            node_id: nodeId,
            type: 'ai',
            contribution: {
                type: 'history',
                content: {
                    role: 'assistant',
                    content: result
                }
            },
            processing: 'ai_completion',
            timestamp: new Date().toISOString()
        };

        const updatedChain = [...contextChain, contribution];
        const output = /** @type {NodeOutput} */ ({
            type: 'structured_context',
            value: ContextEngine.buildStructuredContext(updatedChain),
            sources: this._collectSources(updatedChain),
            context_chain: updatedChain
        });

        this.nodeContextChains.set(nodeId, updatedChain);
        this.nodeOutputs.set(nodeId, output);
    }

    /**
     * Get the current output for a node (for connecting to other nodes)
     * @param {string} nodeId
     * @returns {NodeOutput | undefined}
     */
    getNodeOutput(nodeId) {
        return this.nodeOutputs.get(nodeId);
    }

    /**
     * Clean up this workflow's runtime state
     * @returns {void}
     */
    cleanup() {
        this.nodeOutputs.clear();
        this.nodeInputs.clear();
        this.nodeContextChains.clear();
    }

    /**
     * @param {string} nodeId
     * @param {WorkflowConnection[]} connections
     * @returns {RuntimeInput[]}
     */
    _gatherInputData(nodeId, connections) {
        const inputConnections = connections.filter(conn => {
            const targetId = conn.toId ?? conn.to;
            return targetId === nodeId;
        });

        /** @type {RuntimeInput[]} */
        const inputData = [];
        for (const conn of inputConnections) {
            const sourceId = conn.fromId ?? conn.from;
            if (!sourceId) continue;

            const sourceOutput = this.getNodeOutput(sourceId);
            if (!sourceOutput) continue;

            inputData.push({
                source_id: sourceId,
                data: sourceOutput.value,
                weight: 1.0,
                received_at: new Date().toISOString(),
                sources: sourceOutput.sources || [sourceId],
                context_chain: sourceOutput.context_chain || []
            });
        }

        return inputData;
    }

    /**
     * @param {NodeDataClass} nodeConfig
     * @param {RuntimeInput[]} inputData
     * @returns {{ processedText: string, output: NodeOutput }}
     */
    _processInputNode(nodeConfig, inputData) {
        const { id, content, processing } = nodeConfig.data;
        const template = processing?.wrapper_template || '{inputs}\n{content}';

        const inputTexts = inputData.map((input) => {
            if (input && typeof input.data === 'object' && Array.isArray(input.data?.facts)) {
                return input.data.facts.join(' ');
            }
            return String(input?.data ?? '');
        });

        const processedText = template
            .replace('{inputs}', inputTexts.join('\n'))
            .replace('{content}', content ?? '');

        const contextChain = this._buildContextChain(id, inputData, {
            type: 'fact',
            content: content ?? ''
        });

        return {
            processedText,
            output: {
                type: 'structured_context',
                value: ContextEngine.buildStructuredContext(contextChain),
                sources: [id],
                context_chain: contextChain
            }
        };
    }

    /**
     * @param {string} nodeId
     * @param {RuntimeInput[]} inputData
     * @param {ContextContribution | null} [nodeContribution]
     * @returns {ContextChainItem[]}
     */
    _buildContextChain(nodeId, inputData, nodeContribution = null) {
        /** @type {ContextChainItem[]} */
        const chain = [];

        for (const input of inputData) {
            if (Array.isArray(input.context_chain)) {
                chain.push(...input.context_chain);
            }
        }

        if (nodeContribution) {
            chain.push({
                node_id: nodeId,
                type: 'input',
                contribution: nodeContribution,
                processing: 'runtime_context',
                timestamp: new Date().toISOString()
            });
        }

        return chain;
    }

    /**
     * @param {NodeDataClass} nodeConfig
     * @param {StructuredContext} structuredContext
     * @returns {string}
     */
    _buildAIPrompt(nodeConfig, structuredContext) {
        const { processing } = nodeConfig.data;
        const systemPrompt = processing?.system_prompt || '';

        let contextString = systemPrompt ? `${systemPrompt}\n\n` : '';

        if (Array.isArray(structuredContext.facts) && structuredContext.facts.length > 0) {
            contextString += 'Context Facts:\n' + structuredContext.facts.join('\n') + '\n\n';
        }

        if (Array.isArray(structuredContext.history) && structuredContext.history.length > 0) {
            contextString += 'Conversation History:\n';
            for (const msg of structuredContext.history) {
                contextString += `${msg.role}: ${msg.content}\n`;
            }
            contextString += '\n';
        }

        if (structuredContext.task) {
            contextString += `Task: ${structuredContext.task}\n\n`;
        }

        return contextString.trim() || 'Please provide a response.';
    }

    /**
     * @param {ContextChainItem[]} contextChain
     * @returns {string[]}
     */
    _collectSources(contextChain) {
        /** @type {Set<string>} */
        const sources = new Set();
        for (const item of contextChain) {
            if (item?.node_id) {
                sources.add(item.node_id);
            }
        }
        return Array.from(sources);
    }

    /**
     * @param {string[]} facts
     * @param {Array<{ role: 'user' | 'assistant', content: string }>} history
     * @param {string} task
     * @returns {NodeOutput}
     */
    _createStructuredOutput(facts, history, task) {
        return /** @type {NodeOutput} */ ({
            type: 'structured_context',
            value: {
                facts,
                history,
                task
            },
            sources: [],
            context_chain: []
        });
    }
}
