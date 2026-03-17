/**
 * @fileoverview NodeData - Core data structure for workflow nodes
 * Handles node state, input/output management, and context chain building
 */

import { ContextEngine } from './ContextEngine.js';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

/**
 * @typedef {object} StructuredContext
 * @property {string[]} facts - A list of factual statements.
 * @property {Array<{role: 'user' | 'assistant', content: string}>} history - The conversation history.
 * @property {string} task - The specific task for an AI node.
 */

/**
 * @typedef {object} ContextContribution
 * @property {'fact' | 'task' | 'history'} type - The type of contribution.
 * @property {string | {role: 'assistant' | 'user', content: string}} content - The content of the contribution.
 */

/**
 * @typedef {object} ContextChainItem
 * @property {string} node_id - The ID of the contributing node.
 * @property {string} type - The node type.
 * @property {ContextContribution} contribution - The structured contribution.
 * @property {string} processing - The processing type.
 * @property {string} timestamp - The ISO timestamp of the contribution.
 */

/**
 * @typedef {object} NodeOutput
 * @property {'text' | 'structured_context'} type - The type of the output.
 * @property {string | StructuredContext} value - The output value.
 * @property {string[]} sources - The IDs of the source nodes.
 * @property {ContextChainItem[]} [context_chain] - The historical ledger of contributions.
 */

/**
 * @typedef {object} NodeInput
 * @property {string} source_id
 * @property {any} data
 * @property {number} weight
 * @property {string} received_at
 * @property {ContextChainItem[]=} context_chain
 * @property {string[]=} sources
 */

/**
 * @typedef {object} NodeExecutionState
 * @property {'idle' | 'running' | 'completed' | 'error'} state
 * @property {string | null} started_at
 * @property {string | null} completed_at
 * @property {string | null} error
 * @property {string | null=} result_string
 */

/**
 * @typedef {object} NodeDataInternal
 * @property {string} node_type
 * @property {string} id
 * @property {string} content
 * @property {Record<string, any>} metadata
 * @property {NodeInput[]=} inputs
 * @property {Record<string, any>} processing
 * @property {NodeOutput} output
 * @property {NodeExecutionState} execution
 * @property {string=} purpose
 * @property {string=} filePath
 */

export class NodeData {
    /**
     * @param {string} nodeType
     * @param {string} id
     * @param {string} [content]
     * @param {string} [title]
     */
    constructor(nodeType, id, content = '', title = '') {
        /** @type {NodeDataInternal} */
        this.data = {
            node_type: nodeType,
            id: id,
            content: content,
            metadata: {
                title: title || `${nodeType}_${id}`,
                created_at: new Date().toISOString(),
                version: 1,
                modified: false,
                customColor: null,
                customLabel: null,
                locked: false
            },
            inputs: /** @type {NodeInput[]} */ ([]),
            processing: /** @type {Record<string, any>} */ ({}),
            /** @type {NodeOutput} */
            output: {
                type: 'text',
                value: content,
                sources: [id]
            },
            execution: {
                state: 'idle',
                started_at: null,
                completed_at: null,
                error: null
            },
            purpose: undefined,
            filePath: undefined
        };

        /** @type {ReturnType<typeof setTimeout> | null} */
        this._autoExecuteTimeout = null;
    }

    // Static factory methods for different node types
    /**
     * @param {string} id
     * @param {string} content
     * @param {string} [title]
     * @returns {NodeData}
     */
    static createStatic(id, content, title, actualType = 'static') {
        const nodeData = new NodeData(actualType, id, content, title);
        // Only true static nodes have no input capability
        if (actualType === 'static') {
            nodeData.data.inputs = undefined;
        }
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
    static createAI(id, title) {
        const nodeData = new NodeData('ai', id, '', title);
        nodeData.data.processing = {
            type: 'ai_completion',
            model: '',
            system_prompt: 'You are a component in a workflow processing information. Take the provided contextual information and facts, and provide a direct, relevant response based on that context. Process and respond to what you are given - do not ask questions or request clarification.\n\nIMPORTANT: Respond with plain text only. Do NOT format your response as JSON, XML, or any structured format. Provide only the direct answer or content requested.',
            parameters: {
                temperature: 0.7,
                max_tokens: 1000
            }
        };
        nodeData.data.output.context_chain = [];
        return nodeData;
    }

    /**
     * @param {string} id
     * @param {string} [title]
     * @param {string} [filePath]
     * @returns {NodeData}
     */
    static createTextFileSource(id, title, filePath = '') {
        const nodeData = new NodeData('text_file_source', id, '', title);
        // This is the persistent part: a link to the file
        nodeData.data.filePath = filePath;
        // Mark this node as a generic file source meta-type (store in metadata)
        const metadata = nodeData.data.metadata;
        metadata.meta_type = 'file_source';
        metadata.file_format = 'text';
        // This node has no inputs
        nodeData.data.inputs = undefined;
        return nodeData;
    }

    /**
     * @param {string} id
     * @param {string} [title]
     * @param {string} [filePath]
     * @returns {NodeData}
     */
    static createPdfFileSource(id, title, filePath = '') {
        const nodeData = new NodeData('pdf_file_source', id, '', title);
        nodeData.data.filePath = filePath;
        const metadata = nodeData.data.metadata;
        metadata.meta_type = 'file_source';
        metadata.file_format = 'pdf';
        nodeData.data.inputs = undefined;
        return nodeData;
    }

    /**
     * @param {string} id
     * @param {string} [title]
     * @returns {NodeData}
     */
    static createTextFileOutput(id, title) {
        const nodeData = new NodeData('text_file_output', id, 'Waiting for input...', title);
        nodeData.data.processing = {
            type: 'ai_completion',
            model: '',
            system_prompt: `You are an expert document generator. Your task is to create well-formatted content based on the context you receive.

PROCESSING RULES:
1. If the context includes template instructions or formatting guidelines from connected nodes, follow those exactly
2. If no specific template is provided, use these default formatting guidelines:
   - Start with a clear heading (# Main Topic)
   - Use appropriate heading hierarchy (##, ###, etc.)
   - Convert information into bullet points or numbered lists as appropriate
   - Add emphasis with **bold** and *italic* where it improves readability
   - Include code blocks with \`\`\` for any code or technical content
   - Ensure proper spacing between sections
   - Make the content scannable and well-organized

IMPORTANT: Look for template instructions in the contextual information. If someone says "Use this document as a template" or provides formatting instructions, prioritize those over the default formatting.

Output ONLY the generated content. Do not include any meta-commentary or explanations about the formatting process.`,
            parameters: {
                temperature: 0.3,
                max_tokens: 8000
            }
        };
        nodeData.data.metadata.lastSavedPath = null;
        nodeData.data.output.context_chain = [];
        return nodeData;
    }

    // Core data manipulation methods
    /**
     * @param {string} newContent
     * @returns {this}
     */
    updateContent(newContent) {
        this.data.content = newContent;
        this.data.metadata.version++;
        this.data.metadata.modified = true;


        // THE FIX: Instead of just overwriting the output with the new content,
        // we call _updateOutput(). This function correctly recalculates the
        // final output value by combining any existing inputs with the new content.
        this._updateOutput();

        // Trigger auto-execute for workflows containing this node
        this._triggerAutoExecute();

        return this;
    }

    // Trigger auto-execute for workflows containing this node (debounced)
    _triggerAutoExecute() {
        if (typeof window === 'undefined') {
            return;
        }

        const globalWindow = /** @type {any} */ (window);
        // Skip auto-execution if we're in loading/initialization mode
        if (globalWindow.ordinalLoadingMode) {
            console.log(`🚫 Skipping auto-execute for ${this.data.id} - in loading mode`);
            return;
        }

        // Clear any existing timeout for this node
        if (this._autoExecuteTimeout) {
            clearTimeout(this._autoExecuteTimeout);
        }

        // Set new timeout for 1.5 seconds
        this._autoExecuteTimeout = setTimeout(() => {
            // Double-check loading mode before executing
            if (typeof window !== 'undefined') {
                const deferredWindow = /** @type {any} */ (window);
                if (deferredWindow.ordinalLoadingMode) {
                    console.log(`🚫 Skipping delayed auto-execute for ${this.data.id} - still in loading mode`);
                    return;
                }
            }
            
            // Check if auto-execute is enabled
            import('../stores/settings.js').then(({ settings }) => {
                import('svelte/store').then(({ get }) => {
                    const settingsValue = get(settings);
                    if (settingsValue.autoExecuteWorkflows) {
                        // Find workflows that contain this node
                        import('../stores/workflows.js').then(({ workflowContainers, workflowActions }) => {
                            const containers = get(workflowContainers);
                            containers.forEach(container => {
                                const typedContainer = /** @type {Record<string, any>} */ (container);
                                const containerNodes = Array.isArray(typedContainer.nodes) ? typedContainer.nodes : [];
                                const containsNode = containerNodes.some((node) => {
                                    const typedNode = /** @type {{ id?: string }} */ (node);
                                    return typedNode?.id === this.data.id;
                                });
                                if (containsNode) {
                                    console.log('Auto-executing workflow due to node modification (debounced):', typedContainer.id);
                                    workflowActions.execute(typedContainer.id);
                                }
                            });
                        });
                    }
                });
            });
        }, 1500); // 1.5 seconds delay
    }

    // Input management
    /**
     * @param {string} sourceId
     * @param {StructuredContext | string | any} data
     * @param {number} [weight]
     * @param {ContextChainItem[] | null} [sourceContextChain]
     * @param {string[] | null} [sourceSources]
     * @returns {this}
     */
    addInput(sourceId, data, weight = 1.0, sourceContextChain = null, sourceSources = null) {
        if (this.data.node_type === 'static') {
            throw new Error('Static nodes cannot receive inputs');
        }

        if (!Array.isArray(this.data.inputs)) {
            this.data.inputs = [];
        }

        // Remove existing input from same source
        this.data.inputs = this.data.inputs.filter(input => input.source_id !== sourceId);
        
        // Add new input with context information
        const inputData = /** @type {NodeInput} */ ({
            source_id: sourceId,
            data: data,
            weight: weight,
            received_at: new Date().toISOString()
        });
        
        // Include context chain if provided
        if (Array.isArray(sourceContextChain)) {
            inputData.context_chain = sourceContextChain;
        }
        
        // Include source chain if provided
        if (Array.isArray(sourceSources)) {
            inputData.sources = sourceSources;
        }
        
        this.data.inputs.push(inputData);

        // Rebuild output based on inputs
        this._updateOutput();
        return this;
    }

    /**
     * @param {string} sourceId
     * @returns {this}
     */
    removeInput(sourceId) {
        if (!Array.isArray(this.data.inputs)) {
            return this;
        }
        this.data.inputs = this.data.inputs.filter(input => input.source_id !== sourceId);
        this._updateOutput();
        return this;
    }

    // REBUILT FROM SCRATCH: This consumes the chain to build the live payload.
    _updateOutput() {
        // 1. Build the authoritative historical chain.
        /** @type {ContextChainItem[]} */
        let contextChain = this._buildContextChain();

        // 2. For input nodes, process wrapper_template and add as contribution
        if (this.data.node_type === 'input' && this.data.processing?.wrapper_template) {
            // Process the template by extracting facts from inputs with deduplication
            /** @type {Set<string>} */
            const seenFacts = new Set();
            /** @type {string[]} */
            const inputFacts = [];
            if (Array.isArray(this.data.inputs)) {
                this.data.inputs.forEach(input => {
                    if (typeof input.data === 'object' && Array.isArray(input.data.facts)) {
                        for (const fact of input.data.facts) {
                            if (typeof fact === 'string' && fact.trim() && !seenFacts.has(fact.trim())) {
                                const trimmed = fact.trim();
                                inputFacts.push(trimmed);
                                seenFacts.add(trimmed);
                            }
                        }
                    } else if (input.data) {
                        const factString = String(input.data).trim();
                        if (factString && !seenFacts.has(factString)) {
                            inputFacts.push(factString);
                            seenFacts.add(factString);
                        }
                    }
                });
            }

            // Substitute template placeholders
            const template = this.data.processing.wrapper_template;
            const processedContent = template
                .replace('{inputs}', inputFacts.join('\n'))
                .replace('{content}', this.data.content || '');

            // Add/update this node's contribution with processed content
            contextChain = contextChain.filter(item => item.node_id !== this.data.id);
            contextChain.push({
                node_id: this.data.id,
                type: this.data.node_type,
                contribution: {
                    type: this.data.purpose === 'task' ? 'task' : 'fact',
                    content: processedContent
                },
                processing: 'template_wrapper',
                timestamp: new Date().toISOString()
            });
        }

        // 3. Build the structured value from the chain using ContextEngine.
        const structuredValue = ContextEngine.buildStructuredContext(contextChain);

        // 4. Set the final output values.
        this.data.output = {
            type: 'structured_context',
            value: structuredValue, // The live payload
            sources: this._collectSources(contextChain),
            context_chain: contextChain // The historical ledger
        };
    }

    // Build context chain using ContextEngine
    _buildContextChain() {
        return ContextEngine.buildContextChain(
            this.data,
            Array.isArray(this.data.inputs) ? this.data.inputs : []
        );
    }

    // Execution state management
    setExecuting() {
        this.data.execution.state = 'running';
        this.data.execution.started_at = new Date().toISOString();
        this.data.execution.completed_at = null;
        this.data.execution.error = null;
        return this;
    }

    /**
     * @param {string | null} [result]
     * @returns {this}
     */
    setCompleted(result = null) {
        console.log(`NodeData.setCompleted called for ${this.data.id} with result:`, result);
        console.log(`Current execution state before:`, this.data.execution.state);
        
        this.data.execution.state = 'completed';
        this.data.execution.completed_at = new Date().toISOString();
        
        if (result !== null && (this.data.node_type === 'ai' || this.data.node_type === 'text_file_output')) {
            // Store the raw string result. _updateOutput will structure it.
            this.data.execution.result_string = result;
            // Update the node's content with the AI response
            this.data.content = result;
            console.log(`Updated content for ${this.data.id}:`, this.data.content);
            this._updateOutput(); // Trigger a re-evaluation
        }
        
        console.log(`Execution state after completion:`, this.data.execution.state);
        return this;
    }

    /**
     * @param {unknown} error
     * @returns {this}
     */
    setError(error) {
        this.data.execution.state = 'error';
        this.data.execution.completed_at = new Date().toISOString();
        const message = error instanceof Error ? error.message : String(error);
        this.data.execution.error = message;
        return this;
    }

    // Serialization
    toYAML() {
        return yamlStringify(this.data, { 
            indent: 2,
            lineWidth: 0,
            minContentWidth: 0
        });
    }
    
    // Clean YAML without verbose history
    toCleanYAML() {
        /** @type {Record<string, any>} */
        const cleanData = {
            node_type: this.data.node_type,
            id: this.data.id,
            metadata: {
                title: this.data.metadata.title,
                created_at: this.data.metadata.created_at,
                version: this.data.metadata.version,
                ...(this.data.metadata.customColor && { customColor: this.data.metadata.customColor }),
                ...(this.data.metadata.customLabel && { customLabel: this.data.metadata.customLabel })
            },
            inputs: Array.isArray(this.data.inputs) ? this.data.inputs : undefined,
            processing: this.data.processing,
            output: this.data.output,
            execution: this.data.execution
        };

        // Handle content differently based on node type
        if (this.data.node_type === 'text_file_source') {
            // For text file source nodes, emit file_path and omit content
            cleanData.file_path = this.data.filePath || "";
        } else if (this.data.node_type === 'text_file_output') {
            // For text file output nodes, prefer a file path and omit content
            const path = this.data.metadata.lastSavedPath || this.data.metadata.autoSavePath || this.data.filePath || "";
            cleanData.file_path = path;
            if (this.data.processing?.user_instructions) {
                cleanData.instructions = this.data.processing.user_instructions;
            }
            if (this.data.processing?.user_max_tokens) {
                cleanData.max_tokens = this.data.processing.user_max_tokens;
            }
        } else if (this.data.node_type === 'ai') {
            // For AI nodes, use the result string or content
            cleanData.content = this.data.execution.result_string || this.data.content || "";
        } else {
            // For other node types, use content as is
            cleanData.content = this.data.content || "";
        }
        
        return yamlStringify(cleanData, { 
            indent: 2,
            lineWidth: 0,
            minContentWidth: 0
        });
    }
    
    // Concise config format
    toConfig(visualContent = null) {
        /** @type {{ node: Record<string, any> }} */
        const config = {
            node: {
                id: this.data.id,
                type: this.data.node_type,
            }
        };

        // Handle content differently based on node type
        if (this.data.node_type === 'text_file_source' || this.data.node_type === 'pdf_file_source') {
            // For text file source nodes, emit file_path instead of content
            config.node.file_path = this.data.filePath || "";
            // Concise config: do not include metadata here
        } else if (this.data.node_type === 'text_file_output') {
            // For text file output nodes, emit file_path only and omit content
            const path = this.data.metadata.lastSavedPath || this.data.metadata.autoSavePath || this.data.filePath || "";
            config.node.file_path = path;
            // Optional overrides
            if (this.data.processing?.model_override) {
                config.node.model = this.data.processing.model_override;
            }
            const defaultTempTfo = 0.3;
            const tempTfo = this.data.processing?.parameters?.temperature;
            if (typeof tempTfo === 'number' && tempTfo !== defaultTempTfo) {
                config.node.temperature = tempTfo;
            }
            if (this.data.processing?.user_instructions) {
                config.node.instructions = this.data.processing.user_instructions;
            }
            if (this.data.processing?.user_max_tokens) {
                config.node.max_tokens = this.data.processing.user_max_tokens;
            }
        } else if (visualContent) {
            // For regular nodes, allow visual content override
            config.node.content = visualContent;
        } else if (this.data.node_type === 'ai') {
            config.node.content = this.data.execution.result_string || this.data.content || "";
            // AI optional overrides
            if (this.data.processing?.model_override) {
                config.node.model = this.data.processing.model_override;
            }
            const defaultTempAi = 0.7;
            const tempAi = this.data.processing?.parameters?.temperature;
            if (typeof tempAi === 'number' && tempAi !== defaultTempAi) {
                config.node.temperature = tempAi;
            }
        } else {
            config.node.content = this.data.content || "";
        }
        
        // Add custom properties if they exist
        if (this.data.metadata.customColor) {
            config.node.color = this.data.metadata.customColor;
        }
        if (this.data.metadata.customLabel) {
            config.node.label = this.data.metadata.customLabel;
        }
        
        if (this.data.inputs && this.data.inputs.length > 0) {
            config.node.inputs = this.data.inputs.map(input => input.source_id);
        }
        
        // Add outputs (we'll need to get this from connections)
        // This will be populated by the calling function
        
        return yamlStringify(config, { 
            indent: 2,
            lineWidth: 0,
            minContentWidth: 0
        });
    }

    /**
     * @param {string} yamlString
     * @returns {NodeData}
     */
    static fromYAML(yamlString) {
        try {
            const data = yamlParse(yamlString);
            const nodeData = new NodeData(data.node_type, data.id);
            nodeData.data = { ...nodeData.data, ...data };
            return nodeData;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to parse node YAML: ${message}`);
        }
    }

    // The Prompt Assembler now has a cleaner input.
    /**
     * @returns {string}
     */
    getProcessedInput() {
        if ((this.data.node_type !== 'ai' && this.data.node_type !== 'text_file_output') || !this.data.output.value || typeof this.data.output.value !== 'object') {
            return ''; // Should not happen for AI nodes or artifact output nodes with structured output
        }

        /** @type {StructuredContext} */
        const context = this.data.output.value;
        /** @type {string[]} */
        let promptParts = [];
        
        // 1. System Prompt (No change)
        if (this.data.processing.system_prompt) {
            promptParts.push(this.data.processing.system_prompt);
        }

        // 2. Add Contextual Facts
        if (Array.isArray(context.facts) && context.facts.length > 0) {
            promptParts.push("\n--- CONTEXTUAL INFORMATION ---");
            const facts = /** @type {string[]} */ (context.facts);
            for (const fact of facts) {
                promptParts.push(`- ${fact}`);
            }
        }

        // 3. Add Conversation History
        if (Array.isArray(context.history) && context.history.length > 0) {
            promptParts.push("\n--- CONVERSATION HISTORY ---");
            context.history.forEach((turn) => {
                const role = turn.role === 'assistant' ? 'AI' : 'User';
                promptParts.push(`${role}: ${turn.content}`);
            });
        }

        // 4. Add the Specific Task
        if (context.task) {
            promptParts.push(`\n--- YOUR TASK ---`);
            promptParts.push(context.task);
        } else {
            promptParts.push(`\n--- YOUR TASK ---`);
            promptParts.push("Provide an answer that is both factually correct and relevant to the context provided, without asking for clarification or additional information. Thank you for your service.");
        }
        
        const finalPrompt = promptParts.join('\n');
        console.log("Assembled Prompt for AI:", finalPrompt);
        return finalPrompt;
    }

    // Validation
    /**
     * @returns {string[]}
     */
    validate() {
        /** @type {string[]} */
        const errors = [];

        // Basic required fields
        if (!this.data.node_type) errors.push('node_type is required');
        if (!this.data.id) errors.push('id is required');

        // Type-specific validation
        switch (this.data.node_type) {
            case 'static':
                if (this.data.inputs && this.data.inputs.length > 0) {
                    errors.push('Static nodes cannot have inputs');
                }
                break;
            
            case 'input':
                if (!this.data.processing.wrapper_template) {
                    errors.push('Input nodes must have a wrapper_template');
                }
                break;
            
            case 'ai':
                if (!this.data.processing.type) {
                    errors.push('AI nodes must have a processing type');
                }
                break;
        }

        return errors;
    }

    /**
     * @param {ContextChainItem[]} contextChain
     * @returns {string[]}
     */
    _collectSources(contextChain) {
        return ContextEngine.collectSources(contextChain);
    }

    // Custom appearance methods
    /**
     * @param {string | null} color
     * @returns {this}
     */
    setCustomColor(color) {
        this.data.metadata.customColor = color;
        this.data.metadata.modified = true;
        return this;
    }

    getCustomColor() {
        return this.data.metadata.customColor;
    }

    /** @returns {this} */
    clearCustomColor() {
        this.data.metadata.customColor = null;
        this.data.metadata.modified = true;
        return this;
    }

    /**
     * @param {string | null} label
     * @returns {this}
     */
    setCustomLabel(label) {
        this.data.metadata.customLabel = label;
        this.data.metadata.modified = true;
        return this;
    }

    getCustomLabel() {
        return this.data.metadata.customLabel;
    }

    /** @returns {this} */
    clearCustomLabel() {
        this.data.metadata.customLabel = null;
        this.data.metadata.modified = true;
        return this;
    }

    // Deep clone
    /**
     * @returns {NodeData}
     */
    clone() {
        const cloned = new NodeData(this.data.node_type, this.data.id + '_copy');
        cloned.data = JSON.parse(JSON.stringify(this.data));
        cloned.data.id = this.data.id + '_copy';
        cloned.data.metadata.created_at = new Date().toISOString();
        return cloned;
    }
}

// Workflow-level data management
export class WorkflowData {
    /**
     * @param {string} id
     * @param {string} name
     */
    constructor(id, name) {
        this.data = {
            workflow: {
                id: id,
                name: name,
                created_at: new Date().toISOString(),
                version: 1
            },
            /** @type {Array<Record<string, any>>} */
            nodes: [],
            /** @type {Array<{ from: string, to: string, port_from: string, port_to: string }>} */
            connections: [],
            metadata: {
                total_nodes: 0,
                execution_order: /** @type {string[]} */ ([]),
                dependencies: /** @type {Record<string, string[]>} */ ({})
            }
        };
    }

    /**
     * @param {NodeData} nodeData
     * @returns {this}
     */
    addNode(nodeData) {
        this.data.nodes.push(nodeData.data);
        this.data.metadata.total_nodes = this.data.nodes.length;
        this._updateDependencies();
        return this;
    }

    /**
     * @param {string} fromId
     * @param {string} toId
     * @param {string} [fromPort]
     * @param {string} [toPort]
     * @returns {this}
     */
    addConnection(fromId, toId, fromPort = 'output', toPort = 'input') {
        this.data.connections.push({
            from: fromId,
            to: toId,
            port_from: fromPort,
            port_to: toPort
        });
        this._updateDependencies();
        return this;
    }

    _updateDependencies() {
        /** @type {Record<string, string[]>} */
        const deps = {};
        
        // Initialize all nodes with empty dependencies
        this.data.nodes.forEach(node => {
            deps[node.id] = [];
        });

        // Add dependencies based on connections
        this.data.connections.forEach(conn => {
            if (!deps[conn.to]) deps[conn.to] = [];
            deps[conn.to].push(conn.from);
        });

        this.data.metadata.dependencies = deps;
        this.data.metadata.execution_order = this._calculateExecutionOrder();
    }

    _calculateExecutionOrder() {
        const deps = this.data.metadata.dependencies;
        /** @type {Set<string>} */
        const visited = new Set();
        /** @type {Set<string>} */
        const visiting = new Set();
        /** @type {string[]} */
        const order = [];

        /**
         * @param {string} nodeId
         */
        const visit = (nodeId) => {
            if (visiting.has(nodeId)) {
                throw new Error(`Circular dependency detected involving node ${nodeId}`);
            }
            if (visited.has(nodeId)) return;

            visiting.add(nodeId);
            
            // Visit dependencies first
            (deps[nodeId] || []).forEach(depId => visit(depId));
            
            visiting.delete(nodeId);
            visited.add(nodeId);
            order.push(nodeId);
        };

        Object.keys(deps).forEach(nodeId => visit(nodeId));
        return order;
    }

    /**
     * @returns {string}
     */
    toYAML() {
        return yamlStringify(this.data, { 
            indent: 2,
            lineWidth: 0,
            minContentWidth: 0
        });
    }

    /**
     * @param {string} yamlString
     * @returns {WorkflowData}
     */
    static fromYAML(yamlString) {
        try {
            const data = yamlParse(yamlString);
            const workflow = new WorkflowData(data.workflow.id, data.workflow.name);
            workflow.data = data;
            return workflow;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to parse workflow YAML: ${message}`);
        }
    }
}
