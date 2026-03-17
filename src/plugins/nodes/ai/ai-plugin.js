import { BasePlugin } from '../../core/base-plugin.js';
import { NodeData } from '../../../lib/NodeData.js';
import AINodeComponent from './AINode.svelte';
import manifest from './config.json';

export class AIPlugin extends BasePlugin {
    constructor() { 
        super(manifest); 
    }

    /**
     * @param {string} id
     * @param {string} [content]
     * @returns {NodeData}
     */
    createNodeData(id, content = '') {
        return new NodeData('ai', id, content || 'Waiting for input...', this.manifest.name);
    }
    
    getComponent() { 
        return AINodeComponent; 
    }
}
