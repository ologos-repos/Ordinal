/**
 * Automation Sub-Mode Store — toggles between Agent Graph and Action Graph
 * within automation mode.
 *
 * Agent Graph: Rhode live execution (worker, orchestrator, oracle nodes)
 * Action Graph: Gitea Actions visual pipeline builder (bash, python, trigger nodes)
 */
import { writable, derived } from 'svelte/store';
import { isAutomationMode } from './mode.js';

/** @typedef {'agent' | 'action'} AutomationSubMode */

// ── Core Store ──

/** @type {import('svelte/store').Writable<AutomationSubMode>} */
export const automationSubMode = writable('agent');

// ── Derived Booleans ──

/** Active only when top-level is automation AND sub-mode is agent */
export const isAgentGraph = derived(
  [isAutomationMode, automationSubMode],
  ([$auto, $sub]) => $auto && $sub === 'agent'
);

/** Active only when top-level is automation AND sub-mode is action */
export const isActionGraph = derived(
  [isAutomationMode, automationSubMode],
  ([$auto, $sub]) => $auto && $sub === 'action'
);

// ── Sub-Mode Node Type Sets ──

/** Node types that appear in the Agent Graph palette */
export const AGENT_GRAPH_TYPES = new Set([
  'worker', 'orchestrator', 'oracle', 'input', 'output', 'process',
]);

/** Node types that appear in the Action Graph palette */
export const ACTION_GRAPH_TYPES = new Set([
  'bash', 'python', 'trigger', 'variable', 'artifact', 'approval',
  'input', 'output', 'process',  // shared types
]);

/** Check if a node type belongs to Agent Graph
 * @param {string} type
 * @returns {boolean}
 */
export function isAgentNodeType(type) {
  return AGENT_GRAPH_TYPES.has(type);
}

/** Check if a node type belongs to Action Graph
 * @param {string} type
 * @returns {boolean}
 */
export function isActionNodeType(type) {
  return ACTION_GRAPH_TYPES.has(type);
}
