import { BasePlugin } from '../../core/base-plugin.js';
import { NodeData } from '../../../lib/NodeData.js';
import StaticNodeComponent from './StaticNode.svelte';
import manifest from './config.json';

export class StaticPlugin extends BasePlugin {
    constructor() { 
        super(manifest); 
    }
    
    /**
     * Create node data for static content
     * @param {string} id - Node ID
     * @param {string} content - Static content
     * @returns {NodeData} Node data instance
     */
    createNodeData(id, content = '') {
        return new NodeData('static', id, content || 'Static content', this.manifest.name);
    }
    
    getComponent() { 
        return StaticNodeComponent; 
    }
}