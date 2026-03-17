import { writable, get } from 'svelte/store';

/**
 * Canvas History System
 * 
 * Requirements:
 * - Per session: Resets when loading new canvas
 * - Per canvas: Tracks entire canvas state, not individual elements
 * - 10 action limit: Only keeps last 10 states
 * - Event-driven: No circular dependencies
 */

// History state store
export const historyState = writable({
    canUndo: false,
    canRedo: false,
    actionCount: 0,
    currentIndex: -1
});

class CanvasHistory {
    constructor() {
        /** @type {number} */
        this.maxHistory = 10;
        /** @type {Array<{ action: string, snapshot: any, sessionId: number }>} */
        this.history = [];
        /** @type {number} */
        this.currentIndex = -1;
        /** @type {boolean} */
        this.isPerformingHistoryAction = false;
        /** @type {number | null} */
        this.sessionId = null;
        
        // Macro recording for batch operations
        /** @type {boolean} */
        this.isMacroRecording = false;
        /** @type {any | null} */
        this.macroStartSnapshot = null;
        /** @type {string | null} */
        this.pendingMacroName = null;
        
        // Deferred imports to avoid circular dependencies
        /** @type {any} */
        this.stores = null;
        /** @type {boolean} */
        this.initialized = false;
    }
    
    async initialize() {
        if (this.initialized) return;
        
        // Lazy load stores when needed
        const [nodesModule, workflowsModule] = await Promise.all([
            import('./nodes.js'),
            import('./workflows.js')
        ]);
        
        this.stores = {
            nodes: nodesModule.nodes,
            connections: nodesModule.connections,
            nodeDataStore: nodesModule.nodeDataStore,
            workflowContainers: workflowsModule.workflowContainers,
            containerCustomizations: workflowsModule.containerCustomizations
        };
        
        this.initialized = true;
        console.log('📚 Canvas history initialized');
    }
    
    // Start a new session (called when loading new canvas)
    async startNewSession() {
        // Ensure we're initialized first
        if (!this.initialized) {
            await this.initialize();
        }
        
        this.history = [];
        this.currentIndex = -1;
        this.sessionId = Date.now();
        
        // Small delay to ensure stores are fully updated before capturing initial state
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Capture the initial state (should be empty after clearing)
        const initialSnapshot = await this.takeSnapshot();
        this.history.push({
            action: 'Initial State',
            snapshot: initialSnapshot,
            sessionId: this.sessionId
        });
        this.currentIndex = 0;
        
        this.updateState();
        console.log(`🆕 Started new history session: ${this.sessionId} with initial state (${initialSnapshot.nodes.length} nodes)`);
    }
    
    // Take a snapshot of the entire canvas state
    async takeSnapshot() {
        if (!this.initialized) await this.initialize();
        
        /** @type {any} */
        const stores = this.stores; // non-null after initialize()
        const snapshot = {
            timestamp: Date.now(),
            nodes: (/** @type {any[]} */ (get(stores.nodes))).map((n) => ({ ...n })),
            connections: (/** @type {any[]} */ (get(stores.connections))).map((c) => ({ ...c })),
            nodeDataStore: Array.from(get(stores.nodeDataStore).entries()),
            // Note: workflowContainers is derived, will auto-rebuild
            customizations: Array.from(get(stores.containerCustomizations).entries())
        };
        
        return snapshot;
    }
    
    // Start macro recording (captures initial state)
    /**
     * @param {string} macroName
     */
    async startMacro(macroName) {
        if (this.isPerformingHistoryAction || this.isMacroRecording) return;
        if (!this.initialized) await this.initialize();
        
        // Auto-start session if not started
        if (!this.sessionId) {
            await this.startNewSession();
        }
        
        console.log(`🎬 Starting macro recording: ${macroName}`);
        
        this.isMacroRecording = true;
        this.pendingMacroName = macroName;
        this.macroStartSnapshot = await this.takeSnapshot();
    }
    
    // End macro recording and save as single action
    async endMacro() {
        if (!this.isMacroRecording || this.isPerformingHistoryAction) return;
        
        console.log(`🎬 Ending macro recording: ${this.pendingMacroName}`);
        
        // Take final snapshot
        const finalSnapshot = await this.takeSnapshot();
        
        // Remove any history after current index (branching)
        this.history = this.history.slice(0, this.currentIndex + 1);
        
        // Add the macro as a single action
        this.history.push({
            action: this.pendingMacroName || 'Macro',
            snapshot: finalSnapshot,
            sessionId: this.sessionId ?? Date.now()
        });
        
        // Trim history if it exceeds max
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.currentIndex++;
        }
        
        // Reset macro state
        this.isMacroRecording = false;
        this.macroStartSnapshot = null;
        this.pendingMacroName = null;
        
        this.updateState();
    }
    
    // Record an action (automatically takes snapshot)
    /**
     * @param {string} actionName
     */
    async recordAction(actionName) {
        if (this.isPerformingHistoryAction) return;
        if (!this.initialized) await this.initialize();
        
        // Skip individual recording if we're in a macro
        if (this.isMacroRecording) {
            console.log(`📝 Skipping individual action during macro: ${actionName}`);
            return;
        }
        
        // Auto-start session if not started
        if (!this.sessionId) {
            await this.startNewSession();
        }
        
        console.log(`📝 Recording action: ${actionName}`);
        
        // Take snapshot of current state (this is the RESULT of the action)
        const snapshot = await this.takeSnapshot();
        
        // Remove any history after current index (branching)
        this.history = this.history.slice(0, this.currentIndex + 1);
        
        // Add new snapshot
        this.history.push({
            action: actionName,
            snapshot: snapshot,
            sessionId: this.sessionId ?? Date.now()
        });
        
        // Trim history if it exceeds max
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.currentIndex++;
        }
        
        this.updateState();
    }
    
    // Restore a snapshot
    /**
     * @param {any} snapshot
     */
    async restoreSnapshot(snapshot) {
        if (!snapshot) return;
        if (!this.initialized) await this.initialize();
        
        this.isPerformingHistoryAction = true;
        
        try {
            // Restore all stores
            /** @type {any} */
            const stores = this.stores; // non-null after initialize()
            stores.nodes.set(snapshot.nodes);
            stores.connections.set(snapshot.connections);
            
            // Restore node data store
            const nodeDataMap = new Map(snapshot.nodeDataStore);
            stores.nodeDataStore.set(nodeDataMap);
            
            // Restore customizations
            const customizationsMap = new Map(snapshot.customizations);
            stores.containerCustomizations.set(customizationsMap);
            
            // workflowContainers will automatically update as it's derived
            
            console.log('✅ Snapshot restored');
        } finally {
            // Small delay to ensure derived stores update
            setTimeout(() => {
                this.isPerformingHistoryAction = false;
            }, 100);
        }
    }
    
    // Undo last action
    async undo() {
        if (this.currentIndex <= 0) {
            console.log('⚠️ Nothing to undo');
            return false;
        }
        
        console.log(`↩️ Undoing action at index ${this.currentIndex}`);
        
        this.currentIndex--;
        const targetState = this.history[this.currentIndex];
        await this.restoreSnapshot(targetState.snapshot);
        
        this.updateState();
        return true;
    }
    
    // Redo last undone action
    async redo() {
        if (this.currentIndex >= this.history.length - 1) {
            console.log('⚠️ Nothing to redo');
            return false;
        }
        
        console.log(`↪️ Redoing action at index ${this.currentIndex + 1}`);
        
        this.currentIndex++;
        const targetState = this.history[this.currentIndex];
        await this.restoreSnapshot(targetState.snapshot);
        
        this.updateState();
        return true;
    }
    
    // Update the reactive state
    updateState() {
        historyState.set({
            canUndo: this.currentIndex > 0,
            canRedo: this.currentIndex < this.history.length - 1,
            actionCount: this.history.length,
            currentIndex: this.currentIndex
        });
    }
    
    // Check if we're currently performing a history action
    isHistoryAction() {
        return this.isPerformingHistoryAction;
    }
    
    // Check if we're currently recording a macro
    isMacro() {
        return this.isMacroRecording;
    }
}

// Create singleton instance
export const canvasHistory = new CanvasHistory();

// Export convenient action functions
export const historyActions = {
    record: (/** @type {string} */ actionName) => canvasHistory.recordAction(actionName),
    undo: () => canvasHistory.undo(),
    redo: () => canvasHistory.redo(),
    startNewSession: () => canvasHistory.startNewSession(),
    isHistoryAction: () => canvasHistory.isHistoryAction(),
    startMacro: (/** @type {string} */ macroName) => canvasHistory.startMacro(macroName),
    endMacro: () => canvasHistory.endMacro(),
    isMacro: () => canvasHistory.isMacro()
};

// Initialize on module load
setTimeout(() => {
    canvasHistory.initialize();
}, 0);