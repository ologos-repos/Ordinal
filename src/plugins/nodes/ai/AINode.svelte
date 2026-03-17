<script>
    export let node;  // Visual node from nodes store
    export const nodeData = undefined;  // NodeData instance
</script>

<div class="content">{node.content}</div>

<style>
    .content { 
        padding: 12px; 
        font-style: italic; 
        color: #666; 
    }
</style>