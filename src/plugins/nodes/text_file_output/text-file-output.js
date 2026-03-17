import { BasePlugin } from '../../core/base-plugin.js';
import config from './config.json';

/**
 * TextGeneratePlugin - A plugin for AI-powered text generation nodes
 * 
 * This plugin creates nodes that can:
 * - Generate text content using AI models
 * - Process inputs from other nodes
 * - Save generated content to files
 * - Support intelligent markdown formatting
 */
export class TextGeneratePlugin extends BasePlugin {
    constructor(manifest = config) {
        super(manifest);
    }

    // Node Creation Methods

    /**
     * Create a new text file output node
     * @param {Record<string, any>} options - Node creation options
     * @returns {Record<string, any>} - Node data structure
     */
    createNode(options = {}) {
        const defaultConfig = this.getDefaultConfig();
        
        return {
            id: options.id || this.generateNodeId(),
            type: 'text_file_output',
            pluginId: this.id,
            pluginVersion: this.version,
            
            // Position and visual properties
            x: options.x || 100,
            y: options.y || 100,
            width: options.width || 300,
            height: options.height || 150,
            
            // Node content and configuration
            title: options.title || 'Text File Generation',
            content: options.content || 'Waiting for input...',
            
            // Plugin-specific configuration
            config: {
                ...defaultConfig,
                ...options.config
            },
            
            // Connection state
            inputs: [],
            outputs: [],
            
            // Processing state
            lastProcessed: null,
            processingError: null,
            
            // AI Processing configuration
            processing: {
                type: 'ai_completion',
                model: '',
                system_prompt: this._getDefaultSystemPrompt()
            },
            
            // File saving state
            lastSavedPath: null,
            
            // Metadata
            created: new Date().toISOString(),
            modified: new Date().toISOString()
        };
    }

    /**
     * Get the default system prompt for AI generation
     * 
     * @private
     * @returns {string} Default system prompt
     */
    _getDefaultSystemPrompt() {
        return `You are an expert document generator. Your task is to create well-formatted content based on the context you receive.

FORMATTING GUIDELINES:
- If the user provides template instructions (e.g., "write a story", "create a report", "generate documentation"), follow those instructions precisely
- If no specific template is provided, create a well-structured markdown document
- Use appropriate headings (# ## ###) to organize content
- Include bullet points or numbered lists where appropriate
- Format code blocks, quotes, and emphasis as needed
- Ensure the content is engaging, informative, and professionally formatted

INPUT CONTEXT:
The following context will be provided to help you generate the content. Use this context to inform your writing, but create original, coherent content that builds upon or responds to the input.

TEMPLATE DETECTION:
- Look for template instructions in the input (e.g., "write a...", "create a...", "generate a...")
- If found, prioritize those instructions over default formatting
- If no template instructions are found, create a well-structured document based on the content theme`;
    }

    /**
     * Get the default node configuration
     * 
     * @returns {Object} Default node configuration
     */
    getDefaultConfig() {
        return {
            aiModel: '',
            supportedFileTypes: ['.md', '.txt'],
            defaultFileExtension: '.md',
            autoSaveOnGeneration: false,
            expandOnGeneration: true,
            expansionRatio: {
                vertical: 5,
                horizontal: 1
            },
            intelligentFormatting: true,
            templateDetection: true
        };
    }

    /**
     * Validate configuration object
     * @param {Record<string, any>} config - Configuration to validate
     * @returns {{ isValid: boolean; errors: string[] }} Validation result
     */
    validateConfig(config) {
        const errors = [];

        // Check supported file types
        if (config.supportedFileTypes && !Array.isArray(config.supportedFileTypes)) {
            errors.push('Supported file types must be an array');
        }

        // Check expansion ratio
        if (config.expansionRatio) {
            if (typeof config.expansionRatio !== 'object') {
                errors.push('Expansion ratio must be an object');
            } else {
                if (typeof config.expansionRatio.vertical !== 'number' || 
                    typeof config.expansionRatio.horizontal !== 'number') {
                    errors.push('Expansion ratio values must be numbers');
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Node Processing Methods

    /**
     * Ensure the output file exists when node is executed
     * Creates an empty file if it doesn't exist
     *
     * @param {Record<string, any>} nodeData - Current node data
     * @returns {Promise<boolean>} True if file exists or was created
     */
    async ensureFileExists(nodeData) {
        try {
            // Get the file path from various possible locations
            const filePath = nodeData.metadata?.lastSavedPath
                || nodeData.metadata?.autoSavePath
                || nodeData.filePath
                || nodeData.file_path;

            if (!filePath) {
                console.log('No file path configured for text_file_output node');
                return false;
            }

            console.log(`Ensuring file exists at: ${filePath}`);

            // Browser mode: Use Rhode API for file operations
            if (typeof window !== 'undefined') {
                try {
                    const { readTextFile, writeTextFile } = await import('../../lib/rhodeApi.js');
                    // Try to read the file first
                    await readTextFile(filePath);
                    console.log(`File already exists: ${filePath}`);
                    return true;
                } catch (readErr) {
                    // File doesn't exist, create it with placeholder content
                    console.log(`File doesn't exist, creating: ${filePath}`);
                    try {
                        const { writeTextFile } = await import('../../lib/rhodeApi.js');
                        const placeholder = '# Generated Content\n\nContent will appear here after processing...\n';
                        await writeTextFile(filePath, placeholder);
                        console.log(`Created placeholder file: ${filePath}`);
                        return true;
                    } catch (writeErr) {
                        console.error(`Failed to create file: ${filePath}`, writeErr);
                        return false;
                    }
                }
            } else {
                console.warn('Window not available, cannot ensure file exists');
            }

            return false;
        } catch (error) {
            console.error('Error in ensureFileExists:', error);
            return false;
        }
    }

    /**
     * Process node inputs and generate output using AI
     *
     * @param {Record<string, any>} nodeData - Current node data
     * @param {Array<any>} inputs - Array of input data from connected nodes
     * @param {Record<string, any>} context - Execution context
     * @returns {Promise<Record<string, any>>} Processing result
     */
    async processNode(nodeData, inputs, context) {
        try {
            // Process inputs to create the prompt
            let processedInput = '';
            
            if (inputs && inputs.length > 0) {
                // Combine inputs with separators
                processedInput = inputs.map(input => {
                    if (typeof input === 'string') return input;
                    return input.data || input.content || input.output || '';
                }).filter(content => content.trim() !== '').join('\n\n');
            } else {
                // Use node content as fallback
                processedInput = nodeData.content || 'Generate interesting content.';
            }

            // Get AI settings from context (this would be passed from the workflow execution)
            const aiSettings = context?.aiSettings || {};
            const model = nodeData.processing?.model || aiSettings.model || '';
            
            if (!model) {
                throw new Error('No AI model selected for text generation');
            }

            // Combine system prompt with processed input
            const fullPrompt = nodeData.processing.system_prompt + '\n\n' + processedInput;

            // This would be called from the workflow execution context
            // For now, we'll return the structure that the workflow expects
            
            // Update node processing state
            nodeData.lastProcessed = new Date().toISOString();
            nodeData.processingError = null;

            return {
                success: true,
                output: processedInput, // This will be replaced with AI response in workflow
                metadata: {
                    inputCount: inputs?.length || 0,
                    processedAt: nodeData.lastProcessed,
                    model: model,
                    aiGenerated: true
                },
                // Special flag for workflow to know this needs AI processing
                needsAIProcessing: true,
                aiPrompt: fullPrompt
            };

        } catch (error) {
            // Update node error state
            const errorMessage = error instanceof Error ? error.message : String(error);
            nodeData.processingError = errorMessage;
            
            return {
                success: false,
                error: errorMessage,
                output: nodeData.content || 'Waiting for input...'
            };
        }
    }

    // UI Methods

    /**
     * Get the Svelte component for rendering this node type
     * (For now, we'll use the default Node component)
     * 
     * @returns {null} Will use default rendering
     */
    getComponent() {
        return null; // Use default Node.svelte component
    }

    /**
     * Get the icon for this plugin
     * 
     * @returns {string} Icon string
     */
    getIcon() {
        return /** @type {any} */(this.manifest).icon || '📝';
    }

    /**
     * Get the color scheme for this plugin
     * 
     * @returns {Record<string, any>} Color scheme object
     */
    getColorScheme() {
        return /** @type {any} */(this.manifest).color || {
            primary: '#f59e0b',
            secondary: '#fef3c7',
            text: '#92400e'
        };
    }

    // Connection Methods

    /**
     * Check if this node can accept input connections
     * 
     * @returns {boolean}
     */
    canReceiveInputs() {
        return /** @type {any} */(this.manifest).connections?.canReceiveInputs ?? true;
    }

    /**
     * Check if this node can create output connections
     * 
     * @returns {boolean}
     */
    canCreateOutputs() {
        return /** @type {any} */(this.manifest).connections?.canCreateOutputs ?? true;
    }

    /**
     * Get the maximum number of input connections allowed
     * 
     * @returns {number} -1 for unlimited
     */
    getMaxInputs() {
        return /** @type {any} */(this.manifest).connections?.maxInputs ?? -1;
    }

    /**
     * Get the maximum number of output connections allowed
     * 
     * @returns {number} -1 for unlimited
     */
    getMaxOutputs() {
        return /** @type {any} */(this.manifest).connections?.maxOutputs ?? -1;
    }

    // File Operations

    /**
     * Get suggested filename based on node content
     * @param {Record<string, any>} nodeData - Node data
     * @returns {string} Suggested filename
     */
    getSuggestedFilename(nodeData) {
        const title = nodeData.title || 'generated_text';
        const cleanTitle = title.replace(/\s+/g, '_').toLowerCase();
        const extension = nodeData.config?.defaultFileExtension || '.md';
        return `${cleanTitle}${extension}`;
    }

    // Lifecycle Methods

    /**
     * Called when a node of this type is created
     * 
     * @param {Record<string, any>} nodeData - The created node data
     */
    onNodeCreate(nodeData) {
        console.log(`Text generation node created: ${nodeData.id}`);
    }

    /**
     * Called when a node of this type is deleted
     * 
     * @param {Record<string, any>} nodeData - The deleted node data
     */
    onNodeDelete(nodeData) {
        console.log(`Text generation node deleted: ${nodeData.id}`);
    }
}

// Export both the class and a factory function
export default TextGeneratePlugin;

// Create manifest export for easy access
export { config as manifest };
