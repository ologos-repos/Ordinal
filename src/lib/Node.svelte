<script>
    import { onMount, afterUpdate } from 'svelte';
    import { canvasState } from '../stores/canvas.js';
    import { nodeActions, connections, nodeDataStore } from '../stores/nodes.js';
    import { executionState } from '../stores/workflows.js';
    import { settings } from '../stores/settings.js';
    import { copyText, copyConfig, copyNodeConfig, copyNodeMetadata, pasteConfig } from './clipboard.js';
    import { ContextEngine } from './ContextEngine.js';
    import { writeTextFile } from './rhodeApi.js';
    import { getNodeMeta } from './nodeTypes.js';
    import { getIcon } from '../plugins/nodes/ordinal/icons.js';
    import { isDiagrammingMode } from '../stores/mode.js';
    const SaveTextFile = writeTextFile; // Compatibility alias
    /** @type {any} */
    export let node;
    /** @type {(fromNodeId: string, fromPort: string, event?: MouseEvent | null) => void} */
    export let startConnection;
    /** @type {(toNodeId: string, toPort: string) => Promise<void> | void} */
    export let completeConnection;
    export let isConnecting = false;
    export let isSelected = false;
    export let blockNodeInteractions = false;
    
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    let isEditing = false;
    /** @type {HTMLElement | null} */
    let contentDisplayElement = null;
    /** @type {HTMLElement | null} */
    let nodeCardElement = null;
    let isExpanded = false;
    let isOutputExpanded = false;  // For text_file_output nodes
    let isContentExpanded = false;
    let hasDynamicOverflow = false;
    const BASE_NODE_WIDTH = 250;
    const BASE_NODE_HEIGHT = 120;
    const AI_BASE_UNITS = 2;
    const AI_UNIT_WIDTH = BASE_NODE_WIDTH / AI_BASE_UNITS;
    const AI_UNIT_HEIGHT = BASE_NODE_HEIGHT / AI_BASE_UNITS;
    const AI_MAX_EXPANSION_STEPS = 18;
    const STRUCTURAL_BUFFER = 16;
    const AI_CONTENT_SAFETY = 12;
    // Horizontal overhead inside node card: node-content padding (12*2) + preview padding (8*2) + preview border (1*2)
    const CONTENT_OVERHEAD = (12 * 2) + (8 * 2) + (1 * 2); // 24 + 16 + 2 = 42
    const TEXT_GEN_PREVIEW_MULTIPLIER = 2.25;
    // Base preview width = BASE_NODE_WIDTH - CONTENT_OVERHEAD
    const BASE_PREVIEW_WIDTH = BASE_NODE_WIDTH - CONTENT_OVERHEAD; // 208
    // Ensure inner preview width = 2.25x of base preview width
    const TEXT_GEN_PREVIEW_WIDTH = Math.round(BASE_PREVIEW_WIDTH * TEXT_GEN_PREVIEW_MULTIPLIER); // 468
    // Target node width wraps preview width
    const TEXT_GEN_WIDTH = TEXT_GEN_PREVIEW_WIDTH + CONTENT_OVERHEAD; // 510
    const DYNAMIC_COLLAPSED_HEIGHT = 260;
    const DYNAMIC_EXPANDED_HEIGHT = 520;

    const DYNAMIC_NODE_TYPES = new Set(['ai', 'input', 'static']);
    const dynamicResizeSettings = {
        ai: { contentSafety: AI_CONTENT_SAFETY },
        input: { contentSafety: 8 },
        static: { contentSafety: 8 }
    };

    let workflowModulePromise;

    $: isDynamicSizingNode = DYNAMIC_NODE_TYPES.has(node.type);

    $: if (!isDynamicSizingNode && (hasDynamicOverflow || isContentExpanded)) {
        hasDynamicOverflow = false;
        isContentExpanded = false;
    }

    function scheduleContainerBoundsRecalc(delay = 25) {
        setTimeout(() => {
            (workflowModulePromise ??= import('../stores/workflows.js'))
                .then(/** @param {any} mod */ (mod) => {
                    const workflowActions = (/** @type {any} */ (mod)).workflowActions;
                    workflowActions?.recalculateContainerBounds?.();
                })
                .catch(() => {});
        }, delay);
    }

    /** @param {number} step */
    function getUnitsForStep(step) {
        if (step <= 0) {
            return { widthUnits: AI_BASE_UNITS, heightUnits: AI_BASE_UNITS };
        }
        const verticalAdditions = Math.ceil(step / 2);
        const horizontalAdditions = Math.floor(step / 2);
        return {
            widthUnits: AI_BASE_UNITS + (horizontalAdditions * 2),
            heightUnits: AI_BASE_UNITS + (verticalAdditions * 2)
        };
    }

    /** @param {string} content @param {number} widthPx */
    function measureAIContentHeight(content, widthPx) {
        if (!aiMeasurementElement) {
            return 0;
        }
        const targetWidth = Math.max(40, Math.round(widthPx));
        aiMeasurementElement.style.width = `${targetWidth}px`;
        aiMeasurementElement.style.height = 'auto';
        // Match the preview rendering (lightweight markdown) for accurate measurement
        aiMeasurementElement.innerHTML = renderGeneratedHtml(content || '');
        return aiMeasurementElement.scrollHeight || 0;
    }

    /** @type {{type:any, content:any, width:number, height:number, expanded:boolean}} */
    let lastDynamicLayout = {
        type: null,
        content: null,
        width: 0,
        height: 0,
        expanded: false
    };
    let dynamicCollapsedContentMax = Math.max(60, DYNAMIC_COLLAPSED_HEIGHT - STRUCTURAL_BUFFER);
    let dynamicExpandedContentMax = Math.max(dynamicCollapsedContentMax, DYNAMIC_EXPANDED_HEIGHT - STRUCTURAL_BUFFER);
    let showDynamicExpand = false;
    let lastShowDynamicExpand = false;

    function adjustDynamicNodeLayout(force = false) {
        if (isDragging) return;
        if (!isDynamicSizingNode) return;

        if (!nodeCardElement || !nodeContentElement || !aiMeasurementElement) {
            requestAnimationFrame(() => adjustDynamicNodeLayout(force));
            return;
        }

        const rawContent = node.content || '';
        const currentWidth = Number.isFinite(node.width) ? node.width : BASE_NODE_WIDTH;
        const currentHeight = Number.isFinite(node.height) ? node.height : BASE_NODE_HEIGHT;

        if (
            !force &&
            lastDynamicLayout.type === node.type &&
            lastDynamicLayout.content === rawContent &&
            lastDynamicLayout.width === currentWidth &&
            lastDynamicLayout.height === currentHeight &&
            lastDynamicLayout.expanded === isContentExpanded
        ) {
            return;
        }

        const trimmedContent = rawContent.trim();
        const isEmpty = trimmedContent.length === 0 || trimmedContent === 'Waiting for input...';

        if (isEmpty) {
            lastDynamicLayout = {
                type: node.type,
                content: rawContent,
                width: BASE_NODE_WIDTH,
                height: BASE_NODE_HEIGHT,
                expanded: false
            };

            if (hasDynamicOverflow) {
                hasDynamicOverflow = false;
            }
            if (showDynamicExpand) {
                showDynamicExpand = false;
            }
            if (isContentExpanded) {
                isContentExpanded = false;
            }

            const needsReset = (node.width !== BASE_NODE_WIDTH) || (node.height !== BASE_NODE_HEIGHT);
            if (needsReset) {
                nodeActions.update(node.id, { width: BASE_NODE_WIDTH, height: BASE_NODE_HEIGHT });
                scheduleContainerBoundsRecalc();
            }
            return;
        }

        const headerHeight = nodeHeaderElement?.offsetHeight || 0;
        let paddingTop = 12;
        let paddingBottom = 12;
        let paddingLeft = 12;
        let paddingRight = 12;

        if (nodeContentElement) {
            const styles = getComputedStyle(nodeContentElement);
            paddingTop = parseFloat(styles.paddingTop) || paddingTop;
            paddingBottom = parseFloat(styles.paddingBottom) || paddingBottom;
            paddingLeft = parseFloat(styles.paddingLeft) || paddingLeft;
            paddingRight = parseFloat(styles.paddingRight) || paddingRight;
        }

        const structuralOverhead = headerHeight + paddingTop + paddingBottom + STRUCTURAL_BUFFER;
        const horizontalPadding = paddingLeft + paddingRight;
        const baseSettings = (/** @type {any} */ (dynamicResizeSettings))[node.type] || dynamicResizeSettings.ai;
        const contentSafety = baseSettings.contentSafety ?? AI_CONTENT_SAFETY;

        const widthLimit = node.type === 'ai' ? TEXT_GEN_WIDTH : BASE_NODE_WIDTH;

        if (isEditing && contentElement) {
            const editorHeight = contentElement.scrollHeight || 0;
            showDynamicExpand = false;
            hasDynamicOverflow = false;

            const targetHeight = Math.round(Math.max(
                BASE_NODE_HEIGHT,
                structuralOverhead + editorHeight + contentSafety
            ));
            const targetWidth = Math.round(widthLimit);

            lastDynamicLayout = {
                type: node.type,
                content: rawContent,
                width: targetWidth,
                height: targetHeight,
                expanded: true
            };

            const widthChangedEdit = Math.abs((node.width ?? BASE_NODE_WIDTH) - targetWidth) > 0.5;
            const heightChangedEdit = Math.abs((node.height ?? BASE_NODE_HEIGHT) - targetHeight) > 0.5;
            if (widthChangedEdit || heightChangedEdit) {
                nodeActions.update(node.id, { width: targetWidth, height: targetHeight });
                scheduleContainerBoundsRecalc();
            }
            return;
        }

        const measurementWidth = Math.max(40, widthLimit - horizontalPadding);
        const requiredHeight = measureAIContentHeight(rawContent, measurementWidth);

        const collapsedContentCapacity = Math.max(40, DYNAMIC_COLLAPSED_HEIGHT - structuralOverhead);
        const expandedContentCapacity = Math.max(collapsedContentCapacity, DYNAMIC_EXPANDED_HEIGHT - structuralOverhead);

        dynamicCollapsedContentMax = Math.round(collapsedContentCapacity);
        dynamicExpandedContentMax = Math.round(expandedContentCapacity);

        showDynamicExpand = requiredHeight + contentSafety > collapsedContentCapacity;
        hasDynamicOverflow = showDynamicExpand;

        // If expand visibility toggled, schedule a re-measure next frame to include controls
        if (showDynamicExpand !== lastShowDynamicExpand) {
            lastShowDynamicExpand = showDynamicExpand;
            requestAnimationFrame(() => adjustDynamicNodeLayout(true));
        }

        const heightLimit = isContentExpanded ? DYNAMIC_EXPANDED_HEIGHT : DYNAMIC_COLLAPSED_HEIGHT;
        const allowedContentHeight = isContentExpanded ? expandedContentCapacity : collapsedContentCapacity;
        const constrainedContentHeight = Math.min(requiredHeight + contentSafety, allowedContentHeight);
        // Measure the actual preview controls height if present so we keep it inside the card
        let controlsExtra = 0;
        if (showDynamicExpand || isContentExpanded) {
            try {
                const controlsEl = nodeContentElement?.querySelector?.('.preview-controls');
                if (controlsEl && controlsEl instanceof HTMLElement) {
                    const styles = getComputedStyle(controlsEl);
                    const mt = parseFloat(styles.marginTop || '0');
                    controlsExtra = Math.ceil(controlsEl.offsetHeight + mt);
                } else {
                    controlsExtra = 28; // fallback
                }
            } catch {
                controlsExtra = 28; // safe fallback if measurement fails
            }
        }
        // Prefer measuring the full dynamic preview (content + controls) height
        let visibleContentHeight = constrainedContentHeight;
        let measuredPreview = false;
        try {
            const previewEl = nodeContentElement?.querySelector?.('.dynamic-preview');
            if (previewEl && previewEl instanceof HTMLElement) {
                visibleContentHeight = Math.max(0, Math.ceil(previewEl.clientHeight));
                measuredPreview = true;
            }
        } catch {}
        if (measuredPreview) {
            controlsExtra = 0; // avoid double-counting if preview includes controls
        }

        // Reduce content capacity by controls height so total stays within heightLimit
        const effectiveContentCapacity = Math.max(0, allowedContentHeight - controlsExtra);
        const boundedVisibleContent = Math.min(visibleContentHeight, effectiveContentCapacity);
        let targetHeight = Math.round(Math.max(
            BASE_NODE_HEIGHT,
            structuralOverhead + boundedVisibleContent + controlsExtra
        ));
        // Fallback: ensure we never cut off actual content + controls due to timing/rAF
        try {
            const contentScroll = nodeContentElement?.scrollHeight || 0;
            const fallbackHeight = Math.round(Math.max(BASE_NODE_HEIGHT, headerHeight + contentScroll + STRUCTURAL_BUFFER));
            if (fallbackHeight > targetHeight) {
                targetHeight = fallbackHeight;
            }
        } catch {}
        const targetWidth = Math.round(widthLimit);

        lastDynamicLayout = {
            type: node.type,
            content: rawContent,
            width: targetWidth,
            height: targetHeight,
            expanded: isContentExpanded
        };

        const widthChanged = Math.abs((node.width ?? BASE_NODE_WIDTH) - targetWidth) > 0.5;
        const heightChanged = Math.abs((node.height ?? BASE_NODE_HEIGHT) - targetHeight) > 0.5;
        if (widthChanged || heightChanged) {
            nodeActions.update(node.id, { width: Math.round(targetWidth), height: Math.round(targetHeight) });
            scheduleContainerBoundsRecalc();
        }
    }

    function toggleDynamicExpansion() {
        if (!isDynamicSizingNode) {
            return;
        }
        isContentExpanded = !isContentExpanded;
        requestAnimationFrame(() => {
            adjustDynamicNodeLayout(true);
            scheduleContainerBoundsRecalc();
        });
    }

    // Function to update node dimensions (vertical only)
    function updateNodeDimensions() {
        if (isDragging) return; // don't measure/resize while dragging

        if (isDynamicSizingNode) {
            requestAnimationFrame(() => adjustDynamicNodeLayout(true));
            return;
        }

        if (!nodeCardElement) return;
        if (!node.content || node.content === 'Waiting for input...') return;
        if (node.type === 'text_file_output' && !contentDisplayElement) return;
        try {
            // Ensure text_file_output nodes adopt the 2.25x preview width once content exists
            if (node.type === 'text_file_output' && node.width !== TEXT_GEN_WIDTH) {
                nodeActions.update(node.id, { width: TEXT_GEN_WIDTH });
            }
            // Only persist height changes; width is fixed by style
            requestAnimationFrame(() => setTimeout(() => updateNodeSize(), 25));
        } catch (error) {
            console.warn('Error updating node dimensions:', error);
        }
    }

    // Preview width is governed by CSS and fixed node card width. No JS sync needed.

    // Call update only when content actually changes to avoid spam during move/redraws
    /** @type {any} */
    let lastMeasuredContent = null;
    $: if (node.content !== lastMeasuredContent) {
        lastMeasuredContent = node.content;
        updateNodeDimensions();
    }

    // For text_file_source nodes, re-calculate size when content changes (file loaded)
    $: if (node.content && node.type === 'text_file_source') {
        // Use a timeout to ensure the DOM has updated with the new content
        setTimeout(() => {
            updateNodeSize();
        }, 100);
    }
    /** @type {HTMLElement | null} */
    let contentElement = null;
    let mouseDownTime = 0;
    let mouseDownPos = { x: 0, y: 0 };
    /** @type {HTMLElement | null} */
    let nodeElement = null;
    /** @type {HTMLElement | null} */
    let nodeHeaderElement = null;
    /** @type {HTMLElement | null} */
    let nodeContentElement = null;
    /** @type {HTMLElement | null} */
    let aiMeasurementElement = null;
    
    // Prevent global text selection while dragging nodes
    /** @type {(disabled: boolean) => void} */
    const setGlobalUserSelect = (disabled) => {
        try {
            const val = disabled ? 'none' : '';
            document.body.style.userSelect = val;
            document.documentElement.style.userSelect = val;
            // Also prevent on common text containers if present
            const appRoot = document.getElementById('app');
            if (appRoot) appRoot.style.userSelect = val;
        } catch {}
    }
    
    // Get node metadata (icon, color, label)
    $: nodeMeta = getNodeMeta(node.type);

    // Resolve SVG icon: prefer explicit node.icon field, then nodeMeta.iconName, then null (→ emoji fallback)
    $: iconSvg = (() => {
        const iconName = node.icon || nodeMeta.iconName;
        if (!iconName) return null;
        return getIcon(iconName, nodeMeta.borderColor);
    })();

    // Diagram mode class for type-specific visual variants
    $: diagramShapeClass = $isDiagrammingMode ? `diagram-node diagram-${node.type}` : '';

    // Diagram mode: detect meaningful content (not placeholder text)
    $: diagramHasContent = $isDiagrammingMode && !!(
        node.content &&
        node.content !== 'Click to edit...' &&
        node.content !== 'Waiting for input...' &&
        node.content.trim().length > 0
    );

    // Diagram mode: icon-dominant node dimensions (more square than knowledge mode)
    const DIAGRAM_NODE_WIDTH_NO_CONTENT = 140;
    const DIAGRAM_NODE_HEIGHT_NO_CONTENT = 130;
    const DIAGRAM_NODE_WIDTH_WITH_CONTENT = 260;
    const DIAGRAM_NODE_HEIGHT_WITH_CONTENT = 200;

    $: diagramNodeWidth = $isDiagrammingMode
        ? (diagramHasContent ? DIAGRAM_NODE_WIDTH_WITH_CONTENT : DIAGRAM_NODE_WIDTH_NO_CONTENT)
        : null;
    $: diagramNodeHeight = $isDiagrammingMode
        ? (diagramHasContent ? DIAGRAM_NODE_HEIGHT_WITH_CONTENT : DIAGRAM_NODE_HEIGHT_NO_CONTENT)
        : null;

    // Sync diagram-mode dimensions into the node store so ConnectionLine.svelte,
    // organize.js, and bounds.js all read the correct values (not the stale 250×120 defaults).
    // This also fires when $isDiagrammingMode toggles back to false, restoring BASE dimensions.
    $: {
        if ($isDiagrammingMode && diagramNodeWidth !== null && diagramNodeHeight !== null) {
            const needsSync = node.width !== diagramNodeWidth || node.height !== diagramNodeHeight;
            if (needsSync) {
                nodeActions.update(node.id, { width: diagramNodeWidth, height: diagramNodeHeight });
                scheduleContainerBoundsRecalc();
            }
        } else if (!$isDiagrammingMode && !isDynamicSizingNode) {
            // Only reset fixed-size nodes back to BASE dimensions.
            // Dynamic-sizing nodes (ai, input, static) manage their own height via
            // adjustDynamicNodeLayout — forcing them to BASE_NODE_HEIGHT here would
            // create a feedback loop with afterUpdate → adjustDynamicNodeLayout → resize.
            const needsReset = node.width !== BASE_NODE_WIDTH || node.height !== BASE_NODE_HEIGHT;
            if (needsReset) {
                nodeActions.update(node.id, { width: BASE_NODE_WIDTH, height: BASE_NODE_HEIGHT });
                scheduleContainerBoundsRecalc();
            }
        }
    }

    $: isExecuting = $executionState.activeNodes.has(node.id);
    $: isCompleted = $executionState.completedNodes.has(node.id);
    $: generatedContent = $executionState.generatedArtifacts.get(node.id);
    
    // Get custom styling from nodeData
    $: customStyle = (() => {
        const nodeData = $nodeDataStore?.get(node.id);
        const customColor = nodeData?.getCustomColor?.();
        const customLabel = nodeData?.getCustomLabel?.();
        
        let style = '';
        if (customColor) {
            style += `--node-color: ${customColor};`;
        }
        return style;
    })();
    
    // Get display title (custom label or original title)
    $: displayTitle = (() => {
        const nodeData = $nodeDataStore?.get(node.id);
        const customLabel = nodeData?.getCustomLabel?.();
        return customLabel || node.title || node.id;
    })();

    // Full file path for file-based nodes (desktop only; browser cannot expose full paths)
    $: filePath = (() => {
        const nodeData = $nodeDataStore?.get(node.id);
        return nodeData?.data?.filePath || null;
    })();

    // Requirements traceability array (from .ologic requirements: field)
    $: nodeRequirements = (() => {
        const nodeData = $nodeDataStore?.get(node.id);
        return nodeData?.data?.metadata?.requirements || [];
    })();

    // Meta-type flag: treat any node with metadata.meta_type === 'file_source' as a source-only node
    $: isFileSourceMeta = (() => {
        const nodeData = $nodeDataStore?.get(node.id);
        return nodeData?.data?.metadata?.meta_type === 'file_source';
    })();

    // Effective model used by this node (override -> settings default)
    $: nodeModel = (() => {
        try {
            const nd = $nodeDataStore?.get(node.id);
            const override = nd?.data?.processing?.model_override;
            const def = $settings?.story_processing_model_id;
            return override || def || '';
        } catch {
            return '';
        }
    })();
    
    // Context menu items
    $: contextMenuItems = [
        // Configure appears for AI and text_file_output nodes
        ...(node.type === 'ai' || node.type === 'text_file_output' ? [{
            label: 'Configure…',
            icon: '⚙️',
            action: 'configure'
        }] : []),
        // Prompt Preview for AI nodes
        ...(node.type === 'ai' ? [{
            label: 'Prompt Preview (minimal)',
            icon: '🔍',
            action: 'prompt-preview-min'
        },{
            label: 'Prompt Preview (full)',
            icon: '🔎',
            action: 'prompt-preview-full'
        }] : []),
        {
            label: node.locked ? 'Unlock Node' : 'Lock Node',
            icon: node.locked ? '🔓' : '🔒',
            action: 'toggle-lock'
        },
        { separator: true },
        {
            label: 'Copy Text',
            icon: '📄',
            action: 'copy-text',
            disabled: !node.content
        },
        {
            label: 'Copy Config',
            icon: '⚙️',
            action: 'copy-config'
        },
        {
            label: 'Copy Metadata',
            icon: '🔧',
            action: 'copy-metadata'
        },
        {
            label: 'Paste Config',
            icon: '📥',
            action: 'paste-config'
        },
        { separator: true },
        {
            label: 'Customize',
            icon: '🎨',
            action: 'customize'
        },
        {
            label: 'Delete Node',
            icon: '🗑️',
            action: 'delete',
            shortcut: 'Del'
        }
    ];
    
    // Handle node interactions
    /** @param {MouseEvent} event */
    /** @param {MouseEvent} event */
    function handleMouseDown(event) {
        const t = /** @type {HTMLElement} */ (event.target);
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
            return; // Don't handle when editing text
        }
        
        // Don't handle if canvas is blocking node interactions
        if (blockNodeInteractions || $canvasState.mode === 'box-selecting') {
            event.stopPropagation();
            return;
        }
        
        // Prevent event from bubbling to canvas
        event.stopPropagation();
        event.preventDefault();
        mouseDownTime = Date.now();
        mouseDownPos = { x: event.clientX, y: event.clientY };
        
        const curr = /** @type {HTMLElement | null} */ (event.currentTarget);
        if (!curr) return;
        const rect = curr.getBoundingClientRect();
        dragOffset.x = event.clientX - rect.left;
        dragOffset.y = event.clientY - rect.top;
        
        // Add global mouse listeners
        document.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseup', handleGlobalMouseUp);
        // Disable text selection while dragging
        setGlobalUserSelect(true);
    }
    
    /** @param {MouseEvent} event */
    function handleDoubleClick(event) {
        const t = /** @type {HTMLElement} */ (event.target);
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        // Open the detail panel via global handler registered by Canvas.svelte
        if (typeof window !== 'undefined' && (/** @type {any} */ (window)).showNodeDetail) {
            (/** @type {any} */ (window)).showNodeDetail(node.id);
        }
    }

    /** @param {MouseEvent} event */
    /** @param {MouseEvent | KeyboardEvent} event */
    function handleClick(event) {
        const t = /** @type {HTMLElement} */ (event.target);
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
            return;
        }
        
        event.stopPropagation();
        console.log('Node clicked:', node.id);
        
        // Select this node
        canvasState.update(s => ({ 
            ...s, 
            selectedNode: node.id, 
            selectedConnection: null,
            selectedContainer: null 
        }));
    }
    
    /** @param {MouseEvent} event */
    function handleRightClick(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Select this node
        canvasState.update(s => ({ 
            ...s, 
            selectedNode: node.id, 
            selectedConnection: null,
            selectedContainer: null 
        }));
        
        // Use global context menu system
        if (window.showCanvasContextMenu) {
            const menuItems = contextMenuItems.filter(item => !item.separator).map(item => ({
                label: item.label,
                icon: item.icon,
                handler: () => handleContextMenuAction({ detail: { action: /** @type {any} */ (item.action || '') } }),
                disabled: item.disabled
            }));
            
            // Add separators back in their original positions
            /** @type {any[]} */
            const menuWithSeparators = [];
            let itemIndex = 0;
            contextMenuItems.forEach(item => {
                if (item.separator) {
                    menuWithSeparators.push({ separator: true });
                } else {
                    menuWithSeparators.push(menuItems[itemIndex]);
                    itemIndex++;
                }
            });
            
            (/** @type {any} */ (window)).showCanvasContextMenu(event.clientX, event.clientY, menuWithSeparators);
        }
    }
    
    function showCustomizeDialog() {
        if ((/** @type {any} */ (window)).showCustomizeForNode) {
            (/** @type {any} */ (window)).showCustomizeForNode(node.id);
        }
    }

    function isRunningInBrowser() {
        // Running in browser only if Wails runtime is not present
        return typeof window !== 'undefined' && !(/** @type {any} */ (window)).__WAILS_RUNTIME__;
    }

    // Browser-specific text file save using File System Access API
    /** @param {string} content @param {string} suggestedFilename */
    async function saveTextFileToBrowser(content, suggestedFilename) {
        let savedPath = null;
        
        // Try to use the modern File System Access API first (Chrome/Edge)
        if ((/** @type {any} */ (window)).showSaveFilePicker) {
            try {
                const fileHandle = await (/** @type {any} */ (window)).showSaveFilePicker({
                    suggestedName: suggestedFilename,
                    types: [
                        {
                            description: 'Markdown Files',
                            accept: {
                                'text/markdown': ['.md']
                            }
                        },
                        {
                            description: 'Text Files',
                            accept: {
                                'text/plain': ['.txt']
                            }
                        }
                    ]
                });
                
                const writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
                
                // Browsers do not expose full filesystem paths for security.
                // We only have the filename in browser mode.
                savedPath = fileHandle.name;
                return savedPath;
            } catch (error) {
                if ((/** @type {any} */ (error))?.name === 'AbortError') {
                    console.log('User cancelled file save');
                    return null;
                }
                console.warn('File System Access API failed:', error);
                // Fall through to legacy download method
            }
        }
        
        // Fallback: create a downloadable file in browser
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestedFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Legacy download: we only know the suggested filename in browser.
        return suggestedFilename;
    }

    // Add a new function to save the generated artifact
    async function saveArtifact() {
        if (!node.content || node.content === 'Waiting for input...') {
            alert("No content has been generated. Please run the workflow first.");
            return;
        }

        try {
            // Get current nodeData to check for existing saved path
            const currentNodeData = $nodeDataStore.get(node.id);
            const existingPath = currentNodeData?.data.metadata.lastSavedPath;
            
            let defaultFilename = `${(node.title || 'output').replace(/\s+/g, '_')}.md`;
            
            // If we have an existing path, suggest the same filename
            if (existingPath) {
                const pathParts = existingPath.split(/[/\\]/);
                defaultFilename = pathParts[pathParts.length - 1] || defaultFilename;
            }

            let savedPath;

            // Use browser file dialog (Rhode web mode)
            savedPath = await saveTextFileToBrowser(node.content, defaultFilename);
            
            if (savedPath) {
                // Update the node's metadata with the new path
                nodeDataStore.update(store => {
                    const newStore = new Map(store);
                    const nodeData = newStore.get(node.id);
                    if (nodeData) {
                        nodeData.data.metadata.lastSavedPath = savedPath;
                        newStore.set(node.id, nodeData);
                    }
                    return newStore;
                });
                alert(`File saved successfully to: ${savedPath}`);
            } else {
                // User cancelled the save dialog
                console.log('Save cancelled by user');
            }
        } catch(err) {
            console.error('Save error:', err);
            alert(`Failed to save file: ${err}`);
        }
    }

    /** @param {{ detail: { action: string } }} event */
    async function handleContextMenuAction(event) {
        const action = event.detail.action;
        
        try {
            switch (action) {
                case 'prompt-preview-min':
                case 'prompt-preview-full':
                    if (node.type !== 'ai') break;
                    // Build envelope inputs from incoming connections (use structured output when available)
                    try {
                        const incoming = ($connections || []).filter(c => c.toId === node.id);
                        const envelopeInputs = incoming.map(conn => {
                            const nd = nodeActions.getNodeData(conn.fromId);
                            const output = nd?.data?.output;
                            /** @type {any} */
                            let dataPayload = '';
                            /** @type {any[] | undefined} */
                            let chainPayload = undefined;
                            /** @type {string[] | undefined} */
                            let sourcesPayload = undefined;
                            if (output && output.value) {
                                dataPayload = output.value; // may be structured_context or string
                                if (Array.isArray(output.context_chain)) chainPayload = output.context_chain;
                                if (Array.isArray(output.sources)) sourcesPayload = output.sources;
                            } else {
                                // Fallback to source node's current content
                                dataPayload = nd?.data?.content || '';
                            }
                            return {
                                source_id: conn.fromId,
                                data: dataPayload,
                                weight: 1,
                                received_at: new Date().toISOString(),
                                ...(chainPayload ? { context_chain: chainPayload } : {}),
                                ...(sourcesPayload ? { sources: sourcesPayload } : {})
                            };
                        });
                        const envelope = ContextEngine.buildNodeExecutionEnvelope({
                            id: node.id,
                            node_type: node.type,
                            content: node.content || '',
                            inputs: envelopeInputs
                        }, {
                            // Optional container info could be added here later
                            mode: action === 'prompt-preview-full' ? 'full' : 'minimal'
                        });
                        const r = await copyText(envelope);
                        if (!r?.success) console.warn('Copy failed:', r?.error);
                    } catch (e) {
                        console.warn('Prompt preview failed:', e);
                    }
                    break;
                case 'copy-text':
                    const textResult = await copyText(node.content);
                    if (textResult.success) {
                        console.log('Node text copied to clipboard');
                    } else {
                        console.error('Failed to copy text:', textResult.error);
                    }
                    break;
                    
                case 'copy-config':
                    const nodeData = nodeActions.getNodeData(node.id);
                    console.log('Retrieved node data:', nodeData);
                    if (nodeData) {
                        const configResult = await copyConfig(nodeData, /** @type {any} */ ('node'), /** @type {any} */ ($connections), null, null, node.content);
                        if (configResult.success) {
                            console.log('Node config copied to clipboard successfully');
                            console.log('Config:', configResult.config);
                        } else {
                            console.error('Failed to copy config:', configResult.error);
                        }
                    } else {
                        console.error('No node data found for node:', node.id);
                    }
                    break;
                    
                case 'copy-metadata':
                    const nodeDataForMetadata = nodeActions.getNodeData(node.id);
                    console.log('Retrieved node data for metadata:', nodeDataForMetadata);
                    if (nodeDataForMetadata) {
                        const metadataResult = await copyNodeMetadata(nodeDataForMetadata);
                        if (metadataResult.success) {
                            console.log('Node metadata copied to clipboard successfully');
                            console.log('Metadata YAML:', metadataResult.yamlConfig);
                        } else {
                            console.error('Failed to copy metadata:', metadataResult.error);
                        }
                    } else {
                        console.error('No node data found for node:', node.id);
                    }
                    break;
                    
                case 'paste-config':
                    const pasteResult = await pasteConfig();
                    if (pasteResult.success) {
                        let config = null;
                        
                        if (pasteResult.type === 'node_config' || pasteResult.type === 'raw_yaml' || pasteResult.type === 'node_metadata') {
                            config = pasteResult.data.config;
                        }
                        
                        if (config) {
                            console.log('Pasting YAML config to node:', node.id);
                            console.log('YAML content:', config);
                            
                            const applyResult = nodeActions.applyNodeConfig(node.id, config);
                            if (applyResult.success) {
                                console.log('Node config applied successfully');
                            } else {
                                console.error('Failed to apply config:', applyResult.error);
                            }
                        } else {
                            console.error('No valid config found in paste data');
                        }
                    } else {
                        console.error('Failed to paste config:', pasteResult.error);
                    }
                    break;
                    
                case 'toggle-lock':
                    nodeActions.toggleLock(node.id);
                    break;
                    
                case 'customize':
                    showCustomizeDialog();
                    break;
                case 'configure':
                    if (node.type === 'text_file_output') {
                        if (typeof window !== 'undefined' && (/** @type {any} */ (window)).showConfigureTextOutput) {
                            (/** @type {any} */ (window)).showConfigureTextOutput(node.id);
                        }
                    } else if (node.type === 'ai') {
                        if (typeof window !== 'undefined' && (/** @type {any} */ (window)).showConfigureAI) {
                            (/** @type {any} */ (window)).showConfigureAI(node.id);
                        }
                    }
                    break;
                
                case 'delete':
                    nodeActions.delete(node.id);
                    break;
            }
        } catch (error) {
            console.error('Context menu action failed:', error);
        }
    }
    
    /** @param {MouseEvent} event */
    function handleGlobalMouseMove(event) {
        // Don't interfere with canvas box selection
        if (blockNodeInteractions || $canvasState.mode === 'box-selecting') {
            return;
        }
        
        // Check if we should start dragging
        const distance = Math.sqrt(
            Math.pow(event.clientX - mouseDownPos.x, 2) + 
            Math.pow(event.clientY - mouseDownPos.y, 2)
        );
        
        if (!isDragging && distance > 5) {
            isDragging = true;
            console.log('Started dragging node:', node.id);
        }
        
        if (!isDragging) return;
        
        // Calculate new position (accounting for canvas viewport)
        const canvas = /** @type {HTMLElement | null} */ (document.querySelector('.canvas-content'));
        if (!canvas) return;
        const canvasRect = canvas.getBoundingClientRect();
        const canvasTransform = getComputedStyle(canvas).transform;
        
        // Parse transform matrix to get scale
        const matrix = new DOMMatrix(canvasTransform);
        const scale = matrix.a; // scale factor
        
        // Calculate position relative to canvas
        const newX = (event.clientX - canvasRect.left - dragOffset.x) / scale;
        const newY = (event.clientY - canvasRect.top - dragOffset.y) / scale;
        
        nodeActions.move(node.id, newX, newY);
    }
    
    function handleGlobalMouseUp() {
        // Don't interfere with canvas box selection
        if (blockNodeInteractions || $canvasState.mode === 'box-selecting') {
            return;
        }
        
        isDragging = false;
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        // Re-enable selection
        setGlobalUserSelect(false);
        // Recalculate size after drag completes to ensure stable dimensions
        requestAnimationFrame(() => {
            // First, run the content-based expansion logic for text_file_output
            updateNodeDimensions();
            // Then, persist final measured size to the store after layout settles
            setTimeout(() => updateNodeSize(), 50);
        });
    }
    
    // Handle content editing
    function startEditing() {
        if (node.type === 'input' || node.type === 'static') {
            isEditing = true;
            if (isDynamicSizingNode) {
                showDynamicExpand = false;
                hasDynamicOverflow = false;
            }
            if (isDynamicSizingNode && isContentExpanded) {
                isContentExpanded = false;
                hasDynamicOverflow = false;
                showDynamicExpand = false;
                requestAnimationFrame(() => adjustDynamicNodeLayout(true));
            }
            setTimeout(() => {
                if (contentElement) {
                    contentElement.focus();
                    autoResize(contentElement);
                }
            }, 10);
        }
    }

    function stopEditing() {
        isEditing = false;
        if (isDynamicSizingNode) {
            requestAnimationFrame(() => adjustDynamicNodeLayout(true));
        }
    }
    
    /** @param {Event} event */
    function handleContentChange(event) {
        const el = /** @type {HTMLTextAreaElement | HTMLInputElement} */ (event.target);
        nodeActions.update(node.id, { content: el?.value ?? '' });
        if (el) autoResize(el);
    }
    
    /** @param {Event} event */
    function handleTitleChange(event) {
        const el = /** @type {HTMLInputElement} */ (event.target);
        nodeActions.update(node.id, { title: el?.value ?? '' });
    }
    
    // Handle delete key
    /** @param {KeyboardEvent} event */
    function handleKeyDown(event) {
        if (event.key === 'Delete' && !isEditing && $canvasState.selectedNode === node.id) {
            nodeActions.delete(node.id);
        }
    }
    
    // Auto-resize textarea
    /** @param {HTMLElement & { style: any, scrollHeight: number }} element */
    function autoResize(element) {
        element.style.height = 'auto';
        element.style.overflow = 'hidden';
        element.style.height = element.scrollHeight + 'px';
    }
    
    /**
     * Render simple markdown-ish content to HTML for display.
     * @param {string} text
     */
    function renderGeneratedHtml(text) {
        if (!text) return '';
        return String(text).split('\n').map((line) => {
            return line
                .replace(/^# (.*)/g, '<h1>$1</h1>')
                .replace(/^## (.*)/g, '<h2>$1</h2>')
                .replace(/^### (.*)/g, '<h3>$1</h3>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/^- (.*)/g, '• $1');
        }).join('<br>');
    }
    
    // Connection port handlers
    /** @param {MouseEvent} event @param {string} port */
    function handlePortMouseDown(event, port) {
        event.stopPropagation();
        if (startConnection) {
            startConnection(node.id, port);
        }
    }
    
    /** @param {MouseEvent} event @param {string} port */
    function handlePortMouseUp(event, port) {
        event.stopPropagation();
        if (completeConnection && port === 'input' && isConnecting) {
            completeConnection(node.id, port);
        }
    }

    /** @param {MouseEvent} event */
    function handleNodeBodyMouseUp(event) {
        // Allow dropping connection on node body to connect to input port
        if (completeConnection && isConnecting && node.type !== 'static' && !isFileSourceMeta) {
            event.stopPropagation();
            completeConnection(node.id, 'input');
        }
    }

    let isConnectionHovering = false;

    /** @param {MouseEvent} event */
    function handleNodeBodyMouseEnter(event) {
        if (isConnecting && node.type !== 'static' && !isFileSourceMeta) {
            isConnectionHovering = true;
        }
    }

    /** @param {MouseEvent} event */
    function handleNodeBodyMouseLeave(event) {
        isConnectionHovering = false;
    }

    /** @param {KeyboardEvent} event */
    function handleNodeActivation(event) {
        const t = /** @type {HTMLElement} */ (event.target);
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleClick(event);
        }
    }

    // ── Touch drag support for node cards ──────────────────────────────────────
    /** @type {number | null} */
    let touchIdentifier = null;

    /** @param {TouchEvent} event */
    function handleTouchStart(event) {
        const t = /** @type {HTMLElement} */ (event.target);
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
        if (blockNodeInteractions || $canvasState.mode === 'box-selecting') {
            event.stopPropagation();
            return;
        }
        if (event.touches.length !== 1) return; // ignore multi-touch (pan/zoom handled by Canvas)
        event.stopPropagation();
        // Do NOT preventDefault here — we need the touch to propagate to canvas for two-finger
        // pan/zoom. We only prevent default when we actually start dragging (on move).

        const touch = event.touches[0];
        touchIdentifier = touch.identifier;
        mouseDownTime = Date.now();
        mouseDownPos = { x: touch.clientX, y: touch.clientY };

        const curr = /** @type {HTMLElement | null} */ (event.currentTarget);
        if (!curr) return;
        const rect = curr.getBoundingClientRect();
        dragOffset.x = touch.clientX - rect.left;
        dragOffset.y = touch.clientY - rect.top;

        document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
        document.addEventListener('touchend', handleGlobalTouchEnd);
        document.addEventListener('touchcancel', handleGlobalTouchEnd);
        setGlobalUserSelect(true);
    }

    /** @param {TouchEvent} event */
    function handleGlobalTouchMove(event) {
        if (touchIdentifier === null) return;
        if (blockNodeInteractions || $canvasState.mode === 'box-selecting') return;

        // Find our tracked touch
        let touch = null;
        for (let i = 0; i < event.changedTouches.length; i++) {
            if (event.changedTouches[i].identifier === touchIdentifier) {
                touch = event.changedTouches[i];
                break;
            }
        }
        if (!touch) return;

        const distance = Math.sqrt(
            Math.pow(touch.clientX - mouseDownPos.x, 2) +
            Math.pow(touch.clientY - mouseDownPos.y, 2)
        );

        if (!isDragging && distance > 8) {
            isDragging = true;
        }

        if (!isDragging) return;

        // Prevent canvas pan when dragging a node
        event.preventDefault();
        event.stopPropagation();

        const canvas = /** @type {HTMLElement | null} */ (document.querySelector('.canvas-content'));
        if (!canvas) return;
        const canvasRect = canvas.getBoundingClientRect();
        const canvasTransform = getComputedStyle(canvas).transform;
        const matrix = new DOMMatrix(canvasTransform);
        const scale = matrix.a;

        const newX = (touch.clientX - canvasRect.left - dragOffset.x) / scale;
        const newY = (touch.clientY - canvasRect.top - dragOffset.y) / scale;
        nodeActions.move(node.id, newX, newY);
    }

    function handleGlobalTouchEnd() {
        touchIdentifier = null;
        isDragging = false;
        document.removeEventListener('touchmove', handleGlobalTouchMove);
        document.removeEventListener('touchend', handleGlobalTouchEnd);
        document.removeEventListener('touchcancel', handleGlobalTouchEnd);
        setGlobalUserSelect(false);
        requestAnimationFrame(() => {
            updateNodeDimensions();
            setTimeout(() => updateNodeSize(), 50);
        });
    }

    // Update node size in store
    /** @type {number | null} */
    let __lastMeasuredW = null;
    /** @type {number | null} */
    let __lastMeasuredH = null;
    function updateNodeSize() {
        // Measure the actual card element (root of the node UI)
        if (!nodeCardElement) return;
        if (isDynamicSizingNode && !isEditing) {
            __lastMeasuredW = nodeCardElement.offsetWidth;
            __lastMeasuredH = nodeCardElement.offsetHeight;
            return;
        }
        const newWidth = nodeCardElement.offsetWidth;
        const newHeight = nodeCardElement.offsetHeight;
        const heightChanged = Math.abs((node.height || 0) - newHeight) >= 2; // vertical-only persistence
        const localHeightChanged = __lastMeasuredH === null || Math.abs(__lastMeasuredH - newHeight) >= 2;

        if (newWidth > 0 && newHeight > 0) {
            let didChange = false;
            // All nodes: persist only height to avoid horizontal auto-growth
            if (heightChanged && localHeightChanged) {
                didChange = true;
                __lastMeasuredW = newWidth; // track locally to avoid retrigger loops
                __lastMeasuredH = newHeight;
                nodeActions.update(node.id, { height: newHeight });
            }

            if (didChange) {
                // Force container bounds recalculation so containers resize immediately
                scheduleContainerBoundsRecalc();
            }
        }
    }

    onMount(() => {
        // Set initial height
        if (isDynamicSizingNode) {
            requestAnimationFrame(() => adjustDynamicNodeLayout());
        } else {
            requestAnimationFrame(updateNodeSize);
        }
    });

    afterUpdate(() => {
        // Update height after render
        if (isDynamicSizingNode) {
            requestAnimationFrame(() => adjustDynamicNodeLayout());
        } else {
            requestAnimationFrame(updateNodeSize);
        }
    });
</script>

<svelte:window on:keydown={handleKeyDown} />

<div
    bind:this={nodeCardElement}
    class="node-card {diagramShapeClass}"
    class:selected={isSelected}
    class:dragging={isDragging}
    class:executing={isExecuting}
    class:completed={isCompleted}
    class:locked={node.locked}
    class:connection-hovering={isConnectionHovering}
    style="
        left: {node.x}px;
        top: {node.y}px;
        border-color: {nodeMeta.borderColor};
        --accent: {nodeMeta.color};
        width: {diagramNodeWidth ?? (node.width || BASE_NODE_WIDTH)}px;
        {$isDiagrammingMode ? `height: ${diagramNodeHeight}px;` : (isDynamicSizingNode && !isEditing ? `height: ${(node.height || BASE_NODE_HEIGHT)}px;` : '')}
        --preview-width: {node.type === 'text_file_output' && node.content && node.content !== 'Waiting for input...' ? `${Math.max(BASE_PREVIEW_WIDTH, (node.width || TEXT_GEN_WIDTH) - CONTENT_OVERHEAD)}px` : 'auto'};
        {customStyle}
    "
    on:mousedown={handleMouseDown}
    on:mouseup={handleNodeBodyMouseUp}
    on:mouseenter={handleNodeBodyMouseEnter}
    on:mouseleave={handleNodeBodyMouseLeave}
    on:click={handleClick}
    on:dblclick={handleDoubleClick}
    on:contextmenu={handleRightClick}
    on:touchstart={handleTouchStart}
    on:keydown={handleNodeActivation}
    role="button"
    tabindex="0"
>
    {#if $isDiagrammingMode}
        <!-- ── Diagram mode: icon-dominant layout ── -->
        <div class={`diagram-icon-layout${diagramHasContent ? ' diagram-has-content' : ''}`}>
            <div class="diagram-icon-large">
                {#if iconSvg}
                    {@html iconSvg}
                {:else}
                    <span class="diagram-emoji-large">{nodeMeta.icon}</span>
                {/if}
            </div>
            <div
                class="diagram-label"
                role="textbox"
                tabindex="0"
                aria-label="Node title"
                title={displayTitle}
            >{displayTitle}</div>
            {#if diagramHasContent}
                <div class="diagram-content-label">{node.content}</div>
            {/if}
            <!-- Execution indicator overlay -->
            {#if isExecuting}
                <div class="diagram-executing-indicator">
                    <div class="spinner"></div>
                </div>
            {:else if isCompleted && !node.locked}
                <div class="diagram-completed-indicator">✓</div>
            {/if}
        </div>
        <!-- Close button overlaid top-right -->
        <button
            class="diagram-delete-btn"
            on:click|stopPropagation={() => nodeActions.delete(node.id)}
            title="Delete node"
        >×</button>
        <!-- Lock indicator overlaid top-left -->
        {#if node.locked}
            <button
                class="diagram-lock-btn"
                on:click|stopPropagation={() => nodeActions.toggleLock(node.id)}
                title="Unlock Node"
            >🔒</button>
        {/if}
    {:else}
        <!-- ── Knowledge/Automation mode: standard header layout ── -->
        <div class="node-header" bind:this={nodeHeaderElement}>
            {#if iconSvg}
                <span class="node-icon node-icon-svg" aria-hidden="true">{@html iconSvg}</span>
            {:else}
                <span class="node-icon">{nodeMeta.icon}</span>
            {/if}
            <input
                class="node-title"
                value={displayTitle}
                on:input={handleTitleChange}
                on:click|stopPropagation
                title={filePath || displayTitle}
            />
            <span class="node-type-badge">{nodeMeta.label}</span>

            <!-- Lock indicator -->
            {#if node.locked}
                <button
                    class="lock-btn"
                    on:click|stopPropagation={() => nodeActions.toggleLock(node.id)}
                    title="Unlock Node"
                >
                    🔒
                </button>
            {/if}

            <!-- Execution indicator -->
            {#if isExecuting}
                <div class="execution-indicator">
                    <div class="spinner"></div>
                </div>
            {:else if isCompleted && !node.locked}
                <div class="completion-indicator">✓</div>
            {/if}

            <button
                class="delete-btn"
                on:click|stopPropagation={() => nodeActions.delete(node.id)}
                title="Delete node"
            >
                ×
            </button>
        </div>
    {/if}
    
    <!-- Node content (knowledge/automation mode only) -->
    {#if !$isDiagrammingMode}
    <div class="node-content" bind:this={nodeContentElement}>
        {#if (node.type === 'text_file_source' || node.type === 'pdf_file_source') && filePath}
            <div class="file-path" title={filePath}>{filePath}</div>
        {/if}
        {#if node.type === 'input' || node.type === 'static'}
            {#if isEditing}
                <textarea
                    bind:this={contentElement}
                    class="content-editor"
                    value={node.content}
                    placeholder="Enter your content..."
                    on:input={handleContentChange}
                    on:blur={stopEditing}
                    on:click|stopPropagation
                ></textarea>
            {:else}
                <div class="dynamic-preview">
                    <div
                        role="button"
                        tabindex="0"
                        aria-label="Node content - double-click to edit"
                        class="content-display dynamic-content"
                        class:dynamic-expanded={isContentExpanded}
                        class:dynamic-clamped={showDynamicExpand && !isContentExpanded}
                        style={`max-height: ${isContentExpanded ? dynamicExpandedContentMax : dynamicCollapsedContentMax}px;`}
                        on:dblclick|stopPropagation={startEditing}
                        on:keydown={(e) => e.key === 'Enter' && startEditing()}
                    >
                        {@html renderGeneratedHtml(node.content || '')}
                    </div>
                    {#if showDynamicExpand || isContentExpanded}
                        <div class="preview-controls">
                            <button class="expand-btn" on:click|stopPropagation={toggleDynamicExpansion}>
                                {isContentExpanded ? '🔽 Collapse' : '🔼 Expand'}
                            </button>
                        </div>
                    {/if}
                </div>
            {/if}
        {:else if node.type === 'ai'}
            <div class="dynamic-preview">
                <div class="ai-content"
                    class:dynamic-expanded={isContentExpanded}
                    class:dynamic-clamped={showDynamicExpand && !isContentExpanded}
                    style={`max-height: ${isContentExpanded ? dynamicExpandedContentMax : dynamicCollapsedContentMax}px;`}
                >
                    {#if node.content}
                        {@html renderGeneratedHtml(node.content)}
                    {:else}
                        Click ▶️ to generate content
                    {/if}
                </div>
                {#if showDynamicExpand || isContentExpanded}
                    <div class="preview-controls">
                        <button class="expand-btn" on:click|stopPropagation={toggleDynamicExpansion}>
                            {isContentExpanded ? '🔽 Collapse' : '🔼 Expand'}
                        </button>
                    </div>
                {/if}
            </div>
        {:else if node.type === 'text_file_source'}
            <div class="artifact-content">
                <div class="artifact-preview" class:expanded={isExpanded}>
                    {node.content}
                </div>
                <div class="artifact-controls">
                    <button class="expand-btn" on:click|stopPropagation={() => { isExpanded = !isExpanded; setTimeout(updateNodeSize, 10); }}>
                        {isExpanded ? '🔽 Collapse' : '🔼 Expand'}
                    </button>
                    <button class="select-file-btn" on:click|stopPropagation={() => nodeActions.selectFileForTextFileSource(node.id)}>
                        Select/Change File
                    </button>
                </div>
            </div>
        {:else if node.type === 'pdf_file_source'}
            <div class="artifact-content">
                <div class="artifact-preview" class:expanded={isExpanded}>
                    {node.content}
                </div>
                <div class="artifact-controls">
                    <button class="expand-btn" on:click|stopPropagation={() => { isExpanded = !isExpanded; setTimeout(updateNodeSize, 10); }}>
                        {isExpanded ? '🔽 Collapse' : '🔼 Expand'}
                    </button>
                    <button class="select-file-btn" on:click|stopPropagation={() => nodeActions.selectFileForPdfFileSource(node.id)}>
                        Select/Change PDF
                    </button>
                </div>
            </div>
        {:else if node.type === 'text_file_output'}
            <div class="artifact-output-content">
                <div class="generated-content-display" class:expanded={isOutputExpanded} bind:this={contentDisplayElement}>
                    {#if node.content && node.content !== 'Waiting for input...'}
                        {@html renderGeneratedHtml(node.content)}
                    {:else}
                        <div class="waiting-state">Click ▶️ to generate content</div>
                    {/if}
                </div>
                <div class="output-controls">
                    <button class="expand-btn" on:click|stopPropagation={() => { isOutputExpanded = !isOutputExpanded; setTimeout(updateNodeSize, 10); }}>
                        {isOutputExpanded ? '🔽 Collapse' : '🔼 Expand'}
                    </button>
                    <button class="save-artifact-btn" on:click|stopPropagation={saveArtifact} disabled={!node.content || node.content === 'Waiting for input...'}>
                        Save to File...
                    </button>
                </div>
            </div>
        {/if}
    </div>

    <!-- Model badge for AI/Text Output -->
    {#if (node.type === 'ai' || node.type === 'text_file_output') && nodeModel}
      <div class="model-badge" title="Model in use">{nodeModel}</div>
    {/if}

    {#if isDynamicSizingNode}
        <div class="dynamic-measurement" aria-hidden="true" bind:this={aiMeasurementElement}></div>
    {/if}
    {/if}<!-- end !isDiagrammingMode -->

    <!-- Connection ports -->
    {#if node.type !== 'static' && !isFileSourceMeta}
        <div
            role="button"
            tabindex="0"
            aria-label="Input connection port"
            class="connection-port input-port"
            class:active={isConnecting}
            data-port="input"
            title="Input"
            on:mousedown={(e) => handlePortMouseDown(e, 'input')}
            on:mouseup={(e) => handlePortMouseUp(e, 'input')}
        ></div>
    {/if}
    <div
        role="button"
        tabindex="0"
        aria-label="Output connection port"
        class="connection-port output-port"
        class:active={!isConnecting}
        data-port="output"
        title="Output"
        on:mousedown={(e) => handlePortMouseDown(e, 'output')}
        on:mouseup={(e) => handlePortMouseUp(e, 'output')}
    ></div>

    <!-- Requirements traceability badge -->
    {#if nodeRequirements.length > 0}
        <div
            class="req-badge"
            title={nodeRequirements.join('\n')}
            aria-label="{nodeRequirements.length} requirement{nodeRequirements.length === 1 ? '' : 's'}"
        >
            {nodeRequirements.length} req{nodeRequirements.length === 1 ? '' : 's'}
        </div>
    {/if}
</div>

<style>
    .node-card {
        position: absolute;
        background: #1e1e2e;
        border-radius: 8px;
        border: 2px solid #45475a;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        cursor: url('../assets/cursor-grab.svg') 16 16, move;
        min-height: 120px;
        width: 250px;
        user-select: none;
        transition: box-shadow 0.2s ease; /* avoid animating width to prevent jitter */
        overflow: visible; /* allow connector circles to render outside the card */
    }
    
    .node-card:hover {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    }
    
    .node-card.selected {
        border-color: #2196f3 !important;
        box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.5), 0 4px 16px rgba(0, 0, 0, 0.15);
    }

    .node-card.connection-hovering {
        border-color: #4caf50 !important;
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.3), 0 4px 16px rgba(0, 0, 0, 0.15);
        background-color: rgba(76, 175, 80, 0.05);
    }
    
    .node-card.dragging {
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        transform: scale(1.02);
        cursor: url('../assets/cursor-grabbing.svg') 16 16, grabbing;
    }
    
    .node-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-bottom: 1px solid #313244;
        background: rgba(49, 50, 68, 0.5);
        border-radius: 6px 6px 0 0;
        width: 100%;
        box-sizing: border-box;
    }
    
    .node-icon {
        font-size: 16px;
        margin-right: 8px;
        flex-shrink: 0;
    }

    .node-icon-svg {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        font-size: 0; /* suppress any text node content */
    }

    .node-icon-svg :global(svg) {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
    }

    .node-title {
        flex: 1;
        border: none;
        background: transparent;
        font-weight: 600;
        font-size: 14px;
        color: #cdd6f4;
        outline: none;
        cursor: url('../assets/cursor-text.svg') 16 16, text;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .node-type-badge {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--accent);
        background: rgba(0,0,0,0.3);
        padding: 2px 6px;
        border-radius: 4px;
        flex-shrink: 0;
        margin-left: 4px;
    }
    
    .lock-btn {
        background: none;
        border: none;
        font-size: 14px;
        cursor: pointer;
        color: #666;
        padding: 0;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        flex-shrink: 0;
    }

    .lock-btn:hover {
        background: #e0e0e0;
    }

    .delete-btn {
        background: none;
        border: none;
        font-size: 16px;
        cursor: url('../assets/cursor-pointer.svg') 16 16, pointer;
        color: #999;
        padding: 0;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        flex-shrink: 0;
    }
    
    .delete-btn:hover {
        background: #ff4444;
        color: white;
    }

    .node-card.locked {
        border-style: dashed;
        border-color: #999 !important;
        opacity: 0.85;
    }
    
    .node-content {
        padding: 12px;
        min-height: 60px;
        position: relative;
    }

    .file-path {
        font-size: 11px;
        color: #555;
        margin-bottom: 6px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    
    .content-editor {
        width: 100%;
        border: none;
        background: transparent;
        resize: none;
        outline: none;
        font-family: inherit;
        font-size: 13px;
        line-height: 1.4;
        min-height: 40px;
        word-break: break-word;
        overflow-wrap: anywhere;
    }
    
    .content-display {
        cursor: url('../assets/cursor-text.svg') 16 16, text;
        min-height: 40px;
        font-size: 13px;
        line-height: 1.4;
        color: var(--ctp-text, #cdd6f4);
        white-space: pre-wrap;
    }

    .content-display:empty::before {
        content: 'Double-click to edit...';
        color: #999;
        font-style: italic;
    }

    .dynamic-preview {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-bottom: 8px; /* ensure controls are included in preview box height */
    }

    /* Match expand control alignment with file nodes */
    .preview-controls {
        display: flex;
        gap: 8px;
        justify-content: flex-start;
        align-self: flex-start;
        /* no top margin; spacing comes from dynamic-preview gap/padding */
        margin-top: 0;
    }

    .content-display.dynamic-content,
    .ai-content {
        background: rgba(17, 17, 27, 0.6);
        border: 1px solid #313244;
        border-radius: 4px;
        padding: 8px;
        box-sizing: border-box;
        word-break: break-word;
        overflow-wrap: anywhere;
    }

    .dynamic-clamped {
        overflow: hidden;
    }

    .dynamic-expanded {
        overflow-y: auto;
    }

    /* NOTE: duplicate .preview-controls removed — single definition kept above */

    .ai-content {
        font-size: 13px;
        line-height: 1.4;
        color: var(--ctp-text, #cdd6f4);
        font-style: italic;
        min-height: 40px;
    }

    .dynamic-measurement {
        position: absolute;
        visibility: hidden;
        pointer-events: none;
        top: -9999px;
        left: -9999px;
        width: auto;
        max-width: none;
        height: auto;
        font-size: 13px;
        line-height: 1.4;
        font-style: normal;
        color: #333;
        margin: 0;
        padding: 8px; /* match inner preview padding for accurate measurement */
        white-space: normal;
        overflow: visible;
        word-break: break-word;
        overflow-wrap: anywhere;
    }

    /* Add styles for the new artifact node */
    .artifact-content {
        font-size: 12px;
        color: #666;
    }
    
    .artifact-preview {
        max-height: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
        background: rgba(17, 17, 27, 0.6);
        color: var(--ctp-subtext1, #bac2de);
        padding: 8px;
        border-radius: 3px;
        border: 1px solid #313244;
        margin-bottom: 8px;
        white-space: pre-wrap;     /* preserve newlines from extracted text */
        word-break: normal;        /* keep words intact for readability */
        overflow-wrap: anywhere;   /* allow wrapping long tokens/URLs if needed */
        font-family: monospace;
        font-size: 11px;
        transition: max-height 0.3s ease;
    }
    
    .artifact-preview.expanded {
        max-height: 400px;
        overflow-y: auto;
    }
    
    .artifact-controls {
        display: flex;
        gap: 8px;
        justify-content: space-between;
    }
    
    .expand-btn {
        background: #f0f0f0;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        flex-shrink: 0;
    }
    
    .expand-btn:hover {
        background: #e0e0e0;
        border-color: #bbb;
    }
    
    .select-file-btn {
        flex: 1;
        padding: 4px;
        font-size: 11px;
        background: #f0f0f0;
        border: 1px solid #ccc;
        border-radius: 3px;
        cursor: pointer;
        transition: background 0.2s;
    }
    
    .select-file-btn:hover {
        background: #e0e0e0;
    }

    .generated-content-display {
        min-height: 60px;
        max-height: 80px;
        overflow: hidden;
        width: var(--preview-width, 100%);
        padding: 8px;
        background: rgba(17, 17, 27, 0.6);
        border-radius: 4px;
        border: 1px solid #313244;
        font-size: 15px;
        line-height: 1.5;
        margin-bottom: 8px;
        transition: max-height 0.3s ease;
        color: var(--ctp-text, #cdd6f4);
    }

    .generated-content-display.expanded {
        max-height: 400px;
        overflow-y: auto;
        color: var(--ctp-text, #cdd6f4);
        min-width: 200px;
        max-width: 600px;
        word-wrap: break-word;
        overflow-wrap: break-word;
        box-sizing: border-box;
    }
    
    
    .waiting-state {
        color: #888;
        font-style: italic;
        text-align: center;
        padding: 20px;
    }
    
    .output-controls {
        display: flex;
        gap: 8px;
        justify-content: space-between;
    }
    
    .save-artifact-btn {
        flex: 1;
        padding: 4px;
        font-size: 11px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
    }
    
    .save-artifact-btn:hover {
        background: #45a049;
    }
    
    .save-artifact-btn:disabled {
        background: #ccc;
        cursor: not-allowed;
    }
    
    .connection-port {
        position: absolute;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #fff;
        border: 2px solid #666;
        cursor: url('../assets/cursor-pointer.svg') 16 16, pointer;
        z-index: 3; /* ensure ports appear above card content */
    }
    
    .input-port {
        left: -6px;
        top: 50%;
        transform: translateY(-50%);
    }
    
    .output-port {
        right: -6px;
        top: 50%;
        transform: translateY(-50%);
    }
    
    .connection-port:hover {
        background: #2196f3;
        border-color: #2196f3;
        transform: translateY(-50%) scale(1.2);
    }
    
    .connection-port.active {
        background: #4caf50;
        border-color: #4caf50;
        box-shadow: 0 0 8px rgba(76, 175, 80, 0.5);
    }
    
    /* Execution state styles */
    .node-card.executing {
        border-color: #ff9800 !important;
        box-shadow: 0 0 0 3px rgba(255, 152, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.15);
        animation: pulse-executing 2s ease-in-out infinite;
    }
    
    .node-card.completed {
        border-color: #4caf50 !important;
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.3), 0 4px 16px rgba(0, 0, 0, 0.15);
    }
    
    @keyframes pulse-executing {
        0%, 100% {
            box-shadow: 0 0 0 3px rgba(255, 152, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.15);
        }
        50% {
            box-shadow: 0 0 0 6px rgba(255, 152, 0, 0.2), 0 6px 20px rgba(255, 152, 0, 0.1);
        }
    }
    
    .execution-indicator {
        display: flex;
        align-items: center;
        position: absolute;
        right: 30px;
        top: 50%;
        transform: translateY(-50%);
    }

    .model-badge {
        position: absolute;
        right: 20px; /* extra margin so it doesn't overlap the output port at right: -6px */
        bottom: 6px;
        background: rgba(0,0,0,0.35);
        color: var(--ctp-subtext0, #a6adc8);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 10px;
        pointer-events: none;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        z-index: 2;
    }
    
    .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #f3f3f3;
        border-top: 2px solid #ff9800;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    
    .completion-indicator {
        color: #4caf50;
        font-weight: bold;
        font-size: 16px;
        position: absolute;
        right: 30px;
        top: 50%;
        transform: translateY(-50%);
    }

    /* ── Diagram Mode Visual Variants ── */
    .diagram-node {
        z-index: 3;
    }

    /* Decision nodes — diamond hint via clipped corners + dashed border */
    .diagram-decision {
        border-radius: 4px;
        border-style: dashed;
    }
    .diagram-decision .node-header {
        border-radius: 2px 2px 0 0;
    }

    /* Database nodes — cylinder hint via rounded top */
    .diagram-database {
        border-radius: 12px 12px 4px 4px;
        border-top-width: 3px;
    }
    .diagram-database .node-header {
        border-radius: 10px 10px 0 0;
        border-top: 2px solid var(--accent);
    }

    /* Cloud nodes — extra rounded, softer appearance */
    .diagram-cloud {
        border-radius: 20px;
        border-style: dotted;
        border-width: 2px;
    }
    .diagram-cloud .node-header {
        border-radius: 18px 18px 0 0;
    }

    /* Server nodes — more boxy, industrial look */
    .diagram-server {
        border-radius: 4px;
        border-width: 2px;
    }
    .diagram-server .node-header {
        border-radius: 2px 2px 0 0;
    }

    /* API nodes — slightly tinted background */
    .diagram-api {
        background: rgba(30, 30, 46, 0.95);
        border-radius: 8px;
    }

    /* Queue nodes — elongated feel */
    .diagram-queue {
        border-radius: 16px;
    }
    .diagram-queue .node-header {
        border-radius: 14px 14px 0 0;
    }

    /* Cache nodes — energetic accent */
    .diagram-cache {
        border-radius: 8px;
        box-shadow: inset 0 0 8px rgba(242, 205, 205, 0.05);
    }

    /* Gateway/Firewall — secure look */
    .diagram-gateway, .diagram-firewall {
        border-radius: 6px;
        border-width: 3px;
    }

    /* Monitor nodes — subtle glow */
    .diagram-monitor {
        box-shadow: 0 0 12px rgba(166, 227, 161, 0.08);
    }

    /* User nodes — softer appearance */
    .diagram-user {
        border-radius: 16px;
        border-style: solid;
    }

    /* Loadbalancer — distinctive shape */
    .diagram-loadbalancer {
        border-radius: 8px;
        border-width: 2px;
    }

    /* Container nodes — Docker-esque */
    .diagram-container {
        border-radius: 6px;
        border-style: solid;
        border-width: 2px;
    }

    /* ── Diagram Mode: Icon-Dominant Layout ── */

    /* Override node-card minimum height in diagram mode (handled inline, but ensure no CSS fights it) */
    .diagram-node {
        min-height: unset;
    }

    .diagram-icon-layout {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 10px 8px 10px;
        min-height: 100%;
        height: 100%;
        box-sizing: border-box;
        position: relative;
        overflow: hidden;
    }

    /* When content exists, top-align so icon + title + content stack from top */
    .diagram-icon-layout.diagram-has-content {
        justify-content: flex-start;
    }

    .diagram-icon-large {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 72px;
        height: 72px;
        margin-bottom: 6px;
        flex-shrink: 0;
    }

    /* Scale SVG icons up to fill the container */
    .diagram-icon-large :global(svg) {
        width: 64px;
        height: 64px;
    }

    .diagram-emoji-large {
        font-size: 48px;
        line-height: 1;
    }

    .diagram-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--accent, #cba6f7);
        text-align: center;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 4px;
        cursor: default;
        /* Allow 2-line wrap for longer labels instead of single-line truncation */
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.3;
    }

    .diagram-content-label {
        font-size: 10px;
        color: #a6adc8;
        text-align: left;
        margin-top: 6px;
        width: 100%;
        max-width: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        white-space: normal;
        word-wrap: break-word;
        word-break: break-word;
        line-height: 1.35;
        padding: 4px 8px;
        box-sizing: border-box;
        max-height: 100px;
        border-top: 1px solid rgba(166, 173, 200, 0.15);
        background: rgba(0,0,0,0.12);
        border-radius: 4px;
        flex: 1;
    }

    /* Overlay close button — top-right corner */
    .diagram-delete-btn {
        position: absolute;
        top: 4px;
        right: 6px;
        background: transparent;
        border: none;
        color: #585b70;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        z-index: 10;
        opacity: 0;
        transition: opacity 0.15s ease, color 0.15s ease;
    }

    .diagram-node:hover .diagram-delete-btn,
    .diagram-node.selected .diagram-delete-btn {
        opacity: 1;
    }

    .diagram-delete-btn:hover {
        color: #f38ba8;
    }

    /* Overlay lock button — top-left corner */
    .diagram-lock-btn {
        position: absolute;
        top: 4px;
        left: 6px;
        background: transparent;
        border: none;
        font-size: 12px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        z-index: 10;
    }

    /* Execution / completion indicators for diagram mode */
    .diagram-executing-indicator {
        position: absolute;
        top: 4px;
        left: 50%;
        transform: translateX(-50%);
    }

    .diagram-completed-indicator {
        position: absolute;
        top: 4px;
        left: 50%;
        transform: translateX(-50%);
        color: #a6e3a1;
        font-size: 12px;
        font-weight: bold;
    }

    /* Requirements traceability badge */
    .req-badge {
        position: absolute;
        bottom: 6px;
        left: 8px;
        background: rgba(203, 166, 247, 0.15); /* mauve #cba6f7 tinted */
        color: #cba6f7; /* Catppuccin Mocha mauve */
        border: 1px solid rgba(203, 166, 247, 0.4);
        border-radius: 10px;
        padding: 2px 7px;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        pointer-events: none;
        z-index: 2;
        white-space: nowrap;
        max-width: 80px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
