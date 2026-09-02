import { escapeRouterOsString } from '../utils/hotspotCredentials.js';
import { DEFAULT_CHR_CONFIG } from '../utils/chrConfig.js';
import { buildMikrotikRateLimit } from '../utils/rateLimit.js';

const API_BASE = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function fetchMode(url) {
  return url.startsWith('https') ? 'https' : 'http';
}

function formatMikrotikTimeout(minutes) {
  const m = Number(minutes) || 60;
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440}d`;
  if (m >= 60 && m % 60 === 0) return `${m / 60}h`;
  return `${m}m`;
}

function formatBytesLimit(dataCapMb) {
  if (!dataCapMb || Number(dataCapMb) <= 0) return null;
  return Number(dataCapMb) * 1024 * 1024;
}

function resolveByteLimit(payload) {
  const dataCapMb = payload?.dataCapMb;
  const packageType = payload?.packageType;

  if (packageType === 'TIME_BASED') {
    return dataCapMb ? formatBytesLimit(dataCapMb) : null;
  }

  if (packageType === 'DATA_BASED') {
    return formatBytesLimit(dataCapMb);
  }

  // Legacy commands (before packageType): only apply cap when explicitly set
  return dataCapMb ? formatBytesLimit(dataCapMb) : null;
}

export function buildPortalUrl(routerToken, mac = '$(mac)') {
  const base = `${FRONTEND_URL.replace(/\/$/, '')}/portal/${routerToken}`;
  if (mac === '$(mac)') {
    return `${base}?mac=$(mac)&link-login-only=$(link-login-only)&link-logout=$(link-logout)`;
  }
  return `${base}?mac=${encodeURIComponent(mac)}`;
}

export function buildPreviewPortalUrl(routerToken) {
  return `${FRONTEND_URL.replace(/\/$/, '')}/portal/${routerToken}`;
}

export function commandToRouterOs(cmd) {
  const username = cmd.payload?.username;
  const password = cmd.payload?.password;

  if (!username || !password) {
    return `# SpaiHub: missing username/password for command ${cmd.id}`;
  }

  const safeUsername = escapeRouterOsString(username);
  const safePassword = escapeRouterOsString(password);

  if (cmd.type === 'GRANT_ACCESS') {
    const timeout = formatMikrotikTimeout(cmd.payload.sessionMinutes);
    const sharedUsers = Math.max(1, Number(cmd.payload.sharedUsers) || 1);
    const rateLimit = buildMikrotikRateLimit(
      cmd.payload.uploadSpeedMbPerSec,
      cmd.payload.downloadSpeedMbPerSec
    );
    const profile = `spaihub-${sharedUsers}`;
    const byteLimit = resolveByteLimit(cmd.payload);
    const limitBytesLine = byteLimit
      ? ` limit-bytes-total=${byteLimit}`
      : '';

    return [
      `# SpaiHub GRANT_ACCESS ${cmd.id}`,
      `:local username "${safeUsername}"`,
      `:local password "${safePassword}"`,
      `:local profile "${profile}"`,
      `:if ([:len [/ip hotspot user profile find name=$profile]] = 0) do={`,
      `  /ip hotspot user profile add name=$profile shared-users=${sharedUsers} mac-cookie-timeout=1d rate-limit="${rateLimit}"`,
      `} else={`,
      `  /ip hotspot user profile set [find name=$profile] shared-users=${sharedUsers} rate-limit="${rateLimit}"`,
      `}`,
      `/ip hotspot user remove [find name=$username comment~"spaihub"]`,
      `/ip hotspot active remove [find user=$username]`,
      `/ip hotspot user add name=$username password=$password profile=$profile comment=spaihub limit-uptime=${timeout}${limitBytesLine}`,
    ].join('\n');
  }

  if (cmd.type === 'KICK_USER') {
    const macAddress = cmd.payload?.macAddress;
    const safeMac = macAddress ? escapeRouterOsString(macAddress) : null;
    const lines = [
      `# SpaiHub KICK_USER ${cmd.id}`,
      `:local username "${safeUsername}"`,
      `/ip hotspot active remove [find user=$username]`,
      `/ip hotspot cookie remove [find user=$username]`,
    ];

    if (safeMac) {
      lines.push(`/ip hotspot active remove [find mac-address="${safeMac}"]`);
      lines.push(`/ip hotspot cookie remove [find mac-address="${safeMac}"]`);
    }

    lines.push(`/ip hotspot user remove [find name=$username comment~"spaihub"]`);
    return lines.join('\n');
  }

  return `# SpaiHub: unsupported command type ${cmd.type}`;
}

export function buildCommandsRouterOs(commands) {
  if (!commands.length) {
    return '# SpaiHub: no pending commands';
  }
  return commands.map(commandToRouterOs).join('\n\n');
}

export function buildConnectionScript(routerToken) {
  const mode = fetchMode(API_BASE);
  return `# SpaiHub router connection script
# Paste into MikroTik terminal after you have a working hotspot.

/system scheduler remove [find name=spaihub-heartbeat]
/system scheduler remove [find name=spaihub-commands]

/system scheduler add name=spaihub-heartbeat interval=1m on-event={
:local token "${routerToken}"
:local api "${API_BASE}/api/router/heartbeat"
/tool fetch url=$api http-method=post http-header-field="X-Router-Token: $token" mode=${mode} keep-result=no
}

/system scheduler add name=spaihub-commands interval=15s on-event={
:local token "${routerToken}"
:local api "${API_BASE}/api/router/commands"
/tool fetch url=$api http-method=get http-header-field="X-Router-Token: $token" mode=${mode} dst-path=spaihub-cmd.rsc
:if ([:len [/file find name=spaihub-cmd.rsc]] > 0) do={
  /import file-name=spaihub-cmd.rsc
  /file remove spaihub-cmd.rsc
}
}`;
}

function buildProfileSetupLines() {
  const rateLimit = buildMikrotikRateLimit(1, null);
  const lines = [
    '# SpaiHub user profiles (shared-users controls simultaneous logins per credential)',
    '/ip hotspot user profile remove [find name~"^spaihub-"]',
  ];
  for (let n = 1; n <= 5; n += 1) {
    lines.push(
      `/ip hotspot user profile add name=spaihub-${n} shared-users=${n} mac-cookie-timeout=1d rate-limit="${rateLimit}"`
    );
  }
  return lines.join('\n');
}

function buildAntiTetheringLines(enableAntiTethering) {
  if (!enableAntiTethering) {
    return [
      '# Anti-tethering disabled (hotspot sharing allowed at this location)',
      '/ip firewall mangle remove [find comment~"spaihub-anti-tether"]',
      '/ip firewall filter remove [find comment~"spaihub-anti-tether"]',
    ].join('\n');
  }

  return [
    '# Block tethered traffic (TTL=63 indicates one hop consumed inside phone hotspot)',
    '/ip firewall mangle remove [find comment~"spaihub-anti-tether"]',
    '/ip firewall filter remove [find comment~"spaihub-anti-tether"]',
    '/ip firewall mangle add chain=forward action=mark-packet new-packet-mark=spaihub-tether passthrough=no ttl=equal:63 comment=spaihub-anti-tether',
    '/ip firewall filter add chain=forward action=drop packet-mark=spaihub-tether comment=spaihub-anti-tether',
  ].join('\n');
}

/** Captive-portal redirect page for MikroTik html-directory (RouterOS has no login-url property). */
export function buildMikrotikLoginHtml(routerToken) {
  const portalUrl = buildPortalUrl(routerToken);
  return `<html>
<head>
<meta http-equiv="refresh" content="0; url=${portalUrl}">
<meta http-equiv="pragma" content="no-cache">
<meta http-equiv="expires" content="-1">
<script>
  window.location.href="${portalUrl}";
</script>
</head>
<body>
  <a href="${portalUrl}">Continue to SpaiHub</a>
</body>
</html>
`;
}

export function buildMikrotikLoginHtmlUrl(routerToken) {
  return `${API_BASE.replace(/\/$/, '')}/portal/${routerToken}/mikrotik-login.html`;
}

export function buildChrBootstrapScript(chrConfig = DEFAULT_CHR_CONFIG) {
  const cfg = { ...DEFAULT_CHR_CONFIG, ...chrConfig };
  const bridge = escapeRouterOsString(cfg.bridgeName);
  const wan = escapeRouterOsString(cfg.wanInterface);
  const lan = escapeRouterOsString(cfg.lanInterface);
  const hotspot = escapeRouterOsString(cfg.hotspotName);
  const gateway = escapeRouterOsString(cfg.gatewayIp);
  const network = escapeRouterOsString(cfg.localNetwork);
  const pool = escapeRouterOsString(cfg.dhcpPool);
  const poolName = 'spaihub-dhcp';

  return `# SpaiHub CHR bootstrap (run first on a fresh MikroTik CHR)
# Verify interface names with /interface print before running.
# WAN: ${cfg.wanInterface}  LAN: ${cfg.lanInterface}  Bridge: ${cfg.bridgeName}

:local bridgeName "${bridge}"
:local wanIf "${wan}"
:local lanIf "${lan}"
:local hsName "${hotspot}"
:local gw "${gateway}"

# Bridge for hotspot LAN
:if ([:len [/interface bridge find name=$bridgeName]] = 0) do={
  /interface bridge add name=$bridgeName comment=spaihub-chr
}
:if ($lanIf != $wanIf) do={
  :if ([:len [/interface bridge port find interface=$lanIf]] = 0) do={
    /interface bridge port add bridge=$bridgeName interface=$lanIf
  }
} else={
  # Single-NIC CHR: add WAN interface to bridge (adjust if your layout differs)
  :if ([:len [/interface bridge port find interface=$wanIf]] = 0) do={
    /interface bridge port add bridge=$bridgeName interface=$wanIf
  }
}

# Gateway IP on bridge
:if ([:len [/ip address find interface=$bridgeName address~"${gateway}/"]] = 0) do={
  /ip address add address=${gateway}/24 interface=$bridgeName comment=spaihub-chr
}

# DHCP pool and server
/ip pool remove [find name="${poolName}"]
/ip pool add name=${poolName} ranges=${pool}
/ip dhcp-server network remove [find address="${network}"]
/ip dhcp-server network add address=${network} gateway=$gw dns-server=$gw comment=spaihub-chr
/ip dhcp-server remove [find name="${poolName}"]
/ip dhcp-server add name=${poolName} interface=$bridgeName address-pool=${poolName} disabled=no

# Hotspot server on bridge
/ip hotspot remove [find name=$hsName]
/ip hotspot add name=$hsName interface=$bridgeName address-pool=${poolName} profile=default disabled=no

# NAT for WAN
/ip firewall nat remove [find comment=spaihub-chr-nat]
/ip firewall nat add chain=srcnat out-interface=$wanIf action=masquerade comment=spaihub-chr-nat

# DNS for clients
/ip dns set allow-remote-requests=yes servers=8.8.8.8,1.1.1.1

# Allow established connections
/ip firewall filter remove [find comment=spaihub-chr-forward]
:if ([:len [/ip firewall filter find comment=spaihub-chr-forward]] = 0) do={
  /ip firewall filter add chain=forward action=accept connection-state=established,related comment=spaihub-chr-forward
}`;
}

export function buildHotspotSetupScript(routerToken, location = {}, chrConfig = null) {
  const frontendHost = new URL(FRONTEND_URL).host;
  const apiHost = new URL(API_BASE).host;
  const enableAntiTethering = !location.allowHotspotSharing;
  const hotspotTarget = chrConfig?.hotspotName
    ? `[find name="${escapeRouterOsString(chrConfig.hotspotName)}"]`
    : '[find]';
  const loginHtmlUrl = buildMikrotikLoginHtmlUrl(routerToken);
  const mode = fetchMode(loginHtmlUrl);

  return `# SpaiHub hotspot setup (run once on your MikroTik)
# Requires an existing hotspot server. Verify with: /ip hotspot print
# RouterOS has no login-url property — redirect is installed as hotspot/login.html

# Allow subscribers to reach SpaiHub portal and API before login
/ip hotspot walled-garden ip remove [find comment~"spaihub"]
/ip hotspot walled-garden ip add action=accept dst-host=${frontendHost} comment=spaihub-portal
/ip hotspot walled-garden ip add action=accept dst-host=${apiHost} comment=spaihub-api

${buildProfileSetupLines()}

${buildAntiTetheringLines(enableAntiTethering)}

# Apply login methods + html directory on every profile used by a hotspot
:foreach hsId in=[/ip hotspot find] do={
  :local p [/ip hotspot get $hsId profile]
  /ip hotspot profile set $p login-by=http-chap,http-pap,https html-directory=hotspot
}
/ip hotspot set ${hotspotTarget} disabled=no

# Download SpaiHub redirect page into the hotspot HTML directory
/tool fetch url="${loginHtmlUrl}" mode=${mode} dst-path=hotspot/login.html

# If fetch fails, upload login.html via Winbox Files → hotspot/login.html from:
# ${loginHtmlUrl}

# Optional: test the portal in a browser (does not need the router):
# ${buildPreviewPortalUrl(routerToken)}`;
}

export function buildRouterSetup(routerToken, location = {}, options = {}) {
  const { deploymentType = 'PHYSICAL', chrConfig = null } = options;
  const effectiveChrConfig = deploymentType === 'CHR' ? { ...DEFAULT_CHR_CONFIG, ...chrConfig } : null;
  const hotspotSetupScript = buildHotspotSetupScript(
    routerToken,
    location,
    effectiveChrConfig
  );
  const connectionScript = buildConnectionScript(routerToken);
  const chrBootstrapScript =
    deploymentType === 'CHR' ? buildChrBootstrapScript(effectiveChrConfig) : null;

  const scriptOrder =
    deploymentType === 'CHR'
      ? ['chrBootstrap', 'hotspot', 'connection']
      : ['hotspot', 'connection'];

  const parts = [hotspotSetupScript, connectionScript];
  if (chrBootstrapScript) {
    parts.unshift(chrBootstrapScript);
  }

  return {
    deploymentType,
    chrConfig: effectiveChrConfig,
    chrBootstrapScript,
    hotspotSetupScript,
    connectionScript,
    portalUrl: buildPortalUrl(routerToken),
    previewPortalUrl: buildPreviewPortalUrl(routerToken),
    scriptOrder,
    mikrotikScript: parts.join('\n\n'),
  };
}
