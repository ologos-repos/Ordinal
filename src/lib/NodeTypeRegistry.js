/**
 * @fileoverview NodeTypeRegistry — Central registry for all Ordinal node types.
 *
 * Replaces the ad-hoc switch-case in nodeActions.add() with a declarative
 * registry of type definitions. Each definition specifies:
 *   - defaults: data fields to merge onto the NodeData after construction
 *   - visual:   canvas dimensions and default title/content
 *   - behavior: canReceiveInputs, isPassive, requiresFile, fileFormat
 *   - hooks:    onCreated(id, nodeData, nodeActions) — optional post-creation callback
 *
 * Usage:
 *   import { NodeTypeRegistry } from './NodeTypeRegistry.js';
 *   const { canvasNode, nodeData } = NodeTypeRegistry.create(type, id, content, x, y);
 */

import { NodeData } from './NodeData.js';
import { getNodeMeta } from './nodeTypes.js';

// ── Type definitions ─────────────────────────────────────────────────────────

/**
 * @typedef {object} NodeTypeVisual
 * @property {number} width
 * @property {number} height
 * @property {string} [defaultTitle]   — falls back to getNodeMeta(type).label
 * @property {string} [defaultContent] — default canvas content string
 */

/**
 * @typedef {object} NodeTypeBehavior
 * @property {boolean} canReceiveInputs
 * @property {boolean} isPassive
 * @property {boolean} [requiresFile]
 * @property {string|null} [fileFormat]
 */

/**
 * @typedef {object} NodeTypeHooks
 * @property {(id: string, nodeData: NodeData, nodeActions: any) => void} [onCreated]
 */

/**
 * @typedef {object} NodeTypeDefinition
 * @property {Record<string, any>}  defaults
 * @property {NodeTypeVisual}       visual
 * @property {NodeTypeBehavior}     behavior
 * @property {NodeTypeHooks}        [hooks]
 */

/**
 * @typedef {object} CreateResult
 * @property {import('../stores/nodes.js').CanvasNode} canvasNode
 * @property {NodeData} nodeData
 */

// ── Registry class ────────────────────────────────────────────────────────────

class _NodeTypeRegistry {
    constructor() {
        /** @type {Map<string, NodeTypeDefinition>} */
        this._types = new Map();
        registerBuiltinTypes(this);
    }

    /**
     * Register a node type definition.
     * @param {string} typeName
     * @param {NodeTypeDefinition} definition
     */
    register(typeName, definition) {
        this._types.set(typeName, definition);
    }

    /**
     * Get the definition for a type (or a fallback for unknown types).
     * @param {string} typeName
     * @returns {NodeTypeDefinition}
     */
    getDefinition(typeName) {
        return this._types.get(typeName) || _makeFallbackDefinition(typeName);
    }

    /**
     * Create a canvas node + NodeData pair for the given type.
     *
     * @param {string} type
     * @param {string} id
     * @param {string} content
     * @param {number} x
     * @param {number} y
     * @returns {CreateResult}
     */
    create(type, id, content = '', x = 0, y = 0) {
        const def = this.getDefinition(type);
        const { visual, behavior, defaults } = def;

        // ── Resolve display values ──────────────────────────────────────────
        const title = visual.defaultTitle || getNodeMeta(type).label || type;
        const canvasContent = (content !== '' ? content : null)
            ?? visual.defaultContent
            ?? '';

        // ── Build NodeData ──────────────────────────────────────────────────
        const nodeData = new NodeData(type, id, canvasContent, title);

        // Apply defaults onto the internal data object
        _applyDefaults(nodeData, defaults, behavior);

        // ── Build canvas node ───────────────────────────────────────────────
        /** @type {import('../stores/nodes.js').CanvasNode} */
        const canvasNode = {
            id,
            type,
            x,
            y,
            width: visual.width,
            height: visual.height,
            content: canvasContent,
            title,
            created: Date.now(),
            locked: false
        };

        return { canvasNode, nodeData };
    }

    /**
     * Return the onCreated hook for a type (or null if none).
     * @param {string} type
     * @returns {NodeTypeHooks['onCreated'] | null}
     */
    getOnCreatedHook(type) {
        return this._types.get(type)?.hooks?.onCreated ?? null;
    }
}

// ── Default-application helper ────────────────────────────────────────────────

/**
 * Merge a type definition's defaults onto a freshly-constructed NodeData.
 *
 * @param {NodeData} nodeData
 * @param {Record<string, any>} defaults
 * @param {NodeTypeBehavior} behavior
 */
function _applyDefaults(nodeData, defaults, behavior) {
    const d = nodeData.data;

    // Purpose (input nodes)
    if (defaults.purpose !== undefined) {
        d.purpose = defaults.purpose;
    }

    // Processing block
    if (defaults.processing !== undefined) {
        d.processing = { ...defaults.processing };
    }

    // Output block extras (e.g. context_chain: [])
    if (defaults.output !== undefined) {
        d.output = { ...d.output, ...defaults.output };
    }

    // filePath
    if (defaults.filePath !== undefined) {
        d.filePath = defaults.filePath;
    }

    // metadata_extra — merge into metadata
    if (defaults.metadata_extra !== undefined) {
        d.metadata = { ...d.metadata, ...defaults.metadata_extra };
    }

    // inputs override (e.g. set to undefined for file-source nodes)
    if (Object.prototype.hasOwnProperty.call(defaults, 'inputs')) {
        d.inputs = defaults.inputs;
    }

    // Behavior: inputless nodes set inputs to undefined
    if (!behavior.canReceiveInputs) {
        d.inputs = undefined;
    }
}

// ── Fallback for unknown types ────────────────────────────────────────────────

/**
 * @param {string} typeName
 * @returns {NodeTypeDefinition}
 */
function _makeFallbackDefinition(typeName) {
    return {
        defaults: {},
        visual: { width: 250, height: 120 },
        behavior: { canReceiveInputs: true, isPassive: true }
    };
}

// ── Built-in type registration ────────────────────────────────────────────────

/**
 * Register all built-in Ordinal node types onto the registry.
 * @param {_NodeTypeRegistry} registry
 */
function registerBuiltinTypes(registry) {

    // ── Knowledge Factory: input ────────────────────────────────────────────
    registry.register('input', {
        defaults: {
            purpose: 'fact',
            processing: {
                envelope_style: 'prompt_wrapper',
                wrapper_template: '{inputs}\n{content}'
            }
        },
        visual: { width: 250, height: 120, defaultTitle: 'Input Node' },
        behavior: { canReceiveInputs: true, isPassive: true }
    });

    // ── Knowledge Factory: ai ───────────────────────────────────────────────
    registry.register('ai', {
        defaults: {
            processing: {
                type: 'ai_completion',
                model: '',
                system_prompt:
                    'You are a component in a workflow processing information. Take the provided contextual information and facts, and provide a direct, relevant response based on that context. Process and respond to what you are given - do not ask questions or request clarification.\n\nIMPORTANT: Respond with plain text only. Do NOT format your response as JSON, XML, or any structured format. Provide only the direct answer or content requested.',
                parameters: {
                    temperature: 0.7,
                    max_tokens: 1000
                }
            },
            output: { context_chain: [] }
        },
        visual: { width: 250, height: 120, defaultTitle: 'AI Output' },
        behavior: { canReceiveInputs: true, isPassive: false }
    });

    // ── Knowledge Factory: text_file_source ────────────────────────────────
    registry.register('text_file_source', {
        defaults: {
            filePath: '',
            metadata_extra: { meta_type: 'file_source', file_format: 'text' },
            inputs: undefined
        },
        visual: {
            width: 250,
            height: 120,
            defaultTitle: 'Text File Source',
            defaultContent: 'Select a file...'
        },
        behavior: {
            canReceiveInputs: false,
            isPassive: true,
            requiresFile: true,
            fileFormat: 'text'
        },
        hooks: {
            onCreated: (id, nodeData, nodeActions) => {
                // Automatically prompt for a file after node creation.
                // Skip during paste/load sequences via the same guards as the old code.
                setTimeout(() => {
                    // Never prompt during paste/load sequences
                    if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ordinalLoadingMode) return;

                    // Allow paste logic to explicitly suppress prompts for newly created nodes
                    if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ordinalSkipFilePromptIds instanceof Set) {
                        if ((/** @type {any} */ (window)).ordinalSkipFilePromptIds.has(id)) {
                            (/** @type {any} */ (window)).ordinalSkipFilePromptIds.delete(id);
                            return;
                        }
                    }

                    // If a file path is already present (e.g., set by paste), do not prompt.
                    // We can read it directly from the nodeData object (same reference in store).
                    if (nodeData && nodeData.data && nodeData.data.filePath) return;

                    nodeActions.selectFileForTextFileSource(id);
                }, 150);
            }
        }
    });

    // ── Knowledge Factory: pdf_file_source ─────────────────────────────────
    registry.register('pdf_file_source', {
        defaults: {
            filePath: '',
            metadata_extra: { meta_type: 'file_source', file_format: 'pdf' },
            inputs: undefined
        },
        visual: {
            width: 250,
            height: 120,
            defaultTitle: 'PDF File Source',
            defaultContent: 'Select a PDF...'
        },
        behavior: {
            canReceiveInputs: false,
            isPassive: true,
            requiresFile: true,
            fileFormat: 'pdf'
        },
        hooks: {
            onCreated: (id, nodeData, nodeActions) => {
                // Automatically prompt for a PDF file after node creation.
                setTimeout(() => {
                    if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ordinalLoadingMode) return;

                    if (typeof window !== 'undefined' && (/** @type {any} */ (window)).ordinalSkipFilePromptIds instanceof Set) {
                        if ((/** @type {any} */ (window)).ordinalSkipFilePromptIds.has(id)) {
                            (/** @type {any} */ (window)).ordinalSkipFilePromptIds.delete(id);
                            return;
                        }
                    }

                    // If a file path is already present (e.g., set by paste), do not prompt.
                    if (nodeData && nodeData.data && nodeData.data.filePath) return;

                    nodeActions.selectFileForPdfFileSource(id);
                }, 150);
            }
        }
    });

    // ── Knowledge Factory: text_file_output ────────────────────────────────
    registry.register('text_file_output', {
        defaults: {
            processing: {
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
            },
            metadata_extra: { lastSavedPath: null },
            output: { context_chain: [] }
        },
        visual: {
            width: 300,
            height: 150,
            defaultTitle: 'Text File Generation',
            defaultContent: 'Waiting for input...'
        },
        behavior: { canReceiveInputs: true, isPassive: false }
    });

    // ── Static/Diagramming/Automation types ────────────────────────────────
    // All of these share the same structure: no special processing, 250×120,
    // title from getNodeMeta(type).label. "static" is the only truly inputless one.

    const STATIC_TYPES = [
        // Core static
        'static',
        // Diagramming
        'source', 'decision', 'server', 'database', 'api', 'cloud',
        'container', 'queue', 'cache', 'gateway', 'firewall', 'loadbalancer',
        'user', 'monitor', 'default',
        // Automation — Agent Graph
        'worker', 'orchestrator', 'oracle', 'process',
        // Automation — Action Graph
        'trigger', 'bash', 'python', 'variable', 'approval', 'artifact'
        // NOTE: 'output' type removed — terminal nodes are identified by having
        // no downstream connections, not by a special type.
    ];

    for (const t of STATIC_TYPES) {
        const isStaticNode = (t === 'static');
        registry.register(t, {
            defaults: isStaticNode ? { inputs: undefined } : {},
            visual: { width: 250, height: 120 },
            // defaultTitle intentionally omitted — falls back to getNodeMeta(type).label
            behavior: {
                canReceiveInputs: !isStaticNode,
                isPassive: true
            }
        });
    }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const NodeTypeRegistry = new _NodeTypeRegistry();
