/**
 * @typedef {object} PluginManifest
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string=} category
 * @property {string=} description
 * @property {string=} author
 */

/**
 * BasePlugin - Abstract base class for all Ordinal plugins
 * 
 * All node plugins must extend this class and implement the required methods.
 * This provides a consistent interface for the plugin system.
 */
export class BasePlugin {
    /**
     * @param {PluginManifest} manifest
     */
    constructor(manifest) {
        if (this.constructor === BasePlugin) {
            throw new Error('BasePlugin is abstract and cannot be instantiated directly');
        }

        /** @type {PluginManifest} */
        this.manifest = manifest;
        /** @type {string} */
        this.id = manifest.id;
        /** @type {string} */
        this.name = manifest.name;
        /** @type {string} */
        this.version = manifest.version;
        /** @type {string} */
        this.category = manifest.category || 'misc';
        /** @type {string} */
        this.description = manifest.description || '';
        /** @type {string} */
        this.author = manifest.author || 'Unknown';
    }

    // Plugin Metadata Methods

    /**
     * Get the plugin's unique identifier
     */
    getId() {
        return this.id;
    }

    /**
     * Get the plugin's display name
     */
    getName() {
        return this.name;
    }

    /**
     * Get the plugin's version
     */
    getVersion() {
        return this.version;
    }

    /**
     * Get the plugin's category for grouping in palette
     */
    getCategory() {
        return this.category;
    }

    /**
     * Get the plugin's description
     */
    getDescription() {
        return this.description;
    }

    /**
     * Get the plugin's author
     */
    getAuthor() {
        return this.author;
    }

    // Node Creation Methods

    /**
     * Create a new node instance
     * Must be implemented by concrete plugins
     * 
     * @param {Record<string, any>} options - Initial node options
     * @returns {Record<string, any>} Node data object
     */
    createNode(options = {}) {
        throw new Error('createNode() must be implemented by concrete plugin');
    }

    /**
     * Get the default node configuration
     * Must be implemented by concrete plugins
     * 
     * @returns {Object} Default node configuration
     */
    getDefaultConfig() {
        throw new Error('getDefaultConfig() must be implemented by concrete plugin');
    }

    /**
     * Validate node configuration
     * Can be overridden by concrete plugins for custom validation
     * 
     * @param {Record<string, any>} config - Node configuration to validate
     * @returns {{ isValid: boolean, errors: string[] }} Validation result
     */
    validateConfig(config) {
        return { isValid: true, errors: [] };
    }

    // Node Processing Methods

    /**
     * Process node inputs and generate output
     * Must be implemented by concrete plugins
     * 
     * @param {Record<string, any>} nodeData - Current node data
     * @param {any[]} inputs - Array of input data from connected nodes
     * @param {Record<string, any>} context - Execution context
     * @returns {Promise<Record<string, any>>} Processing result
     */
    async processNode(nodeData, inputs, context) {
        throw new Error('processNode() must be implemented by concrete plugin');
    }

    /**
     * Check if this node can accept input connections
     * Can be overridden by concrete plugins
     * 
     * @returns {boolean}
     */
    canReceiveInputs() {
        return true;
    }

    /**
     * Check if this node can create output connections
     * Can be overridden by concrete plugins
     * 
     * @returns {boolean}
     */
    canCreateOutputs() {
        return true;
    }

    /**
     * Get the maximum number of input connections allowed
     * Can be overridden by concrete plugins
     * 
     * @returns {number} -1 for unlimited
     */
    getMaxInputs() {
        return -1; // Unlimited by default
    }

    /**
     * Get the maximum number of output connections allowed
     * Can be overridden by concrete plugins
     * 
     * @returns {number} -1 for unlimited
     */
    getMaxOutputs() {
        return -1; // Unlimited by default
    }

    // UI Methods

    /**
     * Get the Svelte component for rendering this node type
     * Must be implemented by concrete plugins
     * 
     * @returns {any}
     */
    getComponent() {
        throw new Error('getComponent() must be implemented by concrete plugin');
    }

    /**
     * Get the icon for this plugin (used in palette)
     * Can be overridden by concrete plugins
     * 
     * @returns {string} Icon string (emoji or SVG)
     */
    getIcon() {
        return '🔧'; // Default icon
    }

    /**
     * Get the color scheme for this plugin
     * Can be overridden by concrete plugins
     * 
     * @returns {Object} Color scheme object
     */
    getColorScheme() {
        return {
            primary: '#6366f1',
            secondary: '#e0e7ff',
            text: '#1e1b4b'
        };
    }

    // Lifecycle Methods

    /**
     * Called when the plugin is registered
     * Can be overridden by concrete plugins for initialization
     */
    onRegister() {
        // Override in concrete plugins if needed
    }

    /**
     * Called when the plugin is unregistered
     * Can be overridden by concrete plugins for cleanup
     */
    onUnregister() {
        // Override in concrete plugins if needed
    }

    /**
     * Called when a node of this type is created
     * Can be overridden by concrete plugins
     * 
     * @param {Record<string, any>} nodeData - The created node data
     */
    onNodeCreate(nodeData) {
        // Override in concrete plugins if needed
    }

    /**
     * Called when a node of this type is deleted
     * Can be overridden by concrete plugins
     * 
     * @param {Record<string, any>} nodeData - The deleted node data
     */
    onNodeDelete(nodeData) {
        // Override in concrete plugins if needed
    }

    // Serialization Methods

    /**
     * Serialize node data for saving
     * Can be overridden by concrete plugins for custom serialization
     * 
     * @param {Record<string, any>} nodeData - Node data to serialize
     * @returns {Record<string, any>} Serialized data
     */
    serializeNode(nodeData) {
        return {
            pluginId: this.id,
            pluginVersion: this.version,
            ...nodeData
        };
    }

    /**
     * Deserialize node data for loading
     * Can be overridden by concrete plugins for custom deserialization
     * 
     * @param {Record<string, any>} serializedData - Serialized node data
     * @returns {Record<string, any>} Deserialized node data
     */
    deserializeNode(serializedData) {
        const { pluginId, pluginVersion, ...nodeData } = serializedData;
        return nodeData;
    }

    // Utility Methods

    /**
     * Generate a unique node ID
     * 
     * @returns {string} Unique ID
     */
    generateNodeId() {
        return `${this.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Create a deep copy of an object
     * 
     * @param {Record<string, any>} obj - Object to clone
     * @returns {Record<string, any>} Cloned object
     */
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
}
