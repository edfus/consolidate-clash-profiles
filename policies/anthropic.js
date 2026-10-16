// Node labels are provider metadata; this does not verify the exit IP's location.
const canada = /加拿大|(?:^|[^a-z])Canada(?=$|[^a-z])|🇨🇦/i;

export function isCanadaNode(proxy) {
  return typeof proxy?.name === 'string' && canada.test(proxy.name);
}

export function isCanada03Node(proxy) {
  if (!isCanadaNode(proxy)) return false;
  const region = canada.exec(proxy.name);
  const tail = proxy.name.slice(region.index + region[0].length);
  // The first numeric field after the region is the node ID. Do not mistake
  // 13/30/003, a multiplier, expiry days or duplicate suffix for node 03.
  return /^[^\d\[\]()]*(?:03|3)(?=$|[\s._|丨:/-])(?!\s*(?:x|倍|%))/i.test(tail);
}

export const proxyGroupFilters = { Anthropic: isCanadaNode };
export const proxyGroupPriorities = { Anthropic: isCanada03Node };
