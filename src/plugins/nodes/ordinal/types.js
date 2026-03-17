/**
 * Ordinal Node Type Definitions + Catppuccin Mocha Color Mapping
 *
 * All 28 node types ported from Canvas-MCP's type system.
 * Colors are Catppuccin Mocha palette values — exact hex from MERGE_PLAN.md.
 *
 * Structure:
 *   ORDINAL_NODE_TYPES  — Map of type id -> { label, description, borderColor, category, icon }
 *   ORDINAL_CATEGORIES  — Grouped categories for palette display
 */

// ─── Catppuccin Mocha Palette (used as border/accent colors) ───────────
export const CATPPUCCIN = {
    blue:     '#89b4fa',
    mauve:    '#cba6f7',
    green:    '#a6e3a1',
    peach:    '#fab387',
    yellow:   '#f9e2af',
    red:      '#f38ba8',
    teal:     '#94e2d5',
    overlay0: '#6c7086',
    sky:      '#89dceb',
    pink:     '#f5c2e7',
    // Base colors for node backgrounds
    base:     '#1e1e2e',
    mantle:   '#181825',
    crust:    '#11111b',
    surface0: '#313244',
    surface1: '#45475a',
    text:     '#cdd6f4',
    subtext0: '#a6adc8',
    subtext1: '#bac2de',
};

/**
 * @typedef {object} OrdinalNodeType
 * @property {string} label        - Human-readable display name
 * @property {string} description  - Brief description
 * @property {string} borderColor  - Catppuccin Mocha hex color for border/accent
 * @property {string} category     - Grouping category
 * @property {string} defaultIcon  - Default icon name from icons.js registry
 */

/** @type {Record<string, OrdinalNodeType>} */
export const ORDINAL_NODE_TYPES = {
    // ─── Canvas-MCP Original Types (8) ──────────────────────────────────
    'input': {
        label: 'Input',
        description: 'User input nodes',
        borderColor: CATPPUCCIN.blue,
        category: 'Core',
        defaultIcon: 'user',
    },
    'ai': {
        label: 'AI',
        description: 'AI processing nodes',
        borderColor: CATPPUCCIN.mauve,
        category: 'Core',
        defaultIcon: 'brain',
    },
    'static': {
        label: 'Static',
        description: 'Static content',
        borderColor: CATPPUCCIN.green,
        category: 'Core',
        defaultIcon: 'gear',
    },
    'source': {
        label: 'Source',
        description: 'Data source nodes',
        borderColor: CATPPUCCIN.peach,
        category: 'Core',
        defaultIcon: 'database',
    },
    'output': {
        label: 'Output',
        description: 'Output / result nodes',
        borderColor: CATPPUCCIN.yellow,
        category: 'Core',
        defaultIcon: 'logs',
    },
    'decision': {
        label: 'Decision',
        description: 'Decision / branch points',
        borderColor: CATPPUCCIN.red,
        category: 'Core',
        defaultIcon: 'gateway',
    },
    'process': {
        label: 'Process',
        description: 'Processing steps',
        borderColor: CATPPUCCIN.teal,
        category: 'Core',
        defaultIcon: 'gear',
    },
    'default': {
        label: 'Default',
        description: 'Default / untyped',
        borderColor: CATPPUCCIN.overlay0,
        category: 'Core',
        defaultIcon: 'gear',
    },

    // ─── Ordinal Extended Types (20) ────────────────────────────────────
    'api': {
        label: 'API',
        description: 'API endpoints',
        borderColor: CATPPUCCIN.sky,
        category: 'Services',
        defaultIcon: 'api',
    },
    'approval': {
        label: 'Approval',
        description: 'Approval gates',
        borderColor: CATPPUCCIN.yellow,
        category: 'General',
        defaultIcon: 'lock',
    },
    'artifact': {
        label: 'Artifact',
        description: 'Build artifacts',
        borderColor: CATPPUCCIN.mauve,
        category: 'General',
        defaultIcon: 'filesystem',
    },
    'bash': {
        label: 'Bash',
        description: 'Shell / CLI operations',
        borderColor: CATPPUCCIN.green,
        category: 'Compute',
        defaultIcon: 'server',
    },
    'cache': {
        label: 'Cache',
        description: 'Cache layers',
        borderColor: CATPPUCCIN.pink,
        category: 'Storage',
        defaultIcon: 'cache',
    },
    'cloud': {
        label: 'Cloud',
        description: 'Cloud services',
        borderColor: CATPPUCCIN.blue,
        category: 'Cloud',
        defaultIcon: 'cloud',
    },
    'container': {
        label: 'Container',
        description: 'Container / Docker',
        borderColor: CATPPUCCIN.teal,
        category: 'Compute',
        defaultIcon: 'container',
    },
    'database': {
        label: 'Database',
        description: 'Database nodes',
        borderColor: CATPPUCCIN.peach,
        category: 'Storage',
        defaultIcon: 'database',
    },
    'firewall': {
        label: 'Firewall',
        description: 'Firewall / security',
        borderColor: CATPPUCCIN.red,
        category: 'Networking',
        defaultIcon: 'firewall',
    },
    'gateway': {
        label: 'Gateway',
        description: 'API gateways',
        borderColor: CATPPUCCIN.green,
        category: 'Networking',
        defaultIcon: 'gateway',
    },
    'loadbalancer': {
        label: 'Load Balancer',
        description: 'Load balancers',
        borderColor: CATPPUCCIN.sky,
        category: 'Networking',
        defaultIcon: 'loadbalancer',
    },
    'monitor': {
        label: 'Monitor',
        description: 'Monitoring',
        borderColor: CATPPUCCIN.yellow,
        category: 'Services',
        defaultIcon: 'monitoring',
    },
    'oracle': {
        label: 'Oracle',
        description: 'Oracle / human-in-loop',
        borderColor: CATPPUCCIN.mauve,
        category: 'Agent',
        defaultIcon: 'oracle',
    },
    'orchestrator': {
        label: 'Orchestrator',
        description: 'Orchestration',
        borderColor: CATPPUCCIN.pink,
        category: 'Agent',
        defaultIcon: 'bus',
    },
    'python': {
        label: 'Python',
        description: 'Python scripts',
        borderColor: CATPPUCCIN.green,
        category: 'Compute',
        defaultIcon: 'gear',
    },
    'queue': {
        label: 'Queue',
        description: 'Message queues',
        borderColor: CATPPUCCIN.peach,
        category: 'Services',
        defaultIcon: 'queue',
    },
    'server': {
        label: 'Server',
        description: 'Server instances',
        borderColor: CATPPUCCIN.blue,
        category: 'Compute',
        defaultIcon: 'server',
    },
    'trigger': {
        label: 'Trigger',
        description: 'Event triggers',
        borderColor: CATPPUCCIN.red,
        category: 'General',
        defaultIcon: 'bell',
    },
    'user': {
        label: 'User',
        description: 'User entities',
        borderColor: CATPPUCCIN.sky,
        category: 'General',
        defaultIcon: 'user',
    },
    'variable': {
        label: 'Variable',
        description: 'Variables',
        borderColor: CATPPUCCIN.overlay0,
        category: 'General',
        defaultIcon: 'key',
    },
    'worker': {
        label: 'Worker',
        description: 'Worker agents',
        borderColor: CATPPUCCIN.teal,
        category: 'Agent',
        defaultIcon: 'worker',
    },
};

/**
 * Categories for palette grouping in the UI.
 * Each entry maps a category name to an array of type ids.
 */
export const ORDINAL_CATEGORIES = {
    'Core':       ['input', 'ai', 'static', 'source', 'output', 'decision', 'process', 'default'],
    'Compute':    ['server', 'container', 'bash', 'python'],
    'Networking': ['loadbalancer', 'gateway', 'firewall'],
    'Storage':    ['database', 'cache'],
    'Services':   ['api', 'queue', 'monitor'],
    'Agent':      ['oracle', 'orchestrator', 'worker'],
    'Cloud':      ['cloud'],
    'General':    ['approval', 'artifact', 'trigger', 'user', 'variable'],
};

/**
 * Get the border color for a node type.
 * Falls back to overlay0 gray for unknown types.
 *
 * @param {string} type
 * @returns {string}
 */
export function getBorderColor(type) {
    const def = ORDINAL_NODE_TYPES[type];
    return def ? def.borderColor : CATPPUCCIN.overlay0;
}

/**
 * Get the default icon name for a node type.
 * Falls back to 'gear' for unknown types.
 *
 * @param {string} type
 * @returns {string}
 */
export function getDefaultIcon(type) {
    const def = ORDINAL_NODE_TYPES[type];
    return def ? def.defaultIcon : 'gear';
}

/**
 * Get full type definition. Returns null for unknown types.
 *
 * @param {string} type
 * @returns {OrdinalNodeType | null}
 */
export function getNodeTypeDef(type) {
    return ORDINAL_NODE_TYPES[type] || null;
}

/**
 * Get all type ids as an array.
 * @returns {string[]}
 */
export function getAllTypeIds() {
    return Object.keys(ORDINAL_NODE_TYPES);
}
