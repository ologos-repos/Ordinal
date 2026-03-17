/**
 * Plugin Initialization System
 * 
 * This module handles the initialization and loading of all Ordinal plugins.
 * It sets up the plugin system and registers all built-in plugins.
 */

import { pluginRegistry } from './core/registry.js';
import { pluginLoader } from './core/loader.js';

/**
 * @typedef {import('./core/base-plugin.js').BasePlugin} BasePlugin
 * @typedef {{ successful: number, failed: number, errors: string[] }} PluginInitResults
 */

// Import built-in plugins
import { TextInputPlugin } from './nodes/input/text-input.js';
import { OrdinalPlugin } from './nodes/ordinal/ordinal-plugin.js';

/**
 * Initialize the plugin system
 * 
 * @returns {Promise<PluginInitResults>} Initialization results
 */
export async function initializePlugins() {
    console.log('Initializing Ordinal plugin system...');
    
/** @type {PluginInitResults} */
const results = {
        successful: 0,
        failed: 0,
        errors: []
    };

    try {
        // Register built-in plugins
        await registerBuiltInPlugins(results);
        
        // Load user plugins if any (future feature)
        // await loadUserPlugins(results);
        
        // Load plugins from manifest if exists (future feature)
        // await loadPluginsFromManifest(results);

        console.log(`Plugin initialization complete: ${results.successful} successful, ${results.failed} failed`);
        
        if (results.errors.length > 0) {
            console.warn('Plugin initialization warnings:', results.errors);
        }

        // Log plugin registry stats
        const stats = pluginRegistry.getStats();
        console.log('Plugin registry stats:', stats);

        return results;

    } catch (error) {
        console.error('Plugin initialization failed:', error);
        results.failed++;
        const message = error instanceof Error ? error.message : String(error);
        results.errors.push(message);
        return results;
    }
}

/**
 * Register all built-in plugins
 * 
 * @param {Object} results - Results object to update
 */
/**
 * @param {PluginInitResults} results
 */
async function registerBuiltInPlugins(results) {
    /** @type {Array<{ name: string, factory: () => BasePlugin }> } */
    const builtInPlugins = [
        {
            name: 'Text Input Plugin',
            factory: () => new TextInputPlugin()
        },
        {
            name: 'Ordinal Nodes Plugin',
            factory: () => new OrdinalPlugin()
        }
    ];

    for (const pluginInfo of builtInPlugins) {
        try {
            const plugin = pluginInfo.factory();
            
            if (pluginRegistry.registerPlugin(plugin)) {
                results.successful++;
                console.log(`✓ Registered built-in plugin: ${pluginInfo.name}`);
            } else {
                results.failed++;
                results.errors.push(`Failed to register built-in plugin: ${pluginInfo.name}`);
                console.error(`✗ Failed to register built-in plugin: ${pluginInfo.name}`);
            }
        } catch (error) {
            results.failed++;
            const message = error instanceof Error ? error.message : String(error);
            results.errors.push(`Error registering ${pluginInfo.name}: ${message}`);
            console.error(`✗ Error registering ${pluginInfo.name}:`, error);
        }
    }
}

/**
 * @param {PluginInitResults} results
 */
async function loadUserPlugins(results) {
    // This will be implemented when we add support for user-defined plugins
    // It would scan a user plugins directory and load them dynamically
    console.log('User plugin loading not yet implemented');
}

/**
 * @param {PluginInitResults} results
 */
async function loadPluginsFromManifest(results) {
    // This will be implemented when we add support for plugin manifests
    // It would load plugins defined in a manifest file
    console.log('Manifest plugin loading not yet implemented');
}

/**
 * Get information about all registered plugins
 * 
 * @returns {{ plugins: Array<{ id: string, name: string, version: string, category: string, description: string, author: string, icon: string, colorScheme: Record<string, any> }>, categories: string[], stats: ReturnType<typeof pluginRegistry.getStats> }} Plugin information
 */
export function getPluginInfo() {
    const plugins = pluginRegistry.getAllPlugins();
    const categories = pluginRegistry.getCategories();
    const stats = pluginRegistry.getStats();

    return {
        plugins: plugins.map(plugin => ({
            id: plugin.getId(),
            name: plugin.getName(),
            version: plugin.getVersion(),
            category: plugin.getCategory(),
            description: plugin.getDescription(),
            author: plugin.getAuthor(),
            icon: plugin.getIcon(),
            colorScheme: plugin.getColorScheme()
        })),
        categories,
        stats
    };
}

/**
 * Create a node using a plugin
 * 
 * @param {string} pluginId - Plugin ID
 * @param {Record<string, any>} options - Node creation options
 * @returns {Record<string, any> | null} Created node or null if failed
 */
export function createNodeFromPlugin(pluginId, options = {}) {
    return pluginRegistry.createNode(pluginId, options);
}

/**
 * Get a plugin by ID
 * 
 * @param {string} pluginId - Plugin ID
 * @returns {BasePlugin|null} Plugin instance or null
 */
export function getPlugin(pluginId) {
    return pluginRegistry.getPlugin(pluginId);
}

/**
 * Get plugins by category
 * 
 * @param {string} category - Category name
 * @returns {BasePlugin[]} Array of plugins in the category
 */
export function getPluginsByCategory(category) {
    return pluginRegistry.getPluginsByCategory(category);
}

/**
 * Check if the plugin system is ready
 * 
 * @returns {boolean} Ready status
 */
export function isPluginSystemReady() {
    return pluginRegistry.getPluginCount() > 0;
}

/**
 * Reset the plugin system (mainly for testing)
 */
export function resetPluginSystem() {
    pluginRegistry.clear();
    pluginLoader.clear();
}

// Event system exports
export { pluginRegistry } from './core/registry.js';
export { pluginLoader } from './core/loader.js';
