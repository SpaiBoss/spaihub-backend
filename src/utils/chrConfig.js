const INTERFACE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const CIDR_RE = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const POOL_RE = /^\d{1,3}(\.\d{1,3}){3}-\d{1,3}(\.\d{1,3}){3}$/;

export const DEFAULT_CHR_CONFIG = {
  wanInterface: 'ether1',
  lanInterface: 'ether2',
  bridgeName: 'bridge-spaihub',
  hotspotName: 'hotspot1',
  localNetwork: '192.168.88.0/24',
  gatewayIp: '192.168.88.1',
  dhcpPool: '192.168.88.10-192.168.88.254',
};

export function parseChrConfig(input) {
  if (input === undefined || input === null) {
    return { data: { ...DEFAULT_CHR_CONFIG } };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid CHR configuration' };
  }

  const merged = { ...DEFAULT_CHR_CONFIG, ...input };
  const {
    wanInterface,
    lanInterface,
    bridgeName,
    hotspotName,
    localNetwork,
    gatewayIp,
    dhcpPool,
  } = merged;

  if (!INTERFACE_RE.test(wanInterface)) {
    return { error: 'Invalid WAN interface name' };
  }
  if (!INTERFACE_RE.test(lanInterface)) {
    return { error: 'Invalid LAN interface name' };
  }
  if (!INTERFACE_RE.test(bridgeName)) {
    return { error: 'Invalid bridge name' };
  }
  if (!INTERFACE_RE.test(hotspotName)) {
    return { error: 'Invalid hotspot name' };
  }
  if (!CIDR_RE.test(localNetwork)) {
    return { error: 'Invalid local network CIDR (e.g. 192.168.88.0/24)' };
  }
  if (!IP_RE.test(gatewayIp)) {
    return { error: 'Invalid gateway IP' };
  }
  if (!POOL_RE.test(dhcpPool)) {
    return { error: 'Invalid DHCP pool (e.g. 192.168.88.10-192.168.88.254)' };
  }

  return {
    data: {
      wanInterface,
      lanInterface,
      bridgeName,
      hotspotName,
      localNetwork,
      gatewayIp,
      dhcpPool,
    },
  };
}

export function parseDeploymentType(value) {
  if (value === undefined || value === null || value === 'PHYSICAL') {
    return { data: 'PHYSICAL' };
  }
  if (value === 'CHR') {
    return { data: 'CHR' };
  }
  return { error: 'deploymentType must be PHYSICAL or CHR' };
}
