<script>
  // @ts-nocheck
  import { settings } from '../stores/settings.js';
  import { chatScope, chatActions, chatToolManifest } from '../stores/chat.js';
  import { workflowContainers } from '../stores/workflows.js';
  import { get } from 'svelte/store';
  import { pasteAndCreateConfigUniversal, copyText, generateConfig, mergeContainerYaml } from './clipboard.js';
  import { historyActions } from '../stores/canvasHistory.js';
  import { workflowActions } from '../stores/workflows.js';
  import { nodeActions, nodeDataStore, nodes as nodeListStore } from '../stores/nodes.js';
  import { onMount, afterUpdate } from 'svelte';
  import { aiComplete } from './rhodeApi.js';
  export let isOpen = false;

  // Propose adding a machine to the current scoped container (network/factory)
  async function proposeAddMachine(instruction, scope) {
    try {
      const containers = get(workflowContainers) || [];
      const target = scope.id ? containers.find(c => c.id === scope.id) : null;
      if (!target || !(target.isNetwork || target.isFactory)) {
        messages = [...messages, { role: 'assistant', content: 'I need the chat scope set to a specific network or factory. Right-click a container and choose "Chat about this Container".' }];
        return true;
      }

  

      // Generate current YAML for the target container
      const nodeMap = get(nodeDataStore);
      const nodeArr = get(nodeListStore);
      const entityType = target.isNetwork ? 'network' : 'factory';
      const gen = await generateConfig(target, entityType, null, nodeMap, nodeArr, null);
      if (!gen?.success || !gen?.config) {
        messages = [...messages, { role: 'assistant', content: 'I could not read the current container configuration to modify it.' }];
        return true;
      }

      const currentYaml = gen.config;
      const s = $settings;
      const mode = s.activeMode;
      const model = s.chat_model_id;
      const apiKey = (
        mode === 'openai' ? s.openai_api_key :
        mode === 'gemini' ? s.gemini_api_key :
        mode === 'openrouter' ? s.openrouter_api_key :
        ''
      );
      if (!model || !apiKey) {
        messages = [...messages, { role: 'assistant', content: 'A provider API key and chat model must be set in Settings to propose modifications.' }];
        return true;
      }

      const modifyPrompt = `You are the Ordinal assistant. Given the existing YAML for a ${entityType}, apply the following change request and output ONLY the full, corrected YAML (no fences).\n\nCHANGE REQUEST:\n${instruction}\n\nEXISTING YAML:\n${currentYaml}\n\nREWRITE RULES:\n- Preserve unrelated content and IDs.\n- Add exactly one new machine appropriate to the request with a minimal working node chain (2-3 nodes).\n- Keep IDs sequential if you must add new IDs.\n- Ensure coordinates are reasonable and align with existing spacing.\n- Ensure references (inputs/outputs) point to declared IDs.\n- Do not wrap under a different root; keep the same top-level (${entityType}:).\n- Output ONLY YAML for the ${entityType}.`;

      const provider = mapProviderMode(mode);
      const resp = await aiComplete(modifyPrompt, '', provider, model);
      let raw = resp?.text || '';
      // Extract fenced if present
      const fenced = raw.match(/```(yaml|yml)?\n([\s\S]+?)```/i);
      if (fenced) raw = fenced[2];
      let yamlText = sanitizeYaml((raw || '').trim());
      if (!yamlText) {
        messages = [...messages, { role: 'assistant', content: 'The model did not produce a YAML proposal.' }];
        return true;
      }

      // Merge model patch with the current container YAML; stage merged result
      try {
        const merged = mergeContainerYaml(currentYaml, yamlText);
        lastGeneratedYaml = merged;
      } catch (mergeErr) {
        console.warn('Merge failed, falling back to model YAML:', mergeErr);
        lastGeneratedYaml = yamlText;
      }
      showConfigActions = true;
      pendingReplaceTarget = { id: target.id, type: /** @type {'network'|'factory'|'machine'} */ (entityType) };
      messages = [...messages, { role: 'assistant', content: 'I prepared a merged proposal. Review it and click "Apply to Canvas" to update the current container.' }];
      return true;
    } catch (e) {
      const errMsg = e?.message || String(e);
      messages = [...messages, { role: 'assistant', content: `Failed to propose modification: ${errMsg}` }];
      return false;
    } finally {
      messages = [...messages];
    }
  }

  // Propose a modification to the currently scoped container (network/factory/machine)
  async function proposeModifyCurrentScope(instruction) {
    try {
      const scope = /** @type {{type:'canvas'|'machine'|'factory'|'network', id?:string}} */ ($chatScope || { type: 'canvas' });
      if (!scope.id || scope.type === 'canvas') {
        messages = [...messages, { role: 'assistant', content: 'Please select a specific container and use "Chat about this Container" before asking to modify it.' }];
        return true;
      }
      const containers = get(workflowContainers) || [];
      const target = containers.find(c => c.id === scope.id);
      if (!target) {
        messages = [...messages, { role: 'assistant', content: 'I could not find that container to modify.' }];
        return true;
      }
      const entityType = target.isNetwork ? 'network' : (target.isFactory ? 'factory' : 'machine');

      // Current YAML for the scoped container
      const nodeMap = get(nodeDataStore);
      const nodeArr = get(nodeListStore);
      const gen = await generateConfig(target, /** @type {any} */(entityType), null, /** @type {any} */(nodeMap), /** @type {any} */(nodeArr));
      if (!gen?.success || !gen?.config) {
        messages = [...messages, { role: 'assistant', content: 'I could not read the current container configuration to modify it.' }];
        return true;
      }
      const currentYaml = gen.config;

      // If the instruction is vague (e.g., "sounds good"), use the last assistant message as the change description
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant' && !m.typing)?.content || '';
      const changeRequest = /\b(sounds good|go ahead|apply it|make it|do it|proceed|yes|ok|okay)\b/i.test(instruction)
        ? (lastAssistantMsg ? `Based on the prior assistant suggestion:\n${lastAssistantMsg}` : instruction)
        : instruction;

      const s = $settings;
      const mode = s.activeMode;
      const model = s.chat_model_id;
      const apiKey = (
        mode === 'openai' ? s.openai_api_key :
        mode === 'gemini' ? s.gemini_api_key :
        mode === 'openrouter' ? s.openrouter_api_key :
        ''
      );
      if (!model || !apiKey) {
        messages = [...messages, { role: 'assistant', content: 'A provider API key and chat model must be set in Settings to propose modifications.' }];
        return true;
      }

      const modifyPrompt = `You are the Ordinal assistant. Given the existing YAML for a ${entityType}, apply the following change request and output ONLY the full, corrected YAML (no fences).\n\nCHANGE REQUEST:\n${changeRequest}\n\nEXISTING YAML:\n${currentYaml}\n\nREWRITE RULES:\n- Preserve unrelated content and IDs.\n- Make minimal changes needed to fulfill the request.\n- Keep IDs sequential if you must add new IDs.\n- Ensure coordinates remain reasonable relative to existing nodes.\n- Ensure references (inputs/outputs) point to declared IDs.\n- Do not wrap under a different root; keep the same top-level (${entityType}:).\n- Output ONLY YAML for the ${entityType}.`;

      const provider = mapProviderMode(mode);
      const resp = await aiComplete(modifyPrompt, '', provider, model);
      let raw = resp?.text || '';
      const fenced = raw.match(/```(yaml|yml)?\n([\s\S]+?)```/i);
      if (fenced) raw = fenced[2];
      let yamlText = sanitizeYaml((raw || '').trim());
      if (!yamlText) {
        messages = [...messages, { role: 'assistant', content: 'The model did not produce a YAML proposal.' }];
        return true;
      }

      // Merge the patch with current YAML and stage it
      try {
        lastGeneratedYaml = mergeContainerYaml(currentYaml, yamlText);
      } catch (mergeErr) {
        console.warn('Merge failed, falling back to model YAML:', mergeErr);
        lastGeneratedYaml = yamlText;
      }
      showConfigActions = true;
      pendingReplaceTarget = { id: target.id, type: /** @type {'network'|'factory'|'machine'} */ (entityType) };
      messages = [...messages, { role: 'assistant', content: 'I prepared a merged proposal. Review it and click "Apply to Canvas" to update the current container.' }];
      return true;
    } catch (e) {
      const errMsg = e?.message || String(e);
      messages = [...messages, { role: 'assistant', content: `Failed to propose modification: ${errMsg}` }];
      return false;
    } finally {
      messages = [...messages];
    }
  }

  // Build a concise summary of the current canvas at the highest level
  function buildCanvasSummary() {
    try {
      const containers = get(workflowContainers) || [];
      const nodeArr = get(nodeListStore) || [];
      if (!containers || containers.length === 0) {
        if (Array.isArray(nodeArr) && nodeArr.length > 0) {
          return `I see ${nodeArr.length} nodes on the canvas, but no grouped containers yet.`;
        }
        return 'I do not see any containers on the canvas yet.';
      }
      const networks = containers.filter(c => c.isNetwork);
      const factories = containers.filter(c => c.isFactory);
      const machines = containers.filter(c => !c.isFactory && !c.isNetwork);

      let out = 'Here is the current canvas summary:\n\n';
      if (networks.length > 0) {
        out += `Networks (${networks.length}):\n`;
        for (const net of networks) {
          const fc = (net.factories || []).length;
          const mc = (net.machines || []).length;
          const nc = (net.nodeIds || []).length;
          out += `- ${net.id} — factories: ${fc}, machines: ${mc}, nodes: ${nc}\n`;
        }
      } else if (factories.length > 0) {
        out += `Factories (${factories.length}):\n`;
        for (const fac of factories) {
          const mc = (fac.machines || []).length;
          const nc = (fac.nodeIds || []).length;
          out += `- ${fac.id} — machines: ${mc}, nodes: ${nc}\n`;
        }
      } else {
        out += `Machines (${machines.length}):\n`;
        for (const mach of machines) {
          const nc = (mach.nodes || []).length;
          out += `- ${mach.id} — nodes: ${nc}\n`;
        }
      }

      return out.trim();
    } catch (e) {
      return 'I encountered an issue summarizing the canvas.';
    }
  }

  // Build a summary for the currently scoped container (network/factory/machine)
  function buildScopedContainerSummary() {
    const scope = /** @type {{type:'canvas'|'machine'|'factory'|'network', id?:string}} */ ($chatScope || { type: 'canvas' });
    if (scope.type === 'canvas' || !scope.id) {
      return buildCanvasSummary();
    }
    const containers = get(workflowContainers) || [];
    const target = containers.find(c => c.id === scope.id);
    if (!target) {
      return 'I could not find that container on the canvas.';
    }
    if (target.isNetwork) {
      const fc = (target.factories || []).length;
      const mc = (target.machines || []).length;
      const nc = (target.nodeIds || []).length;
      let out = `Network ${target.id}:\n- Factories: ${fc}\n- Machines: ${mc}\n- Nodes: ${nc}`;
      if (fc > 0) {
        const ids = (target.factories || []).map(f => f.id).filter(Boolean);
        if (ids.length) out += `\n- Factory IDs: ${ids.join(', ')}`;
      }
      return out;
    }
    if (target.isFactory) {
      const mc = (target.machines || []).length;
      const nc = (target.nodeIds || []).length;
      let out = `Factory ${target.id}:\n- Machines: ${mc}\n- Nodes: ${nc}`;
      if (mc > 0) {
        const ids = (target.machines || []).map(m => m.id).filter(Boolean);
        if (ids.length) out += `\n- Machine IDs: ${ids.join(', ')}`;
      }
      return out;
    }
    // Machine
    const nc = (target.nodes || []).length;
    let out = `Machine ${target.id}:\n- Nodes: ${nc}`;
    if (nc > 0) {
      const ids = (target.nodes || []).map(n => n.id).filter(Boolean);
      if (ids.length) out += `\n- Node IDs: ${ids.join(', ')}`;
    }
    return out;
  }

  const fallbackGuide = `
# Ordinal AI Ontology & Large‑Scale Network Guide

## Core Ontology (Hierarchy)
- ` + "`network` -> `factories` (array) -> `factory` -> `machines` (array) -> `machine` -> `nodes` (array)" + `
- Node Types: ` + "`static`, `input`, `ai`" + `
- Each node has: ` + "`id`, `type`, `x`, `y`, `content`, `inputs` (optional), `outputs` (optional)" + `

## Legal ` + "`inputs`" + ` Targets
- Inside a machine: ` + "`inputs: [<node-id>]" + `
- Machine entry point: ` + "`inputs: [<machine-id>]`" + ` or ` + "`inputs: [<factory-id>]" + `
- Joins: ` + "`inputs: [machine-A, machine-B]" + `

## ID & Ordering
- Use sequential IDs: ` + "`machine-1`, `node-1`, etc." + `
- Referenced factories/machines should appear before consumers in their respective arrays.

## Coordinate Guidance
- Spacing: NodeX≈300, MachineX≥500, FactoryX≥1200.
- Use horizontal "bands" for factories and vertical "lanes" for machines to maintain readability.
- Example: Factory A (x: -4000 to -1500), Factory B (x: -800 to +3000).

## Output Format
- Produce a single YAML document. No extra commentary. No markdown fences.
`;
  let masterGuide = fallbackGuide;

  // Concise YAML recipe examples to guide the model's output format
  const yamlRecipeExamples = `
Example A (single factory, one machine, three nodes):
network:
  factories:
    - id: factory-1
      machines:
        - id: machine-1
          nodes:
            - id: node-1
              type: static
              content: "Seed text or context"
              x: -1200
              y: 300
              outputs:
                - node-2
            - id: node-2
              type: input
              content: Refine the seed into measurable sprint goals
              x: -800
              y: 300
              inputs:
                - node-1
              outputs:
                - node-3
            - id: node-3
              type: ai
              content: ""
              x: -400
              y: 300
              inputs:
                - node-2

Example B (cross-machine referencing):
network:
  factories:
    - id: factory-1
      machines:
        - id: machine-1
          nodes:
            - id: node-1
              type: input
              content: Summarize current backlog
              x: -1200
              y: 100
        - id: machine-2
          nodes:
            - id: node-2
              type: input
              content: Select sprint scope from backlog summary
              x: -800
              y: 100
              inputs:
                - machine-1
              outputs:
                - node-3
            - id: node-3
              type: ai
              content: ""
              x: -500
              y: 100
              inputs:
                - node-2

Example C (joins and multi-input nodes):
network:
  factories:
    - id: factory-1
      machines:
        - id: machine-1
          nodes:
            - id: node-1
              type: static
              content: "Seed: Objectives + constraints."
              x: -2000
              y: 300
              outputs:
                - node-2
            - id: node-2
              type: input
              content: Refine objectives into measurable sprint goals
              x: -1700
              y: 300
              inputs:
                - node-1
              outputs:
                - node-3
            - id: node-3
              type: ai
              content: ""
              x: -1400
              y: 300
              inputs:
                - node-2
        - id: machine-2
          nodes:
            - id: node-4
              type: input
              content: Identify risks from goals
              x: -1200
              y: 100
              inputs:
                - machine-1
              outputs:
                - node-5
            - id: node-5
              type: ai
              content: ""
              x: -900
              y: 100
              inputs:
                - node-4
        - id: machine-3
          nodes:
            - id: node-6
              type: input
              content: Draft budget from goals
              x: -1200
              y: 500
              inputs:
                - machine-1
              outputs:
                - node-7
            - id: node-7
              type: ai
              content: ""
              x: -900
              y: 500
              inputs:
                - node-6
        - id: machine-4
          nodes:
            - id: node-8
              type: input
              content: Synthesize risks and budget into decision brief
              x: -600
              y: 300
              inputs:
                - machine-2
                - machine-3
              outputs:
                - node-9
            - id: node-9
              type: ai
              content: ""
              x: -300
              y: 300
              inputs:
                - node-8

Example D (tracker/metrics + multiple specialized branches):
network:
  factories:
    - id: factory-1
      machines:
        - id: machine-ants-foraging
          nodes:
            - id: node-f1
              type: input
              content: Define foraging ant behaviors and parameters
              x: -2000
              y: -200
              outputs:
                - node-f2
            - id: node-f2
              type: ai
              content: ""
              x: -1700
              y: -200
              inputs:
                - node-f1
        - id: machine-ants-scouts
          nodes:
            - id: node-s1
              type: input
              content: Define scout ant behaviors (exploration bias, pheromone seeding)
              x: -2000
              y: 300
              outputs:
                - node-s2
            - id: node-s2
              type: ai
              content: ""
              x: -1700
              y: 300
              inputs:
                - node-s1
        - id: machine-ants-soldiers
          nodes:
            - id: node-sec1
              type: input
              content: Define soldier ant behaviors (trail defense, congestion management)
              x: -2000
              y: 800
              outputs:
                - node-sec2
            - id: node-sec2
              type: ai
              content: ""
              x: -1700
              y: 800
              inputs:
                - node-sec1
        - id: machine-evaporation
          nodes:
            - id: node-e1
              type: input
              content: Pheromone evaporation update (apply decay rate to all grids)
              x: -1300
              y: 100
              inputs:
                - machine-ants-foraging
              outputs:
                - node-e2
            - id: node-e2
              type: ai
              content: ""
              x: -1000
              y: 100
              inputs:
                - node-e1
        - id: machine-synthesis
          nodes:
            - id: node-syn1
              type: input
              content: Combine updates from foraging, scout, soldier, and evaporation into next world state
              x: -600
              y: 100
              inputs:
                - machine-ants-foraging
                - machine-ants-scouts
                - machine-ants-soldiers
                - machine-evaporation
              outputs:
                - node-syn2
            - id: node-syn2
              type: ai
              content: ""
              x: -300
              y: 100
              inputs:
                - node-syn1
        - id: machine-tracker
          nodes:
            - id: node-t1
              type: input
              content: Track metrics (food delivered per tick, average path length, congestion hotspots)
              x: -600
              y: 500
              inputs:
                - machine-ants-foraging
                - machine-ants-scouts
                - machine-ants-soldiers
                - machine-synthesis
              outputs:
                - node-t2
            - id: node-t2
              type: ai
              content: ""
              x: -300
              y: 500
              inputs:
                - node-t1
`;
    
    // Scope-specific minimal examples to anchor correct root and structure
    const scopeRecipeExamples = {
      node: `node:
  id: node-1
  type: input
  content: Example node content
  x: -300
  y: 100
  outputs:
    - node-2`,
      machine: `machine:
  id: machine-1
  nodes:
    - id: node-1
      type: input
      content: Step input
      x: -800
      y: 100
      outputs:
        - node-2
    - id: node-2
      type: ai
      content: ""
      x: -500
      y: 100
      inputs:
        - node-1`,
      factory: `factory:
  id: factory-1
  machines:
    - id: machine-1
      nodes:
        - id: node-1
          type: input
          content: Seed input
          x: -800
          y: 100
          outputs:
            - node-2
        - id: node-2
          type: ai
          content: ""
          x: -500
          y: 100
          inputs:
            - node-1`,
      network: `network:
  factories:
    - id: factory-1
      machines:
        - id: machine-1
          nodes:
            - id: node-1
              type: input
              content: Step 1 input
              x: -800
              y: 100
              outputs:
                - node-2
            - id: node-2
              type: ai
              content: ""
              x: -500
              y: 100
              inputs:
                - node-1
      nodes:
        - id: node-f1
          type: ai
          content: "Factory-level processing of machine output"
          x: -200
          y: 120
          inputs:
            - machine-1
  machines:
    - id: machine-2
      nodes:
        - id: node-3
          type: input
          content: Network-level step that consumes a factory output
          x: -200
          y: 300
          inputs:
            - factory-1
          outputs:
            - node-4
        - id: node-4
          type: ai
          content: ""
          x: 100
          y: 300
          inputs:
            - node-3`
    };

  let messages = [];
  let input = '';
  let isSending = false;
  let isCreating = false;
  let chatBodyElement;
  let hasFirstAssistantReply = false; // Enable Generate Config only after first relay
  let isScopePickerOpen = false; // Show picker for generation scope
  let configScope = ''; // 'node' | 'machine' | 'factory' | 'network'
  let lastGeneratedYaml = '';
  let showConfigActions = false;
  /** @type {{id:string,type:'network'|'factory'|'machine'}|null} */
  let pendingReplaceTarget = null;

  function close() { isOpen = false; chatActions.close(); }
  function describeScopeNow() {
    try {
      const scope = /** @type {{type:'canvas'|'machine'|'factory'|'network', id?:string}} */ (get(chatScope) || { type: 'canvas' });
      const summary = scope.type === 'canvas' || !scope.id ? buildCanvasSummary() : buildScopedContainerSummary();
      messages = [...messages, { role: 'assistant', content: summary }];
    } catch (e) {
      messages = [...messages, { role: 'assistant', content: 'I could not summarize the current scope.' }];
    }
  }

  function buildScopeLine() {
    const scope = /** @type {{type:'canvas'|'machine'|'factory'|'network', id?:string}} */ (get(chatScope) || { type: 'canvas' });
    const containers = get(workflowContainers) || [];
    if (scope.type === 'canvas') {
      const nNetworks = containers.filter(c => c.isNetwork).length;
      const nFactories = containers.filter(c => c.isFactory).length;
      const nMachines = containers.filter(c => c.isWorkflow && c.isMachine).length;
      return `Scope: Canvas (networks: ${nNetworks}, factories: ${nFactories}, machines: ${nMachines})`;
    }
    const target = scope.id ? containers.find(c => c.id === scope.id) : null;
    if (!target) return `Scope: ${scope.type} ${scope.id || ''}`.trim();
    if (target.isNetwork) {
      const nf = (target.factories || []).length;
      const nm = (target.machines || []).length;
      return `Scope: network ${target.id} (factories: ${nf}, machines: ${nm})`;
    }
    if (target.isFactory) {
      const nm = (target.machines || []).length;
      return `Scope: factory ${target.id} (machines: ${nm})`;
    }
    if (target.isWorkflow) {
      const nn = (target.nodes || []).length;
      return `Scope: machine ${target.id} (nodes: ${nn})`;
    }
    return `Scope: ${scope.type} ${scope.id || ''}`.trim();
  }

  function buildGreeting() {
    const scopeLine = buildScopeLine();
    return (
`Hello! I can describe your current canvas, help you modify existing containers, or generate a brand-new config.

${scopeLine}

• Use 'Chat about this Container' to set or change scope.
• Ask 'Are you aware of the canvas?' and I'll summarize it or the current scope.
• Say things like 'Add a machine to this ${get(chatScope).type === 'canvas' ? 'network' : get(chatScope).type} that does X' — I'll propose a change you can 'Apply to Canvas'.
• Use 'Generate Config' for brand-new configurations (separate from chat modifications).
• Tip: If the chat ever seems out of scope, re-run 'Chat about this Container' to reset context.`
    );
  }

  function newChat() {
    // Reset chat session to initial system + greeting
    input = '';
    isSending = false;
    isCreating = false;
    hasFirstAssistantReply = false;
    lastGeneratedYaml = '';
    showConfigActions = false;
    // Clear chat scope back to canvas on new chat
    try { chatActions.setCanvasScope(); } catch {}
    messages = [
      { role: 'system', content: `You are a helpful assistant for the Ordinal app. Your goal is to understand the user's desired workflow and help them design it. You must understand the Ordinal ontology to have a productive conversation.\n\nTOOLS & FLOW:\n- Use the context menu action \"Chat about this Container\" to set scope (canvas/machine/factory/network).\n- Do not output YAML in chat.\n- If asked to describe the canvas, summarize the highest-level containers present and their purposes.\n- For brand-new configs, guide the user to click \"Generate Config\".\n- For modifications (e.g., add a machine), propose a YAML change and the user will click \"Apply to Canvas\" to commit it.\n\nONTOLOGY SUMMARY:\n${masterGuide}` },
      { role: 'assistant', content: buildGreeting() }
    ];
  }

  // Coerce incorrect roots like 'canvas:' or 'networks:' into a valid
  // network root with factories: array.
  function coerceCanvasOrNetworksToNetwork(yaml) {
    const lines = yaml.split(/\r?\n/);
    // Find first meaningful content line (skip comments and YAML doc markers)
    const first = (lines.find(l => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith('#')) return false;
      if (t === '---' || t === '...') return false;
      return true;
    }) || '').trim().toLowerCase();
    const indent = (s) => (s.match(/^\s*/)?.[0] || '');

    // Helper to indent a block under factories
    const wrapAsNetworkFactories = (block) => {
      const blines = block.split(/\r?\n/);
      const out = blines.map(l => l ? '  ' + l : l).join('\n');
      return `network:\n  factories:\n${out}`.trim();
    };

    if (first.startsWith('networks:')) {
      const m = yaml.match(/^[^\S\n]*networks:\s*\n([\s\S]*)$/m);
      if (m && m[1] !== undefined) {
        return wrapAsNetworkFactories(m[1]);
      }
    }
    if (first.startsWith('canvas:')) {
      // Find the networks: block within canvas
      const m = yaml.match(/^[^\S\n]*canvas:[\s\S]*?\n([^\S\n]*)networks:\s*\n([\s\S]*)$/m);
      if (m && m[2] !== undefined) {
        return wrapAsNetworkFactories(m[2]);
      }
    }
    return yaml;
  }

  // Normalize machine references in inputs to the nearest declared machine id
  // by numeric distance. If none found, fall back to first declared.
  function normalizeMachineRefs(yaml) {
    const declared = [];
    const declaredSet = new Set();
    const idRegex = /-\s+id:\s+(machine-(\d+))/g;
    let m;
    while ((m = idRegex.exec(yaml)) !== null) {
      const full = m[1];
      const num = parseInt(m[2], 10);
      if (!declaredSet.has(full)) {
        declaredSet.add(full);
        declared.push({ full, num });
      }
    }
    if (declared.length === 0) return yaml;

    const lines = yaml.split(/\r?\n/);
    const refRegex = /^(\s*-\s+)machine-(\d+)\s*$/;
    const fixed = lines.map(line => {
      const mm = line.match(refRegex);
      if (!mm) return line;
      const prefix = mm[1];
      const refNum = parseInt(mm[2], 10);
      const refFull = `machine-${refNum}`;
      if (declaredSet.has(refFull)) return line;
      // Pick nearest declared by numeric distance
      let best = declared[0];
      let bestDist = Math.abs(refNum - best.num);
      for (const d of declared) {
        const dist = Math.abs(refNum - d.num);
        if (dist < bestDist) { best = d; bestDist = dist; }
      }
      return `${prefix}${best.full}`;
    });
    return fixed.join('\n');
  }

  // Repair missing machine references in node inputs by replacing unknown
  // machine IDs with the first declared machine ID as a safe fallback.
  function repairMissingMachineRefs(yaml) {
    const ids = new Set();
    const idMatches = yaml.match(/-\s+id:\s+(machine-[A-Za-z0-9_-]+)/g) || [];
    for (const m of idMatches) {
      const mm = m.match(/id:\s+(machine-[A-Za-z0-9_-]+)/);
      if (mm && mm[1]) ids.add(mm[1]);
    }
    const first = Array.from(ids)[0];
    if (!first) return yaml;
    const lines = yaml.split(/\r?\n/);
    const re = /^(\s*-\s+)(machine-[A-Za-z0-9_-]+)\s*$/;
    const fixed = lines.map(line => {
      const m = line.match(re);
      if (!m) return line;
      const ref = m[2];
      if (ids.has(ref)) return line;
      return `${m[1]}${first}`;
    });
    return fixed.join('\n');
  }

  function openGenerate() {
    if (isSending || isCreating || !hasFirstAssistantReply) return;
    isScopePickerOpen = true;
  }

  function chooseScope(scope) {
    configScope = scope; // expect one of 'node','machine','factory','network'
    isScopePickerOpen = false;
    // Kick off generation now that scope is selected
    createConfigFromChat();
  }

  // Map provider mode to Rhode API provider names
  function mapProviderMode(mode) {
    // Mode can be: 'openrouter', 'anthropic', 'gemini', 'ollama', etc.
    // Rhode API expects: 'anthropic', 'gemini', 'ollama'
    // OpenRouter is not directly supported by Rhode, map to gemini as fallback
    if (mode === 'openrouter') return 'gemini';
    return mode || 'gemini';
  }

  // Build a compact manifest section for the model and specify the exact output format
  function buildToolManifestBlock() {
    try {
      const items = (chatToolManifest || []).map(t => {
        const params = JSON.stringify(t.parameters || { type: 'object' });
        return `- name: ${t.name}\n  description: ${t.description}\n  parameters: ${params}`;
      }).join('\n');
      const callFormat = [
        'When you decide a tool is appropriate, reply ONLY with a fenced JSON block in this exact shape:',
        '```json',
        '{"tool_call": {"name": "<tool-name>", "arguments": { /* args per parameters schema */ }}}',
        '```',
        'Return at most one tool_call per turn. If no tool is needed, reply normally (no JSON).'
      ].join('\n');
      return `\n\nTOOLS AVAILABLE (id@version):\n${items}\n\n${callFormat}`;
    } catch (e) {
      return '';
    }
  }

  // Parse a tool_call JSON from the model content (expects a fenced JSON block or raw JSON)
  function parseToolCallFromText(content) {
    if (!content) return null;
    let jsonText = '';
    // Prefer fenced JSON
    const fenced = content.match(/```json\n([\s\S]+?)```/i);
    if (fenced) {
      jsonText = fenced[1];
    } else {
      const trimmed = content.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        jsonText = trimmed;
      } else {
        return null;
      }
    }
    try {
      const obj = JSON.parse(jsonText);
      if (obj && obj.tool_call && typeof obj.tool_call.name === 'string') {
        return { name: obj.tool_call.name, arguments: obj.tool_call.arguments || {} };
      }
    } catch {}
    return null;
  }

  // Auto-scroll only if near bottom to avoid disrupting user while reading
  afterUpdate(() => {
    if (!chatBodyElement) return;
    const threshold = 60; // px from bottom considered "near"
    const { scrollTop, scrollHeight, clientHeight } = chatBodyElement;
    const atOrNearBottom = (scrollTop + clientHeight) >= (scrollHeight - threshold);
    if (atOrNearBottom) {
      chatBodyElement.scrollTop = scrollHeight;
    }
  });

  async function send() {
    if (!input.trim() || isSending) return;
    const userMsg = { role: 'user', content: input.trim() };
    messages = [...messages, userMsg];
    input = '';

    try {
      isSending = true;
      // Intercept canvas awareness queries and answer from local state
      const q = (userMsg.content || '').trim().toLowerCase();
      if (/(^are you aware of|^can you see|^describe|what( is|'s|’s)? on|what do you see on)\s+(the\s+)?canvas\??/.test(q)) {
        const summary = buildCanvasSummary();
        messages = [...messages, { role: 'assistant', content: summary }];
        hasFirstAssistantReply = true;
        return;
      }

      // Intercept container-scoped summary queries (e.g., "Tell me about this/the network")
      if (/^(tell me about|describe|summari[sz]e|what( is|'s|’s) (in|inside|about))\s+(this|our|the)\s+(network|factory|machine)\b/.test(q)) {
        const scoped = buildScopedContainerSummary();
        messages = [...messages, { role: 'assistant', content: scoped }];
        hasFirstAssistantReply = true;
        return;
      }

      // Simple modify-in-chat detection: "add machine" requests within factory/network scope
      const scope = /** @type {{type:'canvas'|'machine'|'factory'|'network', id?:string}} */ ($chatScope || { type: 'canvas' });
      if ((/\badd\s+(a\s+)?machine\b/i.test(userMsg.content)) && (scope.type === 'network' || scope.type === 'factory')) {
        const ok = await proposeAddMachine(userMsg.content, scope);
        if (ok) { hasFirstAssistantReply = true; return; }
        // If proposal failed, fall through to normal chat
      }

      // Generic modify-in-chat for current scoped container (e.g., "improve", "add step", or confirmation like "sounds good")
      if (scope.type !== 'canvas') {
        const intent = /\b(improve|add\s+(a\s+)?step|add\s+(an\s+)?ai|insert|modify|change)\b/i.test(userMsg.content)
          || /\b(sounds good|go ahead|apply it|make it|do it|proceed|yes|ok|okay)\b/i.test(userMsg.content);
        if (intent) {
          const ok2 = await proposeModifyCurrentScope(userMsg.content);
          if (ok2) { hasFirstAssistantReply = true; return; }
        }
      }

      messages = [...messages, { role: 'assistant', content: '', typing: true }];

      const s = $settings;
      const mode = s.activeMode;
      // Use the provider's Chat model for conversational chat
      const model = s.chat_model_id;
      const apiKey = (
        mode === 'openai' ? s.openai_api_key :
        mode === 'gemini' ? s.gemini_api_key :
        mode === 'openrouter' ? s.openrouter_api_key :
        ''
      );

      if (!apiKey && (mode === 'openai' || mode === 'gemini' || mode === 'openrouter')) {
          throw new Error(`API key for ${mode} is not set in Settings.`);
      }
      if (!model) {
          throw new Error('Chat model is not selected in Settings.');
      }

      const prompt = await buildChatPrompt(messages.slice(0, -1)); // Don't include the "typing" bubble
      const provider = mapProviderMode(mode);
      const resp = await aiComplete(prompt, '', provider, model);

      const content = resp?.text || '(No response)';

      // Try tool-call path first
      const toolCall = parseToolCallFromText(content);
      if (toolCall && typeof toolCall.name === 'string') {
        const name = String(toolCall.name);
        const args = toolCall.arguments || {};
        // Describe tools replace the typing bubble with the summary
        if (name === 'describe_canvas@1') {
          const summary = buildCanvasSummary();
          messages[messages.length - 1] = { role: 'assistant', content: summary };
          hasFirstAssistantReply = true;
          return;
        }
        if (name === 'describe_scope@1') {
          const summary = buildScopedContainerSummary();
          messages[messages.length - 1] = { role: 'assistant', content: summary };
          hasFirstAssistantReply = true;
          return;
        }
        // For stateful tools, remove the typing bubble and delegate to existing flows
        if (name === 'propose_add_machine@1') {
          if (!args || typeof args.instruction !== 'string') {
            messages[messages.length - 1] = { role: 'assistant', content: 'Invalid arguments for propose_add_machine@1.' };
            hasFirstAssistantReply = true;
            return;
          }
          if (messages[messages.length - 1]?.typing) messages.pop();
          const scope = /** @type {{type:'canvas'|'machine'|'factory'|'network', id?:string}} */ ($chatScope || { type: 'canvas' });
          await proposeAddMachine(args.instruction, scope);
          hasFirstAssistantReply = true;
          return;
        }
        if (name === 'propose_modify_scope@1') {
          if (!args || typeof args.instruction !== 'string') {
            messages[messages.length - 1] = { role: 'assistant', content: 'Invalid arguments for propose_modify_scope@1.' };
            hasFirstAssistantReply = true;
            return;
          }
          if (messages[messages.length - 1]?.typing) messages.pop();
          await proposeModifyCurrentScope(args.instruction);
          hasFirstAssistantReply = true;
          return;
        }
        if (name === 'generate_config@1') {
          if (!args || typeof args.scope !== 'string') {
            messages[messages.length - 1] = { role: 'assistant', content: 'Invalid arguments for generate_config@1.' };
            hasFirstAssistantReply = true;
            return;
          }
          if (messages[messages.length - 1]?.typing) messages.pop();
          configScope = /** @type {'any'|'node'|'machine'|'factory'|'network'} */ (args.scope);
          await createConfigFromChat();
          return;
        }
        if (name === 'apply_config@1') {
          if (messages[messages.length - 1]?.typing) messages.pop();
          await applyGeneratedToCanvas();
          return;
        }
        // Unknown tool
        messages[messages.length - 1] = { role: 'assistant', content: 'I proposed a tool call, but this tool is not available.' };
        hasFirstAssistantReply = true;
        return;
      }

      // No tool call detected: treat as normal assistant text
      messages[messages.length - 1] = { role: 'assistant', content };
      hasFirstAssistantReply = true;
    } catch (e) {
      const errMsg = e?.message || e?.Error || String(e);
      messages[messages.length - 1] = { role: 'assistant', content: `Error: ${errMsg}` };
    } finally {
      isSending = false;
      messages = [...messages]; // Trigger reactivity
    }
  }

  // Build YAML context from current scope (container or full canvas)
  async function buildScopeYamlContext() {
    try {
      const scope = /** @type {{type:'canvas'|'machine'|'factory'|'network', id?:string}} */ ($chatScope || { type: 'canvas' });
      const containers = get(workflowContainers) || [];
      const nodeMap = get(nodeDataStore);
      const nodeArr = get(nodeListStore) || [];
      const chunks = [];

      if (scope.type !== 'canvas' && scope.id) {
        const target = containers.find(c => c.id === scope.id);
        if (!target) return { yaml: '', label: '' };
        const type = target.isNetwork ? 'network' : (target.isFactory ? 'factory' : 'machine');
        const g = await generateConfig(target, /** @type {any} */(type), null, /** @type {any} */(nodeMap), /** @type {any} */(nodeArr));
        if (g?.success && g.config) {
          return { yaml: g.config, label: `${type} ${target.id}` };
        }
        return { yaml: '', label: '' };
      }

      // Canvas scope: include all top-level containers (networks, then factories, then machines)
      const nets = containers.filter(c => c.isNetwork);
      const facs = containers.filter(c => c.isFactory && !containers.some(n => n.isNetwork && (n.factories||[]).some(f => f.id === c.id)));
      const macs = containers.filter(c => !c.isFactory && !c.isNetwork);
      for (const n of nets) {
        const g = await generateConfig(n, 'network', null, /** @type {any} */(nodeMap), /** @type {any} */(nodeArr));
        if (g?.success && g.config) chunks.push(`# network ${n.id}\n${g.config}`);
      }
      for (const f of facs) {
        const g = await generateConfig(f, 'factory', null, /** @type {any} */(nodeMap), /** @type {any} */(nodeArr));
        if (g?.success && g.config) chunks.push(`# factory ${f.id}\n${g.config}`);
      }
      for (const m of macs) {
        const g = await generateConfig(m, 'machine', null, /** @type {any} */(nodeMap), /** @type {any} */(nodeArr));
        if (g?.success && g.config) chunks.push(`# machine ${m.id}\n${g.config}`);
      }
      const yaml = chunks.join('\n\n---\n\n');
      return { yaml, label: yaml ? 'entire canvas' : '' };
    } catch (e) {
      console.warn('Could not build scope YAML context:', e);
      return { yaml: '', label: '' };
    }
  }

  async function buildChatPrompt(msgs) {
    // Flatten history into a single string for the Go backend.
    // The system prompt provides context on how to act conversationally.
    // Exclude large system messages (ontology) to avoid token bloat.
    const nonSystem = msgs.filter(m => m.role !== 'system');
    // Limit to the last N turns to further reduce context size.
    const MAX_MESSAGES = 12; // ~6 exchanges
    const recent = nonSystem.slice(Math.max(0, nonSystem.length - MAX_MESSAGES));
    const transcript = recent
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
    // Small guardrail to keep chat responses conversational and avoid config dumps/JSON
    const systemCue = [
      'SYSTEM: You are the Ordinal assistant. Be concise and helpful.',
      'Never output YAML in chat.',
      'Only output JSON when invoking a tool, and then ONLY as a single fenced JSON block with a top-level object {"tool_call": {...}}. Otherwise, reply normally (no JSON).',
      'When the user wants to create or modify the workflow: (1) ask for any missing details, (2) instruct them to choose a scope via "Chat about this Container" if not already set, (3) tell them to click "Generate Config" for brand-new configs or that you will propose a change for existing configs, (4) after proposing, they must click "Apply to Canvas" to commit changes.',
      'If the user asks about the current canvas, summarize the highest-level containers (networks/factories/machines) and their purposes. Do not invent details.'
    ].join(' ');

    // Append scoped/canvas YAML to provide grounding context (not to be echoed)
    const scopeCtx = await buildScopeYamlContext();
    const labelText = scopeCtx.label || 'current scope';
    let contextBlock = '';
    if (scopeCtx.yaml) {
      contextBlock = '\n\nCONTEXT: YAML of ' + labelText + ' (do not echo; use only for reference)\n' +
        '=== YAML CONTEXT START ===\n' + scopeCtx.yaml + '\n=== YAML CONTEXT END ===\n';
    }
    const manifestBlock = buildToolManifestBlock();
    // Explicitly cue the model to respond as the assistant to reduce cut-offs
    return `${systemCue}${manifestBlock}${contextBlock}\n\n${transcript}\n\nASSISTANT:`;
  }

  async function createConfigFromChat() {
    if (isCreating) return;
    try {
      isCreating = true;
      messages = [...messages, { role: 'assistant', content: 'Generating configuration...', typing: true }];
      
      const s = $settings;
      const mode = s.activeMode;
      // Use the provider's Chat model to generate config from the conversation
      const model = s.chat_model_id;
      const apiKey = (
        mode === 'openai' ? s.openai_api_key :
        mode === 'gemini' ? s.gemini_api_key :
        mode === 'openrouter' ? s.openrouter_api_key :
        ''
      );

      if (!apiKey && (mode === 'openai' || mode === 'gemini' || mode === 'openrouter')) {
          throw new Error(`API key for ${mode} is not set in Settings.`);
      }
      if (!model) {
          throw new Error('Chat model is not selected in Settings.');
      }
      if (!configScope) {
          throw new Error('Select a scope (node/machine/factory/network) before generating.');
      }

      const convoMsgs = messages.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.typing));
      const MAX_HISTORY = 24; // keep recent context to reduce token use
      const trimmed = convoMsgs.slice(Math.max(0, convoMsgs.length - MAX_HISTORY));
      const userIntent = trimmed.map(m => `${m.role}: ${m.content}`).join('\n\n');

      let scopeInstructions = '';
      if (configScope === 'any') {
        scopeInstructions = '0. Scope: Choose the most suitable root (network:, factory:, machine:, or node:) based on the user intent.';
      } else if (configScope === 'network') {
        scopeInstructions = [
          "0. Scope: First line must be exactly 'network:'.",
          "   Immediately include a 'factories:' array at the next level.",
          "   Do NOT use 'factory:' as the root.",
        ].join('\n');
      } else if (configScope === 'factory') {
        scopeInstructions = "0. Scope: First line must be exactly 'factory:'. Do NOT use 'network:' as the root.";
      } else if (configScope === 'machine') {
        scopeInstructions = "0. Scope: First line must be exactly 'machine:'. Do NOT use 'network:' or 'factory:' as the root.";
      } else if (configScope === 'node') {
        scopeInstructions = "0. Scope: First line must be exactly 'node:'. Do NOT use 'network:' or 'factory:' as the root.";
      } else {
        scopeInstructions = `0. Scope: Start with \`${configScope}:\` (do not use any other root).`;
      }

      const anyRootRule = '2. Start with one of: `network:`, `factory:`, or `machine:`. Never use `canvas:` or `networks:` as the root.';
      const networkRule = [
        '3. If scope is `network:`, the top-level must be `network:` and include a `factories:` array.',
        '   A network may also include network-level `machines:` (outside any factory).',
        '   To connect a network-level machine to a factory, put the factory ID in the machine input node: e.g., `inputs: [factory-1]`.',
        '   Ensure all `inputs: [machine-X]` reference declared machines in the same container (factory or network level).',
        '   Prefer at least 2 factories unless the user explicitly asks for a single-factory network.'
      ].join('\n');
      const rootRule = (configScope === 'any') ? anyRootRule : '';
      const scopeExampleBlock = (configScope && configScope !== 'any' && scopeRecipeExamples[configScope])
        ? `\nSCOPE-SPECIFIC EXAMPLE (${configScope.toUpperCase()}):\n${scopeRecipeExamples[configScope]}\n`
        : '';

      const finalPrompt = `You are an expert Ordinal system architect. Generate a valid Ordinal YAML configuration from the conversation.

Follow these rules STRICTLY:
${scopeInstructions}
1. Output ONLY YAML. No explanations and no markdown fences.
${rootRule}
${configScope === 'network' ? networkRule : ''}
3. Use sequential IDs like \`factory-1\`, \`machine-1\`, \`node-1\`. IDs must be referenced exactly in \`inputs\` and \`outputs\`.
4. Each node includes: \`id\`, \`type\` (one of static|input|ai), \`content\`, \`x\`, \`y\`, and optional \`inputs\`/\`outputs\` arrays.
5. For cross-machine flow, use \`inputs: [machine-N]\` to feed an input node from an earlier machine.
6. Keep coordinates reasonable (node X spacing ~300px horizontally) and preserve left-to-right flow.
7. Apply second-layer design: add helpful scaffolding by default (e.g., validation, risk analysis, synthesis/decision, executive summary). Prefer joins that combine parallel branches where logical.
8. For non-trivial requests, prefer at least 2–4 machines with 2–3 nodes each, including at least one multi-input join similar to Example C when appropriate.
9. Ensure an acyclic graph and that all references in \`inputs\`/\`outputs\` point to declared IDs.
10. Quote all \`content\` strings that contain punctuation (e.g., colons) or use block scalars (|) for multi-paragraph content to ensure valid YAML.
11. Err on the side of overcomplicated: prefer 5–8 machines with multiple parallel branches and at least one tracker/metrics machine that ingests from other machines.
12. When modeling agents, include specialized branches (e.g., scouts/foragers/soldiers) and a synthesis machine that fans-in their outputs.
13. Include a tracker machine producing a metrics summary node; wire it from multiple upstream machines as in Example D.
14. If scope is 'network', prefer at least 2 factories (
    
    factories:
      - id: factory-1
      - id: factory-2
    
   ) unless the user explicitly asks for a single-factory network.

${scopeExampleBlock}
YAML RECIPE EXAMPLES (follow structure and keys exactly):
${yamlRecipeExamples}

CONVERSATION HISTORY (basis for the configuration):
${userIntent}

Now produce the YAML configuration only.`;

      const provider = mapProviderMode(mode);
      const resp = await aiComplete(finalPrompt, '', provider, model);
      let raw = resp?.text || '';
      if (!raw.trim()) throw new Error('Model returned an empty configuration.');

      // Extract fenced blocks for yaml/yml only
      let fenced = raw.match(/```(yaml|yml)?\n([\s\S]+?)```/i);
      if (fenced) {
        raw = fenced[2];
      }

      let yamlText = raw.trim();
      yamlText = sanitizeYaml(yamlText);
      yamlText = coerceCanvasOrNetworksToNetwork(yamlText);

      // Fallback repair: if user explicitly selected a scope and the YAML doesn't start with it, fix or ask model to rewrite
      if (configScope && configScope !== 'any') {
        const firstContentLine = (yamlText.split(/\r?\n/).find(l => {
          const t = l.trim();
          if (!t) return false;
          if (t.startsWith('#')) return false;
          if (t === '---' || t === '...') return false;
          return true;
        }) || '').trim();
        if (!firstContentLine.startsWith(configScope + ':')) {
          // Deterministic transform for common case: factory: -> network:
          const lcFirst = firstContentLine.toLowerCase();
          if (configScope === 'network' && lcFirst.startsWith('factory:')) {
            const allLines = yamlText.split(/\r?\n/);
            // Find index of the first meaningful line (which we know is 'factory:')
            let startIdx = allLines.findIndex(l => {
              const t = l.trim();
              if (!t) return false;
              if (t.startsWith('#')) return false;
              if (t === '---' || t === '...') return false;
              return true;
            });
            if (startIdx < 0) startIdx = 0;
            const lines = allLines.slice(startIdx + 1); // drop the actual 'factory:' line
            // Deindent by minimum leading spaces among non-empty lines
            const indents = lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length);
            const minIndent = indents.length ? Math.min(...indents) : 0;
            const deindented = lines.map(l => l.slice(Math.min(minIndent, l.match(/^\s*/)[0].length)));
            // Find first content line and prefix '- '
            let firstIdx = deindented.findIndex(l => l.trim());
            if (firstIdx === -1) firstIdx = 0;
            if (!deindented[firstIdx].trim().startsWith('- ')) {
              deindented[firstIdx] = '- ' + deindented[firstIdx].trim();
            }
            // Indent all subsequent lines by 2 spaces to align under list item
            for (let i = firstIdx + 1; i < deindented.length; i++) {
              if (deindented[i].trim()) deindented[i] = '  ' + deindented[i];
            }
            // Indent whole block under factories:
            const underFactories = deindented.map(l => l ? '  ' + l : l).join('\n');
            yamlText = `network:\n  factories:\n${underFactories}`.trim();
          } else if (configScope === 'network' && lcFirst.startsWith('machine:')) {
            // Wrap a machine root into a default factory under a network
            const allLines = yamlText.split(/\r?\n/);
            let startIdx = allLines.findIndex(l => {
              const t = l.trim();
              if (!t) return false;
              if (t.startsWith('#')) return false;
              if (t === '---' || t === '...') return false;
              return true;
            });
            if (startIdx < 0) startIdx = 0;
            const lines = allLines.slice(startIdx + 1); // drop the actual 'machine:' line
            const indents = lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length);
            const minIndent = indents.length ? Math.min(...indents) : 0;
            const deindented = lines.map(l => l.slice(Math.min(minIndent, l.match(/^\s*/)[0].length)));
            let firstIdx = deindented.findIndex(l => l.trim());
            if (firstIdx === -1) firstIdx = 0;
            if (!deindented[firstIdx].trim().startsWith('- ')) {
              deindented[firstIdx] = '- ' + deindented[firstIdx].trim();
            }
            for (let i = firstIdx + 1; i < deindented.length; i++) {
              if (deindented[i].trim()) deindented[i] = '  ' + deindented[i];
            }
            const underMachines = deindented.map(l => l ? '        ' + l : l).join('\n');
            yamlText = `network:\n  factories:\n    - id: factory-1\n      machines:\n${underMachines}`.trim();
          } else {
            const repairPrompt = `You produced YAML with the wrong top-level root. The user selected '${configScope}'.\n\nOriginal YAML:\n${yamlText}\n\nRewrite the YAML so the FIRST LINE is exactly '${configScope}:'. If the original root was 'factory:' and the user wants 'network:', wrap the factory inside 'network:' using a 'factories:' array. Output ONLY the corrected YAML (no fences).`;
            const provider = mapProviderMode(mode);
            const repairResp = await aiComplete(repairPrompt, '', provider, model);
            let repaired = repairResp?.text || '';
            if (repaired.trim()) {
              const fencedFix = repaired.match(/```(yaml|yml)?\n([\s\S]+?)```/i);
              if (fencedFix) repaired = fencedFix[2];
              yamlText = sanitizeYaml(repaired.trim());
            }
          }
        }
      }

      // Final hard assert before preview: if scope=network and still not network, enforce wrapping again.
      if (configScope === 'network') {
        const firstLine2 = (yamlText.split(/\r?\n/).find(l => {
          const t = l.trim();
          if (!t) return false;
          if (t.startsWith('#')) return false;
          if (t === '---' || t === '...') return false;
          return true;
        }) || '').trim().toLowerCase();
        if (!firstLine2.startsWith('network:')) {
          if (firstLine2.startsWith('factory:')) {
            const allLines = yamlText.split(/\r?\n/);
            let startIdx = allLines.findIndex(l => {
              const t = l.trim();
              if (!t) return false;
              if (t.startsWith('#')) return false;
              if (t === '---' || t === '...') return false;
              return true;
            });
            if (startIdx < 0) startIdx = 0;
            const lines = allLines.slice(startIdx + 1);
            const indents = lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length);
            const minIndent = indents.length ? Math.min(...indents) : 0;
            const deindented = lines.map(l => l.slice(Math.min(minIndent, l.match(/^\s*/)[0].length)));
            let firstIdx = deindented.findIndex(l => l.trim());
            if (firstIdx === -1) firstIdx = 0;
            if (!deindented[firstIdx].trim().startsWith('- ')) {
              deindented[firstIdx] = '- ' + deindented[firstIdx].trim();
            }
            for (let i = firstIdx + 1; i < deindented.length; i++) {
              if (deindented[i].trim()) deindented[i] = '  ' + deindented[i];
            }
            const underFactories = deindented.map(l => l ? '  ' + l : l).join('\n');
            yamlText = `network:\n  factories:\n${underFactories}`.trim();
          } else if (firstLine2.startsWith('machine:')) {
            const allLines = yamlText.split(/\r?\n/);
            let startIdx = allLines.findIndex(l => {
              const t = l.trim();
              if (!t) return false;
              if (t.startsWith('#')) return false;
              if (t === '---' || t === '...') return false;
              return true;
            });
            if (startIdx < 0) startIdx = 0;
            const lines = allLines.slice(startIdx + 1);
            const indents = lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length);
            const minIndent = indents.length ? Math.min(...indents) : 0;
            const deindented = lines.map(l => l.slice(Math.min(minIndent, l.match(/^\s*/)[0].length)));
            let firstIdx = deindented.findIndex(l => l.trim());
            if (firstIdx === -1) firstIdx = 0;
            if (!deindented[firstIdx].trim().startsWith('- ')) {
              deindented[firstIdx] = '- ' + deindented[firstIdx].trim();
            }
            for (let i = firstIdx + 1; i < deindented.length; i++) {
              if (deindented[i].trim()) deindented[i] = '  ' + deindented[i];
            }
            const underMachines = deindented.map(l => l ? '        ' + l : l).join('\n');
            yamlText = `network:\n  factories:\n    - id: factory-1\n      machines:\n${underMachines}`.trim();
          } else {
            // One more model rewrite try
            const finalRepairPrompt = `Rewrite this YAML to have FIRST LINE 'network:' and include a 'factories:' array. If the content is a single 'factory:', wrap it under 'network:'->'factories:'. Output ONLY YAML (no fences).\n\n${yamlText}`;
            try {
              const provider = mapProviderMode(mode);
              const finalResp = await aiComplete(finalRepairPrompt, '', provider, model);
              let fixed = finalResp?.text || '';
              if (fixed.trim()) {
                const fencedV = fixed.match(/```(yaml|yml)?\n([\s\S]+?)```/i);
                if (fencedV) fixed = fencedV[2];
                yamlText = sanitizeYaml(fixed.trim());
              }
            } catch {}
          }
        }
      }

      // Success: store YAML and show action bar (do not auto-apply)
      lastGeneratedYaml = yamlText;
      showConfigActions = true;
      messages[messages.length - 1] = { role: 'assistant', content: '✅ Configuration proposed. Review and apply when ready.' };
      // Require another exchange before next generation
      hasFirstAssistantReply = false;
      configScope = '';
    } catch (e) {
      const errMsg = e?.message || e?.Error || String(e);
      messages[messages.length - 1] = { role: 'assistant', content: `❌ Failed to generate config: ${errMsg}` };
    } finally {
      isCreating = false;
      messages = [...messages]; // Trigger reactivity
    }
  }

  // Apply the last generated YAML to the canvas (with confirmation)
  async function applyGeneratedToCanvas() {
    if (!lastGeneratedYaml) return;
    const confirmed = window.confirm('Apply the proposed configuration to the canvas?');
    if (!confirmed) return;

    await historyActions.startMacro('Apply Generated Config');
    try {
      // If replacing an existing container, remove its contents first
      if (pendingReplaceTarget) {
        const containers = get(workflowContainers) || [];
        const target = containers.find(c => c.id === pendingReplaceTarget.id);
        if (target) {
          if (target.isNetwork) {
            // Delete factories and their contents
            (target.factories || []).forEach(f => {
              (f.machines || []).forEach(m => (m.nodes || []).forEach(n => nodeActions.delete(n.id)));
              (f.nodeIds || []).forEach(nid => nodeActions.delete(nid));
            });
            // Delete network-level machines and nodes
            (target.machines || []).forEach(m => (m.nodes || []).forEach(n => nodeActions.delete(n.id)));
            (target.nodeIds || []).forEach(nid => nodeActions.delete(nid));
          } else if (target.isFactory) {
            (target.machines || []).forEach(m => (m.nodes || []).forEach(n => nodeActions.delete(n.id)));
            (target.nodeIds || []).forEach(nid => nodeActions.delete(nid));
          } else {
            // Machine
            (target.nodes || []).forEach(n => nodeActions.delete(n.id));
          }
        }
      }

      const result = await pasteAndCreateConfigUniversal(null, null, lastGeneratedYaml);
      if (!result?.success) {
        throw new Error(result?.error || 'Applying the generated configuration failed.');
      }

      // Optionally auto-organize affected containers
      const organizeTargets = [];
      if (Array.isArray(result.containerIds)) organizeTargets.push(...result.containerIds);
      if (result.containerId) organizeTargets.push(result.containerId);
      const seen = new Set();
      for (const targetId of organizeTargets) {
        if (!targetId || seen.has(targetId)) continue;
        seen.add(targetId);
        try { await workflowActions.organize(targetId); } catch (e) { console.warn('Auto-organize failed', targetId, e); }
      }

      messages = [...messages, { role: 'assistant', content: '✅ Changes applied to canvas.' }];
      showConfigActions = false;
      pendingReplaceTarget = null;
    } catch (e) {
      const errMsg = e?.message || e?.Error || String(e);
      messages = [...messages, { role: 'assistant', content: `❌ Apply failed: ${errMsg}` }];
    } finally {
      await historyActions.endMacro();
    }
  }

  // A more robust markdown renderer
  function renderMarkdown(src) {
    if (!src) return '';
    let html = src
      .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));

    // Fenced code blocks first
    html = html.replace(/```([\s\S]*?)```/g, (m, p1) => `<pre class="code"><code>${p1.trim()}</code></pre>`);

    // Tokenize code blocks to avoid subsequent markdown processing inside them
    const blockTokens = [];
    html = html.replace(/<pre class="code"><code>[\s\S]*?<\/code><\/pre>/g, (m) => {
      blockTokens.push(m);
      return `@@BLOCK${blockTokens.length - 1}@@`;
    });

    // Inline code / emphasis
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Build nested unordered lists based on indentation (2 spaces per level)
    const lines = html.split(/\r?\n/);
    let out = '';
    let level = 0;
    const openOnce = (depth) => { out += `<ul class="md-ul depth-${depth}">`; };
    const open = (n) => { for (let i = 0; i < n; i++) openOnce(level + i); };
    const close = (n) => { for (let i = 0; i < n; i++) out += '</ul>'; };
    for (const line of lines) {
      const m = line.match(/^(\s*)([-\*])\s+(.*)$/);
      if (m) {
        const prefix = (m[1] || '').replace(/\t/g, '    '); // tabs count as 4 spaces
        const indent = Math.floor(prefix.length / 2) + 1; // base level starts at 1
        while (level < indent) { open(1); level++; }
        while (level > indent) { close(1); level--; }
        out += `<li>${m[3]}</li>`;
      } else {
        if (level > 0) { close(level); level = 0; }
        out += line + '\n';
      }
    }
    if (level > 0) close(level);

    // Restore code blocks
    out = out.replace(/@@BLOCK(\d+)@@/g, (_, i) => blockTokens[+i] || '');

    // Convert remaining newlines to <br>
    return out.replace(/\n/g, '<br>');
  }

  // Minimal sanitizer: quote content values that contain ':' and are unquoted
  function sanitizeYaml(yaml) {
    const lines = yaml.split(/\r?\n/);
    const fixed = lines.map(line => {
      const m = line.match(/^(\s*content:\s)(.+)$/);
      if (!m) return line;
      const prefix = m[1];
      const value = m[2];
      const trimmed = value.trim();
      // Leave empty, quoted, or block scalars alone
      if (!trimmed || trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith('|') || trimmed.startsWith('>')) {
        return line;
      }
      // If value contains a colon or looks risky, wrap in double quotes
      if (trimmed.includes(':')) {
        const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `${prefix}"${escaped}"`;
      }
      return line;
    });
    return fixed.join('\n');
  }

  // Minimal JSON -> YAML converter for simple objects/arrays/primitives
  function jsonToYaml(value, indent = 0) {
    const pad = '  '.repeat(indent);
    const next = '  '.repeat(indent + 1);

    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      return value
        .map(item => {
          const yaml = jsonToYaml(item, indent + 1);
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            return `${pad}- ${yaml.replace(/^\s*/, '')}`;
          }
          return `${pad}- ${yaml}`;
        })
        .join('\n');
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return '{}';
      return keys
        .map(k => {
          const v = value[k];
          const rendered = jsonToYaml(v, indent + 1);
          if (typeof v === 'object' && v !== null) {
            return `${pad}${k}:\n${rendered}`;
          }
          return `${pad}${k}: ${rendered}`;
        })
        .join('\n');
    }
    if (typeof value === 'string') {
      // Quote strings that might confuse YAML
      if (/[:\-\[\]\{\},&*#?]|^\s|\s$|\n/.test(value)) {
        return JSON.stringify(value);
      }
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    // Fallback to JSON string
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  onMount(async () => {
    try {
      const res = await fetch('/docs/AI-Ontology-Guide.md');
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 100) {
          masterGuide = text;
        }
      }
    } catch (err) {
      console.warn('Could not load ontology guide from docs, using fallback.', err);
    } finally {
        messages = [
            { role: 'system', content: `You are a helpful assistant for the Ordinal app. Your goal is to understand the user's desired workflow and help them design it. You must understand the Ordinal ontology to have a productive conversation.\n\nTOOLS & FLOW:\n- Use the context menu action \"Chat about this Container\" to set scope (canvas/machine/factory/network).\n- Do not output YAML in chat.\n- If asked to describe the canvas, summarize the highest-level containers present and their purposes.\n- For brand-new configs, guide the user to click \"Generate Config\".\n- For modifications (e.g., add a machine), propose a YAML change and the user will click \"Apply to Canvas\" to commit it.\n\nONTOLOGY SUMMARY:\n${masterGuide}` },
            { role: 'assistant', content: buildGreeting() }
        ];
    }
  });
</script>

<div class="chat-sidebar" class:open={isOpen}>
  <div class="chat-header">
    <h3>Config Chat</h3>
    {#if $chatScope}
      <div class="scope-pill" title="Current chat scope">
        {#if $chatScope.type === 'canvas'}
          Scope: Canvas
        {:else}
          Scope: {$chatScope.type} {$chatScope.id}
        {/if}
      </div>
    {/if}
    <div class="header-actions">
      <button class="describe-btn" on:click={describeScopeNow} title="Summarize the current scope">Describe Scope</button>
      <button class="new-chat-btn" on:click={newChat} title="Start a new chat session">New Chat</button>
      <button class="close-btn" on:click={close}>�</button>
    </div>
  </div>
  <div class="chat-body" bind:this={chatBodyElement}>
    {#each messages as m}
      {#if m.role !== 'system'}
        <div class="msg-row {m.role}">
          <div class="bubble {m.role}">
            {#if m.typing}
              <div class="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            {:else}
              <div class="content">{@html renderMarkdown(m.content)}</div>
            {/if}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  {#if showConfigActions && lastGeneratedYaml}
    <div class="config-actions-bar">
      <div class="left">
        <span class="label">Config ready</span>
      </div>
      <div class="right">
        <button class="apply-config-btn" on:click={applyGeneratedToCanvas} title="Apply proposed changes to the canvas">Apply to Canvas</button>
        <button class="copy-config-btn" on:click={async () => { const r = await copyText(lastGeneratedYaml); if (!r?.success) { console.warn('Copy failed:', r?.error); } }} title="Copy generated YAML to clipboard">Copy Config</button>
        <button class="dismiss-config-btn" on:click={() => { showConfigActions = false; }} title="Hide actions">×</button>
      </div>
    </div>
  {/if}
  <div class="chat-input">
    <textarea 
      bind:value={input} 
      placeholder="Describe your intended system..." 
      rows="3"
      disabled={isSending || isCreating}
      on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
    ></textarea>
    <div class="actions">
      <button on:click={send} disabled={isSending || isCreating || !input.trim()} title="Send (Enter)">{isSending ? 'Thinking…' : 'Send'}</button>
      <button
        on:click={openGenerate}
        disabled={isSending || isCreating || !hasFirstAssistantReply}
        title={hasFirstAssistantReply ? 'Pick a scope and generate config' : 'Send a message and receive a reply to enable'}
      >
        {isCreating ? 'Generating…' : 'Generate Config'}
      </button>
      {#if isScopePickerOpen}
        <div class="scope-popover" role="menu" aria-label="Select generation scope">
          <button class="scope-item" on:click={() => chooseScope('any')}>Any Size</button>
          <div class="divider"></div>
          <button class="scope-item" on:click={() => chooseScope('node')}>Node</button>
          <button class="scope-item" on:click={() => chooseScope('machine')}>Machine</button>
          <button class="scope-item" on:click={() => chooseScope('factory')}>Factory</button>
          <button class="scope-item" on:click={() => chooseScope('network')}>Network</button>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if isOpen}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    aria-label="Close chat sidebar"
    on:click={close}
    on:keydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        close();
      }
    }}
  ></div>
{/if}

<!-- Removed full-screen scope picker; replaced with small popover above the button -->

<style>
  .chat-sidebar { position: fixed; top:0; right:-420px; width:420px; height:100vh; background: var(--bg-primary,#ffffff); border-left:1px solid var(--border-color,#e2e8f0); box-shadow:-2px 0 10px rgba(0,0,0,0.06); z-index:1000; transition:right .25s ease; display:flex; flex-direction:column; }
  .chat-sidebar.open { right:0; }
  @media (max-width: 480px) {
    .chat-sidebar { width: 100vw; right: -100vw; }
    .chat-sidebar.open { right: 0; }
    .scope-pill { display: none; }
    .header-actions { gap: 4px; }
    .describe-btn, .new-chat-btn { padding: 5px 7px; font-size: 12px; }
  }
  .chat-header { display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:1px solid var(--border-color,#e2e8f0); background: var(--bg-secondary,#f8fafc); }
  .chat-header h3 { margin:0; font-size:16px; font-weight:600; }
  .scope-pill { margin-left:8px; background:#eef2ff; color:#3730a3; border:1px solid #c7d2fe; border-radius:999px; padding:4px 8px; font-size:12px; font-weight:600; }
  .header-actions { display:flex; gap:8px; align-items:center; }
  .close-btn { background:none; border:none; font-size:20px; cursor:pointer; color:#64748b; }
  .describe-btn { background:#e5e7eb; color:#111827; border:none; border-radius:6px; padding:6px 10px; font-size:13px; cursor:pointer; }
  .describe-btn:hover { background:#d1d5db; }
  .new-chat-btn { background:#0ea5e9; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:13px; cursor:pointer; }
  .chat-body { flex:1; overflow:auto; padding:12px 12px 16px; display:flex; flex-direction:column; gap:10px; }
  .msg-row { display:flex; width:100%; }
  .msg-row.user { justify-content:flex-end; }
  .msg-row.assistant { justify-content:flex-start; }
  .bubble { max-width: 85%; padding:10px 14px; border-radius:18px; font-size:14px; line-height:1.4; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  .bubble.user { background:#2563eb; color:#ffffff; border-bottom-right-radius:4px; }
  .bubble.assistant { background:#e2e8f0; color:#0f172a; border-bottom-left-radius:4px; }
  .bubble .content { white-space:pre-wrap; word-break:break-word; }
  :global(.bubble .content ul) { margin: 8px 0; padding-left: 20px; }
  :global(.bubble .content li) { margin-bottom: 4px; }
  /* Ensure nested lists indent progressively and show bullet types */
  :global(.bubble .content ul) { list-style-type: disc; list-style-position: outside; }
  :global(.bubble .content ul ul) { padding-left: 20px; list-style-type: circle; }
  :global(.bubble .content ul ul ul) { padding-left: 20px; list-style-type: square; }
  :global(.bubble .content pre.code) { background: rgba(0,0,0,0.08); padding:8px; border-radius:8px; overflow:auto; font-size: 13px; margin: 8px 0; }
  :global(.bubble.user .content pre.code) { background: rgba(255,255,255,0.1); }
  :global(.bubble .content code) { background: rgba(0,0,0,0.06); padding:1px 4px; border-radius:4px; font-size: 13px; }
  :global(.bubble.user .content code) { background: rgba(255,255,255,0.2); }
  .chat-input { border-top:1px solid var(--border-color,#e0e0e0); padding:10px; display:flex; flex-direction:column; gap:8px; background: var(--bg-secondary); }
  textarea { width:100%; resize:vertical; font-size:14px; padding:10px; border:1px solid var(--border-color); border-radius:8px; background: var(--bg-primary); color:var(--text-primary); }
  textarea:disabled { opacity: 0.6; }
  .actions { position: relative; display:flex; gap:8px; justify-content:flex-end; }
  .actions button { background:#2563eb; color:white; border:none; border-radius:6px; padding:8px 12px; font-size:14px; font-weight: 500; cursor:pointer; }
  .actions button[disabled] { opacity:0.6; cursor:default; }
  .backdrop { position:fixed; inset:0; background: rgba(0,0,0,0.3); z-index: 999; }
  /* Scope popover menu */

  /* Config action bar */
  .config-actions-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 12px; border-top:1px solid #e5e7eb; background:#f8fafc; }
  .config-actions-bar .label { font-size:13px; color:#334155; }
  .config-actions-bar .right { display:flex; gap:8px; }
  .apply-config-btn { background:#22c55e; color:white; border:none; border-radius:6px; padding:6px 10px; font-size:13px; cursor:pointer; }
  .apply-config-btn:hover { background:#16a34a; }
  .copy-config-btn { background:#10b981; color:white; border:none; border-radius:6px; padding:6px 10px; font-size:13px; cursor:pointer; }
  .copy-config-btn:hover { background:#0ea371; }
  .dismiss-config-btn { background:#e5e7eb; color:#111827; border:none; border-radius:6px; padding:6px 10px; font-size:13px; cursor:pointer; }
  .dismiss-config-btn:hover { background:#d1d5db; }
  .scope-popover { position:absolute; bottom:44px; right:0; background:#fff; color:#0f172a; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.15); padding:6px; z-index: 1001; width: 190px; }
  .scope-item { display:block; width:100%; text-align:left; background:transparent; border:none; padding:8px 10px; border-radius:6px; cursor:pointer; font-size:14px; }
  .scope-item:hover { background:#f1f5f9; }
  .divider { height:1px; background:#e2e8f0; margin:6px 0; }

  .typing-indicator { display: flex; align-items: center; justify-content: center; height: 20px; }
  .typing-indicator span { width: 6px; height: 6px; margin: 0 2px; background-color: #94a3b8; border-radius: 50%; display: inline-block; animation: bounce 1.2s infinite ease-in-out; }
  .typing-indicator span:nth-child(2) { animation-delay: -0.2s; }
  .typing-indicator span:nth-child(3) { animation-delay: -0.4s; }
  @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1.0); } }

  :global(body.dark-mode) .chat-sidebar { background:#1e293b; border-left-color:#334155; }
  :global(body.dark-mode) .chat-header { background:#0f172a; border-bottom-color:#334155; }
  :global(body.dark-mode) .chat-body { color:#e5e7eb; }
  :global(body.dark-mode) .bubble.assistant { background:#334155; color:#f1f5f9; }
  :global(body.dark-mode) .bubble.user { background:#4f46e5; color:#ffffff; }
  :global(body.dark-mode) .chat-input { background: #0f172a; border-top-color: #334155; }
  :global(body.dark-mode) textarea { background:#1e293b; color:#f1f5f9; border-color:#475569; }
</style>

