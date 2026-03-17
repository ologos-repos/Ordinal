<script>
    import { get } from 'svelte/store';
    import { viewport, canvasState, viewportActions } from '../stores/canvas.js';
    import { nodes, connections, crossMachineConnections, nodeActions, connectionActions, nodeDataStore } from '../stores/nodes.js';
    import { workflowContainers, containerCustomizations, containerActions, workflowActions } from '../stores/workflows.js';
    import { historyActions, historyState } from '../stores/canvasHistory.js';
    import { generateCanvasConfig, pasteAndCreateConfigUniversal } from './clipboard.js';
    import { NodeData } from './NodeData.js';
    // Toolbar removed — brand + mode controls now live in NodePalette (unified sidebar)
    import Node from './Node.svelte';
    import ConnectionLine from './ConnectionLine.svelte';
    import NodePalette from './NodePalette.svelte';
    import WorkflowContainer from './WorkflowContainer.svelte';
    import SettingsPanel from './SettingsPanel.svelte';
    import ConfigPanel from './ConfigPanel.svelte';
    import CanvasContextMenu from './CanvasContextMenu.svelte';
    import TemplatePalette from './TemplatePalette.svelte';
    import ChatSidebar from './ChatSidebar.svelte';
    import CustomizePanel from './CustomizePanel.svelte';
    import NodeDetailPanel from './NodeDetailPanel.svelte';
    import TextFileOutputModal from './TextFileOutputModal.svelte';
    import { OntologyMonitor } from './OntologyMonitor.js';
    import { isInputless } from './nodeTypes.js';
    // Lazy-load AI configure modal only on demand
    /** @type {any} */
    let AiConfigureComp = null;
    import { onMount, onDestroy } from 'svelte';
    import { chatUI, chatActions } from '../stores/chat.js';
    import { onFileDrop } from './rhodeApi.js';
    import { estimateTokensForCanvas, estimateTokensForNode } from './TokenCounter.js';
    
    /** @type {HTMLDivElement | null} */
    let canvasElement;
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let lastPanPoint = { x: 0, y: 0 };
    let isConnecting = false;
    /** @type {any} */
    let tempConnection = null;
    let mousePosition = { x: 0, y: 0 };
    let connectionMode = 'drag'; // 'drag' or 'click'
    let isBoxSelecting = false;
    let boxSelectionStart = { x: 0, y: 0 };
    let lastBoxSelectionTime = 0;
    let hasMovedDuringDrag = false;
    let suppressNextDoubleClick = false;
    
    // Global flag to immediately block node interactions
    let blockNodeInteractions = false;
    
    // File drag state
    let isDraggingFile = false;
    
    // Settings panel state
    let showSettings = false;
    
    // Config panel state
    let showConfigPanel = false;
    
    // Template palette state
    let showTemplatePalette = false;

    // Chat sidebar state (synced with chatUI store)
    let showChatSidebar = false;
    /** @type {null | (() => void)} */
    let _unsubChatUI = null;
    
    // Customize panel state
    let showCustomizePanel = false;
    let customizeEntityType = 'node';
    let customizeEntityId = '';
    let customizeCurrentColor = '';
    let customizeCurrentLabel = '';

    // Node detail panel state (opened by double-clicking a node)
    let showDetailPanel = false;
    /** @type {string | null} */
    let detailPanelNodeId = null;

    // Token counter state
    $: selectedNodeId = $canvasState.selectedNode;
    $: nodeMap = $nodeDataStore;
    $: nodeList = $nodes;
    $: selectedNodeTokens = (() => {
        if (!selectedNodeId) return 0;
        const nd = nodeMap.get(selectedNodeId);
        return nd ? estimateTokensForNode(nd) : 0;
    })();
    $: canvasTokens = (() => {
        if (!nodeList || nodeList.length === 0) return 0;
        let total = 0;
        nodeList.forEach(n => {
            const nd = nodeMap.get(n.id);
            if (nd) total += estimateTokensForNode(nd);
        });
        return total;
    })();

    // Defensive: ensure configuration modals are closed when canvas is empty (e.g., New Canvas)
    $: if ($nodes && $nodes.length === 0) {
        showTextFileOutputModal = false;
        textOutputConfigureNodeId = null;
        showAIConfigureModal = false;
        aiConfigureNodeId = null;
    }

    // Alias to avoid template "never" inference for boxSelection
    $: boxSel = /** @type {any} */ ($canvasState.boxSelection || { x: 0, y: 0, width: 0, height: 0 });

    // Per-container token count (for selected container)
    $: selectedContainerId = $canvasState.selectedContainer;
    $: selectedContainer = selectedContainerId ? $workflowContainers.find(c => c.id === selectedContainerId) : null;
    /** @param {any} container */
    function collectContainerNodeIds(container) {
        if (!container) return [];
        const seen = new Set();
        /** @type {any[]} */
        const out = [];
        /** @param {any} c */
        const visit = (c) => {
            if (!c || typeof c !== 'object') return;
            // Nodes listed directly on a machine container
            if (Array.isArray(c.nodes)) {
                c.nodes.forEach((/** @type {any} */ n) => {
                    const id = n && n.id;
                    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
                });
            }
            // Node IDs listed directly on factory/network containers
            if (Array.isArray(c.nodeIds)) {
                c.nodeIds.forEach((/** @type {any} */ id) => { if (id && !seen.has(id)) { seen.add(id); out.push(id); } });
            }
            // Recurse into machines and factories
            if (Array.isArray(c.machines)) c.machines.forEach(visit);
            if (Array.isArray(c.factories)) c.factories.forEach(visit);
        };
        visit(container);
        return out;
    }

    $: selectedContainerTokens = (() => {
        if (!selectedContainer) return 0;
        const ids = collectContainerNodeIds(selectedContainer);
        let total = 0;
        ids.forEach(id => {
            const nd = nodeMap.get(id);
            if (nd) total += estimateTokensForNode(nd);
        });
        return total;
    })();
    
    // Text file output modal state
    let showTextFileOutputModal = false;
    let pendingTextFileOutputPosition = { x: 0, y: 0 };
    /** @type {string | null} */
    let textOutputConfigureNodeId = null; // when set, modal is in update mode
    
    // Global context menu state
    let showCanvasContextMenu = false;
    let canvasContextMenuX = 0;
    let canvasContextMenuY = 0;
    /** @type {any[]} */
    let canvasContextMenuItems = [];
    
    // Environment detection
    function isRunningInBrowser() {
        // Running in browser only if Wails runtime is not present
        return typeof window !== 'undefined' && !(/** @type {any} */ (window)).__WAILS_RUNTIME__;
    }
    
    // Browser-specific file operations
    /** @param {any} canvasData */
    async function saveCanvasToBrowser(canvasData) {
        // canvasData is now already a YAML string, not an object
        const dataStr = typeof canvasData === 'string' ? canvasData : JSON.stringify(canvasData, null, 2);
        const timestamp = Date.now();
        let fileName = `ordinal-canvas-${timestamp}`;
        let savedSuccessfully = false;

        // Try to use the modern File System Access API first (Chrome/Edge)
        if ('showSaveFilePicker' in window) {
            try {
                const fileHandle = await (/** @type {any} */ (window)).showSaveFilePicker({
                    suggestedName: `${fileName}.ologic`,
                    types: [
                        {
                            description: 'Ordinal Logic Files',
                            accept: {
                                'text/yaml': ['.ologic', '.yaml', '.yml']
                            }
                        }
                    ]
                });

                const writable = await fileHandle.createWritable();
                await writable.write(dataStr);
                await writable.close();

                // Extract filename from the file handle
                fileName = fileHandle.name.replace(/\.(ologic|yaml|yml)$/, '');
                savedSuccessfully = true;

                console.log('Canvas saved via File System Access API:', fileName);
            } catch (error) {
                const err = /** @type {any} */ (error);
                if (err.name !== 'AbortError') {
                    console.warn('File System Access API failed, falling back to download:', err);
                }
            }
        }
        
        // Fallback to traditional download for older browsers or if user cancelled
        if (!savedSuccessfully) {
            const dataBlob = new Blob([dataStr], { type: 'text/yaml' });
            const url = URL.createObjectURL(dataBlob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `${fileName}.ologic`;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            savedSuccessfully = true;
            console.log('Canvas saved via browser download fallback:', fileName);
        }
        
        // Add to recent canvases if save was successful
        if (savedSuccessfully) {
            addToRecentCanvases(fileName);
            await loadRecentCanvases(); // Refresh the UI
        }
    }
    
    async function loadCanvasFromBrowser() {
        // Try to use the modern File System Access API first (Chrome/Edge)
        if ('showOpenFilePicker' in window) {
            try {
                const [fileHandle] = await (/** @type {any} */ (window)).showOpenFilePicker({
                    types: [
                        {
                            description: 'Ordinal Logic Files',
                            accept: {
                                'text/yaml': ['.ologic', '.yaml', '.yml']
                            }
                        }
                    ]
                });
                
                const file = await fileHandle.getFile();
                const content = await file.text();
                
                console.log('Canvas loaded via File System Access API');
                return { success: true, data: content, path: file.name };
            } catch (error) {
                const err = /** @type {any} */ (error);
                if (err.name !== 'AbortError') {
                    console.warn('File System Access API failed, falling back to input:', err);
                } else {
                    return { success: false, error: 'File selection cancelled' };
                }
            }
        }
        
        // Fallback to traditional file input for older browsers
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.ologic,.yaml,.yml';
            input.style.display = 'none';
            
            /** @param {Event} e */
            input.onchange = (e) => {
                const target = /** @type {HTMLInputElement} */ (e.target);
                const file = target?.files?.[0];
                if (file) {
                    const reader = new FileReader();
                    /** @param {ProgressEvent<FileReader>} event */
                    reader.onload = (event) => {
                        const content = (/** @type {any} */ (event.target)).result;
                        console.log('Canvas loaded via file input fallback');
                        resolve({ success: true, data: content, path: file.name });
                    };
                    reader.readAsText(file);
                } else {
                    resolve({ success: false, error: 'No file selected' });
                }
            };
            
            document.body.appendChild(input);
            input.click();
            document.body.removeChild(input);
        });
    }
    
    // File management state
    let showRecents = false;
    /** @type {any[]} */
    let recentCanvases = [];
    /** @type {string | null} */
    let currentCanvasPath = null;
    /** @type {string | null} */
    let currentCanvasName = null;

    // Project-aware state — set when loaded via ?project=<id> query param
    /** @type {number | null} */
    let projectId = null;
    /** @type {string | null} */
    let projectName = null;
    let isSavingToProject = false;

    // Product-aware state — set when loaded via ?product=<id> query param
    /** @type {number | null} */
    let productId = null;
    /** @type {string | null} */
    let productName = null;
    let isSavingToProduct = false;
    
    // Convert screen coordinates to canvas coordinates
    /** @param {number} screenX @param {number} screenY */
    function screenToCanvas(screenX, screenY) {
        if (!canvasElement) {
            return { x: 0, y: 0 };
        }
        const rect = canvasElement.getBoundingClientRect();
        const x = (screenX - rect.left - $viewport.x) / $viewport.zoom;
        const y = (screenY - rect.top - $viewport.y) / $viewport.zoom;
        return { x, y };
    }
    
    // Global context menu function
    /** @param {number} x @param {number} y @param {any[]} items */
    function showGlobalContextMenu(x, y, items) {
        canvasContextMenuX = x;
        canvasContextMenuY = y;
        canvasContextMenuItems = items;
        showCanvasContextMenu = true;
    }
    
    // Global helpers for context menu actions
    /** @param {string} nodeId */
    function openConfigureTextOutput(nodeId) {
        // Ensure AI modal is closed
        showAIConfigureModal = false;
        aiConfigureNodeId = null;
        textOutputConfigureNodeId = nodeId;
        showTextFileOutputModal = true;
    }

    /** @param {string} nodeId */
    async function openConfigureAI(nodeId) {
        // Ensure Text Output modal is closed
        showTextFileOutputModal = false;
        textOutputConfigureNodeId = null;
        aiConfigureNodeId = nodeId;
        if (!AiConfigureComp) {
            const mod = await import('./AiConfigureModal.svelte');
            AiConfigureComp = mod.default;
        }
        showAIConfigureModal = true;
    }

    // Open node detail panel (called from Node.svelte on double-click)
    /** @param {string} nodeId */
    function showNodeDetail(nodeId) {
        detailPanelNodeId = nodeId;
        showDetailPanel = true;
    }

    function closeDetailPanel() {
        showDetailPanel = false;
        detailPanelNodeId = null;
    }

    // Make context menu function available globally
    if (typeof window !== 'undefined') {
        (/** @type {any} */ (window)).showCanvasContextMenu = showGlobalContextMenu;
        (/** @type {any} */ (window)).showCustomizeForNode = showCustomizeForNode;
        (/** @type {any} */ (window)).showCustomizeForContainer = showCustomizeForContainer;
        // Expose configure handlers for node context menu
        (/** @type {any} */ (window)).showConfigureTextOutput = openConfigureTextOutput;
        (/** @type {any} */ (window)).showConfigureAI = openConfigureAI;
        // Explicit helper to open chat sidebar on demand
        (/** @type {any} */ (window)).openChatSidebar = () => chatActions.open();
        // Node detail panel handler (triggered by double-click on a node)
        (/** @type {any} */ (window)).showNodeDetail = showNodeDetail;
        // Mobile FAB: add a node at the current canvas center
        (/** @type {any} */ (window)).addNodeAtCenter = (/** @type {string} */ nodeType) => {
            if (!canvasElement) return;
            const rect = canvasElement.getBoundingClientRect();
            const canvasCoords = screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
            nodeActions.add(nodeType, canvasCoords.x, canvasCoords.y);
        };
    }

    
    
    // Handle global context menu actions
    /** @param {CustomEvent} event */
    async function handleGlobalContextMenuAction(event) {
        const action = event.detail;
        if (action.handler && typeof action.handler === 'function') {
            await action.handler();
        }
    }
    
    // Customize panel functions
    /** @param {string} nodeId */
    function showCustomizeForNode(nodeId) {
        const nodeData = $nodeDataStore?.get(nodeId);
        customizeEntityType = 'node';
        customizeEntityId = nodeId;
        customizeCurrentColor = nodeData?.getCustomColor?.() || '';
        customizeCurrentLabel = nodeData?.getCustomLabel?.() || '';
        showCustomizePanel = true;
    }
    
    /** @param {any} container */
    function showCustomizeForContainer(container) {
        const containerType = container.isNetwork ? 'network' : container.isFactory ? 'factory' : 'machine';
        const customization = containerActions.getCustomization(container.id);
        
        customizeEntityType = containerType;
        customizeEntityId = container.id;
        customizeCurrentColor = customization.customColor || '';
        customizeCurrentLabel = customization.customLabel || '';
        showCustomizePanel = true;
    }
    
    /** @param {any} data */
    function handleCustomizeSave(data) {
        if (customizeEntityType === 'node') {
            // Get the nodeData from the store
            const nodeData = $nodeDataStore?.get(customizeEntityId);
            if (nodeData) {
                if (data.color) {
                    nodeData.setCustomColor(data.color);
                } else {
                    nodeData.clearCustomColor();
                }
                
                if (data.label) {
                    nodeData.setCustomLabel(data.label);
                } else {
                    nodeData.clearCustomLabel();
                }
                
                // Trigger nodeDataStore update
                nodeDataStore.update(store => {
                    const newStore = new Map(store);
                    newStore.set(customizeEntityId, nodeData);
                    return newStore;
                });
            }
        } else {
            // Handle container customization
            if (data.color) {
                containerActions.setCustomColor(customizeEntityId, data.color);
            } else {
                containerActions.clearCustomColor(customizeEntityId);
            }
            
            if (data.label) {
                containerActions.setCustomLabel(customizeEntityId, data.label);
            } else {
                containerActions.clearCustomLabel(customizeEntityId);
            }
        }
        showCustomizePanel = false;
    }
    
    function handleCustomizeCancel() {
        showCustomizePanel = false;
    }
    
    // Handle text file output modal
    /** @param {CustomEvent} event */
    async function handleTextFileOutputSubmit(event) {
        const { instructions, maxTokens, outputPath, fileHandle, modelOverride, temperature } = event.detail;
        // If we're updating an existing node, apply changes; else create
        if (textOutputConfigureNodeId) {
            const nodeId = textOutputConfigureNodeId;
            // Update existing node data
            nodeDataStore.update(store => {
                const newStore = new Map(store);
                const nodeData = newStore.get(nodeId);
                if (nodeData) {
                    if (instructions) {
                        const basePrompt = nodeData.data.processing.system_prompt || '';
                        nodeData.data.processing.system_prompt = basePrompt.replace(/\n\nADDITIONAL INSTRUCTIONS:[\s\S]*/, '') + (instructions ? ('\n\nADDITIONAL INSTRUCTIONS:\n' + instructions) : '');
                        nodeData.data.processing.user_instructions = instructions;
                    } else {
                        delete nodeData.data.processing.user_instructions;
                    }
                    if (maxTokens) {
                        nodeData.data.processing.parameters.max_tokens = maxTokens;
                        nodeData.data.processing.user_max_tokens = maxTokens;
                    } else {
                        delete nodeData.data.processing.user_max_tokens;
                    }
                    if (outputPath) {
                        nodeData.data.metadata.lastSavedPath = outputPath;
                        nodeData.data.metadata.autoSavePath = outputPath;
                        nodeData.data.filePath = outputPath;
                    }
                    if (modelOverride !== undefined) {
                        if (modelOverride) nodeData.data.processing.model_override = modelOverride;
                        else delete nodeData.data.processing.model_override;
                    }
                    if (temperature !== undefined && temperature !== null && temperature !== '') {
                        nodeData.data.processing.parameters = nodeData.data.processing.parameters || {};
                        nodeData.data.processing.parameters.temperature = Number(temperature);
                    }
                    if (fileHandle) {
                        nodeData.data.metadata.fileHandle = fileHandle;
                    }
                    newStore.set(nodeId, nodeData);
                }
                return newStore;
            });
            showTextFileOutputModal = false;
            textOutputConfigureNodeId = null;
            return;
        }

        // Create the node using nodeActions and extract its id (create mode)
        const createdNode = nodeActions.add('text_file_output', pendingTextFileOutputPosition.x, pendingTextFileOutputPosition.y);
        const nodeId = typeof createdNode === 'string' ? createdNode : createdNode?.id;
        if (!nodeId) {
            console.error('Failed to create text_file_output node or retrieve id');
            return;
        }

        // Update the node data with custom configuration (create mode)
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(nodeId);
            if (nodeData) {
                // Add custom instructions to system prompt if provided, and record for config
                if (instructions) {
                    const basePrompt = nodeData.data.processing.system_prompt;
                    nodeData.data.processing.system_prompt = basePrompt + '\n\nADDITIONAL INSTRUCTIONS:\n' + instructions;
                    nodeData.data.processing.user_instructions = instructions;
                }
                
                // Update max tokens and record for config if provided
                if (maxTokens) {
                    nodeData.data.processing.parameters.max_tokens = maxTokens;
                    nodeData.data.processing.user_max_tokens = maxTokens;
                }
                // Override model and temperature if provided
                if (modelOverride) {
                    nodeData.data.processing.model_override = modelOverride;
                }
                if (temperature !== undefined && temperature !== null && temperature !== '') {
                    nodeData.data.processing.parameters = nodeData.data.processing.parameters || {};
                    nodeData.data.processing.parameters.temperature = Number(temperature);
                }
                
                // Store output path - this will be used for autosaving
                nodeData.data.metadata.lastSavedPath = outputPath;
                nodeData.data.metadata.autoSavePath = outputPath;
                // Also keep a direct filePath for consistent serialization
                nodeData.data.filePath = outputPath;
                
                // If we have a file handle from browser file picker, store it
                if (fileHandle) {
                    nodeData.data.metadata.fileHandle = fileHandle;
                }
                
                newStore.set(nodeId, nodeData);
            }
            return newStore;
        });

        // Persist last used directory for resolving relative paths later
        try {
            const sep = outputPath.includes('\\') ? '\\' : '/';
            const idx = outputPath.lastIndexOf(sep);
            if (idx > 0) {
                const dir = outputPath.slice(0, idx);
                const { settingsActions } = await import('../stores/settings.js');
                settingsActions.update('lastFileDirectory', dir);
            }
        } catch {}

        // If the selected file already exists, load its current contents into the preview
        try {
            const { nodeActions } = await import('../stores/nodes.js');
            await nodeActions.loadOutputPreview(nodeId);
        } catch (e) {
            console.warn('Could not load existing output file into preview:', e);
        }
        
        showTextFileOutputModal = false;
    }
    
    function handleTextFileOutputClose() {
        showTextFileOutputModal = false;
        textOutputConfigureNodeId = null;
    }

    // AI Configure Modal state and handlers
    let showAIConfigureModal = false;
    /** @type {string | null} */
    let aiConfigureNodeId = null;
    function handleAIConfigureClose() { showAIConfigureModal = false; aiConfigureNodeId = null; }
    /** @param {CustomEvent} event */
    async function handleAIConfigureSubmit(event) {
        const { modelOverride, temperature } = event.detail;
        if (!aiConfigureNodeId) return;
        nodeDataStore.update(store => {
            const newStore = new Map(store);
            const nodeData = newStore.get(/** @type {string} */ (aiConfigureNodeId || ''));
            if (nodeData) {
                if (!nodeData.data.processing) nodeData.data.processing = {};
                if (modelOverride) nodeData.data.processing.model_override = modelOverride; else delete nodeData.data.processing.model_override;
                if (temperature !== undefined && temperature !== null) {
                    nodeData.data.processing.parameters = nodeData.data.processing.parameters || {};
                    nodeData.data.processing.parameters.temperature = temperature;
                }
                newStore.set(/** @type {string} */ (aiConfigureNodeId || ''), nodeData);
            }
            return newStore;
        });
        handleAIConfigureClose();
    }

    // Ensure modals are closed on initial mount
    onMount(() => {
        showTextFileOutputModal = false;
        textOutputConfigureNodeId = null;
        showAIConfigureModal = false;
        aiConfigureNodeId = null;
        // Sync ChatSidebar visibility with chatUI store
        _unsubChatUI = chatUI.subscribe((s) => {
            if (s && typeof s.open === 'boolean') {
                showChatSidebar = s.open;
            }
        });
    });

    onDestroy(() => { if (_unsubChatUI) { _unsubChatUI(); _unsubChatUI = null; } });
    
    // Handle mouse wheel for zooming and trackpad pan
    /** @param {WheelEvent} event */
    function handleWheel(event) {
        event.preventDefault();
        
        // Check if this is a trackpad (has deltaX) vs mouse wheel (only deltaY)
        const isTrackpad = Math.abs(event.deltaX) > 0;
        
        if (isTrackpad) {
            // Two-finger trackpad gestures
            const isVertical = Math.abs(event.deltaY) > Math.abs(event.deltaX);
            
            if (isVertical && Math.abs(event.deltaY) > 2) {
                // Two-finger up/down = pan vertically
                viewportActions.pan(0, -event.deltaY);
            } else if (!isVertical && Math.abs(event.deltaX) > 2) {
                // Two-finger left/right = pan horizontally
                viewportActions.pan(-event.deltaX, 0);
            } else if (Math.abs(event.deltaX) > 0 && Math.abs(event.deltaY) > 0) {
                // Both directions = pan both ways
                viewportActions.pan(-event.deltaX, -event.deltaY);
            }
        } else {
            // Regular mouse wheel zoom from viewport center
            if (!canvasElement) return;
            const rect = canvasElement.getBoundingClientRect();
            const viewportCenterX = rect.width / 2;
            const viewportCenterY = rect.height / 2;
            
            const zoomFactor = event.deltaY > 0 ? 0.95 : 1.05;
            viewportActions.zoom(zoomFactor, viewportCenterX, viewportCenterY);
        }
    }
    
    // Handle mouse down for panning or box selection
    /** @param {MouseEvent} event */
    function handleMouseDown(event) {
        if (event.button === 1 || (event.button === 0 && event.shiftKey) || event.button === 2) {
            // Middle mouse, Shift+Left mouse, or Right mouse for panning
            event.preventDefault();
            isDragging = true;
            lastPanPoint = { x: event.clientX, y: event.clientY };
            canvasState.update(s => ({ ...s, mode: 'pan' }));
            
            // Use global listeners for robust panning
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else if (event.button === 0) {
            // Check if clicking on empty space (not a node or connection)
            const target = /** @type {HTMLElement} */ (event.target);
            const clickedOnNode = target?.closest?.('.node-card');
            const clickedOnConnection = target?.closest?.('.connection-group');
            const clickedOnPalette = target?.closest?.('.node-palette');
            const clickedOnSettings = target?.closest?.('.settings-button');
            
            console.log('Mouse down check - clickedOnNode:', !!clickedOnNode, 'clickedOnConnection:', !!clickedOnConnection, 'clickedOnPalette:', !!clickedOnPalette, 'target:', target?.tagName, 'classes:', target?.className);
            
            if (!clickedOnNode && !clickedOnConnection && !clickedOnPalette && !clickedOnSettings) {
                // Left mouse on empty canvas - start box selection
                console.log('Starting box selection on empty space');
                
                // CRUCIAL: Prevent native browser drag behavior
                event.preventDefault();
                
                // IMMEDIATELY set state to prevent node interference
                isBoxSelecting = true;
                hasMovedDuringDrag = false;
                blockNodeInteractions = true;
                
                const canvasCoords = screenToCanvas(event.clientX, event.clientY);
                boxSelectionStart = canvasCoords;
                
                // Set canvas state synchronously
                canvasState.update(s => ({ 
                    ...s, 
                    mode: 'box-selecting',
                    boxSelection: /** @type {any} */ ({
                        x: canvasCoords.x,
                        y: canvasCoords.y,
                        width: 0,
                        height: 0
                    })
                }));
                
                // Use global listeners for robust selection
                window.addEventListener('mousemove', handleMouseMove);
                window.addEventListener('mouseup', handleMouseUp);
            }
        }
    }
    
    // Handle mouse move for panning, connection drawing, and box selection
    /** @param {MouseEvent} event */
    function handleMouseMove(event) {
        mousePosition = { x: event.clientX, y: event.clientY };
        
        if (isDragging && $canvasState.mode === 'pan') {
            const deltaX = event.clientX - lastPanPoint.x;
            const deltaY = event.clientY - lastPanPoint.y;
            
            viewportActions.pan(deltaX, deltaY);
            lastPanPoint = { x: event.clientX, y: event.clientY };
        }
        
        if (isConnecting && tempConnection) {
            const canvasCoords = screenToCanvas(event.clientX, event.clientY);
            tempConnection.endX = canvasCoords.x;
            tempConnection.endY = canvasCoords.y;
            tempConnection = { ...tempConnection }; // Trigger reactivity
        }
        
        if (isBoxSelecting) {
            console.log('Mouse move during box selection - isBoxSelecting:', isBoxSelecting, 'mode:', $canvasState.mode);
            const canvasCoords = screenToCanvas(event.clientX, event.clientY);
            const selection = {
                x: Math.min(boxSelectionStart.x, canvasCoords.x),
                y: Math.min(boxSelectionStart.y, canvasCoords.y),
                width: Math.abs(canvasCoords.x - boxSelectionStart.x),
                height: Math.abs(canvasCoords.y - boxSelectionStart.y)
            };
            
            // Mark as moved if we've dragged more than a few pixels
            if (!hasMovedDuringDrag && (selection.width > 2 || selection.height > 2)) {
                hasMovedDuringDrag = true;
                console.log('Started actual drag movement at:', selection.width, 'x', selection.height);
            }
            
            console.log('Box selection size:', selection.width, 'x', selection.height, 'hasMoved:', hasMovedDuringDrag);
            canvasState.update(s => ({ 
                ...s, 
                boxSelection: /** @type {any} */ (selection),
                mode: 'box-selecting'  // Ensure mode stays consistent
            }));
        }
    }
    
    // Handle mouse up
    /** @param {MouseEvent} event */
    function handleMouseUp(event) {
        const target = /** @type {HTMLElement} */ (event.target);
        console.log('Mouse up - isBoxSelecting:', isBoxSelecting, 'hasMovedDuringDrag:', hasMovedDuringDrag, 'event.target:', target?.tagName);
        
        // Remove global listeners
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        
        isDragging = false;
        
        // Don't cancel connection on mouse up in click mode - let it continue until clicked again
        if (isConnecting && connectionMode === 'drag') {
            // Cancel connection if not dropped on a valid target in drag mode
            cancelConnection();
        }
        
        if (isBoxSelecting) {
            // Finish box selection - find nodes within selection
            const selection = /** @type {any} */ ($canvasState.boxSelection);
            console.log('Finishing box selection:', selection, 'hasMoved:', hasMovedDuringDrag);
            
            if (selection && (selection.width > 5 || selection.height > 5)) {
                const selectedNodeIds = $nodes.filter(node => {
                    const intersects = node.x < selection.x + selection.width &&
                           node.x + node.width > selection.x &&
                           node.y < selection.y + selection.height &&
                           node.y + node.height > selection.y;
                    return intersects;
                }).map(node => node.id);
                
                console.log('Box selected nodes:', selectedNodeIds);
                canvasState.update(s => ({ 
                    ...s, 
                    selectedNodes: /** @type {any} */ (selectedNodeIds),
                    selectedNode: /** @type {any} */ (selectedNodeIds.length === 1 ? selectedNodeIds[0] : null)
                }));
                
                // Only suppress double-click if we actually selected something or moved significantly
                if (hasMovedDuringDrag && selectedNodeIds.length > 0) {
                    suppressNextDoubleClick = true;
                    setTimeout(() => {
                        suppressNextDoubleClick = false;
                    }, 300);
                }
            } else {
                // If box selection was too small, clear selection
                canvasState.update(s => ({ 
                    ...s, 
                    selectedNodes: [],
                    selectedNode: null
                }));
            }
            
            isBoxSelecting = false;
            lastBoxSelectionTime = Date.now();
            hasMovedDuringDrag = false;
            blockNodeInteractions = false;
        }
        
        // Always clear box selection and reset state
        canvasState.update(s => ({ 
            ...s, 
            mode: 'select',
            boxSelection: null
        }));
        
        // Ensure all selection state is properly reset
        if (!isBoxSelecting) {
            hasMovedDuringDrag = false;
        }
    }
    
    // Handle double click to create text node
    /** @param {MouseEvent} event */
    function handleDoubleClick(event) {
        console.log('Double click detected - suppressed:', suppressNextDoubleClick, 'isBoxSelecting:', isBoxSelecting, 'lastBoxSelectionTime:', Date.now() - lastBoxSelectionTime);
        
        if (suppressNextDoubleClick || isBoxSelecting) {
            console.log('Suppressing double-click due to box selection state');
            return;
        }
        
        // Only create node if double-clicking on empty space
        const target = /** @type {HTMLElement} */ (event.target);
        const clickedOnNode = target?.closest?.('.node-card');
        const clickedOnConnection = target?.closest?.('.connection-group');
        const clickedOnPalette = target?.closest?.('.node-palette');
        const clickedOnSettings = target?.closest?.('.settings-button');
        
        if (!clickedOnNode && !clickedOnConnection && !clickedOnPalette && !clickedOnSettings) {
            console.log('Creating new INPUT node via double-click');
            const canvasCoords = screenToCanvas(event.clientX, event.clientY);
            nodeActions.add('input', canvasCoords.x, canvasCoords.y, '');
        }
    }
    
    // Handle drop from node palette or file drops
    /** @param {DragEvent} event */
    function handleDrop(event) {
        const dt = event.dataTransfer;
        console.log('handleDrop called, dataTransfer:', dt ? dt.getData('text/plain') : null, 'isBoxSelecting:', isBoxSelecting);
        
        // Don't handle drops during box selection
        if (isBoxSelecting) {
            console.log('Ignoring drop during box selection');
            return;
        }
        
        event.preventDefault();
        isDraggingFile = false;
        
        const canvasCoords = screenToCanvas(event.clientX, event.clientY);
        
        // Check if files are being dropped
        if (!dt) { event.preventDefault(); isDraggingFile = false; return; }
        if (dt.files && dt.files.length > 0) {
            // In desktop (Wails) mode, rely on OnFileDrop to provide absolute paths
            if (!isRunningInBrowser()) {
                // Prevent default to avoid any unintended handlers, then bail
                event.preventDefault();
                return;
            }
            console.log('Files dropped:', dt.files.length);
            
            // Handle the first file
            const file = dt.files[0];
            
            // Check if it's a text file
            if (file.type.startsWith('text/') || 
                file.name.match(/\.(txt|md|json|yaml|yml|log|csv|js|ts|jsx|tsx|py|java|cpp|c|h|hpp|xml|html|css|scss)$/i)) {
                
                // Read the file content
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const content = /** @type {any} */ (e.target).result;
                    console.log('File content loaded, creating text_file_source node');
                    
                    // Create a text_file_source node manually to bypass the file selection dialog
                    /** @type {any[]} */
                    const currentNodes = get(nodes);
                    const nodeNumber = Math.max(...currentNodes
                        .filter(n => n.id && n.id.startsWith('node-'))
                        .map(n => parseInt(n.id.split('-')[1]))
                        .filter(n => !isNaN(n)), 0) + 1;
                    const id = `node-${nodeNumber}`;
                    
                    // Create the visual node with smaller initial height (collapsed state)
                    const node = {
                        id,
                        type: 'text_file_source',
                        x: canvasCoords.x,
                        y: canvasCoords.y,
                        width: 250,
                        height: 150,  // Smaller height for collapsed state
                        content: content,
                        title: file.name,
                        created: Date.now(),
                        locked: false
                    };
                    
                    // Create the NodeData with file path
                    const nodeData = NodeData.createTextFileSource(id, file.name, file.name);
                    const textContent = typeof content === 'string' ? content : String(content ?? '');
                    nodeData.data.content = textContent;
                    nodeData.data.output.value = textContent;
                    
                    // Update stores (cast store to any to avoid never[] inference)
                    /** @param {any[]} list */
                    const appendNode = (list) => /** @type {any[]} */ ([...list, node]);
                    (/** @type {any} */ (nodes)).update(appendNode);
                    nodeDataStore.update(store => {
                        const newStore = new Map(store);
                        newStore.set(id, nodeData);
                        return newStore;
                    });
                    
                    // Mark as modified (only if method exists on this instance)
                    if (/** @type {any} */ (nodeData).markAsModified) {
                        (/** @type {any} */ (nodeData)).markAsModified();
                    }
                    
                    if (historyActions && !historyActions.isHistoryAction()) {
                        setTimeout(() => historyActions.record('Add text file as source node'), 10);
                    }
                };
                
                reader.onerror = (error) => {
                    console.error('Error reading file:', error);
                };
                
                reader.readAsText(file);
            } else {
                console.warn('Dropped file is not a recognized text file:', file.name);
            }
            return;
        }
        
        // Otherwise, check for node palette drops
        const nodeType = dt.getData('text/plain');
        if (nodeType && nodeType.trim() !== '') {
            console.log('Creating node from palette drop:', nodeType);
            
            // Check if it's a text_file_output node
            if (nodeType === 'text_file_output') {
                // Store position and show modal instead
                pendingTextFileOutputPosition = canvasCoords;
                showTextFileOutputModal = true;
            } else {
                nodeActions.add(nodeType, canvasCoords.x, canvasCoords.y);
            }
        } else {
            console.log('No valid nodeType from drop, ignoring');
        }
    }
    
    /** @param {DragEvent} event */
    function handleDragOver(event) {
        // Only prevent default for actual drag operations from palette, not box selection
        if (!isBoxSelecting) {
            event.preventDefault();
            
            // Check if dragging files
            if (event.dataTransfer && event.dataTransfer.types && event.dataTransfer.types.includes('Files')) {
                isDraggingFile = true;
            }
        }
    }
    
    /** @param {DragEvent} event */
    function handleDragLeave(event) {
        // Only clear file drag state if leaving the canvas element
        if (event.target === canvasElement) {
            isDraggingFile = false;
        }
    }

    // Token counter panel markup is appended near the end of the template
    
    // Touch support for mobile/trackpad
    let touchStartDistance = 0;
    let lastTouchCenter = { x: 0, y: 0 };
    
    /** @param {TouchEvent} event */
    function handleTouchStart(event) {
        console.log('Touch start, fingers:', event.touches.length);
        if (event.touches.length === 2) {
            // Two finger pan/zoom
            event.preventDefault();
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];
            
            touchStartDistance = Math.sqrt(
                Math.pow(touch2.clientX - touch1.clientX, 2) + 
                Math.pow(touch2.clientY - touch1.clientY, 2)
            );
            
            lastTouchCenter = {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2
            };
        }
    }
    
    /** @param {TouchEvent} event */
    function handleTouchMove(event) {
        console.log('Touch move, fingers:', event.touches.length);
        if (event.touches.length === 2) {
            event.preventDefault();
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];
            
            const currentDistance = Math.sqrt(
                Math.pow(touch2.clientX - touch1.clientX, 2) + 
                Math.pow(touch2.clientY - touch1.clientY, 2)
            );
            
            const currentCenter = {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2
            };
            
            // Pan - only if we have a previous center
            if (lastTouchCenter.x !== 0 || lastTouchCenter.y !== 0) {
                const panDeltaX = currentCenter.x - lastTouchCenter.x;
                const panDeltaY = currentCenter.y - lastTouchCenter.y;
                
                // Add some sensitivity multiplier for trackpad
                const sensitivity = 1.5;
                viewportActions.pan(panDeltaX * sensitivity, panDeltaY * sensitivity);
            }
            
            // Zoom - only if distance changed significantly
            if (touchStartDistance > 0) {
                const distanceChange = Math.abs(currentDistance - touchStartDistance);
                if (distanceChange > 5) { // Minimum threshold to prevent jitter
                    const zoomFactor = currentDistance / touchStartDistance;
                    // Clamp zoom factor to prevent extreme zooming
                    const clampedZoomFactor = Math.max(0.8, Math.min(1.2, zoomFactor));
                    viewportActions.zoom(clampedZoomFactor, currentCenter.x, currentCenter.y);
                    touchStartDistance = currentDistance;
                }
            }
            
            lastTouchCenter = currentCenter;
        }
    }
    
    /** @param {TouchEvent} event */
    function handleTouchEnd(event) {
        if (event.touches.length < 2) {
            touchStartDistance = 0;
            lastTouchCenter = { x: 0, y: 0 };
        }
    }
    
    // Connection handling functions
    /** @param {string} fromNodeId @param {string} fromPort @param {MouseEvent | null} [event=null] */
    function startConnection(fromNodeId, fromPort, event = null) {
        // Check if it's a node or a machine
        const fromNode = $nodes.find(n => n.id === fromNodeId);
        const fromMachine = $workflowContainers.find(c => c.id === fromNodeId);
        
        if (!fromNode && !fromMachine) return;
        
        // If already connecting and clicking the same port, cancel
        if (isConnecting && tempConnection && tempConnection.fromNodeId === fromNodeId && tempConnection.fromPort === fromPort) {
            cancelConnection();
            return;
        }
        
        // If already connecting, complete with this as target if it's an input
        if (isConnecting && fromPort === 'input') {
            completeConnection(fromNodeId, fromPort);
            return;
        }
        
        // Cancel any existing connection
        if (isConnecting) {
            cancelConnection();
        }
        
        isConnecting = true;
        let portX, portY;
        
        if (fromNode) {
            // Regular node connection
            portX = fromPort === 'output' ? fromNode.x + fromNode.width : fromNode.x;
            portY = fromNode.y + fromNode.height / 2;
        } else if (fromMachine) {
            // Machine connection - only from output port
            portX = fromMachine.bounds.x + fromMachine.bounds.width;
            portY = fromMachine.bounds.y + fromMachine.bounds.height / 2;
        }
        
        tempConnection = {
            fromNodeId,
            fromPort,
            startX: portX,
            startY: portY,
            endX: portX,
            endY: portY,
            isFromMachine: !!fromMachine
        };
        
        // Set initial end position to mouse if available
        if (event) {
            const canvasCoords = screenToCanvas(event.clientX, event.clientY);
            tempConnection.endX = canvasCoords.x;
            tempConnection.endY = canvasCoords.y;
        }
        
        canvasState.update(s => ({ ...s, mode: 'connecting' }));
    }
    
    /** @param {string} toNodeId @param {string} toPort */
    async function completeConnection(toNodeId, toPort) {
        if (!isConnecting || !tempConnection) return;
        
        // Capture connection data immediately to prevent it from being nulled
        const connectionData = {
            fromNodeId: tempConnection.fromNodeId,
            fromPort: tempConnection.fromPort,
            isFromMachine: tempConnection.isFromMachine
        };
        
        // Don't connect to same node/machine
        if (connectionData.fromNodeId === toNodeId) {
            cancelConnection();
            return;
        }
        
        // Only allow output-to-input connections
        if (connectionData.fromPort === 'input' || toPort === 'output') {
            console.log('Can only connect from output to input');
            cancelConnection();
            return;
        }
        
        // Only allow machine-to-node connections (not machine-to-machine)
        const toNode = $nodes.find(n => n.id === toNodeId);
        const toMachine = $workflowContainers.find(c => c.id === toNodeId);

        // Inputless nodes and file-source nodes cannot receive inputs
        if (toNode) {
            const toNodeData = $nodeDataStore?.get(toNodeId);
            const isTargetInputless = isInputless(toNode.type);
            const isTargetFileSource = toNodeData?.data?.metadata?.meta_type === 'file_source';
            if (isTargetInputless || isTargetFileSource) {
                console.log('Inputless/source nodes cannot receive input connections');
                cancelConnection();
                return;
            }
        }

        if (connectionData.isFromMachine && toMachine) {
            console.log('Machine-to-machine connections not allowed');
            cancelConnection();
            return;
        }
        
        if (connectionData.isFromMachine && toNode && toPort !== 'input') {
            console.log('Machine can only connect to node input ports');
            cancelConnection();
            return;
        }
        
        // Create the connection using captured data (with ontology preflight)
        try {
            if (connectionActions && typeof connectionActions.add === 'function') {
                const monitor = OntologyMonitor.wouldBreakOntology(
                    connectionData.fromNodeId,
                    toNodeId,
                    /** @type {any[]} */ ($connections || []),
                    /** @type {any[]} */ ($workflowContainers || [])
                );
                if (monitor.violates) {
                    const pfId = monitor.parentId ? monitor.parentId : 'parent container';
                    const msg = `Ontology violation prevented:\n\n` +
                        `- You attempted to connect ${connectionData.fromNodeId} -> ${toNodeId}.\n` +
                        (monitor.reason ? `- ${monitor.reason}.\n` : `- ${pfId} already connects to ${toNodeId}.\n`) +
                        `\nThis breaks the ontology (ancestor and descendant connecting to the same external node).\n` +
                        `Connect at the ancestor container level instead, or remove the ancestor-level edge.\n\n` +
                        `Context is already being propagated on this branch; duplicate child-level connections are not allowed to avoid double-propagation and to keep a single source of truth.`;
                    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                        window.alert(msg);
                    } else {
                        console.warn(msg);
                    }
                    // Reset mouse/drag state for the aborted connection
                    try { cancelConnection(); } catch {}
                    // Abort creation
                    return;
                }
                
                connectionActions.add(connectionData.fromNodeId, toNodeId, connectionData.fromPort, toPort);
                console.log('✅ Connection created:', connectionData.fromNodeId, '->', toNodeId);
            } else {
                console.error('❌ connectionActions is not available:', typeof connectionActions);
            }
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            console.error('❌ Failed to create connection:', msg);
        }
        
        cancelConnection();
    }
    
    function cancelConnection() {
        isConnecting = false;
        tempConnection = null;
        canvasState.update(s => ({ ...s, mode: 'select' }));
    }
    
    // Handle global keyboard events
    let pasteInProgress = false;
    
    async function handlePaste() {
        if (pasteInProgress) {
            console.log('⏸️ Paste already in progress, ignoring duplicate');
            return;
        }
        
        pasteInProgress = true;
        
        try {
            console.log('🍀 Pasting config from clipboard...');
            console.log('📍 Current viewport:', $viewport);
            
            // Start macro recording for paste operation
            await historyActions.startMacro('Paste from Clipboard');
            
            // Get current mouse position or center of viewport for placement
            const centerX = 800 / 2 - ($viewport.x || 0);
            const centerY = 600 / 2 - ($viewport.y || 0);
            
            console.log('📍 Paste offset calculated:', { centerX, centerY });
            
            const result = await (/** @type {any} */ (pasteAndCreateConfigUniversal))(centerX, centerY);
            
            if (result.success) {
                console.log('✅ Successfully pasted and created:', result.createdNodes.length, 'nodes');
                // Small delay to ensure all async operations complete before ending macro
                await new Promise(resolve => setTimeout(resolve, 150));
                // End macro recording
                await historyActions.endMacro();
                // The workflow containers will be detected automatically by the reactive system
            } else {
                console.warn('⚠️ Failed to paste config:', result.error);
                // End macro recording even on failure
                await historyActions.endMacro();
            }
        } catch (error) {
            console.error('❌ Error during paste operation:', error);
            // End macro recording even on error
            await historyActions.endMacro();
        } finally {
            pasteInProgress = false;
        }
    }

    /** @param {KeyboardEvent} event */
    function handleKeyDown(event) {
        const target = /** @type {HTMLElement} */ (event.target);
        const isTextInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (/** @type {any} */ (target)).isContentEditable);

        // If typing in an input, don't trigger global shortcuts for deletion
        if (isTextInput && (event.key === 'Delete' || event.key === 'Backspace')) {
            return;
        }

        // console.log('Key pressed:', event.key, 'Selected connection:', $canvasState.selectedConnection, 'Selected node:', $canvasState.selectedNode, 'Selected nodes:', $canvasState.selectedNodes);
        
        // Paste shortcut
        if ((event.ctrlKey || event.metaKey) && event.key === 'v' && !isTextInput) {
            event.preventDefault();
            handlePaste();
            return;
        }
        
        // Undo/Redo shortcuts
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'z' && !isTextInput) {
            event.preventDefault();
            console.log('↩️ Undo triggered');
            historyActions.undo();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.shiftKey && event.key === 'z')) && !isTextInput) {
            event.preventDefault();
            console.log('↪️ Redo triggered');
            historyActions.redo();
            return;
        }
        
        // Arrow key navigation
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && !isTextInput) {
            event.preventDefault();
            
            // Calculate movement distance based on shift key and zoom level
            const baseDistance = event.shiftKey ? 100 : 25; // Faster movement with shift
            const zoomAdjustedDistance = baseDistance / $viewport.zoom; // Adjust for zoom level
            
            let deltaX = 0;
            let deltaY = 0;
            
            switch (event.key) {
                case 'ArrowUp':
                    deltaY = zoomAdjustedDistance;
                    break;
                case 'ArrowDown':
                    deltaY = -zoomAdjustedDistance;
                    break;
                case 'ArrowLeft':
                    deltaX = zoomAdjustedDistance;
                    break;
                case 'ArrowRight':
                    deltaX = -zoomAdjustedDistance;
                    break;
            }
            
            // Pan the viewport
            viewportActions.pan(deltaX, deltaY);
            return;
        }
        
        // Zoom shortcuts
        if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+')) {
            event.preventDefault();
            if (!canvasElement) return;
            const rect = canvasElement.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            viewportActions.zoom(1.2, centerX, centerY);
        } else if ((event.ctrlKey || event.metaKey) && event.key === '-') {
            event.preventDefault();
            // Check if shift is also held for fit-to-screen
            if (event.shiftKey) {
                // Ctrl+Shift+- : Fit all nodes to screen
                if (!canvasElement) return;
                const rect = canvasElement.getBoundingClientRect();
                viewportActions.fitToScreen($nodes, rect.width, rect.height);
            } else {
                // Regular Ctrl+- : Zoom out
                if (!canvasElement) return;
                const rect = canvasElement.getBoundingClientRect();
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                viewportActions.zoom(0.8, centerX, centerY);
            }
        } else if ((event.ctrlKey || event.metaKey) && event.key === '0') {
            event.preventDefault();
            // Ctrl+0 : Reset zoom to 100%
            viewportActions.reset();
        }
        
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if ($canvasState.selectedConnection) {
                console.log('Deleting connection:', $canvasState.selectedConnection);
                connectionActions.delete($canvasState.selectedConnection);
                canvasState.update(s => ({ ...s, selectedConnection: null }));
                event.preventDefault();
            } else if ($canvasState.selectedNodes && $canvasState.selectedNodes.length > 0) {
                console.log('Deleting multiple nodes:', $canvasState.selectedNodes);
                // Delete all selected nodes
                $canvasState.selectedNodes.forEach(nodeId => {
                    nodeActions.delete(nodeId);
                });
                canvasState.update(s => ({ ...s, selectedNodes: [], selectedNode: null }));
                event.preventDefault();
            } else if ($canvasState.selectedNode) {
                console.log('Deleting node:', $canvasState.selectedNode);
                nodeActions.delete($canvasState.selectedNode);
                canvasState.update(s => ({ ...s, selectedNode: null }));
                event.preventDefault();
            }
        }
        if (event.key === 'Escape') {
            if (showDetailPanel) {
                closeDetailPanel();
            } else if (isConnecting) {
                cancelConnection();
            } else {
                canvasState.update(s => ({
                    ...s,
                    selectedNode: null,
                    selectedConnection: null,
                    selectedNodes: []
                }));
            }
        }
    }
    
    // Clear selection when clicking canvas (but not after box selection)
    /** @param {MouseEvent} event */
    function handleCanvasContextMenu(event) {
        event.preventDefault();

        if (!canvasElement) return;
        const canvasRect = canvasElement.getBoundingClientRect();
        const contextMenuItems = [
            {
                label: 'Organize',
                icon: '🎨',
                handler: async () => {
                    console.log('🎨 Triggering global canvas organize...');
                    await workflowActions.organizeCanvas();
                }
            },
            {
                label: 'Paste Config',
                icon: '📥',
                handler: handlePaste
            }
        ];

        showGlobalContextMenu(
            event.clientX - canvasRect.left,
            event.clientY - canvasRect.top,
            contextMenuItems
        );
    }

    /** @param {MouseEvent} event */
    /** @param {MouseEvent} event */
    function handleCanvasClick(event) {
        // Focus canvas for keyboard events
        if (event.currentTarget) {
            /** @type {HTMLElement} */ (event.currentTarget).focus();
        }
        
        // If connecting in click mode and clicking empty space, cancel connection
        if (isConnecting) {
            const t = /** @type {HTMLElement} */ (event.target);
            const clickedOnNode = t?.closest?.('.node-card');
            const clickedOnConnection = t?.closest?.('.connection-group');
            if (!clickedOnNode && !clickedOnConnection) {
                cancelConnection();
                return;
            }
        }
        
        // Only clear selection if this wasn't a box selection and we're not clicking on nodes
        const target2 = /** @type {HTMLElement} */ (event.target);
        const clickedOnNode = target2?.closest?.('.node-card');
        const clickedOnConnection = target2?.closest?.('.connection-group');
        const clickedOnPalette = target2?.closest?.('.node-palette');
        const clickedOnSettings = target2?.closest?.('.settings-button');
        
        if (!isBoxSelecting && !clickedOnNode && !clickedOnConnection && !clickedOnPalette && !clickedOnSettings && Date.now() - lastBoxSelectionTime > 100) {
            canvasState.update(s => ({ 
                ...s, 
                selectedNode: null, 
                selectedConnection: null,
                selectedNodes: [],
                selectedContainer: null,
                boxSelection: null  // Also clear any stuck box selection
            }));
        }
    }
    
    // File management functions
    async function saveCanvas() {
        if (currentCanvasPath) {
            // We have a current file, just save to it
            await saveToCurrentFile();
        } else {
            // No current file, show save dialog
            await saveAsCanvas();
        }
    }
    
    async function saveAsCanvas() {
        try {
            // Generate YAML configuration for the entire canvas
            console.log('🔧 Generating canvas YAML configuration for save...');
            const configResult = await generateCanvasConfig();
            
            if (!configResult.success) {
                throw new Error(configResult.error || 'Failed to generate canvas configuration');
            }
            
            console.log('📋 Generated YAML config:', (/** @type {any} */ (configResult)).config);
            const canvasData = (/** @type {any} */ (configResult)).config; // This is now a YAML string
            
            console.log('Saving canvas data:', canvasData);
            
            // Check environment and use appropriate save method
            if (isRunningInBrowser()) {
                console.log('Running in browser - using browser file dialog');
                await saveCanvasToBrowser(canvasData);
                return;
            }
            
            // Check if Wails runtime is available for desktop app
            if (!((/** @type {any} */ (window)).main && (/** @type {any} */ (window)).main.App)) {
                console.warn('Desktop mode but Wails runtime not available - falling back to browser download');
                await saveCanvasToBrowser(canvasData);
                return;
            }
            
            // Call backend save function (now saving YAML directly)
            const result = await (/** @type {any} */ (window)).main.App.SaveCanvas(canvasData);
            if (result.success) {
                currentCanvasPath = result.path;
                currentCanvasName = result.path.split('/').pop().replace(/\.(ologic|yaml|yml)$/, '');
                console.log('💾 Canvas saved successfully to:', result.path);
                console.log('🔄 Refreshing recent canvases after save...');
                await loadRecentCanvases();
            } else {
                throw new Error(result.error || 'Failed to save canvas');
            }
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            console.error('Failed to save canvas:', msg);
            alert('Failed to save canvas: ' + msg);
        }
    }
    
    async function saveToCurrentFile() {
        try {
            // Generate YAML configuration for the entire canvas
            console.log('🔧 Generating canvas YAML configuration for save to current file...');
            const configResult = await generateCanvasConfig();
            
            if (!configResult.success) {
                throw new Error(configResult.error || 'Failed to generate canvas configuration');
            }
            
            console.log('📋 Generated YAML config for current file:', (/** @type {any} */ (configResult)).config);
            const canvasData = (/** @type {any} */ (configResult)).config; // This is now a YAML string
            
            console.log('Saving to current file:', currentCanvasPath);
            
            // Check environment and use appropriate save method
            if (isRunningInBrowser()) {
                console.log('Running in browser - current file save not supported, using save-as');
                await saveCanvasToBrowser(canvasData);
                return;
            }
            
            // Check if Wails runtime is available for desktop app
            if (!((/** @type {any} */ (window)).main && (/** @type {any} */ (window)).main.App)) {
                console.warn('Desktop mode but Wails runtime not available - using save-as fallback');
                await saveAsCanvas();
                return;
            }
            
            // Use SaveCanvas function (it should handle current file path, now saving YAML directly)
            const result = await (/** @type {any} */ (window)).main.App.SaveCanvas(canvasData);
            if (result.success) {
                console.log('Canvas saved successfully to current file:', currentCanvasPath);
            } else {
                throw new Error(result.error || 'Failed to save to current file');
            }
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            console.error('Failed to save to current file:', msg);
            // Fallback to save-as
            await saveAsCanvas();
        }
    }
    
    async function newCanvas() {
        if ($nodes.length > 0 || $connections.length > 0) {
            if (!confirm('Create new canvas? All unsaved changes will be lost.')) {
                return;
            }
        }
        
        // Clear canvas state and reset all ID counters
        nodes.set([]);
        connections.set([]);
        // workflowContainers is a derived store - it will automatically update when nodes/connections change
        
        // Reset container counters and clear label/color cache
        const { resetContainerCounters, containerCustomizations } = await import('../stores/workflows.js');
        resetContainerCounters();
        containerCustomizations.set(new Map());
        
        // Start new history session for the new canvas
        historyActions.startNewSession();
        
        viewportActions.reset();
        currentCanvasPath = null;
        currentCanvasName = null;
        
        // Reset canvas state
        canvasState.update(s => ({
            ...s,
            selectedNode: null,
            selectedConnection: null,
            selectedNodes: [],
            mode: 'select'
        }));
        
        console.log('New canvas created');
    }
    
    async function loadCanvas() {
        try {
            console.log('Loading canvas...');
            
            // Check environment and use appropriate load method
            if (isRunningInBrowser()) {
                console.log('Running in browser - using browser file picker');
                const result = await loadCanvasFromBrowser();
                
                if (result.success && result.data) {
                    console.log('🔧 Loading canvas from browser using YAML paste system...');
                    
                    // Clear existing canvas first
                    await newCanvas();
                    
                    // Start new history session for loaded canvas
                    historyActions.startNewSession();
                    
                    // Parse as YAML and paste it
                    const pasteResult = await pasteAndCreateConfigUniversal(null, null, result.data);
                    if (pasteResult.success) {
                        console.log('✅ Successfully loaded canvas from YAML configuration');
                        
                        // Re-hydrate artifact nodes
                        await rehydrateArtifactNodes();
                        
                        // Update current file info (just filename for browser)
                        currentCanvasPath = null; // Can't track full paths in browser
                        currentCanvasName = result.path.split('.')[0];
                    } else {
                        throw new Error(pasteResult.error || 'Failed to load canvas configuration');
                    }
                    
                    // Add to recent canvases
                    addToRecentCanvases(currentCanvasName || 'Canvas', result.path);
                    await loadRecentCanvases(); // Refresh the UI
                    
                    console.log('Canvas loaded successfully from browser file:', currentCanvasName);
                } else {
                    console.error('Failed to load canvas:', result.error);
                    alert('Failed to load canvas: ' + (result.error || 'Unknown error'));
                }
                return;
            }
            
            // Check if Wails runtime is available for desktop app
            const w = /** @type {any} */ (window);
            if (!w.main || !w.main.App || !w.main.App.LoadCanvas) {
                console.warn('Desktop mode but Wails runtime not available');
                alert('Load functionality requires the desktop app. Please run the Wails application.');
                return;
            }
            
            // Call backend load function
            const result = await (/** @type {any} */ (window)).main.App.LoadCanvas();
            if (result.success && result.data) {
                console.log('🔧 Loading canvas from desktop using YAML paste system...');
                
                // Clear existing canvas first
                await newCanvas();
                
                // Start new history session for loaded canvas
                historyActions.startNewSession();
                
                // Parse as YAML and paste it
                const pasteResult = await pasteAndCreateConfigUniversal(null, null, result.data);
                if (pasteResult.success) {
                    console.log('✅ Successfully loaded canvas from YAML configuration');
                    
                    // Re-hydrate artifact nodes
                    await rehydrateArtifactNodes();
                    
                    currentCanvasPath = result.path;
                    currentCanvasName = result.path.split('/').pop().replace(/\.(yaml|yml)$/, '');
                } else {
                    throw new Error(pasteResult.error || 'Failed to load canvas configuration');
                }
                console.log('📂 Canvas loaded successfully from:', result.path);
                console.log('🔄 Refreshing recent canvases after load...');
                await loadRecentCanvases();
            } else {
                throw new Error(result.error || 'Failed to load canvas');
            }
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            console.error('Failed to load canvas:', msg);
            alert('Failed to load canvas: ' + msg);
        }
    }
    
    /** @param {{name:string, path:string}} recent */
    async function loadRecentCanvas(recent) {
        try {
            console.log('Loading recent canvas:', recent);
            showRecents = false;
            
            // Browser mode: trigger file picker (same as Load Canvas button)
            if (isRunningInBrowser()) {
                console.log('🌐 Browser mode: Opening file picker for recent canvas:', recent.name);
                await loadCanvas(); // This will trigger the browser file picker
                return;
            }
            
            // Check if Wails runtime is available
            const w = /** @type {any} */ (window);
            if (!w.main || !w.main.App || !w.main.App.LoadCanvasFromPath) {
                console.warn('Wails runtime not available');
                return;
            }
            
            // Call backend to load specific file
            const result = await (/** @type {any} */ (window)).main.App.LoadCanvasFromPath(recent.path);
            if (result.success && result.data) {
                console.log('🔧 Loading recent canvas using YAML paste system...');
                
                // Clear existing canvas first
                await newCanvas();
                
                // Start new history session for loaded canvas
                historyActions.startNewSession();
                
                // Parse as YAML and paste it
                const pasteResult = await pasteAndCreateConfigUniversal(null, null, result.data);
                if (pasteResult.success) {
                    console.log('✅ Successfully loaded recent canvas from YAML configuration');
                    
                    // Re-hydrate artifact nodes
                    await rehydrateArtifactNodes();
                    
                    currentCanvasPath = recent.path;
                } else {
                    throw new Error(pasteResult.error || 'Failed to load canvas configuration');
                }
                
                await loadRecentCanvases();
                
                console.log('Recent canvas loaded successfully');
            } else {
                throw new Error(result.error || 'Failed to load recent canvas');
            }
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            console.error('Failed to load recent canvas:', msg);
            alert('Failed to load recent canvas: ' + msg);
        }
    }
    
    // Add a canvas to recent canvases (browser mode)
    /** @param {string} canvasName @param {string | null} [filePath=null] */
    function addToRecentCanvases(canvasName, filePath = null) {
        if (!isRunningInBrowser()) return; // Desktop mode handles this via backend
        
        try {
            console.log('📋 Adding to recent canvases:', canvasName);
            
            const newRecent = {
                name: canvasName,
                path: filePath || `browser://${canvasName}`,
                lastModified: new Date().toISOString(),
                source: 'browser'
            };
            
            // Load existing recents
            const stored = localStorage.getItem('ordinal-recent-canvases');
            let recents = stored ? JSON.parse(stored) : [];
            
            // Remove duplicates (same name/path)
            recents = recents.filter((/** @type {any} */ r) => r.name !== canvasName && r.path !== newRecent.path);
            
            // Add new recent at the beginning
            recents.unshift(newRecent);
            
            // Limit to 10 most recent
            recents = recents.slice(0, 10);
            
            // Save back to localStorage
            localStorage.setItem('ordinal-recent-canvases', JSON.stringify(recents));
            console.log('✅ Recent canvas added successfully');
            
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            console.error('Failed to add recent canvas:', msg);
        }
    }
    
    async function loadRecentCanvases() {
        try {
            if (isRunningInBrowser()) {
                console.log('🌐 Browser mode: Loading recent canvases from localStorage');
                const stored = localStorage.getItem('ordinal-recent-canvases');
                if (stored) {
                    recentCanvases = JSON.parse(stored);
                    console.log('✅ Recent canvases loaded from browser storage:', recentCanvases.length, 'items');
                } else {
                    recentCanvases = [];
                    console.log('📋 No recent canvases found in browser storage');
                }
                return;
            }
            
            const w = /** @type {any} */ (window);
            if (!w.main || !w.main.App || !w.main.App.GetRecentCanvases) {
                console.log('⚠️ Wails API not available for recent canvases');
                recentCanvases = [];
                return;
            }
            
            console.log('📋 Fetching recent canvases from desktop app...');
            const result = await (/** @type {any} */ (window)).main.App.GetRecentCanvases();
            console.log('📋 GetRecentCanvases result:', result);
            
            if (result.success) {
                recentCanvases = result.recents || [];
                console.log('✅ Recent canvases loaded:', recentCanvases.length, 'items');
                console.log('📄 Recent canvas details:', recentCanvases);
            } else {
                console.warn('❌ GetRecentCanvases failed:', (result && result.error) || 'Unknown error');
                recentCanvases = [];
            }
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            console.error('Failed to load recent canvases:', msg);
            recentCanvases = [];
        }
    }
    
    function toggleRecents() {
        if (!showRecents) {
            loadRecentCanvases();
        }
        showRecents = !showRecents;
    }
    
    // Fix recents dropdown functionality
    /** @param {{name:string, path:string}} recent */
    async function handleRecentClick(recent) {
        try {
            console.log('Loading recent canvas:', recent);
            showRecents = false;
            
            // Browser mode: trigger file picker (same as Load Canvas button)
            if (isRunningInBrowser()) {
                console.log('🌐 Browser mode: Opening file picker for recent canvas:', recent.name);
                await loadCanvas(); // This will trigger the browser file picker
                return;
            }
            
            // Check if Wails runtime is available
            const w2 = /** @type {any} */ (window);
            if (!w2.main || !w2.main.App || !w2.main.App.LoadCanvasFromPath) {
                console.warn('Wails runtime not available');
                return;
            }
            
            // Call backend to load specific file
            const result = await (/** @type {any} */ (window)).main.App.LoadCanvasFromPath(recent.path);
            if (result.success && result.data) {
                console.log('🔧 Loading recent canvas using YAML paste system...');
                
                // Clear existing canvas first
                await newCanvas();
                
                // Start new history session for loaded canvas
                historyActions.startNewSession();
                
                // Parse as YAML and paste it
                const pasteResult = await pasteAndCreateConfigUniversal(null, null, result.data);
                if (pasteResult.success) {
                    console.log('✅ Successfully loaded recent canvas from YAML configuration');
                    
                    // Re-hydrate artifact nodes
                    await rehydrateArtifactNodes();
                    
                    currentCanvasPath = result.path;
                    currentCanvasName = result.path.split('/').pop().replace(/\.(yaml|yml)$/, '');
                } else {
                    throw new Error(pasteResult.error || 'Failed to load canvas configuration');
                }
                
                await loadRecentCanvases();
                
                console.log('Recent canvas loaded successfully:', result.path);
            } else {
                throw new Error(result.error || 'Failed to load recent canvas');
            }
        } catch (error) {
            const msg = (/** @type {any} */ (error))?.message || String(error);
            console.error('Failed to load recent canvas:', msg);
            alert('Failed to load recent canvas: ' + msg);
        }
    }
    
    /** @param {number|string} timestamp */
    function formatDate(timestamp) {
        const date = new Date(Number(timestamp));
        const now = new Date();
        const diffMs = Number(now) - Number(date);
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
    
    // Load a project's diagram from the Rhode API
    async function loadProjectDiagram(pid) {
        try {
            const resp = await fetch(`/ordinal/api/projects/${pid}`);
            if (!resp.ok) throw new Error(`GET /ordinal/api/projects/${pid} returned ${resp.status}`);
            const data = await resp.json();
            projectName = data.name || `Project ${pid}`;

            // ologic_model is stored as raw YAML string directly on the response
            let ologicYaml = null;
            const rawModel = data.ologic_model;
            if (typeof rawModel === 'string' && rawModel.trim()) {
                ologicYaml = rawModel;
            }

            if (ologicYaml) {
                console.log(`📐 Loading diagram from project ${pid} (${projectName})`);
                // Full canvas reset before loading new diagram
                nodes.set([]);
                connections.set([]);
                const { resetContainerCounters: rc1, containerCustomizations: cc1 } = await import('../stores/workflows.js');
                rc1();
                cc1.set(new Map());
                const pasteResult = await pasteAndCreateConfigUniversal(null, null, ologicYaml);
                if (pasteResult.success) {
                    console.log(`✅ Project diagram loaded for project ${pid}`);
                    // Allow Svelte to render nodes and set their diagramming-mode
                    // dimensions (width/height) before organizing
                    await new Promise(resolve => setTimeout(resolve, 150));
                    console.log('🎨 Organizing project diagram layout...');
                    await workflowActions.organizeCanvas();
                    // Fit viewport to show the organized diagram
                    await new Promise(resolve => setTimeout(resolve, 100));
                    if (canvasElement) {
                        const rect = canvasElement.getBoundingClientRect();
                        viewportActions.fitToScreen(get(nodes), rect.width, rect.height);
                        console.log('📐 Viewport fitted to loaded project diagram');
                    }
                } else {
                    console.warn('Diagram paste failed:', pasteResult.error);
                }
            } else {
                console.log(`ℹ️ Project ${pid} has no diagram yet`);
            }
        } catch (err) {
            console.error('Failed to load project diagram:', err);
        }
    }

    // Save current canvas YAML back to the project
    async function saveToProject() {
        if (!projectId) return;
        isSavingToProject = true;
        try {
            const canvasData = generateCanvasConfig();
            const resp = await fetch(`/ordinal/api/projects/${projectId}/diagram`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml: canvasData })
            });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`PUT /ordinal/api/projects/${projectId}/diagram returned ${resp.status}: ${text}`);
            }
            console.log(`✅ Diagram saved to project ${projectId}`);
        } catch (err) {
            const msg = (/** @type {any} */ (err))?.message || String(err);
            console.error('Failed to save diagram to project:', msg);
            alert('Failed to save to project: ' + msg);
        } finally {
            isSavingToProject = false;
        }
    }

    // Load a product's diagram from the Rhode API
    async function loadProductDiagram(pid) {
        try {
            const resp = await fetch(`/ordinal/api/products/${pid}`);
            if (!resp.ok) throw new Error(`GET /ordinal/api/products/${pid} returned ${resp.status}`);
            const data = await resp.json();
            productName = data.name || `Product ${pid}`;

            // ologic_model is stored as raw YAML string directly on the response
            let ologicYaml = null;
            const rawModel = data.ologic_model;
            if (typeof rawModel === 'string' && rawModel.trim()) {
                ologicYaml = rawModel;
            }

            if (ologicYaml) {
                console.log(`📐 Loading diagram from product ${pid} (${productName})`);
                // Full canvas reset before loading new diagram
                nodes.set([]);
                connections.set([]);
                const { resetContainerCounters: rc2, containerCustomizations: cc2 } = await import('../stores/workflows.js');
                rc2();
                cc2.set(new Map());
                const pasteResult = await pasteAndCreateConfigUniversal(null, null, ologicYaml);
                if (pasteResult.success) {
                    console.log(`✅ Product diagram loaded for product ${pid}`);
                    // Allow Svelte to render nodes and set their diagramming-mode
                    // dimensions (width/height) before organizing
                    await new Promise(resolve => setTimeout(resolve, 150));
                    console.log('🎨 Organizing product diagram layout...');
                    await workflowActions.organizeCanvas();
                    // Fit viewport to show the organized diagram
                    await new Promise(resolve => setTimeout(resolve, 100));
                    if (canvasElement) {
                        const rect = canvasElement.getBoundingClientRect();
                        viewportActions.fitToScreen(get(nodes), rect.width, rect.height);
                        console.log('📐 Viewport fitted to loaded product diagram');
                    }
                } else {
                    console.warn('Diagram paste failed:', pasteResult.error);
                }
            } else {
                console.log(`ℹ️ Product ${pid} has no diagram yet`);
            }
        } catch (err) {
            console.error('Failed to load product diagram:', err);
        }
    }

    // Save current canvas YAML back to the product
    async function saveToProduct() {
        if (!productId) return;
        isSavingToProduct = true;
        try {
            const canvasData = generateCanvasConfig();
            const resp = await fetch(`/ordinal/api/products/${productId}/diagram`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml: canvasData })
            });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`PUT /ordinal/api/products/${productId}/diagram returned ${resp.status}: ${text}`);
            }
            console.log(`✅ Diagram saved to product ${productId}`);
        } catch (err) {
            const msg = (/** @type {any} */ (err))?.message || String(err);
            console.error('Failed to save diagram to product:', msg);
            alert('Failed to save to product: ' + msg);
        } finally {
            isSavingToProduct = false;
        }
    }

    // Load recent canvases on mount and initialize history
    onMount(() => {
        loadRecentCanvases();
        // Start a new history session for the initial canvas
        historyActions.startNewSession();

        // Check for ?project=<id> or ?product=<id> query param — auto-load diagram
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const pid = params.get('project');
            if (pid && !isNaN(Number(pid))) {
                projectId = Number(pid);
                loadProjectDiagram(projectId);
            }
            const prodId = params.get('product');
            if (prodId && !isNaN(Number(prodId))) {
                productId = Number(prodId);
                loadProductDiagram(productId);
            }
        }

        // File drop handling: browser mode uses native drag-drop events (handled in handleDrop above)
        // Wails OnFileDrop is not available in browser/SPA mode
    });
    
    // Helper function to re-hydrate artifact nodes after canvas loading
    async function rehydrateArtifactNodes() {
        const currentNodes = $nodes;
        const currentNodeDataStore = $nodeDataStore;
        
        for (const node of currentNodes) {
            if (node.type === 'text_file_source') {
                const nodeData = currentNodeDataStore.get(node.id);
                if (nodeData && nodeData.data.filePath) {
                    // This will re-read the file from disk and populate the node
                    await nodeActions.loadArtifactContent(node.id, nodeData.data.filePath);
                }
            }
        }
    }

    // Expose connection functions to child components
    export { startConnection, completeConnection, cancelConnection };
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="canvas-container">
    <!-- Node Palette (unified sidebar: brand + mode + nodes) -->
    <NodePalette />

    <!-- Token Counter Panel -->
    <div class="token-counter" title="Estimated tokens (heuristic)">
        <div class="token-title">Token Count</div>
        <div class="token-row">
            <span class="label">Canvas</span>
            <span class="value">{canvasTokens}</span>
        </div>
        {#if selectedContainer}
        <div class="token-row">
            <span class="label">Container</span>
            <span class="value">{selectedContainerTokens}</span>
        </div>
        {/if}
        {#if selectedNodeId}
        <div class="token-row">
            <span class="label">Selected</span>
            <span class="value">{selectedNodeTokens}</span>
        </div>
        {/if}
    </div>
    
    <!-- Main Canvas -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        role="application"
        aria-label="Visual workflow canvas"
        class="canvas-viewport"
        class:file-drag-over={isDraggingFile}
        bind:this={canvasElement}
        tabindex="-1"
        on:wheel={handleWheel}
        on:mousedown={handleMouseDown}
        on:mousemove={handleMouseMove}
        on:mouseup={handleMouseUp}
        on:dblclick={handleDoubleClick}
        on:drop={handleDrop}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        on:touchstart={handleTouchStart}
        on:touchmove={handleTouchMove}
        on:touchend={handleTouchEnd}
        on:contextmenu={handleCanvasContextMenu}
        on:click={handleCanvasClick}
        on:keydown={handleKeyDown}
    >
        <div 
            class="canvas-content"
            style="transform: translate({$viewport.x}px, {$viewport.y}px) scale({$viewport.zoom})"
        >
            <!-- SVG layer for connections -->
            <svg class="connections-layer" style="color: var(--connection-color, #666);">
                <!-- Arrow marker definition -->
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                            refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" />
                    </marker>
                </defs>
                
                <!-- Render connections (intra-machine) -->
                {#each $connections as connection}
                    <ConnectionLine {connection} />
                {/each}
                <!-- Render cross-machine connections -->
                {#each $crossMachineConnections as connection}
                    <ConnectionLine {connection} />
                {/each}
                
                <!-- Render temporary connection while dragging -->
                {#if tempConnection}
                    <path
                        d="M {tempConnection.startX} {tempConnection.startY} C {tempConnection.startX + 50} {tempConnection.startY}, {tempConnection.endX - 50} {tempConnection.endY}, {tempConnection.endX} {tempConnection.endY}"
                        stroke="var(--connection-color, #666)"
                        stroke-width="2"
                        stroke-dasharray="5,5"
                        fill="none"
                        marker-end="url(#arrowhead)"
                        class="temp-connection"
                    />
                {/if}
            </svg>
            
            <!-- Workflow containers layer (behind nodes) -->
            <div class="containers-layer">
                {#each $workflowContainers as container}
                    <WorkflowContainer 
                        {container}
                        isTopLevel={true}
                        {blockNodeInteractions}
                        {startConnection}
                        {completeConnection}
                        {isConnecting}
                    />
                {/each}
            </div>
            
            <!-- Nodes layer -->
            <div class="nodes-layer">
                {#each $nodes as node (node.id)}
                    <Node 
                        {node} 
                        {startConnection} 
                        {completeConnection} 
                        isConnecting={$canvasState.mode === 'connecting'}
                        isSelected={(/** @type {any[]} */ ($canvasState.selectedNodes || [])).includes(node.id) || $canvasState.selectedNode === node.id}
                        {blockNodeInteractions}
                    />
                {/each}
            </div>
            
            <!-- Box selection overlay -->
            {#if $canvasState.boxSelection}
                <div 
                    class="box-selection"
                    style="
                        left: {boxSel.x}px;
                        top: {boxSel.y}px;
                        width: {boxSel.width}px;
                        height: {boxSel.height}px;
                    "
                ></div>
            {/if}
        </div>
        
        <!-- Canvas info overlay -->
        <div class="canvas-info">
            <div class="info-left">
                <div class="zoom-controls">
                    <span class="zoom-info">Zoom: {Math.round($viewport.zoom * 100)}%</span>
                    <button 
                        class="zoom-fit-btn" 
                        on:click={() => {
                            if (!canvasElement) return;
                            const rect = canvasElement.getBoundingClientRect();
                            viewportActions.fitToScreen($nodes, rect.width, rect.height);
                        }}
                        title="Fit to screen (Ctrl+Shift+-)"
                    >
                        ⊡
                    </button>
                    <button 
                        class="zoom-reset-btn" 
                        on:click={() => viewportActions.reset()}
                        title="Reset zoom (Ctrl+0)"
                    >
                        100%
                    </button>
                </div>
                <div class="node-count">{$nodes.length} nodes</div>
                <div class="history-controls">
                    <button 
                        class="history-btn"
                        on:click={() => historyActions.undo()}
                        disabled={!$historyState.canUndo}
                        title="Undo (Ctrl+Z)"
                    >
                        ↩️
                    </button>
                    <button 
                        class="history-btn"
                        on:click={() => historyActions.redo()}
                        disabled={!$historyState.canRedo}
                        title="Redo (Ctrl+Y)"
                    >
                        ↪️
                    </button>
                    <span class="history-info">{$historyState.actionCount}/10</span>
                </div>
            </div>
            <div class="info-right">
                <div class="toolbar-buttons">
                    <!-- New Canvas Button -->
                    <button 
                        class="toolbar-button" 
                        on:click={newCanvas}
                        title="New Canvas"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/>
                        </svg>
                    </button>
                    <!-- Save Button -->
                    <button 
                        class="toolbar-button" 
                        on:click={saveCanvas}
                        title={currentCanvasPath ? `Save ${currentCanvasName || 'Canvas'}` : 'Save Canvas'}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3M19,19H5V5H16.17L19,7.83V19M12,12A3,3 0 0,0 9,15A3,3 0 0,0 12,18A3,3 0 0,0 15,15A3,3 0 0,0 12,12Z"/>
                        </svg>
                    </button>
                    <!-- Save to Project Button (only show when loaded via ?project=<id>) -->
                    {#if projectId}
                        <button
                            class="toolbar-button project-save-btn"
                            class:saving={isSavingToProject}
                            on:click={saveToProject}
                            disabled={isSavingToProject}
                            title={`Save to Project: ${projectName || projectId}`}
                        >
                            {#if isSavingToProject}
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="spin">
                                    <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
                                </svg>
                            {:else}
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6,2V8H18V2H20A2,2 0 0,1 22,4V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V4A2,2 0 0,1 4,2H6M8,4V8H16V4H8M12,10A4,4 0 0,1 16,14A4,4 0 0,1 12,18A4,4 0 0,1 8,14A4,4 0 0,1 12,10Z"/>
                                </svg>
                            {/if}
                            <span class="project-save-label">{isSavingToProject ? 'Saving…' : (projectName || `Project ${projectId}`)}</span>
                        </button>
                    {/if}
                    <!-- Save to Product Button (only show when loaded via ?product=<id>) -->
                    {#if productId}
                        <button
                            class="toolbar-button project-save-btn"
                            class:saving={isSavingToProduct}
                            on:click={saveToProduct}
                            disabled={isSavingToProduct}
                            title={`Save to Product: ${productName || productId}`}
                        >
                            {#if isSavingToProduct}
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="spin">
                                    <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
                                </svg>
                            {:else}
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6,2V8H18V2H20A2,2 0 0,1 22,4V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V4A2,2 0 0,1 4,2H6M8,4V8H16V4H8M12,10A4,4 0 0,1 16,14A4,4 0 0,1 12,18A4,4 0 0,1 8,14A4,4 0 0,1 12,10Z"/>
                                </svg>
                            {/if}
                            <span class="project-save-label">{isSavingToProduct ? 'Saving…' : (productName || `Product ${productId}`)}</span>
                        </button>
                    {/if}

                    <!-- Save As Button (only show if we have a current file) -->
                    {#if currentCanvasPath}
                        <button 
                            class="toolbar-button" 
                            on:click={saveAsCanvas}
                            title="Save As..."
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3M12,12A3,3 0 0,0 9,15A3,3 0 0,0 12,18A3,3 0 0,0 15,15A3,3 0 0,0 12,12M6,19V17H8V19H6M6,15V13H8V15H6M6,11V9H8V11H6M6,7V5H8V7H6Z"/>
                            </svg>
                        </button>
                    {/if}

                    <!-- Load Button -->
                    <button 
                        class="toolbar-button" 
                        on:click={loadCanvas}
                        title="Load Canvas"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"/>
                        </svg>
                    </button>

                    <!-- Recents Button -->
                    <button 
                        class="toolbar-button recents-button" 
                        on:click={toggleRecents}
                        title="Recent Canvases"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3"/>
                        </svg>
                        {#if showRecents}
                            <div class="recents-dropdown">
                                <div class="recents-header">Recent Canvases</div>
                                {#if recentCanvases.length === 0}
                                    <div class="recents-empty">No recent canvases</div>
                                {:else}
                                    {#each recentCanvases as recent}
                                        <button 
                                            class="recent-item"
                                            on:click={() => handleRecentClick(recent)}
                                            title={recent.path}
                                        >
                                            <div class="recent-name">{recent.name}</div>
                                        </button>
                                    {/each}
                                {/if}
                            </div>
                        {/if}
                    </button>

                    <!-- Config Panel Button -->
                    <button 
                        class="toolbar-button config-button" 
                        class:active={showConfigPanel}
                        on:click={() => showConfigPanel = !showConfigPanel}
                        title="View Configuration"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3,5H21V7H3V5M3,11H21V13H3V11M3,17H21V19H3V17Z"/>
                        </svg>
                    </button>

                    <!-- Template Palette Button -->
                    <button 
                        class="toolbar-button template-button" 
                        class:active={showTemplatePalette}
                        on:click={() => showTemplatePalette = !showTemplatePalette}
                        title="Templates"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M5,3C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H5M5,5H19V19H5V5M7,7V9H9V7H7M11,7V9H13V7H11M15,7V9H17V7H15M7,11V13H9V11H7M11,11V13H13V11H11M15,11V13H17V11H15M7,15V17H9V15H7M11,15V17H13V15H11M15,15V17H17V15H15Z"/>
                        </svg>
                    </button>

                    <!-- Chat Sidebar Button -->
                    <button 
                        class="toolbar-button" 
                        class:active={showChatSidebar}
                        on:click={() => chatActions.toggle()}
                        title="Config Chat"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9,22A1,1 0 0,1 8,21V18H5A2,2 0 0,1 3,16V5A2,2 0 0,1 5,3H19A2,2 0 0,1 21,5V16A2,2 0 0,1 19,18H13.9L10.2,21.71C10,21.9 9.76,22 9.5,22H9Z"/>
                        </svg>
                    </button>

                    <!-- Settings Button -->
                    <button 
                        class="toolbar-button settings-button" 
                        on:click={() => showSettings = true}
                        title="Settings"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11.03L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11.03C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.68 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Settings Panel -->
    <SettingsPanel bind:isOpen={showSettings} />
    
    <!-- Config Panel -->
    <ConfigPanel bind:visible={showConfigPanel} />
    
    <!-- Template Palette -->
    <TemplatePalette bind:isOpen={showTemplatePalette} />

    <!-- Chat Sidebar -->
    <ChatSidebar bind:isOpen={showChatSidebar} />
    
    <!-- Customize Panel -->
    <CustomizePanel
        bind:visible={showCustomizePanel}
        entityType={customizeEntityType}
        entityId={customizeEntityId}
        currentColor={customizeCurrentColor}
        currentLabel={customizeCurrentLabel}
        onSave={handleCustomizeSave}
        onCancel={handleCustomizeCancel}
    />

    <!-- Node Detail Panel (double-click a node to open) -->
    {#if showDetailPanel && detailPanelNodeId}
        <NodeDetailPanel
            nodeId={detailPanelNodeId}
            projectId={projectId}
            onClose={closeDetailPanel}
        />
    {/if}
    
    <!-- Global Context Menu -->
    <CanvasContextMenu 
        bind:visible={showCanvasContextMenu}
        x={canvasContextMenuX}
        y={canvasContextMenuY}
        items={canvasContextMenuItems}
        on:item-click={handleGlobalContextMenuAction}
    />
    
    <!-- Text File Output Modal -->
    {#if showTextFileOutputModal}
      <TextFileOutputModal
          show={showTextFileOutputModal}
          isUpdate={textOutputConfigureNodeId !== null}
          initialInstructions={textOutputConfigureNodeId ? ($nodeDataStore.get(textOutputConfigureNodeId)?.data?.processing?.user_instructions || '') : ''}
          initialMaxTokens={textOutputConfigureNodeId ? ($nodeDataStore.get(textOutputConfigureNodeId)?.data?.processing?.user_max_tokens || $nodeDataStore.get(textOutputConfigureNodeId)?.data?.processing?.parameters?.max_tokens || 8000) : 8000}
          initialOutputPath={textOutputConfigureNodeId ? ($nodeDataStore.get(textOutputConfigureNodeId)?.data?.metadata?.lastSavedPath || $nodeDataStore.get(textOutputConfigureNodeId)?.data?.metadata?.autoSavePath || '') : ''}
          initialModel={textOutputConfigureNodeId ? ($nodeDataStore.get(textOutputConfigureNodeId)?.data?.processing?.model_override || '') : ''}
          initialTemperature={textOutputConfigureNodeId ? ($nodeDataStore.get(textOutputConfigureNodeId)?.data?.processing?.parameters?.temperature ?? null) : null}
          on:submit={handleTextFileOutputSubmit}
          on:close={handleTextFileOutputClose}
      />
    {/if}

    <!-- AI Configure Modal -->
    {#if showAIConfigureModal && AiConfigureComp}
      <svelte:component 
        this={AiConfigureComp}
        show={showAIConfigureModal}
        nodeId={/** @type {any} */ (aiConfigureNodeId || '')}
        initialModel={$nodeDataStore.get(aiConfigureNodeId || '')?.data?.processing?.model_override || ''}
        initialTemperature={$nodeDataStore.get(aiConfigureNodeId || '')?.data?.processing?.parameters?.temperature ?? null}
        on:close={handleAIConfigureClose}
        on:submit={handleAIConfigureSubmit}
      />
    {/if}
</div>

<style>
    .canvas-container {
        display: flex;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        background: var(--canvas-bg, #f5f5f5);
        position: relative;
    }
    
    .canvas-viewport {
        flex: 1;
        position: relative;
        cursor: url('../assets/cursor-grab.svg') 16 16, grab;
        background: 
            radial-gradient(circle, var(--canvas-dots, #ddd) 1px, transparent 1px);
        background-size: 20px 20px;
        overflow: hidden;
        transition: background-color 0.2s ease;
    }

    .token-counter {
        position: absolute;
        right: 12px;
        top: 12px;
        background: rgba(236, 239, 244, 0.85); /* semi-opaque light grey */
        color: #000; /* explicit black for readability */
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 2px 10px rgba(0,0,0,0.08);
        font-size: 12px;
        line-height: 1.2;
        z-index: 5;
        min-width: 140px;
        backdrop-filter: saturate(120%) blur(2px);
    }
    .token-counter .token-title {
        font-weight: 700;
        font-size: 12px;
        margin-bottom: 6px;
        opacity: 0.95;
    }
    .token-counter .token-row { display: flex; justify-content: space-between; gap: 12px; }
    .token-counter .label { color: rgba(0,0,0,0.6); }
    .token-counter .value { font-weight: 600; }
    
    .canvas-viewport.file-drag-over {
        background-color: rgba(52, 152, 219, 0.1);
        border: 2px dashed #3498db;
        box-shadow: inset 0 0 20px rgba(52, 152, 219, 0.2);
    }
    
    .canvas-viewport.file-drag-over::after {
        content: 'Drop text file to create source node';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 18px;
        color: #3498db;
        font-weight: 500;
        pointer-events: none;
        background: rgba(255, 255, 255, 0.9);
        padding: 10px 20px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }
    
    .canvas-viewport:active {
        cursor: url('../assets/cursor-grabbing.svg') 16 16, grabbing;
    }
    
    .canvas-viewport:focus {
        outline: none;
    }
    
    .canvas-content {
        position: relative;
        width: 100%;
        height: 100%;
        transform-origin: 0 0;
    }
    
    .connections-layer {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
        overflow: visible;
    }
    
    .connections-layer :global(.connection-group) {
        pointer-events: all;
    }
    
    .containers-layer {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 0;
    }
    
    .nodes-layer {
        position: relative;
        z-index: 2;
    }
    
    .canvas-info {
        position: absolute;
        bottom: 10px;
        left: 10px;
        right: 10px;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        pointer-events: none;
    }
    
    .info-left {
        background: rgba(255, 255, 255, 0.9);
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        color: #666;
        pointer-events: all;
    }
    
    .info-right {
        pointer-events: all;
    }
    
    .zoom-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 2px 0;
    }
    
    .zoom-info {
        margin-right: 4px;
    }
    
    .node-count {
        margin: 2px 0;
    }
    
    .zoom-fit-btn, .zoom-reset-btn {
        padding: 2px 8px;
        font-size: 11px;
        background: #f0f0f0;
        border: 1px solid #ccc;
        border-radius: 3px;
        cursor: pointer;
        transition: background 0.2s;
    }
    
    .zoom-fit-btn:hover, .zoom-reset-btn:hover {
        background: #e0e0e0;
    }
    
    .zoom-fit-btn {
        font-size: 14px;
        padding: 1px 6px;
    }
    
    .history-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
    }
    
    .history-btn {
        padding: 2px 8px;
        font-size: 12px;
        background: #f0f0f0;
        border: 1px solid #ccc;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s;
    }
    
    .history-btn:hover:not(:disabled) {
        background: #e0e0e0;
    }
    
    .history-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    
    .history-info {
        font-size: 10px;
        color: #888;
        margin-left: 4px;
    }
    
    .toolbar-buttons {
        display: flex;
        gap: 8px;
        align-items: center;
    }
    
    .toolbar-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.9);
        color: #6b7280;
        cursor: url('../assets/cursor-pointer.svg') 16 16, pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        position: relative;
    }
    
    .toolbar-button:hover {
        background: white;
        color: #4f46e5;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    }
    
    .toolbar-button.active {
        background: #4f46e5;
        color: white;
        box-shadow: 0 4px 8px rgba(79, 70, 229, 0.3);
    }
    
    .recents-button {
        position: relative;
    }
    
    .recents-dropdown {
        position: absolute;
        bottom: 100%;
        right: 0;
        margin-bottom: 8px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        min-width: 280px;
        max-width: 400px;
        z-index: 1000;
        overflow: hidden;
    }
    
    .recents-header {
        padding: 12px 16px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        font-weight: 600;
        font-size: 14px;
        color: #374151;
    }
    
    .recents-empty {
        padding: 20px 16px;
        text-align: center;
        color: #9ca3af;
        font-size: 14px;
    }
    
    .recent-item {
        display: block;
        width: 100%;
        padding: 12px 16px;
        border: none;
        background: none;
        text-align: left;
        cursor: url('../assets/cursor-pointer.svg') 16 16, pointer;
        transition: background-color 0.15s ease;
        border-bottom: 1px solid #f3f4f6;
    }
    
    .recent-item:last-child {
        border-bottom: none;
    }
    
    .recent-item:hover {
        background: #f9fafb;
    }
    
    .recent-name {
        font-weight: 500;
        font-size: 14px;
        color: #374151;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    
    :global(.temp-connection) {
        animation: dash 1s linear infinite;
    }
    
    @keyframes dash {
        to {
            stroke-dashoffset: -10;
        }
    }
    
    .box-selection {
        position: absolute;
        border: 2px dashed #2196f3;
        background: rgba(33, 150, 243, 0.1);
        pointer-events: none;
        z-index: 10;
    }

    /* Project-aware Save to Project button */
    .project-save-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        background: rgba(180, 190, 254, 0.12); /* lavender tint */
        border-color: rgba(180, 190, 254, 0.4);
        color: #b4befe; /* Catppuccin Mocha lavender */
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        max-width: 160px;
        overflow: hidden;
    }

    .project-save-btn:hover:not(:disabled) {
        background: rgba(180, 190, 254, 0.22);
        border-color: rgba(180, 190, 254, 0.6);
    }

    .project-save-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .project-save-btn.saving {
        opacity: 0.75;
    }

    .project-save-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 110px;
        display: inline-block;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
    }

    .spin {
        animation: spin 1s linear infinite;
    }

    /* ── Mobile responsive layout ─────────────────────────────────────────── */
    @media (max-width: 768px) {
        /* Canvas fills the full screen — palette is hidden (FAB replaces it) */
        .canvas-container {
            flex-direction: column;
        }

        /* Token counter is too wide for phones — hide it */
        .token-counter {
            display: none;
        }

        /* Bottom info bar: collapse to a single compact row */
        .canvas-info {
            bottom: 6px;
            left: 6px;
            right: 6px;
            flex-direction: row;
            align-items: center;
            gap: 6px;
        }

        /* Left info panel: horizontal single-line, smaller text */
        .info-left {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            padding: 5px 8px;
            font-size: 11px;
            background: rgba(30, 30, 46, 0.88);
            color: #cdd6f4;
            border: 1px solid #313244;
            border-radius: 8px;
            flex: 1;
            overflow: hidden;
        }

        /* Collapse history controls into horizontal row */
        .history-controls {
            margin-top: 0;
        }

        /* Toolbar buttons on the right: leave space for FAB (bottom-right: 80px) */
        .info-right {
            /* FAB is in bottom-right — push toolbar left of it */
            margin-right: 72px;
        }

        /* Touch-friendly toolbar buttons — 44px Apple HIG minimum */
        .toolbar-button {
            width: 44px;
            height: 44px;
            background: rgba(30, 30, 46, 0.92);
            color: #cdd6f4;
            border: 1px solid #313244;
            border-radius: 10px;
        }

        .toolbar-button:hover, .toolbar-button.active {
            background: rgba(203, 166, 247, 0.2);
            color: #cba6f7;
            border-color: rgba(203, 166, 247, 0.4);
        }

        /* Toolbar button gap: min 8px so fat fingers don't mis-tap */
        .toolbar-buttons {
            gap: 8px;
        }

        /* Project/product save label — shorten on mobile */
        .project-save-label {
            max-width: 70px;
        }

        /* Project save button: taller on mobile */
        .project-save-btn {
            height: 44px;
            padding: 0 12px;
        }

        /* Zoom + history buttons: bring to 44px touch target */
        .zoom-fit-btn, .zoom-reset-btn {
            height: 44px;
            padding: 0 14px;
            font-size: 15px;
            background: rgba(30, 30, 46, 0.92);
            border: 1px solid #313244;
            border-radius: 10px;
            color: #cdd6f4;
        }

        .zoom-fit-btn:hover, .zoom-reset-btn:hover {
            background: rgba(49, 50, 68, 0.95);
        }

        .history-btn {
            height: 44px;
            padding: 0 14px;
            font-size: 15px;
            background: rgba(30, 30, 46, 0.92);
            border: 1px solid #313244;
            border-radius: 10px;
            color: #cdd6f4;
        }

        .history-btn:hover:not(:disabled) {
            background: rgba(49, 50, 68, 0.95);
        }

        /* Larger zoom controls gap */
        .zoom-controls {
            gap: 10px;
        }

        /* history controls: bigger gap */
        .history-controls {
            gap: 8px;
        }

        /* Recents dropdown: adjust for smaller screens */
        .recents-dropdown {
            min-width: 220px;
            max-width: 90vw;
            right: 0;
        }

        /* Recents items: touch-friendly */
        .recent-item {
            padding: 14px 16px;
            min-height: 44px;
        }

        /* node-count and zoom-info: hide on very narrow screens */
        .node-count {
            display: none;
        }
    }

    @media (max-width: 480px) {
        /* On very narrow phones, also hide history info text */
        .history-info {
            display: none;
        }

        /* Zoom info: shorter */
        .zoom-info {
            font-size: 10px;
        }
    }
</style>
