/**
 * PluginLoader - Handles loading and initialization of plugins
 * 
 * Manages the dynamic loading of plugins and their registration with the registry.
 */
import { pluginRegistry } from './registry.js';

/**
 * @typedef {import('./base-plugin.js').BasePlugin} BasePlugin
 * @typedef {import('./base-plugin.js').PluginManifest} PluginManifest
 * @typedef {new (manifest: PluginManifest) => BasePlugin} PluginConstructor
 */

export class PluginLoader {
    constructor() {
        /** @type {Map<string, Record<string, any>>} */
        this.loadedModules = new Map(); // module path -> module
        /** @type {Map<string, Promise<boolean>>} */
        this.loadPromises = new Map(); // module path -> promise
    }

    /**
     * Load a plugin from a module path
     * 
     * @param {string} modulePath - Path to plugin module
     * @param {Record<string, any>} options - Loading options
     * @returns {Promise<boolean>} Success status
     */
    async loadPlugin(modulePath, options = {}) {
        try {
            // Check if already loaded
            if (this.loadedModules.has(modulePath)) {
                console.log(`Plugin module ${modulePath} already loaded`);
                return true;
            }

            // Check if currently loading
            if (this.loadPromises.has(modulePath)) {
                console.log(`Plugin module ${modulePath} is currently loading, waiting...`);
                const existingPromise = this.loadPromises.get(modulePath);
                return existingPromise ? await existingPromise : false;
            }

            // Start loading
            const loadPromise = this._loadPluginModule(modulePath, options);
            this.loadPromises.set(modulePath, loadPromise);

            const result = await loadPromise;
            
            // Clean up promise
            this.loadPromises.delete(modulePath);

            return result;

        } catch (error) {
            console.error(`Failed to load plugin from ${modulePath}:`, error);
            this.loadPromises.delete(modulePath);
            return false;
        }
    }

    /**
     * Internal method to load plugin module
     * 
     * @private
     * @param {string} modulePath - Path to plugin module
     * @param {Record<string, any>} options - Loading options
     * @returns {Promise<boolean>} Success status
     */
    async _loadPluginModule(modulePath, options) {
        try {
            // Dynamic import of the plugin module
            const pluginModule = /** @type {Record<string, any>} */ (await import(modulePath));
            
            // Store the loaded module
            this.loadedModules.set(modulePath, pluginModule);

            // Look for plugin exports
            const pluginExports = this._extractPluginExports(pluginModule);
            
            if (pluginExports.length === 0) {
                console.warn(`No plugin exports found in ${modulePath}`);
                return false;
            }

            // Register all found plugins
            let successCount = 0;
            for (const PluginClass of pluginExports) {
                try {
                    // Load manifest if provided
                    const loadOptions = /** @type {{ manifest?: PluginManifest }} */ (options);
                    let manifest = loadOptions.manifest;
                    if (!manifest && pluginModule.manifest) {
                        manifest = /** @type {PluginManifest} */ (pluginModule.manifest);
                    }

                    // Create plugin instance
                    const pluginManifest = /** @type {PluginManifest} */ (manifest || {
                        id: PluginClass.name,
                        name: PluginClass.name,
                        version: '0.0.0'
                    });
                    const pluginInstance = new PluginClass(pluginManifest);

                    // Register with registry
                    if (pluginRegistry.registerPlugin(pluginInstance)) {
                        successCount++;
                    }
                } catch (error) {
                    console.error(`Failed to instantiate plugin from ${modulePath}:`, error);
                }
            }

            console.log(`Loaded ${successCount} plugin(s) from ${modulePath}`);
            return successCount > 0;

        } catch (error) {
            console.error(`Failed to import plugin module ${modulePath}:`, error);
            return false;
        }
    }

    /**
     * Extract plugin classes from loaded module
     * 
     * @private
     * @param {Object} module - Loaded module
     * @returns {Array} Array of plugin classes
     */
    /**
     * @param {Record<string, any>} pluginModule
     * @returns {PluginConstructor[]}
     */
    _extractPluginExports(pluginModule) {
        /** @type {PluginConstructor[]} */
        const plugins = [];

        // Check for default export
        if (pluginModule.default && typeof pluginModule.default === 'function') {
            plugins.push(/** @type {PluginConstructor} */ (pluginModule.default));
        }

        // Check for named exports
        for (const [key, value] of Object.entries(pluginModule)) {
            if (key !== 'default' && typeof value === 'function') {
                // Check if it looks like a plugin class (has required methods)
                const proto = value.prototype;
                if (proto && typeof proto.getId === 'function' && typeof proto.createNode === 'function') {
                    plugins.push(/** @type {PluginConstructor} */ (value));
                }
            }
        }

        return plugins;
    }

    /**
     * Load multiple plugins from an array of module paths
     * 
     * @param {string[]} modulePaths - Array of module paths
     * @param {Record<string, any>} options - Loading options
     * @returns {Promise<{ successful: number, failed: number, errors: string[] }>} Loading results
     */
    async loadPlugins(modulePaths, options = {}) {
        const results = {
            successful: 0,
            failed: 0,
            errors: /** @type {string[]} */ ([])
        };

        const loadPromises = modulePaths.map(async (modulePath) => {
            try {
                const success = await this.loadPlugin(modulePath, options);
                if (success) {
                    results.successful++;
                } else {
                    results.failed++;
                    results.errors.push(`Failed to load plugin from ${modulePath}`);
                }
            } catch (error) {
                results.failed++;
                const message = error instanceof Error ? error.message : String(error);
                results.errors.push(`Error loading ${modulePath}: ${message}`);
            }
        });

        await Promise.all(loadPromises);

        console.log(`Plugin loading complete: ${results.successful} successful, ${results.failed} failed`);
        
        if (results.errors.length > 0) {
            console.error('Plugin loading errors:', results.errors);
        }

        return results;
    }

    /**
     * Load plugins from a manifest file
     * 
     * @param {string} manifestPath - Path to manifest file
     * @returns {Promise<{ successful: number, failed: number, errors: string[] }>} Loading results
     */
    async loadFromManifest(manifestPath) {
        try {
            const manifest = await import(manifestPath);
            const plugins = /** @type {(string | { path: string })[]} */ (
                manifest.plugins || manifest.default?.plugins || []
            );

            const modulePaths = plugins.map((entry) => {
                if (typeof entry === 'string') {
                    return entry;
                }
                if (entry && typeof entry === 'object' && 'path' in entry) {
                    return entry.path;
                }
                throw new Error('Invalid plugin entry in manifest');
            });

            return await this.loadPlugins(modulePaths);

        } catch (error) {
            console.error(`Failed to load plugins from manifest ${manifestPath}:`, error);
            const message = error instanceof Error ? error.message : String(error);
            return { successful: 0, failed: 1, errors: [message] };
        }
    }

    /**
     * Unload a plugin module
     * 
     * @param {string} modulePath - Path to plugin module
     * @returns {boolean} Success status
     */
    unloadPlugin(modulePath) {
        const module = this.loadedModules.get(modulePath);
        if (!module) {
            console.warn(`Plugin module ${modulePath} not loaded`);
            return false;
        }

        try {
            // Find plugins from this module and unregister them
            const pluginExports = this._extractPluginExports(module);
            
            for (const PluginClass of pluginExports) {
                // This is tricky - we need to find plugin instances by class
                // For now, we'll rely on the registry's unregister method
                // In a more sophisticated implementation, we'd track plugin instances by module
            }

            // Remove from loaded modules
            this.loadedModules.delete(modulePath);

            console.log(`Unloaded plugin module ${modulePath}`);
            return true;

        } catch (error) {
            console.error(`Failed to unload plugin module ${modulePath}:`, error);
            return false;
        }
    }

    /**
     * Get statistics about loaded modules
     * 
     * @returns {Object} Statistics
     */
    getStats() {
        return {
            loadedModules: this.loadedModules.size,
            loadingModules: this.loadPromises.size,
            modules: Array.from(this.loadedModules.keys())
        };
    }

    /**
     * Clear all loaded modules
     */
    clear() {
        this.loadedModules.clear();
        this.loadPromises.clear();
    }
}

// Create and export singleton loader instance
export const pluginLoader = new PluginLoader();
