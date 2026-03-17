import { BasePlugin } from '../../core/base-plugin.js';
import config from './config.json';

/**
 * TextSourcePlugin - A plugin for text source nodes that load content from files
 * 
 * This plugin creates nodes that can:
 * - Load text content from files
 * - Support drag and drop file loading
 * - Provide file content as output to other nodes
 */
export class TextSourcePlugin extends BasePlugin {
    constructor(manifest = config) {
        super(manifest);
    }

    // Node Creation Methods

    /**
     * Create a new text source node
     * @param {Record<string, any>} options - Node creation options
     * @returns {Record<string, any>} - Node data structure
     */
    createNode(options = {}) {
        const defaultConfig = this.getDefaultConfig();
        
        return {
            id: options.id || this.generateNodeId(),
            type: 'text_source',
            pluginId: this.id,
            pluginVersion: this.version,
            
            // Position and visual properties
            x: options.x || 100,
            y: options.y || 100,
            width: options.width || 250,
            height: options.height || 120,
            
            // Node content and configuration
            title: options.title || 'Text File Source',
            content: options.content || 'Select a file...',
            
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
            
            // File-specific data
            filePath: options.filePath || null,
            
            // Metadata
            created: new Date().toISOString(),
            modified: new Date().toISOString()
        };
    }

    /**
     * Get the default node configuration
     * 
     * @returns {Object} Default node configuration
     */
    getDefaultConfig() {
        return {
            supportedFileTypes: ['.txt', '.md', '.json', '.yaml', '.yml'],
            autoLoadOnCreate: true,
            preserveLineBreaks: true,
            encoding: 'utf-8'
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

        // Check encoding
        if (config.encoding && typeof config.encoding !== 'string') {
            errors.push('Encoding must be a string');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Node Processing Methods

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
            // Text source nodes don't process inputs, they provide file content as output
            const content = nodeData.content || '';
            
            // Update node processing state
            nodeData.lastProcessed = new Date().toISOString();
            nodeData.processingError = null;

            return {
                success: true,
                output: content,
                metadata: {
                    filePath: nodeData.filePath,
                    processedAt: nodeData.lastProcessed,
                    fileLoaded: !!nodeData.filePath
                }
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
        return /** @type {any} */(this.manifest).icon || '📄';
    }

    /**
     * Get the color scheme for this plugin
     * 
     * @returns {Record<string, any>} Color scheme object
     */
    getColorScheme() {
        return /** @type {any} */(this.manifest).color || {
            primary: '#10b981',
            secondary: '#d1fae5',
            text: '#064e3b'
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

    // Lifecycle Methods

    /**
     * Called when a node of this type is created
     * 
     * @param {Record<string, any>} nodeData - The created node data
     */
    onNodeCreate(nodeData) {
        console.log(`Text source node created: ${nodeData.id}`);
        
        // Auto-prompt for file selection if enabled
        if (nodeData.config?.autoLoadOnCreate) {
            // This would trigger the file selection dialog
            // Implementation will be handled by the node store
        }
    }

    /**
     * Called when a node of this type is deleted
     * 
     * @param {Record<string, any>} nodeData - The deleted node data
     */
    onNodeDelete(nodeData) {
        console.log(`Text source node deleted: ${nodeData.id}`);
    }
}

// Export both the class and a factory function
export default TextSourcePlugin;

// Create manifest export for easy access
export { config as manifest };