<script>
    import { canvasState } from '../stores/canvas.js';
    import { executionState, workflowActions, containerCustomizations } from '../stores/workflows.js';
    import { nodeActions, nodeDataStore, nodes } from '../stores/nodes.js';
    import { copyText, copyConfig, copyMachineConfig, copyMachineMetadata, copyNetworkConfig, copyNetworkMetadata, pasteConfig } from './clipboard.js';
    import { templateActions } from '../stores/templates.js';
    import { chatActions } from '../stores/chat.js';
    import { appMode, isDiagrammingMode } from '../stores/mode.js';
    
    /** @type {any} */
    export let container;
    /** @type {boolean} */
    export let isTopLevel = false;
    /** @type {boolean} */
    export let blockNodeInteractions = false;
    /** @type {((fromId: string, port: string) => void) | null} */
    export let startConnection = null;
    /** @type {((toId: string, port: string) => void) | null} */
    export const completeConnection = null;
    /** @type {boolean} */
    export const isConnecting = false;
    
    /** @type {boolean} */
    let isDragging = false;
    /** @type {{x:number,y:number}} */
    let dragOffset = { x: 0, y: 0 };
    /** @type {{x:number,y:number}} */
    let mouseDownPos = { x: 0, y: 0 };
    /** @type {{ totalDeltaX:number, totalDeltaY:number }} */
    let movementBuffer = { totalDeltaX: 0, totalDeltaY: 0 };
    /** @type {Map<string,{x:number,y:number}>} */
    let originalPositions = new Map(); // Store original positions for all nodes
    /** @type {HTMLElement | null} */
    let containerElement = null; // Reference to the container DOM element for visual feedback
    /** @type {number} */
    let mouseDownTime = 0;
    
    
    $: isExecuting = $executionState.activeWorkflows.has(container.id);
    $: showPlayButton = (container.isWorkflow && container.nodes && container.nodes.length > 1) || 
                       (container.isFactory && container.machines && container.machines.length > 0) ||
                       (container.isNetwork && container.factories && container.factories.length > 0);
    
    // Get custom styling from containerCustomizations
    $: customization = $containerCustomizations?.get(container.id) || {};
    $: customStyle = (() => {
        let style = '';
        if (customization.customColor) {
            if (container.isNetwork) {
                style += `--network-color: ${customization.customColor};`;
            } else if (container.isFactory) {
                style += `--factory-color: ${customization.customColor};`;
            } else {
                style += `--machine-color: ${customization.customColor};`;
            }
        }
        return style;
    })();
    
    // Get display label (custom label or original label)
    $: displayLabel = customization.customLabel || getDefaultLabel();
    
    // Handle container dragging
    /** @param {MouseEvent} event */
    function handleMouseDown(event) {
        mouseDownTime = Date.now();
        // Only handle if clicking on container background, not nodes
        const t = /** @type {HTMLElement} */ (event.target);
        if (t?.closest('.node-card')) {
            return;
        }
        
        if (blockNodeInteractions) {
            event.stopPropagation();
            return;
        }
        
        event.stopPropagation();
        event.preventDefault();
        
        isDragging = false; // Will become true if we actually move
        mouseDownPos = { x: event.clientX, y: event.clientY };
        movementBuffer = { totalDeltaX: 0, totalDeltaY: 0 };
        originalPositions.clear();
        
        // Capture original positions of all nodes that will be moved
        captureOriginalPositions();
        
        const curr = /** @type {HTMLElement | null} */ (event.currentTarget);
        if (!curr) return;
        const rect = curr.getBoundingClientRect();
        dragOffset.x = event.clientX - rect.left;
        dragOffset.y = event.clientY - rect.top;
        
        // Add global listeners for robust dragging
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    
    /** @param {MouseEvent} event */
    function handleClick(event) {
        // Prevent click from firing after a drag operation
        if (isDragging || (Date.now() - mouseDownTime > 250)) {
            return;
        }
        // Only handle if clicking on container background, not nodes
        const t = /** @type {HTMLElement} */ (event.target);
        if (t?.closest('.node-card')) {
            return;
        }
        event.stopPropagation();
        console.log(`Container ${container.id} clicked for selection.`);
        canvasState.update(s => ({
            ...s,
            selectedNode: null,
            selectedNodes: [],
            selectedConnection: null,
            selectedContainer: container.id
        }));
    }

    // Capture original positions of all nodes that will be moved
    function captureOriginalPositions() {
        console.log('📍 Capturing original positions for container:', container.id);
        
        if (container.isNetwork) {
            // Capture all nodes in the network
            container.factories?.forEach((/** @type {any} */ factory) => {
                factory.machines?.forEach((/** @type {any} */ machine) => {
                    machine.nodes?.forEach((/** @type {any} */ node) => {
                        originalPositions.set(node.id, { x: node.x, y: node.y });
                    });
                });
                
                // Factory's individual nodes
                factory.nodeIds?.forEach((/** @type {any} */ nodeId) => {
                    let currentNode = null;
                    const unsubscribe = nodes.subscribe(nodeList => {
                        const list = /** @type {any[]} */ (nodeList);
                        currentNode = list.find(n => n.id === nodeId) || null;
                    });
                    unsubscribe();
                    
                    if (currentNode) {
                        const c = /** @type {any} */ (currentNode);
                        originalPositions.set(nodeId, { x: c.x, y: c.y });
                    }
                });
            });
            
            // Network's standalone machines
            container.machines?.forEach((/** @type {any} */ machine) => {
                machine.nodes?.forEach((/** @type {any} */ node) => {
                    originalPositions.set(node.id, { x: node.x, y: node.y });
                });
            });
            
            // Network's standalone nodes
            container.nodeIds?.forEach((/** @type {any} */ nodeId) => {
                let currentNode = null;
                const unsubscribe = nodes.subscribe(nodeList => {
                    const list = /** @type {any[]} */ (nodeList);
                    currentNode = list.find(n => n.id === nodeId) || null;
                });
                unsubscribe();
                
                if (currentNode) {
                    const c = /** @type {any} */ (currentNode);
                    originalPositions.set(nodeId, { x: c.x, y: c.y });
                }
            });
            
        } else if (container.isFactory) {
            // Capture all nodes in the factory
            container.machines?.forEach((/** @type {any} */ machine) => {
                machine.nodes?.forEach((/** @type {any} */ node) => {
                    originalPositions.set(node.id, { x: node.x, y: node.y });
                });
            });
            
            container.nodeIds?.forEach((/** @type {any} */ nodeId) => {
                let currentNode = null;
                const unsubscribe = nodes.subscribe(nodeList => {
                    const list = /** @type {any[]} */ (nodeList);
                    currentNode = list.find(n => n.id === nodeId) || null;
                });
                unsubscribe();
                
                if (currentNode) {
                    const c = /** @type {any} */ (currentNode);
                    originalPositions.set(nodeId, { x: c.x, y: c.y });
                }
            });
            
        } else {
            // Machine - capture its nodes
            container.nodes?.forEach((/** @type {any} */ node) => {
                originalPositions.set(node.id, { x: node.x, y: node.y });
            });
        }
        
        console.log(`📍 Captured ${originalPositions.size} node positions for buffered movement`);
    }
    
    /** @param {MouseEvent} event */
    function handleGlobalMouseMove(event) {
        // Check if we should start dragging
        const distance = Math.sqrt(
            Math.pow(event.clientX - mouseDownPos.x, 2) + 
            Math.pow(event.clientY - mouseDownPos.y, 2)
        );
        
        if (!isDragging && distance > 5) {
            isDragging = true;
            console.log('Started dragging workflow container:', container.id);
        }
        
        if (!isDragging) return;
        
        // ===== BUFFERED MOVEMENT SYSTEM =====
        // Instead of moving nodes immediately, just update the movement buffer
        const canvas = document.querySelector('.canvas-content');
        if (!canvas) return;
        const canvasTransform = getComputedStyle(canvas).transform;
        
        // Parse transform matrix to get scale
        const matrix = new DOMMatrix(canvasTransform);
        const scale = matrix.a; // scale factor
        
        // Update total movement delta (this is all we do during drag - no expensive node updates!)
        movementBuffer.totalDeltaX = (event.clientX - mouseDownPos.x) / scale;
        movementBuffer.totalDeltaY = (event.clientY - mouseDownPos.y) / scale;
        
        // ===== VISUAL SIMULATION =====
        // Apply lightweight CSS transform for immediate visual feedback
        if (containerElement) {
            containerElement.style.transform = `translate(${movementBuffer.totalDeltaX}px, ${movementBuffer.totalDeltaY}px)`;
            containerElement.style.transition = 'none'; // Disable transitions during drag
        }
        
        console.log(`🚀 Buffering movement: dx=${movementBuffer.totalDeltaX.toFixed(1)}, dy=${movementBuffer.totalDeltaY.toFixed(1)}`);
    }
    
    function handleGlobalMouseUp() {
        if (isDragging) {
            // ===== APPLY BUFFERED MOVEMENTS =====
            console.log('🎯 Applying buffered movements:', movementBuffer);
            console.log(`📦 Moving ${originalPositions.size} nodes by dx=${movementBuffer.totalDeltaX.toFixed(1)}, dy=${movementBuffer.totalDeltaY.toFixed(1)}`);
            
            // Apply all movements at once using original positions + total delta
            const startTime = performance.now();
            let moveCount = 0;
            
            originalPositions.forEach((originalPos, nodeId) => {
                const newX = originalPos.x + movementBuffer.totalDeltaX;
                const newY = originalPos.y + movementBuffer.totalDeltaY;
                nodeActions.move(nodeId, newX, newY);
                moveCount++;
            });
            
            const endTime = performance.now();
            console.log(`✅ Completed ${moveCount} node movements in ${(endTime - startTime).toFixed(2)}ms`);
            
            // ===== CLEAR VISUAL SIMULATION =====
            // Remove the transform since nodes are now in their final positions
            if (containerElement) {
                containerElement.style.transform = '';
                containerElement.style.transition = ''; // Re-enable transitions
            }
        }
        
        isDragging = false;
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
        
        // Clear buffers
        movementBuffer = { totalDeltaX: 0, totalDeltaY: 0 };
        originalPositions.clear();
    }
    
    // Execute workflow
    function executeWorkflow() {
        console.log('WorkflowContainer executeWorkflow called, isExecuting:', isExecuting, 'container.id:', container.id);
        if (!isExecuting) {
            console.log('Calling workflowActions.execute with container.id:', container.id);
            workflowActions.execute(container.id, { clearContext: isTopLevel });
        } else {
            console.log('Already executing, skipping');
        }
    }
    
    // Stop workflow execution
    function stopWorkflow() {
        if (isExecuting) {
            workflowActions.stop(container.id);
        }
    }
    
    function getDefaultLabel() {
        if (container.isNetwork) {
            // Network label: "Network (2 factories, 4 machines)"
            const factoriesCount = container.factories?.length || 0;
            const machinesCount = container.machines?.length || 0;
            const nodeCount = container.nodeIds?.length || 0;
            const parts = [];
            if (factoriesCount > 0) parts.push(`${factoriesCount} factor${factoriesCount !== 1 ? 'ies' : 'y'}`);
            if (machinesCount > 0) parts.push(`${machinesCount} machine${machinesCount !== 1 ? 's' : ''}`);
            if (nodeCount > 0) parts.push(`${nodeCount} node${nodeCount !== 1 ? 's' : ''}`);
            return `Network (${parts.join(', ')})`;
        } else if (container.isFactory) {
            // Factory label: "Factory (2 machines, 5 nodes)"
            const machineCount = container.machines?.length || 0;
            const nodeCount = container.nodeIds?.length || 0;
            const parts = [];
            parts.push(`${machineCount} machine${machineCount !== 1 ? 's' : ''}`);
            if (nodeCount > 0) parts.push(`${nodeCount} node${nodeCount !== 1 ? 's' : ''}`);
            return `Factory (${parts.join(', ')})`;
        } else {
            // Machine label: "Machine (3 nodes)"
            const count = container.nodes?.length || 0;
            return `Machine (${count} node${count !== 1 ? 's' : ''})`;
        }
    }

    async function saveAsBlueprint() {
        try {
            // Prompt user for blueprint name
            const blueprintName = prompt(`Enter a name for this ${container.isNetwork ? 'network' : container.isFactory ? 'factory' : 'machine'} blueprint:`);
            if (!blueprintName) return;
            
            // Generate the config YAML for this container
            let configResult;
            try {
                configResult = await copyConfig(container, null, null, /** @type {any} */ ($nodeDataStore), /** @type {any} */ ($nodes));
                if (!configResult.success) {
                    throw new Error(configResult.error || 'Failed to generate config');
                }
            } catch (error) {
                console.error('Failed to generate config for template:', error);
                alert('Failed to create template: Could not generate configuration');
                return;
            }
            
            // Determine template type and icon
            let templateType = 'machine';
            if (container.isNetwork) templateType = 'network';
            else if (container.isFactory) templateType = 'factory';
            
            // Save as blueprint with current mode
            console.log('📄 Generated config for blueprint:', configResult.config);
            if (!configResult.config) {
                throw new Error('Failed to generate config for blueprint');
            }
            const templateId = templateActions.add(blueprintName, templateType, configResult.config, null, $appMode);
            console.log('✅ Blueprint saved successfully:', templateId);
            alert(`Blueprint "${blueprintName}" saved successfully!`);
            
        } catch (error) {
            const e = /** @type {any} */ (error);
            console.error('Failed to save blueprint:', e);
            alert('Failed to save blueprint: ' + (e?.message || String(e)));
        }
    }

    function showContainerCustomizeDialog() {
        if ((/** @type {any} */ (window)).showCustomizeForContainer) {
            (/** @type {any} */ (window)).showCustomizeForContainer(container);
        }
    }

    /** @param {MouseEvent} event */
    function handleRightClick(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Use global context menu system
        if ((/** @type {any} */ (window)).showCanvasContextMenu) {
            const menuItems = [
                ...(isExecuting ?
                    [{
                        label: 'Stop Execution',
                        icon: '⏹️',
                        handler: stopWorkflow
                    }] :
                    [{
                        label: 'Execute',
                        icon: '▶️',
                        handler: executeWorkflow,
                        disabled: !showPlayButton
                    }]
                ),
                {
                    label: 'Chat about this Container',
                    icon: '💬',
                    handler: async () => {
                        const type = container.isNetwork ? 'network' : (container.isFactory ? 'factory' : 'machine');
                        chatActions.setContainerScope(container.id, /** @type {any} */(type));
                        chatActions.open();
                        try { (/** @type {any} */(window)).openChatSidebar?.(); } catch {}
                    }
                },
                {
                    separator: true
                },
                {
                    label: 'Copy Text',
                    icon: '📄',
                    handler: async () => {
                        let allText = '';
                        if (container.isFactory) {
                            // For factory containers, collect from machines and individual nodes
                            const machineTexts = (container.machines || [])
                                .flatMap((/** @type {any} */ machine) => machine.nodes || [])
                                .filter((/** @type {any} */ node) => node.content)
                                .map((/** @type {any} */ node) => `${node.title}:\n${node.content}`);
                            allText = machineTexts.join('\n\n---\n\n');
                        } else if (container.nodes) {
                            allText = container.nodes
                                .filter((/** @type {any} */ node) => node.content)
                                .map((/** @type {any} */ node) => `${node.title}:\n${node.content}`)
                                .join('\n\n---\n\n');
                        }
                        
                        if (allText.trim()) {
                            const textResult = await copyText(allText);
                            if (!textResult.success) {
                                console.error('Failed to copy text:', textResult.error);
                            }
                        }
                    },
                    disabled: (() => {
                        if (container.isFactory) {
                            return !(container.machines || []).some((/** @type {any} */ machine) => 
                                (machine.nodes || []).some((/** @type {any} */ node) => node.content)
                            );
                        }
                        return !container.nodes || !container.nodes.some((/** @type {any} */ node) => node.content);
                    })()
                },
                {
                    separator: true
                },
                {
                    label: container.isNetwork ? 'Copy Network Config' : container.isFactory ? 'Copy Factory Config' : 'Copy Machine Config',
                    icon: '⚙️',
                    handler: async () => {
                        let configResult;
                        configResult = await copyConfig(container, null, null, /** @type {any} */ ($nodeDataStore), /** @type {any} */ ($nodes));
                        if (!configResult.success) {
                            console.error('Failed to copy config:', configResult.error);
                        }
                    }
                },
                {
                    label: container.isNetwork ? 'Copy Network Metadata' : container.isFactory ? 'Copy Factory Metadata' : 'Copy Machine Metadata',
                    icon: '🔧',
                    handler: async () => {
                        let metadataResult;
                        if (container.isNetwork) {
                            metadataResult = await copyNetworkMetadata(container, $nodeDataStore);
                        } else {
                            metadataResult = await copyMachineMetadata(container, $nodeDataStore);
                        }
                        if (!metadataResult.success) {
                            console.error('Failed to copy metadata:', metadataResult.error);
                        }
                    }
                },
                {
                    label: container.isFactory ? 'Paste Factory Config' : 'Paste Machine Config',
                    icon: '📥',
                    handler: async () => {
                        const pasteResult = await pasteConfig();
                        if (pasteResult.success) {
                            console.log('Config pasted successfully (feature not implemented)');
                        } else {
                            console.error('Failed to paste config:', pasteResult.error);
                        }
                    }
                },
                {
                    label: 'Reset AI Nodes',
                    icon: '♻️',
                    handler: async () => {
                        await workflowActions.resetAINodes(container.id);
                    }
                },
                {
                    label: 'Organize',
                    icon: '🧭',
                    handler: async () => {
                        await workflowActions.organize(container.id);
                    }
                },
                {
                    separator: true
                },
                {
                    label: 'Save as Blueprint',
                    icon: '📋',
                    handler: async () => {
                        await saveAsBlueprint();
                    }
                },
                {
                    label: 'Customize',
                    icon: '🎨',
                    handler: async () => {
                        showContainerCustomizeDialog();
                    }
                },
                {
                    label: 'Delete',
                    icon: '🗑️',
                    handler: async () => {
                        if (container.isNetwork) {
                            // Delete all factories, machines and nodes in the network
                            console.log('Deleting network:', container.id);
                            
                            // Delete all factories and their contents
                            if (container.factories) {
                                container.factories.forEach((/** @type {any} */ factory) => {
                                    // Delete each factory's machines
                                    if (factory.machines) {
                                        factory.machines.forEach((/** @type {any} */ machine) => {
                                            if (machine.nodes) {
                                                machine.nodes.forEach((/** @type {any} */ node) => {
                                                    nodeActions.delete(node.id);
                                                });
                                            }
                                        });
                                    }
                                    // Delete factory's individual nodes
                                    if (factory.nodeIds) {
                                        factory.nodeIds.forEach((/** @type {any} */ nodeId) => {
                                            nodeActions.delete(nodeId);
                                        });
                                    }
                                });
                            }
                            
                            // Delete standalone machines in the network
                            if (container.machines) {
                                container.machines.forEach((/** @type {any} */ machine) => {
                                    if (machine.nodes) {
                                        machine.nodes.forEach((/** @type {any} */ node) => {
                                            nodeActions.delete(node.id);
                                        });
                                    }
                                });
                            }
                            
                            // Delete standalone nodes in the network
                            if (container.nodeIds) {
                                container.nodeIds.forEach((/** @type {any} */ nodeId) => {
                                    nodeActions.delete(nodeId);
                                });
                            }
                            
                        } else if (container.isFactory) {
                            // Delete all machines and nodes in the factory
                            if (container.machines) {
                                container.machines.forEach((/** @type {any} */ machine) => {
                                    if (machine.nodes) {
                                        machine.nodes.forEach((/** @type {any} */ node) => {
                                            nodeActions.delete(node.id);
                                        });
                                    }
                                });
                            }
                            if (container.nodeIds) {
                                container.nodeIds.forEach((/** @type {any} */ nodeId) => {
                                    nodeActions.delete(nodeId);
                                });
                            }
                        } else {
                            // Delete individual machine
                            if (container.nodes) {
                                container.nodes.forEach((/** @type {any} */ node) => {
                                    nodeActions.delete(node.id);
                                });
                            }
                        }
                    }
                }
            ];
            
            (/** @type {any} */ (window)).showCanvasContextMenu(event.clientX, event.clientY, menuItems);
        }
    }
    
    
    // Container port handlers - output only (no input ports on containers)
    /** @param {MouseEvent} event @param {string} port */
    function handlePortMouseDown(event, port) {
        event.stopPropagation();
        // Containers only have output ports. Starting a connection from a container.
        if (port === 'output' && startConnection) {
            startConnection(container.id, port);
        }
    }

    /** @param {KeyboardEvent} event */
    function handleContainerKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleClick(/** @type {any} */ (event));
        }
    }

    // ── Touch drag + long-press context menu for containers ───────────────────
    /** @type {number | null} */
    let touchId = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let longPressTimer = null;
    let touchDidMove = false;
    let touchDragging = false;
    /** @type {{x:number,y:number}} */
    let touchDownPos = { x: 0, y: 0 };
    /** @type {Map<string,{x:number,y:number}>} */
    let touchOriginalPositions = new Map();

    /** @param {TouchEvent} event */
    function handleTouchStart(event) {
        const t = /** @type {HTMLElement} */ (event.target);
        if (t?.closest('.node-card')) return;
        if (blockNodeInteractions) { event.stopPropagation(); return; }
        if (event.touches.length !== 1) return;

        event.stopPropagation();

        const touch = event.touches[0];
        touchId = touch.identifier;
        touchDidMove = false;
        touchDragging = false;
        touchDownPos = { x: touch.clientX, y: touch.clientY };
        mouseDownTime = Date.now();
        movementBuffer = { totalDeltaX: 0, totalDeltaY: 0 };
        touchOriginalPositions.clear();
        captureOriginalPositions();
        // Use the same originalPositions as the mouse drag path
        originalPositions.forEach((v, k) => touchOriginalPositions.set(k, v));

        // Long-press timer → open context menu after 500ms if finger hasn't moved
        longPressTimer = setTimeout(() => {
            if (!touchDidMove) {
                // Synthesize right-click by calling the same handler with fake event coords
                (/** @type {any} */ (window)).showCanvasContextMenu?.(
                    touchDownPos.x,
                    touchDownPos.y,
                    buildContainerMenuItems()
                );
            }
        }, 500);

        document.addEventListener('touchmove', handleContainerTouchMove, { passive: false });
        document.addEventListener('touchend', handleContainerTouchEnd);
        document.addEventListener('touchcancel', handleContainerTouchEnd);
    }

    /** Build the same menu items array as handleRightClick */
    function buildContainerMenuItems() {
        return [
            ...(isExecuting ?
                [{ label: 'Stop Execution', icon: '⏹️', handler: stopWorkflow }] :
                [{ label: 'Execute', icon: '▶️', handler: executeWorkflow, disabled: !showPlayButton }]
            ),
            {
                label: 'Chat about this Container',
                icon: '💬',
                handler: async () => {
                    const type = container.isNetwork ? 'network' : (container.isFactory ? 'factory' : 'machine');
                    chatActions.setContainerScope(container.id, /** @type {any} */(type));
                    chatActions.open();
                    try { (/** @type {any} */(window)).openChatSidebar?.(); } catch {}
                }
            },
            { separator: true },
            {
                label: 'Organize',
                icon: '🧭',
                handler: async () => { await workflowActions.organize(container.id); }
            },
            {
                label: 'Reset AI Nodes',
                icon: '♻️',
                handler: async () => { await workflowActions.resetAINodes(container.id); }
            },
            { separator: true },
            {
                label: 'Customize',
                icon: '🎨',
                handler: async () => { showContainerCustomizeDialog(); }
            },
            {
                label: 'Delete',
                icon: '🗑️',
                handler: async () => {
                    // Reuse existing right-click delete handler by calling the full menu items and
                    // triggering the delete action inline.
                    if (container.isNetwork) {
                        container.factories?.forEach((/** @type {any} */ f) => {
                            f.machines?.forEach((/** @type {any} */ m) => m.nodes?.forEach((/** @type {any} */ n) => nodeActions.delete(n.id)));
                            f.nodeIds?.forEach((/** @type {any} */ id) => nodeActions.delete(id));
                        });
                        container.machines?.forEach((/** @type {any} */ m) => m.nodes?.forEach((/** @type {any} */ n) => nodeActions.delete(n.id)));
                        container.nodeIds?.forEach((/** @type {any} */ id) => nodeActions.delete(id));
                    } else if (container.isFactory) {
                        container.machines?.forEach((/** @type {any} */ m) => m.nodes?.forEach((/** @type {any} */ n) => nodeActions.delete(n.id)));
                        container.nodeIds?.forEach((/** @type {any} */ id) => nodeActions.delete(id));
                    } else {
                        container.nodes?.forEach((/** @type {any} */ n) => nodeActions.delete(n.id));
                    }
                }
            }
        ];
    }

    /** @param {TouchEvent} event */
    function handleContainerTouchMove(event) {
        if (touchId === null) return;
        let touch = null;
        for (let i = 0; i < event.changedTouches.length; i++) {
            if (event.changedTouches[i].identifier === touchId) { touch = event.changedTouches[i]; break; }
        }
        if (!touch) return;

        const distance = Math.sqrt(
            Math.pow(touch.clientX - touchDownPos.x, 2) +
            Math.pow(touch.clientY - touchDownPos.y, 2)
        );

        if (distance > 8) {
            touchDidMove = true;
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            touchDragging = true;
        }

        if (!touchDragging) return;

        event.preventDefault();
        event.stopPropagation();

        const canvas = document.querySelector('.canvas-content');
        if (!canvas) return;
        const canvasTransform = getComputedStyle(canvas).transform;
        const matrix = new DOMMatrix(canvasTransform);
        const scale = matrix.a;

        movementBuffer.totalDeltaX = (touch.clientX - touchDownPos.x) / scale;
        movementBuffer.totalDeltaY = (touch.clientY - touchDownPos.y) / scale;

        if (containerElement) {
            containerElement.style.transform = `translate(${movementBuffer.totalDeltaX}px, ${movementBuffer.totalDeltaY}px)`;
            containerElement.style.transition = 'none';
        }
    }

    function handleContainerTouchEnd() {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

        if (touchDragging) {
            touchOriginalPositions.forEach((originalPos, nodeId) => {
                nodeActions.move(nodeId, originalPos.x + movementBuffer.totalDeltaX, originalPos.y + movementBuffer.totalDeltaY);
            });
            if (containerElement) {
                containerElement.style.transform = '';
                containerElement.style.transition = '';
            }
        }

        touchId = null;
        touchDragging = false;
        touchDidMove = false;
        movementBuffer = { totalDeltaX: 0, totalDeltaY: 0 };
        touchOriginalPositions.clear();

        document.removeEventListener('touchmove', handleContainerTouchMove);
        document.removeEventListener('touchend', handleContainerTouchEnd);
        document.removeEventListener('touchcancel', handleContainerTouchEnd);
    }
</script>

{#if container.isWorkflow || container.isFactory || container.isNetwork}
    <div 
        bind:this={containerElement}
        class="workflow-container"
        class:factory-container={container.isFactory}
        class:network-container={container.isNetwork}
        class:executing={isExecuting}
        class:dragging={isDragging}
        style="
            left: {container.bounds.x}px;
            top: {container.bounds.y}px;
            width: {container.bounds.width}px;
            height: {container.bounds.height}px;
            {customStyle}
        "
        on:mousedown={handleMouseDown}
        on:contextmenu={handleRightClick}
        on:click={handleClick}
        on:touchstart={handleTouchStart}
        on:keydown={handleContainerKeydown}
        tabindex="0"
        role="button"
        aria-label="Container {container.id}"
    >
        <!-- Container border -->
        <div class="container-border"></div>
        
        <!-- Play/Stop button — hidden in diagram mode (nothing to execute) -->
        {#if showPlayButton && !$isDiagrammingMode}
            <div class="play-button-container">
                <button
                    class="play-button"
                    class:stop-button={isExecuting}
                    on:click|stopPropagation={isExecuting ? stopWorkflow : executeWorkflow}
                    disabled={false}
                    title={isExecuting ? 'Stop execution' : 'Execute workflow'}
                >
                    {#if isExecuting}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="1"/>
                        </svg>
                    {:else}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="8,5 19,12 8,19"/>
                        </svg>
                    {/if}
                </button>

                <!-- Execution indicator -->
                {#if isExecuting}
                    <div class="execution-indicator">
                        <div class="pulse"></div>
                    </div>
                {/if}
            </div>
        {/if}
        
        <!-- Container label -->
        <div class="container-label">
            {displayLabel}
        </div>
        
        <!-- Output port for machines and factories only (not networks) -->
        <!-- Per ontology spec: Networks have NO ports. Machines/Factories have output port only. -->
        {#if !container.isNetwork}
            <div
                role="button"
                tabindex="0"
                aria-label="{container.isFactory ? 'Factory' : 'Machine'} output connection port"
                class="machine-port output-port"
                title={container.isFactory ? 'Factory Output' : 'Machine Output'}
                on:mousedown={(e) => handlePortMouseDown(e, 'output')}
            ></div>
        {/if}
    </div>
{/if}

<style>
    .workflow-container {
        position: absolute;
        pointer-events: none;
        z-index: 0; /* Default z-index for a Machine */
        cursor: url('../assets/cursor-grab.svg') 16 16, grab;
    }
    
    .workflow-container:active {
        cursor: url('../assets/cursor-grabbing.svg') 16 16, grabbing;
    }
    
    .workflow-container.dragging {
        z-index: 5; /* Above nodes when dragging */
    }
    
    .workflow-container.dragging .container-border {
        opacity: 0.7;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transform: scale(1.02);
    }
    
    .container-border {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        border: 2px solid #6c7086;
        border-radius: 12px;
        background: rgba(30, 30, 60, 0.85);
        pointer-events: all;
        transition: all 0.2s ease;
    }

    /* Factory containers have dashed border and subtle purple tint */
    .factory-container .container-border {
        border: 2px dashed #7f849c;
        background: rgba(35, 30, 50, 0.75);
        pointer-events: all; /* Allow dragging factory */
    }
    
    /* Factory containers allow interaction with contained elements */
    .factory-container {
        pointer-events: none; /* Allow clicks to pass through to contained machines */
    }
    
    .factory-container .container-border {
        pointer-events: all; /* But allow dragging the factory border */
    }
    
    .workflow-container.executing .container-border {
        border-color: #10b981;
        background: rgba(16, 185, 129, 0.1);
        box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
    }
    
    .workflow-container:hover .container-border {
        border-color: #585b70;
    }
    
    .play-button-container {
        position: absolute;
        top: -40px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 8px;
        pointer-events: all;
        z-index: 1000; /* Above all containers */
    }
    
    .play-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border: none;
        border-radius: 50%;
        background: #4f46e5;
        color: white;
        cursor: url('../assets/cursor-pointer.svg') 16 16, pointer;
        box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
        transition: all 0.2s ease;
    }
    
    .play-button:hover {
        background: #6366f1;
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
    }
    
    .play-button.stop-button {
        background: #ef4444;
    }
    
    .play-button.stop-button:hover {
        background: #f87171;
    }
    
    .play-button:disabled {
        opacity: 0.6;
        cursor: url('../assets/cursor-not-allowed.svg') 16 16, not-allowed;
        transform: none;
    }
    
    .execution-indicator {
        position: relative;
        width: 12px;
        height: 12px;
    }
    
    .pulse {
        position: absolute;
        width: 100%;
        height: 100%;
        background: #10b981;
        border-radius: 50%;
        animation: pulse 1.5s ease-in-out infinite;
    }
    
    @keyframes pulse {
        0% {
            transform: scale(0.8);
            opacity: 1;
        }
        50% {
            transform: scale(1.2);
            opacity: 0.7;
        }
        100% {
            transform: scale(0.8);
            opacity: 1;
        }
    }
    
    .container-label {
        position: absolute;
        top: -22px;
        right: 12px;
        font-size: 28px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 2px;
        pointer-events: none;
        user-select: none;
        color: #cdd6f4;
        /* Floating tab style */
        background: #313244;
        border: 2px solid #6c7086;
        border-radius: 10px;
        padding: 5px 20px;
        white-space: nowrap;
        max-width: 700px;
        overflow: hidden;
        text-overflow: ellipsis;
        z-index: 5;
        line-height: 1.4;
    }

    .workflow-container.executing .container-label {
        color: #a6e3a1;
        border-color: #a6e3a1;
        background: rgba(166, 227, 161, 0.15);
    }

    .factory-container .container-label {
        color: #cba6f7;
        border-color: #7f849c;
        background: #2a2640;
    }

    .network-container .container-label {
        color: #89b4fa;
        border-color: #7f849c;
        background: #1e2640;
    }
    
    /* Machine ports for connecting machines together */
    .machine-port {
        position: absolute;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        border: 3px solid #4f46e5;
        cursor: url('../assets/cursor-pointer.svg') 16 16, pointer;
        pointer-events: all;
        transition: all 0.2s ease;
        z-index: 10;
    }
    
    .machine-port.output-port {
        right: -8px;
        top: 50%;
        transform: translateY(-50%);
    }
    
    .machine-port:hover {
        background: #4f46e5;
        border-color: #6366f1;
        transform: translateY(-50%) scale(1.2);
        box-shadow: 0 0 8px rgba(79, 70, 229, 0.5);
    }
    
    .workflow-container.executing .machine-port {
        border-color: #10b981;
        animation: pulse-port 2s ease-in-out infinite;
    }
    
    
    @keyframes pulse-port {
        0%, 100% {
            box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.7);
        }
        50% {
            box-shadow: 0 0 0 4px rgba(79, 70, 229, 0);
        }
    }
    
    
    .factory-container:hover .container-border {
        border-color: #6c7086;
    }
    
    .factory-container.executing .container-border {
        border-color: #10b981;
        background: rgba(16, 185, 129, 0.1);
        box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
    }
    
    
    /* Removed complex factory border system - now using simple container like machines */
    
    /* Ensure play buttons inside factories are clickable */
    .factory-container .play-button-container {
        z-index: 1000; /* Above factory borders */
        pointer-events: all;
    }
    
    /* Factory containers are above networks but below machines */
    .factory-container {
        z-index: 0; /* Below machines, above canvas background */
    }
    
    .factory-container.dragging {
        z-index: 10; /* Above everything when dragging factory */
    }
    
    /* Network container specific styles - dotted border and subtle teal tint */
    .network-container .container-border {
        border: 2px dotted #89b4fa;
        border-radius: 12px;
        background: rgba(25, 35, 45, 0.70);
        pointer-events: all; /* Allow dragging network */
    }
    
    /* Network containers allow interaction with contained elements */
    .network-container {
        pointer-events: none; /* Allow clicks to pass through to contained elements */
    }
    
    .network-container .container-border {
        pointer-events: all; /* But allow dragging the network border */
    }
    
    .network-container:hover .container-border {
        border-color: #7f849c;
    }
    
    .network-container.executing .container-border {
        border-color: #10b981;
        background: rgba(16, 185, 129, 0.1);
        box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
    }
    
    
    
    /* Network containers are behind contained elements */
    .network-container {
        z-index: 0; /* Below factories and machines via DOM order, above canvas background */
    }
    
    .network-container.dragging {
        z-index: 10; /* Above everything when dragging network */
    }
    
    /* Ensure network play buttons are accessible */
    .network-container .play-button-container {
        z-index: 1000; /* Above all containers */
        pointer-events: all;
    }
    
    .factory-container.dragging {
        z-index: 10; /* Above everything when dragging factory */
    }
</style>
