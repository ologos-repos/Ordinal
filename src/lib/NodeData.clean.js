/**
 * @fileoverview NodeData - Simplified node configuration (no runtime state)
 * Nodes are now pure configuration/recipes - runtime state lives in workflow stores
 */

import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

/**
 * @typedef {object} NodeMetadata
 * @property {string} title
 * @property {string} created_at
 * @property {number} version
 */

/**
 * @typedef {object} NodeDataConfig
 * @property {string} node_type
 * @property {string} id
 * @property {string} content
 * @property {NodeMetadata} metadata
 * @property {Record<string, any>} processing
 * @property {string=} purpose
 */

/**
 * Simplified NodeData class - configuration only, no runtime state
 */
export class NodeData {
    /**
     * @param {string} nodeType
     * @param {string} id
     * @param {string} [content]
     * @param {string} [title]
     */
    constructor(nodeType, id, content = '', title = '') {
        /** @type {NodeDataConfig} */
        this.data = {
            node_type: nodeType,
            id: id,
            content: content,
            metadata: {
                title: title || `${nodeType}_${id}`,
                created_at: new Date().toISOString(),
                version: 1
            },
            // Configuration only - no runtime state stored here
            processing: {},
            purpose: undefined
        };
    }

    // Static factory methods for different node types
    /**
     * @param {string} id
     * @param {string} content
     * @param {string} [title]
     * @returns {NodeData}
     */
    static createStatic(id, content, title) {
        const nodeData = new NodeData('static', id, content, title);
        return nodeData;
    }

    /**
     * @param {string} id
     * @param {string} content
     * @param {string} [title]
     * @returns {NodeData}
     */
    static createInput(id, content, title) {
        const nodeData = new NodeData('input', id, content, title);
        nodeData.data.purpose = 'fact'; // Default purpose, can be 'task'
        nodeData.data.processing = {
            envelope_style: 'prompt_wrapper',
            wrapper_template: '{inputs}\n{content}'
        };
        return nodeData;
    }

    /**
     * @param {string} id
     * @param {string} [title]
     * @returns {NodeData}
     */
    static createDynamic(id, title) {
        const nodeData = new NodeData('dynamic', id, '', title);
        nodeData.data.processing = {
            type: 'ai_completion',
            model: '',
            system_prompt: 'You are a component in a workflow processing information. Take the provided contextual information and facts, and provide a direct, relevant response based on that context. Process and respond to what you are given - do not ask questions or request clarification.\n\nIMPORTANT: Respond with plain text only. Do NOT format your response as JSON, XML, or any structured format. Provide only the direct answer or content requested.',
            parameters: {
                temperature: 0.7,
                max_tokens: 1000
            }
        };
        return nodeData;
    }

    // Configuration getters/setters
    /**
     * @returns {string}
     */
    getContent() {
        return this.data.content;
    }

    /**
     * @param {string} content
     * @returns {NodeData}
     */
    setContent(content) {
        this.data.content = content;
        this.data.metadata.version += 1;
        return this;
    }

    /**
     * @returns {Record<string, any>}
     */
    getProcessingConfig() {
        return this.data.processing;
    }

    /**
     * @param {Record<string, any>} config
     * @returns {NodeData}
     */
    setProcessingConfig(config) {
        this.data.processing = { ...this.data.processing, ...config };
        this.data.metadata.version += 1;
        return this;
    }

    // For dynamic nodes - get the prompt template that will be filled at runtime
    /**
     * @returns {string}
     */
    getPromptTemplate() {
        if (this.data.node_type === 'input' && this.data.processing?.wrapper_template) {
            return this.data.processing.wrapper_template;
        }
        if (this.data.node_type === 'dynamic' && this.data.processing?.system_prompt) {
            return this.data.processing.system_prompt;
        }
        return this.data.content;
    }

    // Serialization
    /**
     * @returns {string}
     */
    toYAML() {
        return yamlStringify(this.data, { 
            indent: 2,
            lineWidth: -1,
            minContentWidth: 0
        });
    }

    /**
     * @returns {string}
     */
    toCleanYAML() {
        return yamlStringify(this.data, { 
            indent: 2,
            lineWidth: -1,
            minContentWidth: 0
        });
    }

    // Create from YAML
    /**
     * @param {string} yamlString
     * @returns {NodeData}
     */
    static fromYAML(yamlString) {
        try {
            const data = yamlParse(yamlString);
            const nodeData = new NodeData(data.node_type, data.id, data.content, data.metadata?.title);
            
            // Restore the full configuration
            nodeData.data = { ...nodeData.data, .../** @type {Partial<NodeDataConfig>} */ (data) };
            
            return nodeData;
        } catch (error) {
            console.error('Error parsing node YAML:', error);
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to parse node YAML: ${message}`);
        }
    }

    // Clone this node (for copy/paste operations)
    /**
     * @param {string} [newId]
     * @returns {NodeData}
     */
    clone(newId) {
        const clonedData = /** @type {NodeDataConfig} */ (JSON.parse(JSON.stringify(this.data)));
        if (typeof newId === 'string' && newId.length > 0) {
            clonedData.id = newId;
        }
        clonedData.metadata.created_at = new Date().toISOString();
        clonedData.metadata.version = 1;
        
        const cloned = new NodeData(clonedData.node_type, clonedData.id, clonedData.content, clonedData.metadata.title);
        cloned.data = clonedData;
        return cloned;
    }
}
