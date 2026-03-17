/**
 * Universal Container System for Ordinal
 * Treats all entities (nodes, machines, factories, networks) as containers
 * This enables universal copy/paste and connection logic
 */

export class UniversalContainer {
    /**
     * @param {'node' | 'machine' | 'factory' | 'network'} type
     * @param {string} id
     * @param {Record<string, any>=} config
     */
    constructor(type, id, config = {}) {
        /** @type {'node' | 'machine' | 'factory' | 'network'} */
        this.type = type; // 'node', 'machine', 'factory', 'network'
        this.id = id;
        /** @type {UniversalContainer[]} */
        this.children = []; // For node: empty, for machine: nodes, for factory: machines, etc.
        /** @type {Record<string, any>} */
        this.config = config; // Type-specific configuration
        this.coordinates = { x: 0, y: 0 };
        this.connections = { inputs: [], outputs: [] };
        this.metadata = {
            created_at: new Date().toISOString(),
            originalId: id // Preserve original ID for context mapping
        };
    }

    // Universal factory method - creates appropriate container type
    /**
     * @param {Record<string, any>} config
     * @param {number} [offsetX]
     * @param {number} [offsetY]
     * @returns {UniversalContainer}
     */
    static fromConfig(config, offsetX = 0, offsetY = 0) {
        // Handle single entity types first
        if (config.node || config.node_type) {
            return UniversalContainer.createNode(config.node || config, offsetX, offsetY);
        } else if (config.machine) {
            return UniversalContainer.createMachine(config.machine, offsetX, offsetY);
        } else if (config.factory) {
            return UniversalContainer.createFactory(config.factory, offsetX, offsetY);
        } else if (config.network) {
            return UniversalContainer.createNetwork(config.network, offsetX, offsetY);
        }

        // Handle plural arrays - check for mixed configurations
        const hasNetworks = config.networks && Array.isArray(config.networks);
        const hasFactories = config.factories && Array.isArray(config.factories);
        const hasMachines = config.machines && Array.isArray(config.machines);
        const hasNodes = config.nodes && Array.isArray(config.nodes);

        // Standalone nodes only — no container wrapping, return individual nodes
        if (hasNodes && !hasNetworks && !hasFactories && !hasMachines) {
            const container = new UniversalContainer('nodes-group', 'nodes-group');
            container.type = 'nodes-group';
            for (const nodeConfig of config.nodes) {
                container.children.push(
                    UniversalContainer.createNode(nodeConfig, offsetX, offsetY)
                );
            }
            return container;
        }

        // Mixed or hierarchical — build synthetic network
        if (hasNetworks || hasFactories || hasMachines) {
            const networkConfig = { id: 'network-auto' };

            if (hasNetworks) networkConfig.networks = config.networks;
            if (hasFactories) networkConfig.factories = config.factories;
            if (hasMachines) networkConfig.machines = config.machines;
            if (hasNodes) networkConfig.nodes = config.nodes;

            return UniversalContainer.createNetwork(networkConfig, offsetX, offsetY);
        }

        throw new Error('Unknown config type');
    }

    /**
     * @param {Record<string, any>} nodeConfig
     * @param {number} [offsetX]
     * @param {number} [offsetY]
     * @returns {UniversalContainer}
     */
    static createNode(nodeConfig, offsetX = 0, offsetY = 0) {
        // Convert context to inputs for consistency
        let inputs = nodeConfig.inputs;
        if (nodeConfig.context && nodeConfig.context !== 'none') {
            inputs = inputs ? [...inputs, nodeConfig.context] : [nodeConfig.context];
        }

        const container = new UniversalContainer('node', nodeConfig.id, {
            // .ologic uses node_type; Thoughtorio format uses type — support both
            nodeType: nodeConfig.type || nodeConfig.node_type,
            // .ologic uses title for display name; fall back to label
            title: nodeConfig.title || nodeConfig.label || '',
            label: nodeConfig.label || nodeConfig.title || '',
            // .ologic icon field (optional override)
            icon: nodeConfig.icon || '',
            content: nodeConfig.content || '',
            inputs: inputs,
            outputs: nodeConfig.outputs,
            // Carry through file path metadata for file-based nodes
            filePath: nodeConfig.file_path || nodeConfig.file_source || '',
            // Carry through AI overrides if present in concise config
            model: nodeConfig.model || '',
            temperature: nodeConfig.temperature,
            // Carry through requirements traceability array
            requirements: nodeConfig.requirements || []
        });
        
        // Set coordinates with fallback
        container.coordinates.x = (nodeConfig.x || 0) + offsetX;
        container.coordinates.y = (nodeConfig.y || 0) + offsetY;
        
        return container;
    }

    /**
     * @param {Record<string, any>} machineConfig
     * @param {number} [offsetX]
     * @param {number} [offsetY]
     * @returns {UniversalContainer}
     */
    static createMachine(machineConfig, offsetX = 0, offsetY = 0) {
        const container = new UniversalContainer('machine', machineConfig.id);

        // Store custom properties from config
        // .ologic uses title for display name; Thoughtorio uses label — support both
        const machineLabel = machineConfig.label || machineConfig.title || '';
        container.config = {
            ...(machineConfig.color && { color: machineConfig.color }),
            ...(machineLabel && { label: machineLabel }),
            requirements: machineConfig.requirements || [],
        };
        
        // Create child node containers
        for (const nodeConfig of machineConfig.nodes || []) {
            const nodeContainer = UniversalContainer.createNode(nodeConfig, offsetX, offsetY);
            container.children.push(nodeContainer);
        }
        
        return container;
    }

    /**
     * @param {Record<string, any>} factoryConfig
     * @param {number} [offsetX]
     * @param {number} [offsetY]
     * @returns {UniversalContainer}
     */
    static createFactory(factoryConfig, offsetX = 0, offsetY = 0) {
        const container = new UniversalContainer('factory', factoryConfig.id);

        // Store custom properties from config
        // .ologic uses title for display name; Thoughtorio uses label — support both
        const factoryLabel = factoryConfig.label || factoryConfig.title || '';
        container.config = {
            ...(factoryConfig.color && { color: factoryConfig.color }),
            ...(factoryLabel && { label: factoryLabel }),
            requirements: factoryConfig.requirements || [],
        };
        
        // Create child machine containers
        for (const machineConfig of factoryConfig.machines || []) {
            const machineContainer = UniversalContainer.createMachine(machineConfig, offsetX, offsetY);
            container.children.push(machineContainer);
        }
        
        // Create standalone node containers
        for (const nodeConfig of factoryConfig.nodes || []) {
            const nodeContainer = UniversalContainer.createNode(nodeConfig, offsetX, offsetY);
            container.children.push(nodeContainer);
        }
        
        return container;
    }

    /**
     * @param {Record<string, any>} networkConfig
     * @param {number} [offsetX]
     * @param {number} [offsetY]
     * @returns {UniversalContainer}
     */
    static createNetwork(networkConfig, offsetX = 0, offsetY = 0) {
        const container = new UniversalContainer('network', networkConfig.id);

        // Store custom properties from config
        // .ologic uses title for display name; Thoughtorio uses label — support both
        const networkLabel = networkConfig.label || networkConfig.title || '';
        if (networkConfig.color || networkLabel) {
            container.config = {
                ...(networkConfig.color && { color: networkConfig.color }),
                ...(networkLabel && { label: networkLabel })
            };
        }
        
        // Create child factory containers
        for (const factoryConfig of networkConfig.factories || []) {
            const factoryContainer = UniversalContainer.createFactory(factoryConfig, offsetX, offsetY);
            container.children.push(factoryContainer);
        }
        
        // Create child machine containers
        for (const machineConfig of networkConfig.machines || []) {
            const machineContainer = UniversalContainer.createMachine(machineConfig, offsetX, offsetY);
            container.children.push(machineContainer);
        }
        
        // Create standalone node containers
        for (const nodeConfig of networkConfig.nodes || []) {
            const nodeContainer = UniversalContainer.createNode(nodeConfig, offsetX, offsetY);
            container.children.push(nodeContainer);
        }
        
        return container;
    }

    // Universal flattener - gets all containers at specified depth
    /**
     * @param {'node' | 'machine' | 'factory' | 'network'} targetType
     * @returns {UniversalContainer[]}
     */
    flattenByType(targetType) {
        /** @type {UniversalContainer[]} */
        const results = [];
        
        if (this.type === targetType) {
            results.push(this);
        }
        
        for (const child of this.children) {
            results.push(...child.flattenByType(targetType));
        }
        
        return results;
    }

    // Universal finder - finds container by original ID
    /**
     * @param {string} targetId
     * @returns {UniversalContainer | null}
     */
    findById(targetId) {
        if (this.id === targetId || this.metadata.originalId === targetId) {
            return this;
        }
        
        for (const child of this.children) {
            const found = child.findById(targetId);
            if (found) return found;
        }
        
        return null;
    }

    // Universal connection resolver - maps old IDs to new containers
    buildConnectionMap() {
        const map = new Map();
        
        /**
         * @param {UniversalContainer} container
         */
        const addToMap = (container) => {
            map.set(container.metadata.originalId, container);
            for (const child of container.children) {
                addToMap(child);
            }
        };
        
        addToMap(this);
        return map;
    }

    // Get the first node in this container (for connections)
    /**
     * @returns {UniversalContainer | null}
     */
    getFirstNode() {
        if (this.type === 'node') {
            return this;
        }
        
        for (const child of this.children) {
            const node = child.getFirstNode();
            if (node) return node;
        }
        
        return null;
    }

    // Get the last node in this container (for outputs)
    /**
     * @returns {UniversalContainer | null}
     */
    getLastNode() {
        if (this.type === 'node') {
            return this;
        }
        
        // Traverse in reverse to get the last node
        for (let i = this.children.length - 1; i >= 0; i--) {
            const node = this.children[i].getLastNode();
            if (node) return node;
        }
        
        return null;
    }

    // Get the first machine in this container
    /**
     * @returns {UniversalContainer | null}
     */
    getFirstMachine() {
        if (this.type === 'machine') {
            return this;
        }
        
        for (const child of this.children) {
            if (child.type === 'machine') {
                return child;
            }
            const machine = child.getFirstMachine();
            if (machine) return machine;
        }
        
        return null;
    }

    // Get the last machine in this container
    /**
     * @returns {UniversalContainer | null}
     */
    getLastMachine() {
        if (this.type === 'machine') {
            return this;
        }
        
        // Traverse in reverse to get the last machine
        for (let i = this.children.length - 1; i >= 0; i--) {
            if (this.children[i].type === 'machine') {
                return this.children[i];
            }
            const machine = this.children[i].getLastMachine();
            if (machine) return machine;
        }
        
        return null;
    }

    // Get the first factory in this container
    /**
     * @returns {UniversalContainer | null}
     */
    getFirstFactory() {
        if (this.type === 'factory') {
            return this;
        }
        
        for (const child of this.children) {
            if (child.type === 'factory') {
                return child;
            }
            const factory = child.getFirstFactory();
            if (factory) return factory;
        }
        
        return null;
    }

    // Get the output connector of this container
    /**
     * @returns {string | null}
     */
    getOutputConnector() {
        if (this.type === 'node') {
            return this.id; // Node connects directly
        } else if (this.type === 'machine') {
            // Machine outputs from last node
            const lastNode = this.getLastNode();
            return lastNode ? lastNode.id : this.id;
        } else if (this.type === 'factory') {
            // Factory outputs from last machine's last node
            const lastMachine = this.getLastMachine();
            return lastMachine ? lastMachine.getOutputConnector() : this.id;
        } else if (this.type === 'network') {
            // Networks have no output (highest level)
            return null;
        }
        return this.id;
    }

    // Get the input connector of this container
    /**
     * @returns {string | null}
     */
    getInputConnector() {
        if (this.type === 'node') {
            return this.id; // Node connects directly
        } else if (this.type === 'machine') {
            // Machine inputs to first node
            const firstNode = this.getFirstNode();
            return firstNode ? firstNode.id : this.id;
        } else if (this.type === 'factory') {
            // Factory inputs to first machine's first node
            const firstMachine = this.getFirstMachine();
            return firstMachine ? firstMachine.getInputConnector() : this.id;
        } else if (this.type === 'network') {
            // Networks have no input connector (highest ontology level)
            return null;
        }
        return this.id;
    }

    // Universal to YAML config
    toConfig() {
        /** @type {Record<string, any>} */
        const config = {};
        
        if (this.type === 'node') {
            const nodeType = /** @type {string} */ (this.config.nodeType ?? this.config.type ?? '');
            /** @type {Record<string, any>} */
            const nodeConfig = {
                id: this.metadata.originalId,
                type: nodeType,
                x: this.coordinates.x,
                y: this.coordinates.y
            };

            // File source nodes: emit file_path instead of content and never include inputs
            if (nodeType === 'text_file_source' || nodeType === 'pdf_file_source') {
                if (this.config.filePath) {
                    nodeConfig.file_path = this.config.filePath;
                }
            } else {
                // Regular nodes can include content
                if (this.config.content !== undefined) {
                    nodeConfig.content = this.config.content;
                }
                // Only non-source nodes may include inputs
                if (this.config.inputs && this.config.inputs.length > 0) {
                    nodeConfig.inputs = this.config.inputs;
                }
            }

            // Outputs can be present for any node type
            if (this.config.outputs) {
                nodeConfig.outputs = this.config.outputs;
            }

            config.node = nodeConfig;
        } else {
            /** @type {Record<string, any>} */
            const containerData = {
                id: this.metadata.originalId
            };
            
            if (this.children.length > 0) {
                /** @type {Record<string, any[]>} */
                const childrenByType = {};
                
                for (const child of this.children) {
                    const childConfig = child.toConfig();
                    const childType = child.type === 'node' ? 'nodes' : child.type + 's';
                    
                    if (!childrenByType[childType]) {
                        childrenByType[childType] = [];
                    }
                    
                    const configValue = childConfig.node || childConfig.machine || childConfig.factory || childConfig.network;
                    if (configValue) {
                        childrenByType[childType].push(configValue);
                    }
                }
                
                Object.assign(containerData, childrenByType);
            }
            
            config[this.type] = containerData;
        }
        
        return config;
    }
}

// Universal connection engine
export class UniversalConnector {
    /**
     * @param {UniversalContainer} fromContainer
     * @param {UniversalContainer} toContainer
     * @param {{ add: (fromId: string, toId: string, fromPort: string, toPort: string) => void }} connectionActions
     */
    static async connectContainers(fromContainer, toContainer, connectionActions) {
        const fromId = fromContainer.getOutputConnector();
        const toId = toContainer.getInputConnector();
        
        if (fromId && toId && fromId !== toId) {
            console.log(`🔗 Universal connection: ${fromContainer.type}(${fromId}) -> ${toContainer.type}(${toId})`);
            connectionActions.add(fromId, toId, 'output', 'input');
            return true;
        }
        
        return false;
    }

    // Process all connections in a container using universal logic
    /**
     * @param {UniversalContainer} container
     * @param {{ add: (fromId: string, toId: string, fromPort: string, toPort: string) => void }} connectionActions
     */
    static async processConnections(container, connectionActions) {
        const connectionMap = container.buildConnectionMap();
        const processedConnections = new Set();
        
        // Recursive function to process connections at all levels
        /**
         * @param {UniversalContainer} currentContainer
         */
        const processLevel = (currentContainer) => {
            for (const child of currentContainer.children) {
                // Process child's internal connections first
                processLevel(child);
                
                // Process connections FROM this child
                const childConfig = /** @type {Record<string, any>} */ (child.config);
                
                // Handle inputs (unified approach - both context and inputs array)
                let allInputs = [];
                if (childConfig.context && childConfig.context !== 'none') {
                    allInputs.push(childConfig.context);
                }
                if (childConfig.inputs && Array.isArray(childConfig.inputs)) {
                    allInputs.push(...childConfig.inputs);
                }
                
                // Process all inputs
                if (allInputs.length > 0) {
                    for (const inputId of allInputs) {
                        const sourceContainer = connectionMap.get(inputId);
                        if (sourceContainer) {
                            const connectionKey = `${sourceContainer.id}->${child.id}`;
                            if (!processedConnections.has(connectionKey)) {
                                UniversalConnector.connectContainers(sourceContainer, child, connectionActions);
                                processedConnections.add(connectionKey);
                            }
                        }
                    }
                }
                
                // Handle outputs
                if (childConfig.outputs && Array.isArray(childConfig.outputs)) {
                    for (const outputId of childConfig.outputs) {
                        const targetContainer = connectionMap.get(outputId);
                        if (targetContainer) {
                            const connectionKey = `${child.id}->${targetContainer.id}`;
                            if (!processedConnections.has(connectionKey)) {
                                UniversalConnector.connectContainers(child, targetContainer, connectionActions);
                                processedConnections.add(connectionKey);
                            }
                        }
                    }
                }
            }
        };
        
        processLevel(container);
    }
}
