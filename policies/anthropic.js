// Exact generated node labels; provider metadata does not verify exit location.
export const anthropicPreferredNode = '[Ytoo] Japan 02';
export const anthropicBackupNode = '[TAG] Japan-5G网络 10x';

export function isAnthropicNode(proxy) {
  return proxy?.name === anthropicPreferredNode || proxy?.name === anthropicBackupNode;
}

export function isPreferredAnthropicNode(proxy) {
  return proxy?.name === anthropicPreferredNode;
}

// Keep the existing manual selector. The second candidate is a manual backup.
// One missing node retains the other; neither present fails closed in index.js.
export const proxyGroupFilters = { Anthropic: isAnthropicNode };
export const proxyGroupPriorities = { Anthropic: isPreferredAnthropicNode };
