import { writable } from 'svelte/store';

// Import YAML templates as raw strings (Vite ?raw suffix)
// Knowledge mode blueprints
import knowledgeSimpleYaml from './templates/knowledge-simple.yaml?raw';
import knowledgeMultisourceYaml from './templates/knowledge-multisource.yaml?raw';
import knowledgePipelineYaml from './templates/knowledge-pipeline.yaml?raw';

// Automation mode blueprints
import automationSimpleYaml from './templates/automation-simple.yaml?raw';
import automationOrchestratorYaml from './templates/automation-orchestrator.yaml?raw';
import automationOracleYaml from './templates/automation-oracle.yaml?raw';

// Diagramming mode blueprints
import diagram3tierYaml from './templates/diagram-3tier.yaml?raw';
import diagramMicroservicesYaml from './templates/diagram-microservices.yaml?raw';
import diagramDatapipelineYaml from './templates/diagram-datapipeline.yaml?raw';

// Structural blueprints (all modes)
import structureMachineYaml from './templates/structure-machine.yaml?raw';
import structureFactoryYaml from './templates/structure-factory.yaml?raw';
import structureNetworkYaml from './templates/structure-network.yaml?raw';

// Ontology test library — single-level
import testStandaloneNodesYaml from './templates/test-standalone-nodes.yaml?raw';
import testSingleMachineYaml from './templates/test-single-machine.yaml?raw';
import testSingleFactoryYaml from './templates/test-single-factory.yaml?raw';
import testSingleNetworkYaml from './templates/test-single-network.yaml?raw';

// Ontology test library — mixed/nested
import testMachinePlusStandaloneYaml from './templates/test-machine-plus-standalone.yaml?raw';
import testFactoryStandaloneNodesYaml from './templates/test-factory-standalone-nodes.yaml?raw';
import testFactorySingleNodeMachinesYaml from './templates/test-factory-single-node-machines.yaml?raw';
// FIX: test-network-standalone-machines — added second factory connected to first, making it a real network
import testNetworkStandaloneMachinesYaml from './templates/test-network-standalone-machines.yaml?raw';
// FIX: test-network-standalone-nodes — added second factory connected to first, making it a real network
import testNetworkStandaloneNodesYaml from './templates/test-network-standalone-nodes.yaml?raw';

// Ontology test library — multi-instance
import testMultipleMachinesYaml from './templates/test-multiple-machines.yaml?raw';
import testMultipleFactoriesYaml from './templates/test-multiple-factories.yaml?raw';
// FIX: test-multiple-networks — each network now has 2 connected factories (was 1 factory = not a network)
import testMultipleNetworksYaml from './templates/test-multiple-networks.yaml?raw';

// Ontology test library — topological patterns
import testLinearChainYaml from './templates/test-linear-chain.yaml?raw';
import testFanOutYaml from './templates/test-fan-out.yaml?raw';
import testFanInYaml from './templates/test-fan-in.yaml?raw';
import testDiamondYaml from './templates/test-diamond.yaml?raw';

// Default templates — organized by mode
// Template metadata (name, icon, mode, isDefault) lives here.
// YAML content lives in ./templates/*.yaml
const defaultTemplates = {
    // ==================== KNOWLEDGE MODE BLUEPRINTS ====================
    'knowledge-simple': {
        name: "Simple AI Pipeline",
        icon: "🧠",
        mode: "knowledge",
        isDefault: true,
        yaml: knowledgeSimpleYaml
    },
    'knowledge-multisource': {
        name: "Multi-Source Research",
        icon: "📚",
        mode: "knowledge",
        isDefault: true,
        yaml: knowledgeMultisourceYaml
    },
    // FIX: knowledge-pipeline had 3 cross-connected machines at top level with no factory wrapper.
    // Connected machines must be grouped in a factory. Wrapped in a factory container.
    'knowledge-pipeline': {
        name: "Research Pipeline",
        icon: "🔬",
        mode: "knowledge",
        isDefault: true,
        yaml: knowledgePipelineYaml
    },

    // ==================== AUTOMATION MODE BLUEPRINTS ====================
    // FIX: automation-simple had 'trigger' (action-mode type) mixed with 'worker'/'output' (agent-mode types).
    // Replaced trigger with 'input' so this is a pure agent-mode blueprint.
    'automation-simple': {
        name: "Input → Worker",
        icon: "⚙️",
        mode: "automation",
        isDefault: true,
        yaml: automationSimpleYaml
    },
    'automation-orchestrator': {
        name: "Orchestrator Pool",
        icon: "🎭",
        mode: "automation",
        isDefault: true,
        yaml: automationOrchestratorYaml
    },
    'automation-oracle': {
        name: "Worker → Oracle Flow",
        icon: "🔮",
        mode: "automation",
        isDefault: true,
        yaml: automationOracleYaml
    },

    // ==================== DIAGRAMMING MODE BLUEPRINTS ====================
    // FIX: diagram-3tier had 3 cross-connected machines at top level with no factory wrapper.
    // Machines connected by cross-machine edges must be inside a factory. Wrapped in factory.
    'diagram-3tier': {
        name: "3-Tier Web App",
        icon: "🏗️",
        mode: "diagramming",
        isDefault: true,
        yaml: diagram3tierYaml
    },
    // FIX: diagram-microservices had 4 cross-connected machines at top level with no factory wrapper.
    // api-gateway output referenced machine IDs (auth-service, user-service, order-service).
    // Wrapped all machines in a factory.
    'diagram-microservices': {
        name: "Microservices",
        icon: "🔷",
        mode: "diagramming",
        isDefault: true,
        yaml: diagramMicroservicesYaml
    },
    // FIX: diagram-datapipeline had 3 cross-connected machines at top level with no factory wrapper.
    // Wrapped in a factory container.
    'diagram-datapipeline': {
        name: "Data Pipeline",
        icon: "🌊",
        mode: "diagramming",
        isDefault: true,
        yaml: diagramDatapipelineYaml
    },

    // ==================== STRUCTURAL BLUEPRINTS (ALL MODES) ====================
    'structure-machine': {
        name: "Empty Machine",
        icon: "🔧",
        mode: "all",
        isDefault: true,
        yaml: structureMachineYaml
    },
    'structure-factory': {
        name: "Factory",
        icon: "🏭",
        mode: "all",
        isDefault: true,
        yaml: structureFactoryYaml
    },
    'structure-network': {
        name: "Network",
        icon: "🌐",
        mode: "all",
        isDefault: true,
        yaml: structureNetworkYaml
    },

    // ==================== ONTOLOGY TEST LIBRARY ====================
    // Single-level templates
    'test-standalone-nodes': {
        name: "Standalone Nodes",
        icon: "⚪",
        mode: "knowledge",
        isDefault: true,
        yaml: testStandaloneNodesYaml
    },
    'test-single-machine': {
        name: "Single Machine",
        icon: "🔧",
        mode: "knowledge",
        isDefault: true,
        yaml: testSingleMachineYaml
    },
    'test-single-factory': {
        name: "Single Factory",
        icon: "🏭",
        mode: "knowledge",
        isDefault: true,
        yaml: testSingleFactoryYaml
    },
    'test-single-network': {
        name: "Single Network",
        icon: "🌐",
        mode: "knowledge",
        isDefault: true,
        yaml: testSingleNetworkYaml
    },

    // Mixed/nested templates
    'test-machine-plus-standalone': {
        name: "Machine + Standalone",
        icon: "🔧⚪",
        mode: "knowledge",
        isDefault: true,
        yaml: testMachinePlusStandaloneYaml
    },
    'test-factory-standalone-nodes': {
        name: "Factory + Standalone",
        icon: "🏭⚪",
        mode: "knowledge",
        isDefault: true,
        yaml: testFactoryStandaloneNodesYaml
    },
    'test-factory-single-node-machines': {
        name: "Factory (Single-Node Machines)",
        icon: "🏭🔵",
        mode: "knowledge",
        isDefault: true,
        yaml: testFactorySingleNodeMachinesYaml
    },
    // FIX: was a factory + disconnected machine mislabeled as a network.
    // Now has two connected factories inside the network container.
    'test-network-standalone-machines': {
        name: "Network + Standalone Machine",
        icon: "🌐🔧",
        mode: "knowledge",
        isDefault: true,
        yaml: testNetworkStandaloneMachinesYaml
    },
    // FIX: was a factory + disconnected nodes mislabeled as a network.
    // Now has two connected factories inside the network container.
    'test-network-standalone-nodes': {
        name: "Network + Standalone Nodes",
        icon: "🌐⚪",
        mode: "knowledge",
        isDefault: true,
        yaml: testNetworkStandaloneNodesYaml
    },

    // Multi-instance templates
    'test-multiple-machines': {
        name: "Multiple Machines",
        icon: "🔧🔧🔧",
        mode: "knowledge",
        isDefault: true,
        yaml: testMultipleMachinesYaml
    },
    'test-multiple-factories': {
        name: "Multiple Factories",
        icon: "🏭🏭",
        mode: "knowledge",
        isDefault: true,
        yaml: testMultipleFactoriesYaml
    },
    // FIX: each "network" had only 1 factory with 1 machine — that's a factory, not a network.
    // Each network now has 2 factories connected by an inter-factory edge.
    'test-multiple-networks': {
        name: "Multiple Networks",
        icon: "🌐🌐",
        mode: "knowledge",
        isDefault: true,
        yaml: testMultipleNetworksYaml
    },

    // Topological patterns
    'test-linear-chain': {
        name: "Linear Chain (A→B→C→D)",
        icon: "⛓️",
        mode: "knowledge",
        isDefault: true,
        yaml: testLinearChainYaml
    },
    'test-fan-out': {
        name: "Fan-Out (1→3)",
        icon: "📤",
        mode: "knowledge",
        isDefault: true,
        yaml: testFanOutYaml
    },
    'test-fan-in': {
        name: "Fan-In (3→1)",
        icon: "📥",
        mode: "knowledge",
        isDefault: true,
        yaml: testFanInYaml
    },
    'test-diamond': {
        name: "Diamond (A→B,C→D)",
        icon: "💎",
        mode: "knowledge",
        isDefault: true,
        yaml: testDiamondYaml
    }
};

// Load saved templates from localStorage
function loadTemplates() {
    try {
        const saved = localStorage.getItem('ordinal-templates');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge with defaults, ensuring defaults can't be overridden
            return { ...parsed, ...defaultTemplates };
        }
    } catch (error) {
        console.warn('Failed to load templates from localStorage:', error);
    }
    return defaultTemplates;
}

// Save templates to localStorage (excluding defaults)
/**
 * @param {Object<string, any>} templates
 */
function saveTemplates(templates) {
    try {
        // Only save custom templates, not defaults
        /** @type {Object<string, any>} */
        const customTemplates = {};
        for (const [key, template] of Object.entries(templates)) {
            if (!template.isDefault) {
                customTemplates[key] = template;
            }
        }
        localStorage.setItem('ordinal-templates', JSON.stringify(customTemplates));
    } catch (error) {
        console.warn('Failed to save templates to localStorage:', error);
    }
}

// Create the templates store
export const templates = writable(loadTemplates());

// Template actions
export const templateActions = {
    /**
     * Add a new template
     * @param {string} name
     * @param {string} type
     * @param {string} yaml
     * @param {string | null} icon
     * @param {string | null} mode
     */
    add: (name, type, yaml, icon = null, mode = null) => {
        const templateId = `custom_${Date.now()}`;
        const template = {
            name,
            icon: icon || getDefaultIcon(type),
            mode: mode || 'knowledge', // Default to knowledge mode if not specified
            isDefault: false,
            yaml,
            createdAt: new Date().toISOString()
        };

        templates.update(current => {
            const updated = { ...current, [templateId]: template };
            saveTemplates(updated);
            return updated;
        });

        return templateId;
    },

    // Delete a template (only custom templates)
    /**
     * @param {string} templateId
     * @returns {void}
     */
    delete: (templateId) => {
        templates.update(current => {
            const template = current[templateId];
            if (template && !template.isDefault) {
                const updated = { ...current };
                delete updated[templateId];
                saveTemplates(updated);
                return updated;
            }
            return current;
        });
    },

    /**
     * Update a template
     * @param {string} templateId
     * @param {Object} updates
     */
    update: (templateId, updates) => {
        templates.update(current => {
            const template = current[templateId];
            if (template && !template.isDefault) {
                const updated = {
                    ...current,
                    [templateId]: { ...template, ...updates }
                };
                saveTemplates(updated);
                return updated;
            }
            return current;
        });
    }
};

// Helper function to get default icon for template type
/**
 * @param {string} type
 * @returns {string}
 */
function getDefaultIcon(type) {
    switch (type) {
        case 'machine': return '🔧';
        case 'factory': return '🏭';
        case 'network': return '🌐';
        default: return '📦';
    }
}
