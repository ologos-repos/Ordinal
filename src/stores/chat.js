import { writable, get } from 'svelte/store';

/**
 * Chat scope store
 * scope: { type: 'canvas' | 'machine' | 'factory' | 'network', id?: string }
 */
export const chatScope = writable(/** @type {{type: 'canvas'|'machine'|'factory'|'network', id?: string}} */({ type: 'canvas' }));

export const chatUI = writable(/** @type {{open: boolean}} */({ open: false }));

export const chatActions = {
  /** @param {{type: 'canvas'|'machine'|'factory'|'network', id?: string}} scope */
  setScope(scope) {
    chatScope.set(scope);
  },
  /** @param {string} id @param {'machine'|'factory'|'network'} type */
  setContainerScope(id, type) {
    chatScope.set({ type, id });
  },
  setCanvasScope() { chatScope.set({ type: 'canvas' }); },
  open() { chatUI.update(s => ({ ...s, open: true })); },
  close() { chatUI.update(s => ({ ...s, open: false })); },
  toggle() { chatUI.update(s => ({ ...s, open: !s.open })); },
};

/**
 * Proposed changeset from chat (when model outputs JSON)
 */
export const proposedChangeSet = writable(/** @type {any|null} */(null));

/**
 * Stable tool manifest for Chat. This is used to generate the model-visible manifest
 * and to validate/route tool calls. Names are stable and versioned as id@version.
 * This is metadata only; execution is handled in ChatSidebar.svelte.
 */
export const chatToolManifest = [
  {
    name: 'describe_canvas@1',
    description: 'Summarize the highest-level containers on the canvas for the user.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    returns: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary']
    }
  },
  {
    name: 'describe_scope@1',
    description: 'Summarize the currently selected container scope (network/factory/machine).',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    returns: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary']
    }
  },
  {
    name: 'propose_add_machine@1',
    description: 'Propose adding one machine to the current network/factory scope based on the instruction.',
    parameters: {
      type: 'object',
      properties: {
        instruction: { type: 'string' }
      },
      required: ['instruction'],
      additionalProperties: false
    },
    returns: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok']
    }
  },
  {
    name: 'propose_modify_scope@1',
    description: 'Propose a minimal modification to the current scope based on the instruction.',
    parameters: {
      type: 'object',
      properties: {
        instruction: { type: 'string' }
      },
      required: ['instruction'],
      additionalProperties: false
    },
    returns: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok']
    }
  },
  {
    name: 'generate_config@1',
    description: 'Generate a configuration YAML from the conversation for the specified scope.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['any','node','machine','factory','network'] }
      },
      required: ['scope'],
      additionalProperties: false
    },
    returns: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok']
    }
  },
  {
    name: 'apply_config@1',
    description: 'Apply the last generated YAML to the canvas. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    returns: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok']
    },
    requiresConsent: true
  }
];
