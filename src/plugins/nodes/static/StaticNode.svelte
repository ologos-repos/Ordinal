<script>
    /** @type {any} */
    export let node;  // Visual node from nodes store
    /** @type {any} */
    export const nodeData = undefined;  // NodeData instance
</script>

<div class="content">{node.content}</div>

<style>
    .content { 
        padding: 12px; 
        white-space: pre-wrap; 
        font-size: 13px; 
    }
</style>