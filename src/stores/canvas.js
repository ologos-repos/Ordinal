import { writable } from 'svelte/store';

// Canvas viewport state
export const viewport = writable({
    x: 0,
    y: 0,
    zoom: 1
});

// Canvas interaction state
export const canvasState = writable({
    mode: 'select', // 'select', 'pan', 'connecting', 'box-selecting'
    selectedNode: null,
    selectedConnection: null,
    selectedNodes: [],
    selectedContainer: null,
    isDragging: false,
    isConnecting: false,
    connectionStart: null,
    boxSelection: null
});

// Helper functions for viewport operations
export const viewportActions = {
    /**
     * @param {number} deltaX
     * @param {number} deltaY
     */
    pan: (deltaX, deltaY) => {
        viewport.update(v => ({
            ...v,
            x: v.x + deltaX,
            y: v.y + deltaY
        }));
    },
    
    /**
     * @param {number} factor
     * @param {number} centerX
     * @param {number} centerY
     */
    zoom: (factor, centerX = 0, centerY = 0) => {
        viewport.update(v => {
            // Semi-infinite zoom out (0.01 min) with reasonable zoom in limit (5x)
            const newZoom = Math.max(0.01, Math.min(5, v.zoom * factor));
            const zoomDelta = newZoom - v.zoom;
            
            return {
                ...v,
                zoom: newZoom,
                x: v.x - (centerX * zoomDelta),
                y: v.y - (centerY * zoomDelta)
            };
        });
    },
    
    reset: () => {
        viewport.set({ x: 0, y: 0, zoom: 1 });
    },
    
    /**
     * @param {any} newViewport
     */
    setViewport: (newViewport) => {
        viewport.set({
            x: newViewport.x || 0,
            y: newViewport.y || 0,
            zoom: newViewport.zoom || 1
        });
    },
    
    // Fit all nodes in view with padding
    /**
     * @param {any[]} nodes
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     * @param {number} padding
     */
    fitToScreen: (nodes, canvasWidth, canvasHeight, padding = 100) => {
        if (!nodes || nodes.length === 0) {
            viewportActions.reset();
            return;
        }
        
        // Calculate bounds of all nodes
        const nodeXs = nodes.map(/** @param {any} n */ (n) => n.x);
        const nodeYs = nodes.map(/** @param {any} n */ (n) => n.y);
        const nodeWidths = nodes.map(/** @param {any} n */ (n) => n.width || 254); // Default node width
        const nodeHeights = nodes.map(/** @param {any} n */ (n) => n.height || 126); // Default node height
        
        const minX = Math.min(...nodeXs) - padding;
        const maxX = Math.max(...nodes.map(/** @param {any} n @param {number} i */ (n, i) => nodeXs[i] + nodeWidths[i])) + padding;
        const minY = Math.min(...nodeYs) - padding;
        const maxY = Math.max(...nodes.map(/** @param {any} n @param {number} i */ (n, i) => nodeYs[i] + nodeHeights[i])) + padding;
        
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        
        // Calculate zoom to fit content
        const zoomX = canvasWidth / contentWidth;
        const zoomY = canvasHeight / contentHeight;
        const newZoom = Math.min(zoomX, zoomY, 1); // Don't zoom in beyond 100%
        
        // Calculate pan to center content
        const contentCenterX = (minX + maxX) / 2;
        const contentCenterY = (minY + maxY) / 2;
        const canvasCenterX = canvasWidth / 2;
        const canvasCenterY = canvasHeight / 2;
        
        // Set new viewport
        viewport.set({
            zoom: Math.max(0.01, newZoom), // Ensure minimum zoom
            x: canvasCenterX - (contentCenterX * newZoom),
            y: canvasCenterY - (contentCenterY * newZoom)
        });
    }
};