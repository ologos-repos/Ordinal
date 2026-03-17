/**
 * Rhode Web API Adapter
 *
 * Replaces Wails Go bindings with fetch-based calls to Rhode's web API.
 * Provides the same interface as the original Wails bindings for easy drop-in replacement.
 */

// API base URL (empty string for same-origin, or configure for remote Rhode instances)
const RHODE_API_BASE = '';

// Optional bearer token for AI completion endpoint (if RHODE_AI_TOKEN is set on server)
let aiAuthToken = null;

/**
 * Set the AI API authentication token (if Rhode requires it via RHODE_AI_TOKEN env var)
 * @param {string} token
 */
export function setAIAuthToken(token) {
    aiAuthToken = token;
}

/**
 * AI Completion - POST /ai/complete
 * @param {string} prompt - The user prompt
 * @param {string} [system=''] - Optional system prompt
 * @param {string} [provider='gemini'] - Provider: 'anthropic', 'gemini', or 'ollama'
 * @param {string} [model] - Model name (uses provider defaults if not specified)
 * @param {number} [temperature=0.7] - Temperature (0.0 - 1.0)
 * @param {number} [maxTokens=8192] - Max tokens to generate
 * @returns {Promise<{text: string, provider: string, model: string, duration_ms: number}>}
 */
export async function aiComplete(prompt, system = '', provider = 'gemini', model = null, temperature = 0.7, maxTokens = 8192) {
    const headers = {
        'Content-Type': 'application/json',
    };

    if (aiAuthToken) {
        headers['Authorization'] = `Bearer ${aiAuthToken}`;
    }

    const body = {
        prompt,
        system,
        provider,
        temperature,
        max_tokens: maxTokens,
    };

    if (model) {
        body.model = model;
    }

    const response = await fetch(`${RHODE_API_BASE}/ai/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `AI completion failed: ${response.status}`);
    }

    return await response.json();
}

/**
 * Settings - GET /ordinal/api/settings
 * @returns {Promise<Record<string, any>>}
 */
export async function settingsGetAll() {
    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/settings`);
    if (!response.ok) {
        throw new Error(`Failed to get settings: ${response.status}`);
    }
    return await response.json();
}

/**
 * Settings - GET /ordinal/api/settings/{key}
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function settingsGetKey(key) {
    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/settings/${encodeURIComponent(key)}`);
    if (!response.ok) {
        if (response.status === 404) {
            return null; // Key not found
        }
        throw new Error(`Failed to get setting '${key}': ${response.status}`);
    }
    const data = await response.json();
    return data.value;
}

/**
 * Settings - PUT /ordinal/api/settings (update multiple keys)
 * @param {Record<string, any>} settings
 * @returns {Promise<void>}
 */
export async function settingsPutAll(settings) {
    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
    });
    if (!response.ok) {
        throw new Error(`Failed to update settings: ${response.status}`);
    }
}

/**
 * Settings - PUT single key (convenience wrapper)
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function settingsPutKey(key, value) {
    await settingsPutAll({ [key]: value });
}

/**
 * Graphs - GET /ordinal/api/graphs
 * @returns {Promise<Array<{id: number, name: string, created_at: string, updated_at: string}>>}
 */
export async function graphsList() {
    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/graphs`);
    if (!response.ok) {
        throw new Error(`Failed to list graphs: ${response.status}`);
    }
    const data = await response.json();
    return data.graphs || [];
}

/**
 * Graphs - GET /ordinal/api/graphs/{id}
 * @param {number} graphId
 * @returns {Promise<{id: number, name: string, yaml_data: string, created_at: string, updated_at: string}>}
 */
export async function graphsGet(graphId) {
    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/graphs/${graphId}`);
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Graph ${graphId} not found`);
        }
        throw new Error(`Failed to get graph: ${response.status}`);
    }
    return await response.json();
}

/**
 * Graphs - POST /ordinal/api/graphs
 * @param {string} name
 * @param {string} yamlData
 * @returns {Promise<{id: number, name: string}>}
 */
export async function graphsCreate(name, yamlData) {
    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/graphs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, yaml_data: yamlData }),
    });
    if (!response.ok) {
        throw new Error(`Failed to create graph: ${response.status}`);
    }
    return await response.json();
}

/**
 * Graphs - PUT /ordinal/api/graphs/{id}
 * @param {number} graphId
 * @param {string} [name]
 * @param {string} [yamlData]
 * @returns {Promise<void>}
 */
export async function graphsUpdate(graphId, name = null, yamlData = null) {
    const body = {};
    if (name !== null) body.name = name;
    if (yamlData !== null) body.yaml_data = yamlData;

    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/graphs/${graphId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`Failed to update graph: ${response.status}`);
    }
}

/**
 * Graphs - DELETE /ordinal/api/graphs/{id}
 * @param {number} graphId
 * @returns {Promise<void>}
 */
export async function graphsDelete(graphId) {
    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/graphs/${graphId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error(`Failed to delete graph: ${response.status}`);
    }
}

/**
 * Graphs - POST /ordinal/api/graphs/{id}/execute
 * @param {number} graphId
 * @param {Record<string, string>} [overrides={}] - Node ID -> custom input text
 * @returns {Promise<any>}
 */
export async function graphsExecute(graphId, overrides = {}) {
    const response = await fetch(`${RHODE_API_BASE}/ordinal/api/graphs/${graphId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
    });
    if (!response.ok) {
        throw new Error(`Failed to execute graph: ${response.status}`);
    }
    return await response.json();
}

// ── FILE OPERATIONS (Browser mode - HTML5 File API) ──

/**
 * Read text file - Browser mode using File System Access API or file input fallback
 * @param {string} [suggestedPath] - Ignored in browser mode (no path access)
 * @returns {Promise<{path: string, content: string}>}
 */
export async function readTextFile(suggestedPath = '') {
    // Try File System Access API first (Chrome/Edge)
    if ('showOpenFilePicker' in window) {
        try {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [
                    {
                        description: 'Text Files',
                        accept: {
                            'text/plain': ['.txt'],
                            'text/markdown': ['.md'],
                            'application/json': ['.json'],
                            'text/yaml': ['.yaml', '.yml', '.ologic'],
                        },
                    },
                ],
            });
            const file = await fileHandle.getFile();
            const content = await file.text();
            return { path: file.name, content };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('File selection cancelled');
            }
            throw error;
        }
    }

    // Fallback: traditional file input
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.md,.json,.yaml,.yml';
        input.style.display = 'none';

        input.onchange = async (e) => {
            const file = e.target?.files?.[0];
            if (file) {
                const content = await file.text();
                document.body.removeChild(input);
                resolve({ path: file.name, content });
            } else {
                document.body.removeChild(input);
                reject(new Error('No file selected'));
            }
        };

        input.oncancel = () => {
            document.body.removeChild(input);
            reject(new Error('File selection cancelled'));
        };

        document.body.appendChild(input);
        input.click();
    });
}

/**
 * Select text file (returns path only, doesn't read content) - Browser mode
 * @returns {Promise<string>}
 */
export async function selectTextFile() {
    const result = await readTextFile();
    return result.path; // In browser mode, this is just the filename
}

/**
 * Read PDF file - Browser mode (limited - can get filename but not parse PDF)
 * @param {string} [suggestedPath] - Ignored in browser mode
 * @returns {Promise<{path: string, content: string}>}
 */
export async function readPDFFile(suggestedPath = '') {
    // Browser mode: can select PDF but cannot parse it without a library
    // Return the filename and a placeholder message
    if ('showOpenFilePicker' in window) {
        try {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [
                    {
                        description: 'PDF Files',
                        accept: { 'application/pdf': ['.pdf'] },
                    },
                ],
            });
            const file = await fileHandle.getFile();
            return {
                path: file.name,
                content: `[PDF file selected: ${file.name} - PDF parsing not available in browser mode]`,
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('File selection cancelled');
            }
            throw error;
        }
    }

    // Fallback
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf';
        input.style.display = 'none';

        input.onchange = async (e) => {
            const file = e.target?.files?.[0];
            if (file) {
                document.body.removeChild(input);
                resolve({
                    path: file.name,
                    content: `[PDF file selected: ${file.name} - PDF parsing not available in browser mode]`,
                });
            } else {
                document.body.removeChild(input);
                reject(new Error('No file selected'));
            }
        };

        document.body.appendChild(input);
        input.click();
    });
}

/**
 * Select PDF file (returns path only)
 * @returns {Promise<string>}
 */
export async function selectPDFFile() {
    const result = await readPDFFile();
    return result.path;
}

/**
 * Write text file - Browser mode using File System Access API or download fallback
 * @param {string} path - Filename (in browser mode)
 * @param {string} content - File content
 * @returns {Promise<void>}
 */
export async function writeTextFile(path, content) {
    const filename = path.split(/[/\\]/).pop() || 'output.txt';

    // Try File System Access API first
    if ('showSaveFilePicker' in window) {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [
                    {
                        description: 'Text Files',
                        accept: { 'text/plain': ['.txt', '.md', '.json', '.yaml', '.yml'] },
                    },
                ],
            });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
            return;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('File save cancelled');
            }
            throw error;
        }
    }

    // Fallback: trigger download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Select save file path (returns path where file will be saved) - Browser mode
 * @param {string} defaultFilename
 * @returns {Promise<string>}
 */
export async function selectSaveFilePath(defaultFilename) {
    if ('showSaveFilePicker' in window) {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: defaultFilename,
                types: [
                    {
                        description: 'Ordinal Logic Files',
                        accept: { 'text/yaml': ['.ologic', '.yaml', '.yml'] },
                    },
                    {
                        description: 'All Files',
                        accept: { '*/*': [] },
                    },
                ],
            });
            return fileHandle.name; // Browser mode: only filename available
        } catch (error) {
            if (error.name === 'AbortError') {
                return ''; // User cancelled
            }
            throw error;
        }
    }

    // Fallback: just return the suggested filename
    return defaultFilename;
}

// ── RHODE TASK API ──

/**
 * Create a new Rhode task
 * POST /tasks — { "prompt": "..." } → { "id": N, "status": "pending" }
 * @param {string} prompt - The task prompt to execute
 * @returns {Promise<{id: number, status: string}>}
 */
export async function createTask(prompt) {
    const response = await fetch(`${RHODE_API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Failed to create task: ${response.status}`);
    }
    return await response.json();
}

/**
 * Get task status and result
 * GET /tasks/{id} → { "id": N, "status": "...", "result": "..." }
 * @param {number} taskId
 * @returns {Promise<{id: number, status: string, result: string|null, description: string}>}
 */
export async function getTask(taskId) {
    const response = await fetch(`${RHODE_API_BASE}/tasks/${taskId}`);
    if (!response.ok) {
        throw new Error(`Failed to get task ${taskId}: ${response.status}`);
    }
    return await response.json();
}

/**
 * Get all messages for a task
 * GET /tasks/{id}/messages → array of message objects
 * @param {number} taskId
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
export async function getTaskMessages(taskId) {
    const response = await fetch(`${RHODE_API_BASE}/tasks/${taskId}/messages`);
    if (!response.ok) {
        throw new Error(`Failed to get task messages for ${taskId}: ${response.status}`);
    }
    return await response.json();
}

/**
 * Stream SSE events from a task until completion or failure.
 * Uses fetch + ReadableStream to handle Server-Sent Events from GET /tasks/{id}/stream.
 *
 * Emits these event types via onEvent:
 *   { type: 'message', content: '...' }   — partial content chunk
 *   { type: 'heartbeat' }                  — keepalive ping
 *   { type: 'completed', result: '...' }   — final result (streaming done)
 *   { type: 'failed', error: '...' }       — task failed
 *
 * @param {number} taskId
 * @param {function({type: string, content?: string, result?: string, error?: string}): void} onEvent
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<string>} — resolves with the final result text on completion
 */
export async function streamTask(taskId, onEvent, abortSignal) {
    const response = await fetch(`${RHODE_API_BASE}/tasks/${taskId}/stream`, {
        signal: abortSignal,
    });
    if (!response.ok) {
        throw new Error(`Failed to stream task ${taskId}: ${response.status}`);
    }
    if (!response.body) {
        throw new Error(`No response body for task stream ${taskId}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = '';

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events (separated by double newlines)
            const events = buffer.split('\n\n');
            buffer = events.pop() || ''; // Keep incomplete event in buffer

            for (const eventBlock of events) {
                if (!eventBlock.trim()) continue;

                // Parse SSE event block
                const lines = eventBlock.split('\n');
                let eventType = 'message';
                let eventData = '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        eventData = line.slice(6).trim();
                    }
                }

                if (!eventData) continue;

                let parsed;
                try {
                    parsed = JSON.parse(eventData);
                } catch {
                    // Plain text data
                    parsed = { content: eventData };
                }

                if (eventType === 'completed') {
                    finalResult = parsed.result || parsed.content || '';
                    onEvent({ type: 'completed', result: finalResult });
                    return finalResult;
                } else if (eventType === 'failed') {
                    const errMsg = parsed.error || parsed.content || 'Task failed';
                    onEvent({ type: 'failed', error: errMsg });
                    throw new Error(errMsg);
                } else if (eventType === 'heartbeat') {
                    onEvent({ type: 'heartbeat' });
                } else {
                    // message event — partial content
                    const content = parsed.content || parsed.text || (typeof parsed === 'string' ? parsed : '');
                    if (content) {
                        onEvent({ type: 'message', content });
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    // If stream ended without a completed event, fall back to polling
    if (!finalResult) {
        const taskData = await getTask(taskId);
        finalResult = taskData.result || '';
    }
    return finalResult;
}

// ── COMPATIBILITY SHIMS ──

/**
 * Check if running in browser mode (vs desktop Wails mode)
 * @returns {boolean}
 */
export function isRunningInBrowser() {
    return typeof window !== 'undefined' && !window.__WAILS_RUNTIME__;
}

/**
 * File drop handler (browser mode - noop, handled via native drag-drop events)
 * In Wails, this was window.runtime.OnFileDrop. In browser, use standard dragover/drop events.
 * @param {Function} callback - Called with array of file paths (browser mode: File objects)
 * @returns {Function} - Cleanup function
 */
export function onFileDrop(callback) {
    // In browser mode, files come from standard drag-drop events
    // This is a compatibility shim - actual implementation should use native events
    console.warn('onFileDrop: Use native dragover/drop events in browser mode');
    return () => {}; // Noop cleanup
}
