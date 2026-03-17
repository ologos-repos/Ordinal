/**
 * OrdinalPlugin — Main plugin class for all 28 Ordinal node types.
 *
 * Extends BasePlugin and registers every Ordinal node type (8 Canvas-MCP core +
 * 20 Ordinal-extended) into Ordinal's plugin system. Each type gets correct
 * Catppuccin Mocha colors, default icons, and connection capabilities.
 *
 * This is a single plugin that covers all 28 types — the node's `type` field
 * determines which color/icon/label to use. The OrdinalNode.svelte component
 * handles rendering any of them.
 */
import { BasePlugin } from '../../core/base-plugin.js';
import OrdinalNodeComponent from './OrdinalNode.svelte';
import { ORDINAL_NODE_TYPES, ORDINAL_CATEGORIES, getBorderColor, getDefaultIcon, getAllTypeIds, CATPPUCCIN } from './types.js';
import { getIcon } from './icons.js';

/**
 * Plugin manifest for the Ordinal plugin.
 * @type {import('../../core/base-plugin.js').PluginManifest}
 */
const ORDINAL_MANIFEST = {
    id: 'ordinal',
    name: 'Ordinal Nodes',
    version: '1.0.0',
    category: 'ordinal',
    description: 'All 28 Ordinal node types with Catppuccin Mocha styling and SVG icons',
    author: 'Ordinal',
};

export class OrdinalPlugin extends BasePlugin {
    constructor(manifest = ORDINAL_MANIFEST) {
        super(manifest);

        /**
         * Map of all supported node type IDs.
         * @type {string[]}
         */
        this.supportedTypes = getAllTypeIds();
    }

    // ─── Node Creation ──────────────────────────────────────────────────

    /**
     * Create a new Ordinal node instance.
     *
     * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, title?: string, content?: string, type?: string, icon?: string, config?: Record<string, any> }} [options]
     * @returns {Record<string, any>} Node data object
     */
    createNode(options = {}) {
        const opts = /** @type {{ id?: string, x?: number, y?: number, width?: number, height?: number, title?: string, content?: string, type?: string, icon?: string, config?: Record<string, any> }} */ (options);
        const nodeType = opts.type || 'default';
        const typeDef = ORDINAL_NODE_TYPES[nodeType] || ORDINAL_NODE_TYPES['default'];

        return {
            id: opts.id || this.generateNodeId(),
            type: nodeType,
            pluginId: this.id,
            pluginVersion: this.version,

            // Position and visual properties
            x: typeof opts.x === 'number' ? opts.x : 100,
            y: typeof opts.y === 'number' ? opts.y : 100,
            width: typeof opts.width === 'number' ? opts.width : 200,
            height: typeof opts.height === 'number' ? opts.height : 100,

            // Node content
            title: opts.title || typeDef.label,
            content: opts.content || '',

            // Icon override (optional — falls back to type default)
            icon: opts.icon || typeDef.defaultIcon,

            // Plugin-specific configuration
            config: {
                ...(opts.config || {}),
            },

            // Connection state
            inputs: [],
            outputs: [],

            // Processing state
            lastProcessed: null,
            processingError: null,

            // Metadata
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
        };
    }

    // ─── Default Config ─────────────────────────────────────────────────

    /**
     * Get the default node configuration.
     * @returns {Record<string, any>}
     */
    getDefaultConfig() {
        return {};
    }

    // ─── Validation ─────────────────────────────────────────────────────

    /**
     * Validate node configuration.
     *
     * @param {Record<string, any>} config
     * @returns {{ isValid: boolean, errors: string[] }}
     */
    validateConfig(config) {
        // Ordinal nodes are lightweight — minimal validation
        return { isValid: true, errors: [] };
    }

    // ─── Processing ─────────────────────────────────────────────────────

    /**
     * Process node inputs and generate output.
     * Ordinal nodes are visual/structural — they pass data through.
     *
     * @param {Record<string, any>} nodeData
     * @param {any[]} inputs
     * @param {Record<string, any>} context
     * @returns {Promise<Record<string, any>>}
     */
    async processNode(nodeData, inputs, context) {
        try {
            // Ordinal nodes act as pass-through or content holders
            const result = nodeData.content || '';

            nodeData.lastProcessed = new Date().toISOString();
            nodeData.processingError = null;

            return {
                success: true,
                output: result,
                metadata: {
                    type: nodeData.type,
                    inputCount: inputs.length,
                    processedAt: nodeData.lastProcessed,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            nodeData.processingError = message;
            return {
                success: false,
                error: message,
                output: nodeData.content || '',
            };
        }
    }

    // ─── UI Methods ─────────────────────────────────────────────────────

    /**
     * Get the Svelte component for rendering this node type.
     * @returns {any}
     */
    getComponent() {
        return OrdinalNodeComponent;
    }

    /**
     * Get the icon for this plugin (used in palette).
     * Returns a gear icon by default — individual nodes use per-type icons.
     * @returns {string}
     */
    getIcon() {
        return '🔮';
    }

    /**
     * Get the color scheme for this plugin.
     * Returns the Catppuccin Mocha base palette.
     * @returns {Record<string, any>}
     */
    getColorScheme() {
        return {
            primary: CATPPUCCIN.mauve,
            secondary: CATPPUCCIN.surface0,
            text: CATPPUCCIN.text,
        };
    }

    // ─── Connection Methods ─────────────────────────────────────────────

    /**
     * All Ordinal node types can receive inputs.
     * @returns {boolean}
     */
    canReceiveInputs() {
        return true;
    }

    /**
     * All Ordinal node types can create outputs.
     * @returns {boolean}
     */
    canCreateOutputs() {
        return true;
    }

    /**
     * Unlimited inputs.
     * @returns {number}
     */
    getMaxInputs() {
        return -1;
    }

    /**
     * Unlimited outputs.
     * @returns {number}
     */
    getMaxOutputs() {
        return -1;
    }

    // ─── Lifecycle Methods ──────────────────────────────────────────────

    onRegister() {
        console.log(`Ordinal plugin registered: ${this.supportedTypes.length} node types available`);
    }

    /**
     * @param {Record<string, any>} nodeData
     */
    onNodeCreate(nodeData) {
        // Set defaults based on type if not already set
        const typeDef = ORDINAL_NODE_TYPES[nodeData.type];
        if (typeDef && !nodeData.title) {
            nodeData.title = typeDef.label;
        }
        if (typeDef && !nodeData.icon) {
            nodeData.icon = typeDef.defaultIcon;
        }
    }

    /**
     * @param {Record<string, any>} nodeData
     */
    onNodeDelete(nodeData) {
        // No cleanup needed
    }

    // ─── Ordinal-Specific Methods ───────────────────────────────────────

    /**
     * Check if a given type string is a known Ordinal node type.
     * @param {string} type
     * @returns {boolean}
     */
    isOrdinalType(type) {
        return type in ORDINAL_NODE_TYPES;
    }

    /**
     * Get all supported type IDs.
     * @returns {string[]}
     */
    getSupportedTypes() {
        return this.supportedTypes;
    }

    /**
     * Get the border color for a node type.
     * @param {string} type
     * @returns {string}
     */
    getBorderColor(type) {
        return getBorderColor(type);
    }

    /**
     * Get the default icon name for a node type.
     * @param {string} type
     * @returns {string}
     */
    getDefaultIcon(type) {
        return getDefaultIcon(type);
    }

    /**
     * Get categories for palette display.
     * @returns {Record<string, string[]>}
     */
    getCategories() {
        return ORDINAL_CATEGORIES;
    }

    /**
     * Get an SVG icon string for a given icon name and color.
     * @param {string} iconName
     * @param {string} color
     * @returns {string | null}
     */
    getIconSvg(iconName, color) {
        return getIcon(iconName, color);
    }
}

export default OrdinalPlugin;
export { ORDINAL_MANIFEST as manifest };
