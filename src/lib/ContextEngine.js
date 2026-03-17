/**
 * @fileoverview ContextEngine - Centralized context management system
 * Handles context chain building, merging, and propagation across workflow nodes
 */

/**
 * @typedef {import('./NodeData.js').StructuredContext} StructuredContext
 * @typedef {import('./NodeData.js').ContextChainItem} ContextChainItem
 * @typedef {import('./NodeData.js').ContextContribution} ContextContribution
 * @typedef {import('./NodeData.js').NodeOutput} NodeOutput
 */

/**
 * @typedef {{ role: 'user' | 'assistant', content: string }} ConversationTurn
 */

/**
 * @returns {StructuredContext}
 */
function createEmptyStructuredContext() {
    return {
        facts: /** @type {string[]} */ ([]),
        history: /** @type {ConversationTurn[]} */ ([]),
        task: ''
    };
}

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
 * @typedef {object} ContextNodeData
 * @property {string} id
 * @property {string} node_type
 * @property {string=} content
 * @property {string=} purpose
 * @property {{type?: string}=} processing
 * @property {NodeInput[]=} inputs
 */

/**
 * ContextEngine - Manages context chains and merging operations
 */
export class ContextEngine {
    /**
     * Build a context chain for a node based on its inputs and own contribution
     * @param {ContextNodeData} nodeData - The node data object
     * @param {NodeInput[]} [inputs=[]] - Array of input objects with context_chain
     * @returns {ContextChainItem[]} The built context chain
     */
    static buildContextChain(nodeData, inputs = []) {
        /** @type {ContextChainItem[]} */
        const newChain = [];
        /** @type {Set<string>} */
        const seenNodeIds = new Set();

        // 1. Inherit the chain from all inputs recursively
        inputs.forEach(input => {
            if (input.context_chain && Array.isArray(input.context_chain)) {
                const chain = /** @type {ContextChainItem[]} */ (input.context_chain);
                chain.forEach(item => {
                    if (!seenNodeIds.has(item.node_id)) {
                        newChain.push(item);
                        seenNodeIds.add(item.node_id);
                    }
                });
            }
        });

        // 2. Add this node's own contribution to the chain
        if (nodeData.content || nodeData.node_type === 'ai') {
            const contribution = this._createContribution(nodeData);
            
            if (contribution && !seenNodeIds.has(nodeData.id)) {
                newChain.push({
                    node_id: nodeData.id,
                    type: nodeData.node_type,
                    contribution: contribution,
                    processing: nodeData.processing?.type || 'unknown',
                    timestamp: new Date().toISOString()
                });
                seenNodeIds.add(nodeData.id);
            }
        }

        return newChain;
    }

    /**
     * Create a contribution object based on node type and data
     * @param {ContextNodeData} nodeData - The node data object
     * @returns {ContextContribution|undefined} The contribution object
     * @private
     */
    static _createContribution(nodeData) {
        switch (nodeData.node_type) {
            case 'input':
            case 'static':
                return {
                    type: nodeData.purpose === 'task' ? 'task' : 'fact',
                    content: nodeData.content ?? ''
                };
            case 'text_file_source':
            case 'pdf_file_source':
            case 'text_source':
                // Treat file/externally loaded text as facts
                return {
                    type: 'fact',
                    content: nodeData.content ?? ''
                };
            case 'ai':
                // Do not propagate AI outputs as history into downstream context
                // per project preference to avoid hidden history.
                return undefined;
            default:
                return undefined;
        }
    }

    /**
     * Collect unique source IDs from a context chain
     * @param {ContextChainItem[]} contextChain - The context chain
     * @returns {string[]} Array of unique source IDs
     */
    static collectSources(contextChain) {
        /** @type {Set<string>} */
        const sources = new Set();
        contextChain.forEach(item => {
            if (item && typeof item.node_id === 'string') {
                sources.add(item.node_id);
            }
        });
        return Array.from(sources);
    }

    /**
     * Build structured context value from context chain
     * @param {ContextChainItem[]} contextChain - The context chain
     * @returns {StructuredContext} The structured context object
     */
    static buildStructuredContext(contextChain) {
        const structuredValue = createEmptyStructuredContext();

        /** @type {Set<string>} */
        const seenFacts = new Set();
        /** @type {Set<string>} */
        const seenHistoryEntries = new Set();

        contextChain.forEach(item => {
            if (!item || !item.contribution) {
                return;
            }

            const contribution = item.contribution;

            if (contribution.type === 'fact') {
                if (typeof contribution.content !== 'string') {
                    return;
                }

                const factContent = contribution.content.trim();
                if (!factContent) {
                    return;
                }

                // Enhanced deduplication: split concatenated facts on newlines and deduplicate individual lines
                const factLines = factContent
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);

                factLines.forEach(line => {
                    if (!seenFacts.has(line)) {
                        structuredValue.facts.push(line);
                        seenFacts.add(line);
                    }
                });
                return;
            }

            if (contribution.type === 'task') {
                if (typeof contribution.content === 'string' && contribution.content.length > 0) {
                    structuredValue.task = contribution.content;
                }
                return;
            }

            if (contribution.type === 'history') {
                const historyContent = contribution.content;
                if (
                    historyContent &&
                    typeof historyContent === 'object' &&
                    typeof historyContent.content === 'string' &&
                    typeof historyContent.role === 'string'
                ) {
                    const historyTurn = /** @type {ConversationTurn} */ ({
                        role: historyContent.role,
                        content: historyContent.content
                    });
                    const historyKey = `${historyTurn.role}:${historyTurn.content}`;
                    if (!seenHistoryEntries.has(historyKey)) {
                        structuredValue.history.push(historyTurn);
                        seenHistoryEntries.add(historyKey);
                    }
                }
            }
        });

        return structuredValue;
    }

    /**
     * Merge outputs from multiple nodes into a single structured payload
     * @param {{ id: string }[]} outputNodes - Array of output node objects
     * @param {(id: string) => import('./NodeData.js').NodeData | undefined} getNodeData - Function to get node data by ID
     * @returns {NodeOutput} Merged output object
     */
    static mergeWorkflowOutputs(outputNodes, getNodeData) {
        console.log(`🔀 Merging workflow outputs from ${outputNodes.length} nodes:`, outputNodes.map(n => n.id));

        const mergedValue = createEmptyStructuredContext();
        /** @type {Set<string>} */
        const mergedSources = new Set();
        /** @type {ContextChainItem[]} */
        const mergedContextChain = [];
        /** @type {Set<string>} */
        const seenContextItems = new Set();
        /** @type {Set<string>} */
        const seenFacts = new Set();
        /** @type {Set<string>} */
        const seenHistoryEntries = new Set();

        outputNodes.forEach(node => {
            const nodeData = getNodeData(node.id);
            const nodeOutput = nodeData?.data?.output;
            if (!nodeOutput) {
                return;
            }

            const outputValue = nodeOutput.value;

            if (typeof outputValue === 'string') {
                const fact = outputValue.trim();
                if (fact && !seenFacts.has(fact)) {
                    mergedValue.facts.push(fact);
                    seenFacts.add(fact);
                }
            } else if (outputValue && typeof outputValue === 'object') {
                const structuredValue = /** @type {StructuredContext} */ (outputValue);

                if (Array.isArray(structuredValue.facts)) {
                    structuredValue.facts.forEach(fact => {
                        if (typeof fact === 'string' && !seenFacts.has(fact)) {
                            mergedValue.facts.push(fact);
                            seenFacts.add(fact);
                        }
                    });
                }

                if (Array.isArray(structuredValue.history)) {
                    structuredValue.history.forEach(historyItem => {
                        if (!historyItem || typeof historyItem.content !== 'string' || typeof historyItem.role !== 'string') {
                            return;
                        }
                        const historyKey = `${historyItem.role}:${historyItem.content}`;
                        if (!seenHistoryEntries.has(historyKey)) {
                            mergedValue.history.push(historyItem);
                            seenHistoryEntries.add(historyKey);
                        }
                    });
                }

                if (typeof structuredValue.task === 'string' && structuredValue.task.length > 0) {
                    mergedValue.task = structuredValue.task;
                }
            }

            if (Array.isArray(nodeOutput.sources)) {
                const sourceList = /** @type {string[]} */ (nodeOutput.sources);
                sourceList.forEach(sourceId => {
                    if (typeof sourceId === 'string') {
                        mergedSources.add(sourceId);
                    }
                });
            }

            if (Array.isArray(nodeOutput.context_chain)) {
                const chainItems = /** @type {ContextChainItem[]} */ (nodeOutput.context_chain);
                chainItems.forEach(chainItem => {
                    if (chainItem && typeof chainItem.node_id === 'string' && !seenContextItems.has(chainItem.node_id)) {
                        mergedContextChain.push(chainItem);
                        seenContextItems.add(chainItem.node_id);
                    }
                });
            }
        });

        // Sort history by timestamp if available
        mergedValue.history.sort((a, b) => {
            const entryA = mergedContextChain.find(item => item.contribution?.content === a);
            const entryB = mergedContextChain.find(item => item.contribution?.content === b);
            const timestampA = entryA?.timestamp;
            const timestampB = entryB?.timestamp;

            if (
                timestampA &&
                timestampB &&
                !Number.isNaN(new Date(timestampA).getTime()) &&
                !Number.isNaN(new Date(timestampB).getTime())
            ) {
                return new Date(timestampA).getTime() - new Date(timestampB).getTime();
            }
            return 0;
        });

        return {
            type: 'structured_context',
            value: mergedValue,
            sources: Array.from(mergedSources),
            context_chain: mergedContextChain
        };
    }

    /**
     * Add input to a node with proper context chain handling
     * @param {ContextNodeData & { inputs?: NodeInput[] }} nodeData - The target node data
     * @param {string} sourceId - Source node ID
     * @param {StructuredContext | string | any} value - Input value
     * @param {number} weight - Input weight
     * @param {(ContextChainItem[] | null)=} contextChain - Source context chain
     * @param {(string[] | null)=} sources - Source IDs
     */
    static addInput(nodeData, sourceId, value, weight = 1.0, contextChain = [], sources = []) {
        const inputData = /** @type {NodeInput} */ ({
            source_id: sourceId,
            data: value,
            weight: weight,
            received_at: new Date().toISOString()
        });
        
        // Include context chain if provided
        if (Array.isArray(contextChain) && contextChain.length > 0) {
            inputData.context_chain = /** @type {ContextChainItem[]} */ (contextChain);
        }
        
        // Include source chain if provided
        if (Array.isArray(sources) && sources.length > 0) {
            inputData.sources = /** @type {string[]} */ (sources);
        }

        if (!Array.isArray(nodeData.inputs)) {
            nodeData.inputs = [];
        }

        nodeData.inputs.push(inputData);
    }

    /**
     * Validate context chain structure
     * @param {ContextChainItem[]} contextChain - The context chain to validate
     * @returns {boolean} True if valid
     */
    static validateContextChain(contextChain) {
        if (!Array.isArray(contextChain)) return false;
        
        return contextChain.every(item => 
            item.node_id && 
            item.type && 
            item.contribution &&
            item.timestamp
        );
    }

    /**
     * Dynamic Context Flow: Propagate existing output to newly connected downstream node/machine
     * Called when a new connection is made TO an already-executed source
     * @param {string} sourceId - Source node/machine ID that already has output
     * @param {string} targetId - Target node/machine ID that should receive the output
     * @param {Function} getNodeData - Function to get node data by ID
     * @param {Function} getContainerOutput - Async function to get container output (machine/factory/network) by ID  
     * @param {Function} updateNodeInput - Function to update node input
     */
    static async propagateExistingOutput(sourceId, targetId, getNodeData, getContainerOutput, updateNodeInput) {
        console.log(`🔄 Propagating existing output from ${sourceId} to ${targetId}`);
        
        // Get source output (could be node, machine, factory, or network)
        /** @type {StructuredContext | string | null} */
        let sourceOutput = null;
        /** @type {ContextChainItem[]} */
        let sourceContextChain = [];
        /** @type {string[]} */
        let sourceSources = [];
        
        // Try node first
        const sourceNodeData = getNodeData(sourceId);
        if (sourceNodeData && sourceNodeData.data.output && sourceNodeData.data.output.value) {
            sourceOutput = sourceNodeData.data.output.value;
            const nodeContextChain = sourceNodeData.data.output.context_chain;
            const nodeSources = sourceNodeData.data.output.sources;
            sourceContextChain = Array.isArray(nodeContextChain) ? nodeContextChain : [];
            sourceSources = Array.isArray(nodeSources) ? nodeSources : [];
            console.log(`📤 Found node output from ${sourceId}:`, typeof sourceOutput);
        } 
        // Try container output (machine/factory/network)
        else {
            const containerOutput = await getContainerOutput(sourceId);
            if (containerOutput && containerOutput.value) {
                sourceOutput = containerOutput.value;
                const containerContextChain = containerOutput.context_chain;
                const containerSources = containerOutput.sources;
                sourceContextChain = Array.isArray(containerContextChain) ? containerContextChain : [];
                sourceSources = Array.isArray(containerSources) ? containerSources : [];
                console.log(`🏭 Found container output from ${sourceId}:`, typeof sourceOutput);
                const structured =
                    sourceOutput && typeof sourceOutput === 'object'
                        ? /** @type {StructuredContext} */ (sourceOutput)
                        : null;
                console.log(`🔍 Container output data:`, {
                    facts: structured?.facts?.length || 0,
                    history: structured?.history?.length || 0, 
                    task: structured?.task || 'empty',
                    contextChainLength: sourceContextChain.length,
                    sourcesCount: sourceSources.length
                });
            }
        }
        
        if (sourceOutput) {
            // Propagate to target
            const contextChainForPropagation = sourceContextChain.length > 0 ? sourceContextChain : null;
            const sourcesForPropagation = sourceSources.length > 0 ? sourceSources : null;
            updateNodeInput(targetId, sourceId, sourceOutput, 1.0, contextChainForPropagation, sourcesForPropagation);
            console.log(`✅ Context propagated from ${sourceId} to ${targetId}`);
        } else {
            console.log(`⚠️ No existing output found on ${sourceId} to propagate`);
        }
    }
    
    /**
     * Dynamic Context Flow: Clear context when connection is removed
     * Called when a connection is broken
     * @param {string} sourceId - Source node/machine ID  
     * @param {string} targetId - Target node/machine ID that should lose the input
     * @param {Function} getNodeData - Function to get node data by ID
     * @param {Function} clearNodeInput - Function to clear node input
     */
    static clearPropagatedContext(sourceId, targetId, getNodeData, clearNodeInput) {
        console.log(`🧹 Clearing propagated context from ${sourceId} to ${targetId}`);
        
        // Clear the specific input from the target
        clearNodeInput(targetId, sourceId);
        console.log(`✅ Context cleared between ${sourceId} and ${targetId}`);
    }
    
    /**
     * Dynamic Context Flow: Check if a node/machine has existing output to propagate
     * @param {string} nodeId - Node/machine ID to check
     * @param {Function} getNodeData - Function to get node data by ID  
     * @param {Function} getContainerOutput - Async function to get container output by ID
     * @returns {Promise<boolean>} True if the node/container has output to propagate
     */
    static async hasExistingOutput(nodeId, getNodeData, getContainerOutput) {
        // Check node output
        const nodeData = getNodeData(nodeId);
        if (nodeData && nodeData.data.output && nodeData.data.output.value) {
            return true;
        }
        
        // Check container output (machine/factory/network)
        const containerOutput = await getContainerOutput(nodeId);
        if (containerOutput && containerOutput.value) {
            return true;
        }
        
        return false;
    }

    /**
     * Get context statistics for debugging
     * @param {ContextChainItem[]} contextChain - The context chain
     * @returns {Object} Statistics object
     */
    static getContextStats(contextChain) {
        /** @type {Set<string>} */
        const uniqueNodeSet = new Set();
        /** @type {Record<string, number>} */
        const nodeTypeCounts = {};

        const stats = {
            totalItems: contextChain.length,
            facts: 0,
            history: 0,
            tasks: 0,
            uniqueNodes: 0,
            nodeTypes: nodeTypeCounts
        };

        contextChain.forEach(item => {
            if (!item || typeof item.node_id !== 'string') {
                return;
            }

            uniqueNodeSet.add(item.node_id);
            
            if (item.type) {
                nodeTypeCounts[item.type] = (nodeTypeCounts[item.type] || 0) + 1;
            }
            
            if (item.contribution) {
                switch (item.contribution.type) {
                    case 'fact':
                        stats.facts++;
                        break;
                    case 'history':
                        stats.history++;
                        break;
                    case 'task':
                        stats.tasks++;
                        break;
                }
            }
        });

        stats.uniqueNodes = uniqueNodeSet.size;
        return stats;
    }

    /**
     * Build an instruction-first execution envelope for an AI node.
     * This does NOT hit any stores; it uses only provided nodeData and inputs/context_chain.
     * Callers can pass optional container/ordering info.
     *
     * @param {ContextNodeData & { inputs?: NodeInput[] }} nodeData
     * @param {{
     *   containerInfo?: { factoryId?: string, machineId?: string, stepIndex?: number, totalSteps?: number },
     *   roleHint?: string,
     *   outputContract?: { format?: string, content?: string[] },
     *   budgets?: { instruction?: number, constraints?: number, context?: number },
     *   mode?: 'minimal' | 'full',
     * }=} options
     * @returns {string} envelope prompt text
     */
    static buildNodeExecutionEnvelope(nodeData, options = {}) {
        const containerInfo = options.containerInfo || {};
        const budgets = Object.assign({ instruction: 800, constraints: 400, context: 800 }, options.budgets || {});
        const mode = options.mode || 'minimal';

        // 1) Derive instruction (from nearest input/static or provided content sections)
        const instruction = this._extractInstruction(nodeData, budgets.instruction);

        // 2) Derive constraints (heuristic from instruction bullets/keywords)
        const constraints = this._extractConstraints(instruction, budgets.constraints);

        // 3) Context from inputs/context_chain
        const contextBullets = mode === 'full'
            ? this._buildFullContext(nodeData)
            : this._buildMinimalContext(nodeData, budgets.context);

        // 4) Role hint + output contract
        const roleHint = options.roleHint || this._deriveRoleHint(nodeData);
        const outputContract = options.outputContract || { format: 'Bulleted list', content: ['Only deliver the requested artifacts', 'Do not include workflow summaries'] };

        // 5) Ordering header (optional)
        const header = this._formatHeader({
            nodeId: nodeData.id,
            nodeType: nodeData.node_type,
            factoryId: containerInfo.factoryId,
            machineId: containerInfo.machineId,
            stepIndex: containerInfo.stepIndex,
            totalSteps: containerInfo.totalSteps,
            roleHint
        });

        const contextHeading = mode === 'full' ? 'FULL CONTEXT (deduplicated)' : 'MINIMAL CONTEXT (ranked, truncated)';
        return this._formatEnvelope({ header, instruction, constraints, outputContract, contextBullets, contextHeading });
    }

    /**
     * @param {{ nodeId?: string, nodeType?: string, factoryId?: string, machineId?: string, stepIndex?: number, totalSteps?: number, roleHint?: string }} meta
     */
    static _formatHeader(meta) {
        const parts = [];
        if (meta.nodeId || meta.nodeType) {
            parts.push(`You are node ${meta.nodeId || 'unknown'} (type: ${meta.nodeType || 'unknown'}).`);
        }
        if (meta.machineId || meta.factoryId) {
            parts.push(`Location: machine ${meta.machineId || 'unknown'}${meta.factoryId ? `, factory ${meta.factoryId}` : ''}.`);
        }
        if (Number.isFinite(meta.stepIndex) && Number.isFinite(meta.totalSteps) && meta.totalSteps) {
            parts.push(`Position: step ${meta.stepIndex}/${meta.totalSteps}.`);
        }
        if (meta.roleHint) {
            parts.push(`Role: ${meta.roleHint}`);
        }
        return parts.join(' ');
    }

    /**
     * Extract an instruction string from node inputs/context_chain heuristically.
     * Preference order: explicit task in inputs' structured context -> last task contribution in context_chain -> nearest fact from input/static -> nodeData.content.
     * @param {ContextNodeData & { inputs?: NodeInput[] }} nodeData
     * @param {number} budget
     */
    static _extractInstruction(nodeData, budget) {
        // Check inputs for structured task
        if (Array.isArray(nodeData.inputs)) {
            for (const inp of nodeData.inputs) {
                const v = /** @type {any} */ (inp.data);
                if (v && typeof v === 'object' && typeof v.task === 'string' && v.task.trim()) {
                    return this._truncate(v.task.trim(), budget);
                }
            }
            // Search context_chain (nearest last)
            for (const inp of nodeData.inputs) {
                const chain = inp.context_chain;
                if (Array.isArray(chain) && chain.length) {
                    for (let i = chain.length - 1; i >= 0; i--) {
                        const ci = chain[i];
                        if (ci?.contribution?.type === 'task' && typeof ci.contribution.content === 'string') {
                            return this._truncate(ci.contribution.content.trim(), budget);
                        }
                    }
                }
            }
            // Fallback: nearest fact-like from inputs
            for (const inp of nodeData.inputs) {
                const v = /** @type {any} */ (inp.data);
                if (typeof v === 'string' && v.trim()) return this._truncate(v.trim(), budget);
                if (v && typeof v === 'object' && Array.isArray(v.facts) && v.facts.length) {
                    const facts = /** @type {string[]} */ (v.facts);
                    const first = (facts.find((fx) => typeof fx === 'string' && /^(define|decompose|break|generate|prioritize|identify|synthesize|produce)/i.test(fx)) || facts[0]);
                    if (typeof first === 'string') return this._truncate(first.trim(), budget);
                }
            }
        }
        // Last fallback: node content (only for non-AI nodes)
        if (nodeData.node_type !== 'ai' && typeof nodeData.content === 'string' && nodeData.content.trim()) {
            return this._truncate(nodeData.content.trim(), budget);
        }
        return 'Follow the instruction precisely based on the provided minimal context.';
    }

    /**
     * Derive constraints from instruction text (very lightweight heuristic)
     * @param {string} instruction
     * @param {number} budget
     */
    static _extractConstraints(instruction, budget) {
        const lines = instruction.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const picks = [];
        for (const l of lines) {
            if (/^(must|should|dont|do not|avoid|ensure|limit|no\s+)/i.test(l) || /^[-\*]\s/.test(l)) {
                picks.push(l.replace(/^[-\*]\s+/, ''));
            }
            if (picks.length >= 8) break;
        }
        const txt = picks.length ? picks.map(x => `- ${x}`).join('\n') : '- Adhere strictly to requested output and scope.';
        return this._truncate(txt, budget);
    }

    /**
     * Build minimal context bullets from inputs and context_chain.
     * @param {ContextNodeData & { inputs?: NodeInput[] }} nodeData
     * @param {number} budget
     * @returns {string[]}
     */
    static _buildMinimalContext(nodeData, budget) {
        /** @type {string[]} */
        const bullets = [];
        const pushBullet = (/** @type {string} */ s) => { if (s && typeof s === 'string' && s.trim()) bullets.push(s.trim()); };

        // Prefer last items (closest) from context_chain
        if (Array.isArray(nodeData.inputs)) {
            for (const inp of nodeData.inputs) {
                const chain = inp.context_chain;
                if (Array.isArray(chain) && chain.length) {
                    for (let i = Math.max(0, chain.length - 5); i < chain.length; i++) {
                        const ci = chain[i];
                        const c = ci?.contribution;
                        if (!c) continue;
                        if (c.type === 'fact' && typeof c.content === 'string') {
                            pushBullet(`${ci.node_id}: ${this._shortenLine(c.content)}`);
                        } else if (c.type === 'task' && typeof c.content === 'string') {
                            pushBullet(`${ci.node_id} (task): ${this._shortenLine(c.content)}`);
                        }
                    }
                }
            }
        }

        // Fallback: include a few facts from structured inputs
        if (bullets.length < 3 && Array.isArray(nodeData.inputs)) {
            for (const inp of nodeData.inputs) {
                const v = /** @type {any} */ (inp.data);
                if (v && typeof v === 'object' && Array.isArray(v.facts)) {
                    const facts = /** @type {string[]} */ (v.facts);
                    for (const f of facts.slice(0, 3)) {
                        if (typeof f === 'string') pushBullet(this._shortenLine(f));
                    }
                } else if (typeof v === 'string') {
                    pushBullet(this._shortenLine(v));
                }
            }
        }

        // Budget: cap total chars
        let acc = 0; const out = [];
        for (const b of bullets) {
            const bb = this._truncate(b, 200);
            if (acc + bb.length > budget) break;
            out.push(bb); acc += bb.length + 1;
            if (out.length >= 8) break;
        }
        return out;
    }

    /** @param {ContextNodeData} nodeData */
    static _deriveRoleHint(nodeData) {
        if (nodeData.node_type === 'ai') {
            // Try to infer from instruction keywords later if needed
            return 'Transform upstream inputs into the requested concrete deliverables.';
        }
        return 'Follow the node instruction.';
    }

    /**
     * @param {{ header: string, instruction: string, constraints: string, outputContract: { format?: string, content?: string[] }, contextBullets: string[], contextHeading: string }} p
     */
    static _formatEnvelope(p) {
        const ctx = p.contextBullets.length ? p.contextBullets.map(x => `- ${x}`).join('\n') : '- (minimal)';
        const contentRules = (p.outputContract.content || []).map(x => `- ${x}`).join('\n');
        const formatLine = p.outputContract.format ? `Format: ${p.outputContract.format}` : '';
        return [
            'SYSTEM',
            p.header,
            '',
            'INSTRUCTION (respond to this task only)',
            p.instruction,
            '',
            'CONSTRAINTS',
            p.constraints,
            '',
            'OUTPUT CONTRACT',
            [formatLine, contentRules].filter(Boolean).join('\n'),
            '',
            p.contextHeading,
            ctx
        ].join('\n');
    }

    /** @param {string} s */
    static _shortenLine(s) {
        return s.replace(/\s+/g, ' ').slice(0, 180);
    }

    /** @param {string} s @param {number} n */
    static _truncate(s, n) {
        if (!Number.isFinite(n) || n <= 0) return s;
        return s.length > n ? (s.slice(0, Math.max(0, n - 1)) + '…') : s;
    }

    /**
     * Build full, deduplicated context bullets from inputs/context_chain/structured values.
     * @param {ContextNodeData & { inputs?: NodeInput[] }} nodeData
     * @returns {string[]}
     */
    static _buildFullContext(nodeData) {
        /** @type {Set<string>} */
        const seen = new Set();
        /** @type {string[]} */
        const bullets = [];
        const add = (/** @type {string} */ s) => {
            const line = (s || '').replace(/\s+/g, ' ').trim();
            if (!line) return;
            if (seen.has(line)) return;
            seen.add(line);
            bullets.push(line);
        };

        if (!Array.isArray(nodeData.inputs)) return bullets;

        for (const inp of nodeData.inputs) {
            const v = /** @type {any} */ (inp.data);
            // Prefer structured context content when available
            if (v && typeof v === 'object') {
                const facts = Array.isArray(v.facts) ? /** @type {string[]} */ (v.facts) : [];
                for (const f of facts) if (typeof f === 'string') add(f);
                const hist = Array.isArray(v.history) ? v.history : [];
                for (const h of hist) {
                    if (h && typeof h === 'object' && typeof h.content === 'string' && typeof h.role === 'string') {
                        add(`${h.role}: ${h.content}`);
                    }
                }
                if (typeof v.task === 'string' && v.task.trim()) add(`task: ${v.task.trim()}`);
            } else if (typeof v === 'string') {
                add(v);
            }

            // Also include context_chain contributions for traceability
            const chain = inp.context_chain;
            if (Array.isArray(chain)) {
                for (const ci of chain) {
                    const c = ci?.contribution;
                    if (!c) continue;
                    if (c.type === 'fact' && typeof c.content === 'string') add(c.content);
                    if (c.type === 'task' && typeof c.content === 'string') add(c.content);
                    if (c.type === 'history' && c.content && typeof c.content === 'object') {
                        const hc = /** @type {{content?: string, role?: string}} */ (c.content);
                        if (typeof hc.content === 'string' && typeof hc.role === 'string') {
                            add(`${hc.role}: ${hc.content}`);
                        }
                    }
                }
            }
        }

        return bullets;
    }
}
