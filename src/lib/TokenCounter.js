/**
 * TokenCounter - lightweight token estimation for canvas and nodes
 * Heuristic: ~4 characters per token (common rough estimate for English)
 */

/**
 * Estimate token count from plain text
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  // Conservative: 4 chars per token
  return Math.ceil(normalized.length / 4);
}

/**
 * Estimate tokens for a structured context value
 * @param {{facts?: string[], history?: Array<{role:string, content:string}>, task?: string}} value
 * @returns {number}
 */
/**
 * @param {import('./NodeData').StructuredContext} value
 */
export function estimateTokensForStructured(value) {
  if (!value || typeof value !== 'object') return 0;
  let text = '';
  if (Array.isArray(value.facts)) {
    text += value.facts.join('\n') + '\n';
  }
  if (Array.isArray(value.history)) {
    text += value.history.map(h => `${h.role}: ${h.content}`).join('\n') + '\n';
  }
  if (value.task) {
    text += value.task + '\n';
  }
  return estimateTokens(text);
}

/**
 * Estimate tokens for a NodeData instance
 * - For AI nodes, uses assembled prompt via getProcessedInput()
 * - For file/input/static nodes, uses structured output
 * @param {import('./NodeData').NodeData} nodeData
 * @returns {number}
 */
export function estimateTokensForNode(nodeData) {
  if (!nodeData || !nodeData.data) return 0;
  const type = nodeData.data.node_type;
  try {
    if (type === 'ai' || type === 'text_file_output') {
      const prompt = nodeData.getProcessedInput?.() || '';
      return estimateTokens(prompt);
    }
    if (nodeData.data.output && nodeData.data.output.type === 'structured_context') {
      const outputValue = nodeData.data.output.value;
      if (outputValue && typeof outputValue === 'object') {
        return estimateTokensForStructured(outputValue);
      }
      return estimateTokens(String(outputValue ?? nodeData.data.content ?? ''));
    }
    return estimateTokens(nodeData.data.content || '');
  } catch (_) {
    return estimateTokens(nodeData.data.content || '');
  }
}

/**
 * Estimate total tokens across all nodes on canvas
 * @param {Map<string, import('./NodeData').NodeData>} nodeMap
 * @returns {number}
 */
export function estimateTokensForCanvas(nodeMap) {
  if (!nodeMap || typeof nodeMap.forEach !== 'function') return 0;
  let total = 0;
  nodeMap.forEach(nd => { total += estimateTokensForNode(nd); });
  return total;
}
