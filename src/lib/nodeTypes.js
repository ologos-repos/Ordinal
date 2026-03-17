/**
 * Node type definitions and mode-based filtering for the Ordinal app.
 *
 * Three top-level modes:
 * 1. Automation — agent/pipeline nodes
 * 2. Diagramming — architecture diagram nodes
 * 3. Knowledge — knowledge factory nodes
 */

// ── Mode-Specific Node Type Arrays ──

/** Get all automation node types (Agent Graph) */
export function getAutomationTypes() {
  // 'output' removed — terminal nodes are identified by having no downstream connections
  return ['input', 'worker', 'orchestrator', 'oracle', 'process'];
}

/** Get Agent Graph node types — same as getAutomationTypes */
export function getAgentGraphTypes() {
  return ['input', 'worker', 'orchestrator', 'oracle', 'process'];
}

/** Get Action Graph node types — CI/CD pipeline nodes */
export function getActionGraphTypes() {
  // 'output' removed — terminal nodes are identified by having no downstream connections
  return ['trigger', 'bash', 'python', 'variable', 'process', 'approval', 'artifact'];
}

/** Get all diagramming node types */
export function getDiagramTypes() {
  return [
    'static', 'source', 'decision', 'ai', 'server', 'database', 'api',
    'cloud', 'container', 'queue', 'cache', 'gateway', 'firewall',
    'loadbalancer', 'user', 'monitor', 'default'
  ];
}

/** Get all Knowledge Factory node types */
export function getKnowledgeTypes() {
  return ['input', 'static', 'ai', 'text_file_source', 'pdf_file_source', 'text_file_output'];
}

/** Check if a node type is a Knowledge Factory type
 * @param {string} type
 * @returns {boolean}
 */
export function isKnowledgeType(type) {
  // Knowledge types may have kf_ prefix in some contexts, or use generic names
  return type.startsWith('kf_') ||
         ['text_file_source', 'pdf_file_source', 'text_file_output'].includes(type);
}

// ── Node Type Metadata ──

/**
 * Get display metadata for a node type
 * @param {string} type
 * @returns {{label: string, icon: string, iconName: string|null, color: string, borderColor: string}}
 */
export function getNodeMeta(type) {
  const meta = {
    // Automation: Agent Graph
    // iconName maps to ICON_REGISTRY in icons.js; null = use emoji fallback
    'input':        { label: 'Input',        icon: '✏️', iconName: null,           color: '#89b4fa', borderColor: '#89b4fa' },
    'worker':       { label: 'Worker',       icon: '🔧', iconName: 'worker',       color: '#a6e3a1', borderColor: '#a6e3a1' },
    'orchestrator': { label: 'Orchestrator', icon: '🎭', iconName: 'brain',        color: '#cba6f7', borderColor: '#cba6f7' },
    'oracle':       { label: 'Oracle',       icon: '👁️', iconName: 'oracle',       color: '#f9e2af', borderColor: '#f9e2af' },
    'process':      { label: 'Process',      icon: '⚙️', iconName: 'gear',         color: '#94e2d5', borderColor: '#94e2d5' },
    // NOTE: 'output' type removed — terminal nodes identified by no downstream connections

    // Automation: Action Graph
    'trigger':      { label: 'Trigger',      icon: '▶️', iconName: null,           color: '#a6e3a1', borderColor: '#a6e3a1' },
    'bash':         { label: 'Bash',         icon: '💻', iconName: null,           color: '#89b4fa', borderColor: '#89b4fa' },
    'python':       { label: 'Python',       icon: '🐍', iconName: null,           color: '#f9e2af', borderColor: '#f9e2af' },
    'variable':     { label: 'Variable',     icon: '📦', iconName: null,           color: '#94e2d5', borderColor: '#94e2d5' },
    'approval':     { label: 'Approval',     icon: '✅', iconName: null,           color: '#f38ba8', borderColor: '#f38ba8' },
    'artifact':     { label: 'Artifact',     icon: '📦', iconName: null,           color: '#fab387', borderColor: '#fab387' },

    // Diagramming
    'static':       { label: 'Static',       icon: '📄', iconName: 'logs',         color: '#a6e3a1', borderColor: '#a6e3a1' },
    'source':       { label: 'Source',       icon: '📥', iconName: null,           color: '#fab387', borderColor: '#fab387' },
    'decision':     { label: 'Decision',     icon: '❓', iconName: null,           color: '#f9e2af', borderColor: '#f9e2af' },
    'ai':           { label: 'AI',           icon: '🤖', iconName: 'brain',        color: '#cba6f7', borderColor: '#cba6f7' },
    'server':       { label: 'Server',       icon: '🖥️', iconName: 'server',       color: '#89b4fa', borderColor: '#89b4fa' },
    'database':     { label: 'Database',     icon: '🗄️', iconName: 'database',     color: '#a6e3a1', borderColor: '#a6e3a1' },
    'api':          { label: 'API',          icon: '🔌', iconName: 'api',          color: '#94e2d5', borderColor: '#94e2d5' },
    'cloud':        { label: 'Cloud',        icon: '☁️', iconName: 'cloud',        color: '#89dceb', borderColor: '#89dceb' },
    'container':    { label: 'Container',    icon: '📦', iconName: 'container',    color: '#89b4fa', borderColor: '#89b4fa' },
    'queue':        { label: 'Queue',        icon: '📮', iconName: 'queue',        color: '#fab387', borderColor: '#fab387' },
    'cache':        { label: 'Cache',        icon: '⚡', iconName: 'cache',        color: '#f9e2af', borderColor: '#f9e2af' },
    'gateway':      { label: 'Gateway',      icon: '🚪', iconName: 'gateway',      color: '#94e2d5', borderColor: '#94e2d5' },
    'firewall':     { label: 'Firewall',     icon: '🛡️', iconName: 'firewall',     color: '#f38ba8', borderColor: '#f38ba8' },
    'loadbalancer': { label: 'Load Balancer',icon: '⚖️', iconName: 'loadbalancer', color: '#cba6f7', borderColor: '#cba6f7' },
    'user':         { label: 'User',         icon: '👤', iconName: 'user',         color: '#89b4fa', borderColor: '#89b4fa' },
    'monitor':      { label: 'Monitor',      icon: '📊', iconName: 'monitoring',   color: '#a6e3a1', borderColor: '#a6e3a1' },
    'default':      { label: 'Node',         icon: '○',  iconName: 'network',      color: '#6c7086', borderColor: '#6c7086' },

    // Knowledge Factory
    'text_file_source': { label: 'Text File Source', icon: '📄', iconName: 'filesystem', color: '#fab387', borderColor: '#fab387' },
    'pdf_file_source':  { label: 'PDF File Source',  icon: '📕', iconName: 'filesystem', color: '#f38ba8', borderColor: '#f38ba8' },
    'text_file_output': { label: 'Text File Output', icon: '📝', iconName: 'logs',       color: '#a6e3a1', borderColor: '#a6e3a1' },
  };

  return meta[type] || { label: type, icon: '○', iconName: null, color: '#6c7086', borderColor: '#6c7086' };
}

/**
 * Check if a node type is a "passive" type (non-AI, content passthrough).
 * These types display received input as content and auto-complete on load.
 * Includes: static, all diagramming types, all automation types, input.
 * Excludes: ai (which processes content via LLM).
 * @param {string} type
 * @returns {boolean}
 */
export function isPassiveType(type) {
  return type !== 'ai';
}

/**
 * Check if a node type should NOT accept incoming connections.
 * Currently only 'static' nodes are input-less.
 * @param {string} type
 * @returns {boolean}
 */
export function isInputless(type) {
  return type === 'static';
}
