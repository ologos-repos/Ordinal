/**
 * App-level mode store — controls which type of canvas/graph is active.
 *
 * Modes:
 * - automation: Pipeline/agent execution (worker, orchestrator, oracle, trigger, etc.)
 * - diagramming: Architecture diagrams (server, database, api, cloud, etc.)
 * - knowledge: Knowledge Factory nodes (AI completion, source, process, output)
 */
import { writable, derived } from 'svelte/store';
import { nodes } from './nodes.js';

/** @typedef {'automation' | 'diagramming' | 'knowledge'} CanvasAppMode */

/** @type {import('svelte/store').Writable<CanvasAppMode>} */
export const appMode = writable('knowledge');

export const isAutomationMode = derived(appMode, $m => $m === 'automation');
export const isDiagrammingMode = derived(appMode, $m => $m === 'diagramming');
export const isKnowledgeMode = derived(appMode, $m => $m === 'knowledge');

/**
 * modeLocked — true when any nodes exist on the canvas.
 * When locked, the mode toggle and automation sub-mode toggle are disabled.
 * Mode unlocks automatically when the canvas is cleared (all nodes removed).
 */
export const modeLocked = derived(nodes, $nodes => $nodes.length > 0);
