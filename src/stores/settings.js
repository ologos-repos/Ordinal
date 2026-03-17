import { writable } from 'svelte/store';
import { settingsGetAll, settingsPutAll } from '../lib/rhodeApi.js';

// Available AI providers based on your Go lego code
export const availableProviders = [
    {
        id: 'openrouter',
        name: 'OpenRouter',
        description: 'Access multiple LLM providers through OpenRouter',
        requiresApiKey: true,
        models: []
    },
    {
        id: 'openai',
        name: 'OpenAI',
        description: 'Direct OpenAI API integration',
        requiresApiKey: true,
        models: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo']
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        description: 'Google Gemini models (API key managed server-side)',
        requiresApiKey: false,
        models: ['gemini-2.0-flash', 'gemini-2.5-pro-preview-05-06', 'gemini-2.5-flash-preview-04-17', 'gemini-2.0-flash-lite']
    },
    {
        id: 'local',
        name: 'Local (Ollama)',
        description: 'Local models via Ollama',
        requiresApiKey: false,
        models: []
    }
];

// Available embedding providers
export const availableEmbeddingProviders = [
    {
        id: 'openai',
        name: 'OpenAI Embeddings',
        description: 'OpenAI text-embedding-3-small/large'
    },
    {
        id: 'gemini',
        name: 'Gemini Embeddings',
        description: 'Google Gemini embedding models'
    },
    {
        id: 'local',
        name: 'Local Embeddings',
        description: 'Local embedding models'
    }
];

// Model list stores
/** @type {import('svelte/store').Writable<Array<{id: string, name: string}>>} */
export const modelList = writable([]);
export const isModelListLoading = writable(false);
export const modelListError = writable('');
/** @type {import('svelte/store').Writable<Array<{id: string, name: string}>>} */
export const embeddingModelList = writable([]);
export const isEmbeddingModelListLoading = writable(false);
export const embeddingModelListError = writable('');

// Settings store
export const settings = writable({
    // LLM Provider settings
    activeMode: 'gemini',
    openrouter_api_key: '',
    openai_api_key: '',
    openai_embedding_api_key: '',
    gemini_api_key: '',
    gemini_embedding_api_key: '',
    chat_model_id: 'gemini-2.0-flash',
    story_processing_model_id: 'gemini-2.0-flash',
    local_embedding_model_name: '',

    // UI settings
    showContainerLabels: true,
    autoExecuteWorkflows: false,
    debugMode: false,
    
    // Appearance settings
    darkMode: false,
    nodeColor: '#ffffff',
    machineColor: '#e3f2fd',
    factoryColor: '#f3e5f5',
    networkColor: '#e8f5e8',
    
    // Canvas settings
    defaultNodeWidth: 200,
    defaultNodeHeight: 120,
    containerPadding: 20,
    connectorStyle: 'fluid', // 'fluid' (bezier), 'straight', or 'cornered' (orthogonal)

    // Node behavior
    autosaveOnTextGenerate: true,

    // File handling
    lastFileDirectory: '',

    // Execution concurrency
    maxConcurrentExecutions: 3,
    maxConcurrentAIRequests: 3
});

// Store provider-specific model selections
export const providerModels = writable({
    openrouter: { chat: '', story: '' },
    openai: { chat: '', story: '' },
    gemini: { chat: '', story: '' },
    local: { chat: '', story: '' }
});

// Settings actions
export const settingsActions = {
    // Load settings from Rhode backend API, fall back to localStorage
    load: async () => {
        try {
            // Try Rhode backend API first
            const backendSettings = await settingsGetAll();
            if (backendSettings && Object.keys(backendSettings).length > 0) {
                settings.update(current => ({ ...current, ...backendSettings }));
                console.log('Settings loaded from Rhode backend');
                return;
            }
        } catch (err) {
            console.warn('Failed to load settings from backend, trying localStorage:', err);
        }
        try {
            // Fall back to localStorage
            const saved = localStorage.getItem('ordinal-settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                settings.update(current => ({ ...current, ...parsed }));
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    },
    
    // Save settings to backend/localStorage
    /**
     * @param {any} newSettings
     * @returns {Promise<void>}
     */
    save: async (newSettings) => {
        try {
            settings.update(current => ({ ...current, ...newSettings }));

            // Save to localStorage as immediate cache
            localStorage.setItem('ordinal-settings', JSON.stringify(newSettings));

            // Persist to Rhode backend API
            try {
                await settingsPutAll(newSettings);
                console.log('Settings saved to backend:', Object.keys(newSettings));
            } catch (err) {
                console.warn('Failed to save settings to backend:', err);
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    },
    
    // Update specific setting
    /**
     * @param {string} key
     * @param {any} value
     * @returns {void}
     */
    update: (key, value) => {
        settings.update(current => {
            const updated = { ...current, [key]: value };
            // Auto-save when settings change
            settingsActions.save(updated);
            return updated;
        });
    },
    
    // Reset to defaults
    reset: () => {
        const defaults = {
            activeMode: 'gemini',
            openrouter_api_key: '',
            openai_api_key: '',
            openai_embedding_api_key: '',
            gemini_api_key: '',
            gemini_embedding_api_key: '',
            chat_model_id: 'gemini-2.0-flash',
            story_processing_model_id: 'gemini-2.0-flash',
            local_embedding_model_name: '',
            showContainerLabels: true,
            autoExecuteWorkflows: false,
            debugMode: false,
            darkMode: false,
            nodeColor: '#ffffff',
            machineColor: '#e3f2fd',
            factoryColor: '#f3e5f5',
            networkColor: '#e8f5e8',
            defaultNodeWidth: 200,
            defaultNodeHeight: 120,
            containerPadding: 20,
            connectorStyle: 'fluid',
            autosaveOnTextGenerate: true,
            lastFileDirectory: '',
            maxConcurrentExecutions: 3,
            maxConcurrentAIRequests: 3
        };
        settings.set(defaults);
        settingsActions.save(defaults);
    },
    
    // Test connection with current provider
    testConnection: async () => {
        // TODO: Implement provider connection test
        return { success: true, message: 'Connection test not implemented yet' };
    },
    
    // Fetch available models for current provider
    /**
     * @param {string} providerId
     * @param {string} apiKey
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    fetchModels: async (providerId, apiKey) => {
        try {
            isModelListLoading.set(true);
            modelListError.set('');
            
            console.log(`Fetching models for ${providerId}...`);
            
            // Declare models variable first
            /** @type {Array<{id: string, name: string}>} */
            let models = [];

            // Provide fallback model data for Rhode web mode
            {
                // Fallback data for browser mode
                if (providerId === 'openrouter') {
                    models = [
                        { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
                        { id: 'openai/gpt-4', name: 'OpenAI: GPT-4' },
                        { id: 'anthropic/claude-3.5-sonnet', name: 'Anthropic: Claude 3.5 Sonnet' }
                    ];
                } else if (providerId === 'openai') {
                    models = [
                        { id: 'gpt-4o', name: 'GPT-4o' },
                        { id: 'gpt-4', name: 'GPT-4' },
                        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
                    ];
                } else if (providerId === 'gemini') {
                    models = [
                        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
                        { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro' },
                        { id: 'gemini-2.5-flash-preview-04-17', name: 'Gemini 2.5 Flash' },
                        { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' }
                    ];
                } else if (providerId === 'local') {
                    models = [
                        { id: 'llama3:latest', name: 'Llama 3' },
                        { id: 'mistral:latest', name: 'Mistral' }
                    ];
                }


                modelList.set(models);
                return models;
            }
            
            /** @type {{ id: string, name: string }[]} */
            const finalModels = models || [];
            modelList.set(finalModels);
            return models || [];
        } catch (error) {
            console.error('Failed to fetch models:', error);
            modelListError.set(`Error loading models: ${error instanceof Error ? error.message : String(error)}`);
            modelList.set([]);
            return [];
        } finally {
            isModelListLoading.set(false);
        }
    },

    // Fetch embedding models (for local mode)
    fetchEmbeddingModels: async () => {
        try {
            isEmbeddingModelListLoading.set(true);
            embeddingModelListError.set('');

            // Check if Wails is available - if not, provide fallback data for development
            if (!window.go || !window.go?.app || !window.go?.app?.App) {
                console.warn('Wails runtime not available - using fallback embedding models for development');

                /** @type {{ id: string, name: string }[]} */
                const models = [
                    { id: 'nomic-embed-text:latest', name: 'Nomic Embed Text' },
                    { id: 'all-minilm:latest', name: 'All MiniLM' }
                ];
                
                embeddingModelList.set(models);
                return models;
            }
            
            // Use Ollama models for embedding (same API)
            /** @type {{ id: string, name: string }[] | undefined} */
            // Stub: Ollama model fetching not implemented in browser mode
            let models = [];
            
            /** @type {{ id: string, name: string }[]} */
            const finalModels = models || [];
            embeddingModelList.set(finalModels);
            return models || [];
        } catch (error) {
            console.error('Failed to fetch embedding models:', error);
            embeddingModelListError.set(`Error loading embedding models: ${error instanceof Error ? error.message : String(error)}`);
            embeddingModelList.set([]);
            return [];
        } finally {
            isEmbeddingModelListLoading.set(false);
        }
    },

    // Clear model lists
    clearModels: () => {
        modelList.set([]);
        modelListError.set('');
        embeddingModelList.set([]);
        embeddingModelListError.set('');
    }
};

// Initialize settings on app load
settingsActions.load();
