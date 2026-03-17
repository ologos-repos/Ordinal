/**
 * Headless API for Ordinal — programmatic canvas control for Playwright tests
 *
 * Exports window.__ordinal with methods for loading YAMLs, organizing layout,
 * fitting viewport, and capturing rendered state.
 */

import { get } from 'svelte/store';
import { nodes, connections, crossMachineConnections, nodeActions, connectionActions, nodeDataStore } from '../stores/nodes.js';
import { workflowContainers, containerActions, workflowActions, executionState } from '../stores/workflows.js';
import { viewport, viewportActions } from '../stores/canvas.js';
import { settings } from '../stores/settings.js';
import { pasteAndCreateConfigUniversal } from './clipboard.js';

/**
 * Initialize the headless API once the Svelte app is mounted
 * @param {any} appInstance - The Svelte App instance (not used, but kept for consistency)
 */
export function initHeadlessAPI(appInstance) {
    if (typeof window === 'undefined') return;

    const api = {
        ready: false,

        /**
         * Enter headless mode — hide toolbar, palettes, panels
         */
        enterHeadlessMode() {
            // Hide ALL UI chrome — only the canvas content should be visible
            const selectors = [
                '.toolbar',
                '.node-palette',
                '.settings-panel',
                '.config-panel',
                '.template-palette',
                '.chat-sidebar',
                '.customize-panel',
                '.token-counter',
                '.zoom-controls',
                '.toolbar-buttons',
                '.minimap-container',
                '.bottom-bar',
                '.status-bar',
            ];
            selectors.forEach(sel => {
                // Use querySelectorAll to catch multiple instances
                document.querySelectorAll(sel).forEach(el => {
                    el.style.display = 'none';
                });
            });
        },

        /**
         * Load YAML recipe into the canvas
         * @param {string} yamlStr - YAML recipe string
         * @param {object} [options] - Options for loading
         * @param {boolean} [options.organize] - Whether to auto-organize after loading (default: true)
         * @returns {Promise<number>} - Number of nodes loaded
         */
        async loadYAML(yamlStr, options = {}) {
            const shouldOrganize = options.organize !== false;
            try {
                // Clear existing canvas
                const existingNodes = get(nodes);
                existingNodes.forEach(n => nodeActions.delete(n.id));

                // Validate model before loading (non-blocking — just logs warnings)
                try {
                    const _vresp = await fetch('/ordinal/api/validate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ yaml: yamlStr }),
                    });
                    const _vdata = await _vresp.json();
                    if (!_vdata.valid) {
                        console.warn('[headlessAPI] Model validation errors:', _vdata.errors);
                    } else if (_vdata.warnings && _vdata.warnings.length > 0) {
                        console.warn('[headlessAPI] Model validation warnings:', _vdata.warnings);
                    }
                } catch (_ve) {
                    console.warn('[headlessAPI] Validation check failed:', _ve);
                }

                // Load YAML using the universal paste handler
                // pasteAndCreateConfigUniversal(targetX, targetY, templateConfig)
                const result = await pasteAndCreateConfigUniversal(400, 300, yamlStr);

                if (!result || !result.success) {
                    console.error('[headlessAPI] loadYAML failed:', result?.error || 'Unknown error');
                    return 0;
                }

                // Wait for container detection to complete before organizing
                // The workflowContainers derived store needs time to detect machines/factories/networks
                console.log('[headlessAPI] Waiting for container detection...');
                const createdNodeIds = new Set((result.createdNodes || []).map(n => n.id));
                let attempts = 0;
                const maxAttempts = 30; // 3 seconds max
                let containersDetected = false;

                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const containers = get(workflowContainers);

                    // Check if any container contains our nodes
                    const containsOurNodes = containers.some(container =>
                        container.nodes && container.nodes.some(node => createdNodeIds.has(node.id)) ||
                        container.nodeIds && container.nodeIds.some(nodeId => createdNodeIds.has(nodeId))
                    );

                    if (containsOurNodes) {
                        console.log(`[headlessAPI] ✅ Container detection complete after ${attempts + 1} attempts. Found ${containers.length} containers.`);
                        containersDetected = true;
                        break;
                    }

                    attempts++;
                }

                if (!containersDetected) {
                    console.warn('[headlessAPI] ⚠️ Container detection timed out. Organizing anyway...');
                }

                // Auto-organize after loading (matches web.py render endpoint behavior)
                // Skip if caller pre-computed coordinates
                if (shouldOrganize) {
                    await this.organize();
                }

                // Return node count
                return get(nodes).length;
            } catch (err) {
                console.error('[headlessAPI] loadYAML failed:', err);
                return 0;
            }
        },

        /**
         * Organize the canvas layout
         * @param {object} options - Organize options
         * @param {string} options.spacing_level - 'node' | 'container' | 'network'
         */
        async organize(options = {}) {
            const spacing = options.spacing_level || 'container';
            // Import workflowActions which has the organize function
            const { workflowActions } = await import('../stores/workflows.js');

            // Organize all containers on the canvas
            const containers = get(workflowContainers);
            console.log(`[headlessAPI] organize() called with ${containers.length} containers`);

            if (containers.length === 0) {
                console.warn('[headlessAPI] ⚠️ No containers detected - organize skipped');
                return;
            }

            // NOTE: workflowContainers items use isNetwork/isFactory/isWorkflow/isMachine flags,
            // NOT a .type string field. The .type field does NOT exist on these objects.
            // Log container details using the correct property names.
            containers.forEach((container, idx) => {
                const containerType = container.isNetwork ? 'network' : container.isFactory ? 'factory' : 'machine';
                const nodeCount = container.nodes?.length || container.nodeIds?.length || 0;
                console.log(`[headlessAPI]   Container ${idx + 1}: ${container.id} (type: ${containerType}, nodes: ${nodeCount})`);
            });

            // Step 1: Organize the canvas globally (spreads top-level containers apart)
            console.log('[headlessAPI] Step 1: Global canvas organize (spread containers)...');
            await workflowActions.organizeCanvas();

            // Step 2: Organize each top-level container individually to spread nodes within them.
            // Networks → organize as network (handles child factories & machines recursively)
            // Factories → organize as factory (handles child machines recursively)
            // Machines → organize nodes within (deepest level)
            // Use isNetwork/isFactory/isWorkflow (NOT .type) to identify container types.
            const hasNetworks = containers.some(c => c.isNetwork);

            /** Run one organize pass over all top-level containers */
            const runOrganizePass = async (passLabel) => {
                console.log(`[headlessAPI] ${passLabel}: organizing containers...`);
                if (hasNetworks) {
                    for (const container of containers) {
                        if (container.isNetwork) {
                            console.log(`[headlessAPI]   Organizing network: ${container.id}`);
                            await workflowActions.organize(container.id, { spacing });
                        }
                    }
                } else {
                    // No networks — organize factories and standalone machines
                    const hasFactories = containers.some(c => c.isFactory);
                    if (hasFactories) {
                        for (const container of containers) {
                            if (container.isFactory) {
                                console.log(`[headlessAPI]   Organizing factory: ${container.id}`);
                                await workflowActions.organize(container.id, { spacing });
                            }
                        }
                    } else {
                        // Only machines — organize each machine to spread its nodes
                        for (const container of containers) {
                            if (container.isWorkflow || container.isMachine) {
                                console.log(`[headlessAPI]   Organizing machine: ${container.id}`);
                                await workflowActions.organize(container.id, { spacing });
                            }
                        }
                    }
                }
            };

            await runOrganizePass('Step 2 (pass 1)');

            // Step 3: Wait for bounds to settle after the first pass, then run a second pass.
            // The first pass may nudge nodes to avoid bezier collisions, which shifts bezier
            // paths for other connections and can create new collisions. The second pass
            // converges to a cleaner layout using the corrected positions from pass 1.
            await new Promise(resolve => setTimeout(resolve, 50));
            await workflowActions.organizeCanvas(); // re-spread top-level containers
            await runOrganizePass('Step 3 (pass 2)');

            console.log('[headlessAPI] ✅ organize() complete (2 passes)');
        },

        /**
         * Wait for edge SVG paths to be computed
         * @returns {object} - Edge info (connectionCount, svgPaths)
         */
        waitForEdges() {
            const conns = get(connections);
            const crossConns = get(crossMachineConnections);
            const svgPaths = document.querySelectorAll('.connections-svg path').length;
            return {
                connectionCount: conns.length + crossConns.length,
                crossMachineCount: crossConns.length,
                svgPaths
            };
        },

        /**
         * Get bounding box of all content — uses container bounds (which include padding,
         * port margins, and header chrome) rather than raw node positions.
         *
         * Container bounds are already computed correctly by computeMachineBounds(),
         * computeFactoryBounds(), computeNetworkBounds() in stores/workflows/bounds.js.
         * Each container in workflowContainers has a .bounds {x, y, width, height} that
         * accounts for:
         *   Machine:  20px padding + 14px port margin + 50px header (playButtonSpace)
         *   Factory:  30px padding + 50px header
         *   Network:  40px padding + 50px header
         *
         * We also fall back to raw node bounds for standalone nodes not in any container.
         *
         * @returns {object} - {minX, minY, maxX, maxY, width, height}
         */
        getBounds() {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            // Step 1: Use container bounds (they include all chrome/padding/headers).
            // Only look at top-level containers to avoid double-counting nested ones.
            // Top-level = network > factory > machine.  A machine inside a factory is
            // already covered by the factory's bounds, so we skip it.
            const containers = get(workflowContainers);
            const allContainedNodeIds = new Set();

            if (containers.length > 0) {
                // Identify top-level containers: networks first, then factories not inside
                // a network, then machines not inside a factory or network.
                const networkIds = new Set(containers.filter(c => c.isNetwork).map(c => c.id));
                const factoryIds = new Set(containers.filter(c => c.isFactory).map(c => c.id));

                // Collect node IDs that belong to ANY container (to detect standalone nodes)
                containers.forEach(container => {
                    if (container.nodes) container.nodes.forEach(n => allContainedNodeIds.add(n.id));
                    if (container.nodeIds) container.nodeIds.forEach(id => allContainedNodeIds.add(id));
                });

                containers.forEach(container => {
                    if (!container.bounds) return;

                    // Determine if this is a top-level container.
                    // Networks are always top-level.
                    // Factories are top-level only if not inside a network.
                    // Machines are top-level only if not inside a factory or network.
                    let isTopLevel = false;

                    if (container.isNetwork) {
                        isTopLevel = true;
                    } else if (container.isFactory) {
                        // Factory is top-level if no network contains it
                        const insideNetwork = containers.some(
                            c => c.isNetwork && c.factories && c.factories.some(f => f.id === container.id)
                        );
                        isTopLevel = !insideNetwork;
                    } else if (container.isWorkflow || container.isMachine) {
                        // Machine is top-level if no factory or network contains it
                        const insideFactory = containers.some(
                            c => c.isFactory && c.machines && c.machines.some(m => m.id === container.id)
                        );
                        const insideNetwork = containers.some(
                            c => c.isNetwork && c.machines && c.machines.some(m => m.id === container.id)
                        );
                        isTopLevel = !insideFactory && !insideNetwork;
                    }

                    if (!isTopLevel) return;

                    const b = container.bounds;
                    console.log(`[headlessAPI] getBounds() container ${container.id}: x=${b.x} y=${b.y} w=${b.width} h=${b.height}`);
                    minX = Math.min(minX, b.x);
                    minY = Math.min(minY, b.y);
                    maxX = Math.max(maxX, b.x + b.width);
                    maxY = Math.max(maxY, b.y + b.height);
                });
            }

            // Step 2: Include standalone nodes not inside any container.
            const nodeList = get(nodes);
            nodeList.forEach(n => {
                if (allContainedNodeIds.has(n.id)) return; // already covered by a container
                const x = n.x || 0;
                const y = n.y || 0;
                const w = n.width || 200;
                const h = n.height || 80;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + w);
                maxY = Math.max(maxY, y + h);
            });

            // If nothing was found at all, return zero bounds
            if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
                // Last resort: raw node bounds (handles edge case of nodes with no containers)
                if (nodeList.length === 0) {
                    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
                }
                minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
                nodeList.forEach(n => {
                    const x = n.x || 0;
                    const y = n.y || 0;
                    const w = n.width || 200;
                    const h = n.height || 80;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + w);
                    maxY = Math.max(maxY, y + h);
                });
            }

            return {
                minX,
                minY,
                maxX,
                maxY,
                width: maxX - minX,
                height: maxY - minY
            };
        },

        /**
         * Get recommended viewport dimensions to fit all content
         * @param {number} padding - Padding around content
         * @returns {object} - {width, height} recommended for the browser viewport
         */
        getRecommendedViewportSize(padding = 60) {
            const bounds = this.getBounds();
            if (bounds.width === 0 || bounds.height === 0) {
                return { width: 800, height: 600 };
            }

            const renderW = Math.ceil(bounds.width + padding * 2);
            const renderH = Math.ceil(bounds.height + padding * 2);

            // Match web.py logic: ensure minimum dimensions
            return {
                width: Math.max(renderW, 800),
                height: Math.max(renderH, 600)
            };
        },

        /**
         * Set connector style (fluid, straight, or cornered)
         * @param {string} style - The connector style
         */
        setConnectorStyle(style) {
            settings.update(s => ({
                ...s,
                connectorStyle: style
            }));
        },

        /**
         * Fit viewport to show all content with padding
         * @param {number} viewportWidth - Target viewport width
         * @param {number} viewportHeight - Target viewport height
         * @param {number} padding - Padding around content
         */
        fitToView(viewportWidth, viewportHeight, padding = 0) {
            const bounds = this.getBounds();
            if (bounds.width === 0 || bounds.height === 0) return;

            const contentW = bounds.width + padding * 2;
            const contentH = bounds.height + padding * 2;

            // Calculate scale to fit content in viewport
            const scaleX = viewportWidth / contentW;
            const scaleY = viewportHeight / contentH;
            const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

            // Center the content
            const offsetX = (viewportWidth - bounds.width * scale) / 2 - bounds.minX * scale;
            const offsetY = (viewportHeight - bounds.height * scale) / 2 - bounds.minY * scale;

            viewportActions.setViewport({
                x: offsetX,
                y: offsetY,
                zoom: scale
            });
        },

        // ── Execution API ───────────────────────────────────────────────────────

        /**
         * Execute a workflow container and wait for completion.
         *
         * @param {string} containerId - ID of the container to execute
         * @param {object} [options] - Execution options
         * @returns {Promise<{status: string, duration_ms: number, results: object}>}
         */
        async executeWorkflow(containerId, options = {}) {
            const t0 = performance.now();

            // Reset execution state so we get a clean read after completion
            executionState.reset();

            // Run execution (workflowActions.execute awaits until the container completes)
            await workflowActions.execute(containerId, options);

            const duration_ms = Math.round(performance.now() - t0);

            // Collect results from nodeDataStore
            const results = this.getExecutionResults();

            // Determine overall status
            const state = get(executionState);
            const hasErrors = state.errorNodes.size > 0;
            const status = hasErrors ? 'partial' : 'completed';

            return { status, duration_ms, results };
        },

        /**
         * Read the current execution state and return all node results.
         *
         * @returns {object} Map of nodeId → { content, status, duration_ms }
         */
        getExecutionResults() {
            const state = get(executionState);
            const ndMap = get(nodeDataStore);
            const nodeList = get(nodes);

            /** @type {Record<string, {content: string, status: string, node_type: string}>} */
            const results = {};

            for (const node of nodeList) {
                const nd = ndMap.get(node.id);
                const content = nd?.data?.output?.value
                    ?? nd?.data?.content
                    ?? '';
                let status = 'idle';
                if (state.completedNodes.has(node.id)) status = 'completed';
                else if (state.errorNodes.has(node.id)) status = 'error';
                else if (state.activeNodes.has(node.id)) status = 'running';

                results[node.id] = {
                    content: typeof content === 'string' ? content : JSON.stringify(content),
                    status,
                    node_type: node.type || 'unknown',
                };
            }

            return results;
        },

        /**
         * Load a YAML recipe onto the canvas, execute it, and return structured results.
         * This is the primary entry point called by web.py via Playwright.
         *
         * Called as: window.__ordinal.executeLogic(yamlStr, { mode: 'knowledge' })
         *
         * @param {string} yamlStr - YAML recipe string (already serialised by web.py)
         * @param {object} [options] - Options: { mode: string, organize: bool }
         * @returns {Promise<{status: string, mode: string, duration_ms: number, results: object, output_nodes: object}>}
         */
        async executeLogic(yamlStr, options = {}) {
            const t0 = performance.now();
            const mode = options.mode || 'knowledge';

            // Step 1: Load YAML into canvas
            const nodeCount = await this.loadYAML(yamlStr, { organize: options.organize !== false });
            if (nodeCount === 0) {
                throw new Error('Logic produced no nodes on canvas');
            }

            // Step 2: Find the top-level container to execute
            const containers = get(workflowContainers);
            if (containers.length === 0) {
                throw new Error('No containers detected after loading logic');
            }

            // Find top-level container: network > factory > machine
            const topContainer = containers.find(c => c.isNetwork)
                || containers.find(c => c.isFactory)
                || containers[0];

            // Step 3: Execute
            const executionResult = await this.executeWorkflow(topContainer.id, options);

            const duration_ms = Math.round(performance.now() - t0);

            // Step 4: Collect output nodes (terminal nodes — no outgoing connections)
            const connList = get(connections);
            const connectedFromIds = new Set(connList.map(c => c.fromId));
            const nodeList = get(nodes);
            const outputNodes = {};
            for (const node of nodeList) {
                if (!connectedFromIds.has(node.id)) {
                    const result = executionResult.results[node.id];
                    if (result && result.content) {
                        outputNodes[node.id] = result.content;
                    }
                }
            }

            return {
                status: executionResult.status,
                mode,
                duration_ms,
                results: executionResult.results,
                output_nodes: outputNodes,
            };
        }
    };

    // Mark as ready
    api.ready = true;

    // Expose on window
    window.__ordinal = api;

    console.log('[headlessAPI] Initialized');
}
