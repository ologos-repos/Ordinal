/**
 * @typedef {import('./base-plugin.js').BasePlugin} BasePlugin
 * @typedef {import('./base-plugin.js').PluginManifest} PluginManifest
 * @typedef {{ isValid: boolean, errors: string[] }} PluginValidationResult
 */

/**
 * PluginRegistry - Central registry for all Ordinal plugins
 * 
 * Manages plugin registration, validation, and access throughout the application.
 */
export class PluginRegistry {
    constructor() {
        /** @type {Map<string, BasePlugin>} */
        this.plugins = new Map(); // id -> plugin instance
        /** @type {Map<string, Set<string>>} */
        this.categories = new Map(); // category -> Set of plugin ids
        /** @type {Map<string, Set<(...args: any[]) => void>>} */
        this.eventListeners = new Map(); // event -> Set of callbacks
    }

    // Plugin Registration

    /**
     * Register a plugin with the registry
     * 
     * @param {BasePlugin} plugin - Plugin instance to register
     * @returns {boolean} Success status
     */
    /**
     * @param {BasePlugin} plugin
     * @returns {boolean}
     */
    registerPlugin(plugin) {
        try {
            // Validate plugin
            const validation = this.validatePlugin(plugin);
            if (!validation.isValid) {
                console.error(`Plugin registration failed for ${plugin.getId()}:`, validation.errors);
                return false;
            }

            // Check for duplicate registration
            if (this.plugins.has(plugin.getId())) {
                console.warn(`Plugin ${plugin.getId()} is already registered. Skipping.`);
                return false;
            }

        // Register plugin
        this.plugins.set(plugin.getId(), plugin);

        // Add to category
        const category = plugin.getCategory();
        let categorySet = this.categories.get(category);
        if (!categorySet) {
            categorySet = new Set();
            this.categories.set(category, categorySet);
        }
        categorySet.add(plugin.getId());

            // Call plugin's onRegister lifecycle method
            try {
                plugin.onRegister();
            } catch (error) {
                console.error(`Plugin ${plugin.getId()} onRegister() failed:`, error);
            }

            // Emit registration event
            this.emit('plugin:registered', { plugin });

            console.log(`Plugin registered: ${plugin.getName()} (${plugin.getId()}) v${plugin.getVersion()}`);
            return true;

        } catch (error) {
            console.error(`Failed to register plugin ${plugin.getId()}:`, error);
            return false;
        }
    }

    /**
     * Unregister a plugin from the registry
     * 
     * @param {string} pluginId - Plugin ID to unregister
     * @returns {boolean} Success status
     */
    unregisterPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            console.warn(`Plugin ${pluginId} not found for unregistration`);
            return false;
        }

        try {
            // Remove from category
            const category = plugin.getCategory();
            const categorySet = this.categories.get(category);
            if (categorySet) {
                categorySet.delete(pluginId);
                if (categorySet.size === 0) {
                    this.categories.delete(category);
                }
            }

            // Call plugin's onUnregister lifecycle method
            try {
                plugin.onUnregister();
            } catch (error) {
                console.error(`Plugin ${pluginId} onUnregister() failed:`, error);
            }

            // Remove from registry
            this.plugins.delete(pluginId);

            // Emit unregistration event
            this.emit('plugin:unregistered', { pluginId, plugin });

            console.log(`Plugin unregistered: ${plugin.getName()} (${pluginId})`);
            return true;

        } catch (error) {
            console.error(`Failed to unregister plugin ${pluginId}:`, error);
            return false;
        }
    }

    // Plugin Access

    /**
     * Get a plugin by ID
     * 
     * @param {string} pluginId - Plugin ID
     * @returns {BasePlugin|null} Plugin instance or null
     */
    getPlugin(pluginId) {
        return this.plugins.get(pluginId) || null;
    }

    /**
     * Get all registered plugins
     * 
     * @returns {BasePlugin[]} Array of plugin instances
     */
    getAllPlugins() {
        return Array.from(this.plugins.values());
    }

    /**
     * Get plugins by category
     * 
     * @param {string} category - Category name
     * @returns {BasePlugin[]} Array of plugin instances
     */
    getPluginsByCategory(category) {
        const pluginIds = this.categories.get(category);
        if (!pluginIds) {
            return [];
        }

        const plugins = [];
        for (const id of pluginIds) {
            const plugin = this.plugins.get(id);
            if (plugin) {
                plugins.push(plugin);
            }
        }
        return plugins;
    }

    /**
     * Get all categories
     * 
     * @returns {string[]} Array of category names
     */
    getCategories() {
        return Array.from(this.categories.keys()).sort();
    }

    /**
     * Check if a plugin is registered
     * 
     * @param {string} pluginId - Plugin ID to check
     * @returns {boolean} Registration status
     */
    isPluginRegistered(pluginId) {
        return this.plugins.has(pluginId);
    }

    /**
     * Get the number of registered plugins
     * 
     * @returns {number} Plugin count
     */
    getPluginCount() {
        return this.plugins.size;
    }

    // Node Creation

    /**
     * Create a node using a specific plugin
     * 
     * @param {string} pluginId - Plugin ID
     * @param {Record<string, any>} options - Node creation options
     * @returns {Record<string, any> | null} Created node data or null
     */
    createNode(pluginId, options = {}) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            console.error(`Plugin ${pluginId} not found for node creation`);
            return null;
        }

        try {
            const nodeData = plugin.createNode(options);
            
            // Add plugin metadata to node
            if (nodeData && typeof nodeData === 'object') {
                const nodeRecord = /** @type {Record<string, any>} */ (nodeData);
                nodeRecord.pluginId = pluginId;
                nodeRecord.pluginVersion = plugin.getVersion();
            }

            // Call plugin's onNodeCreate lifecycle method
            try {
                plugin.onNodeCreate(nodeData);
            } catch (error) {
                console.error(`Plugin ${pluginId} onNodeCreate() failed:`, error);
            }

            // Emit node creation event
            this.emit('node:created', { pluginId, nodeData, plugin });

            return nodeData;

        } catch (error) {
            console.error(`Failed to create node with plugin ${pluginId}:`, error);
            return null;
        }
    }

    // Plugin Validation

    /**
     * Validate a plugin before registration
     * 
     * @param {BasePlugin} plugin - Plugin to validate
     * @returns {PluginValidationResult} Validation result
     */
    validatePlugin(plugin) {
        const errors = [];

        // Check if plugin extends BasePlugin
        if (!plugin || typeof plugin.getId !== 'function') {
            errors.push('Plugin must extend BasePlugin');
        }

        // Check required methods
        const requiredMethods = [
            'getId', 'getName', 'getVersion', 'getCategory',
            'createNode', 'getDefaultConfig', 'processNode', 'getComponent'
        ];

        const pluginAny = /** @type {Record<string, any>} */ (plugin);
        for (const method of requiredMethods) {
            if (typeof pluginAny[method] !== 'function') {
                errors.push(`Plugin missing required method: ${method}`);
            }
        }

        // Check required properties
        if (!plugin.id || typeof plugin.id !== 'string') {
            errors.push('Plugin must have a valid string ID');
        }

        if (!plugin.name || typeof plugin.name !== 'string') {
            errors.push('Plugin must have a valid string name');
        }

        if (!plugin.version || typeof plugin.version !== 'string') {
            errors.push('Plugin must have a valid string version');
        }

        // Check ID format (alphanumeric with hyphens/underscores)
        if (plugin.id && !/^[a-zA-Z0-9_-]+$/.test(plugin.id)) {
            errors.push('Plugin ID must contain only alphanumeric characters, hyphens, and underscores');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Event System

    /**
     * Add event listener
     * 
     * @param {string} event - Event name
     * @param {(...args: any[]) => void} callback - Event callback
     */
    on(event, callback) {
        let listeners = this.eventListeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.eventListeners.set(event, listeners);
        }
        listeners.add(callback);
    }

    /**
     * Remove event listener
     * 
     * @param {string} event - Event name
     * @param {(...args: any[]) => void} callback - Event callback
     */
    off(event, callback) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.delete(callback);
            if (listeners.size === 0) {
                this.eventListeners.delete(event);
            }
        }
    }

    /**
     * Emit event to all listeners
     * 
     * @param {string} event - Event name
     * @param {Record<string, any>} data - Event data
     */
    emit(event, data) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Event listener error for ${event}:`, error);
                }
            });
        }
    }

    // Utility Methods

    /**
     * Get registry statistics
     * 
     * @returns {{ totalPlugins: number, categories: number, pluginsByCategory: Record<string, number> }}
     */
    getStats() {
        const stats = {
            totalPlugins: this.plugins.size,
            categories: this.getCategories().length,
            pluginsByCategory: /** @type {Record<string, number>} */ ({})
        };

        for (const [category, pluginIds] of this.categories) {
            stats.pluginsByCategory[category] = pluginIds.size;
        }

        return stats;
    }

    /**
     * Clear all plugins from registry
     */
    clear() {
        // Unregister all plugins to ensure proper cleanup
        const pluginIds = Array.from(this.plugins.keys());
        for (const pluginId of pluginIds) {
            this.unregisterPlugin(pluginId);
        }

        // Clear any remaining data
        this.plugins.clear();
        this.categories.clear();
        this.eventListeners.clear();
    }

    /**
     * Export registry state for debugging
     * 
     * @returns {Object} Registry state
     */
    /**
     * @returns {{ plugins: Array<{ id: string, name: string, version: string, category: string }>, categories: Array<{ category: string, pluginIds: string[] }>, stats: { totalPlugins: number, categories: number, pluginsByCategory: Record<string, number> } }}
     */
    exportState() {
        return {
            plugins: Array.from(this.plugins.entries()).map(([id, plugin]) => ({
                id,
                name: plugin.getName(),
                version: plugin.getVersion(),
                category: plugin.getCategory()
            })),
            categories: Array.from(this.categories.entries()).map(([category, pluginIds]) => ({
                category,
                pluginIds: Array.from(pluginIds)
            })),
            stats: this.getStats()
        };
    }
}

// Create and export singleton registry instance
export const pluginRegistry = new PluginRegistry();
