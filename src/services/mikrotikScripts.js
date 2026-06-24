import { escapeRouterOsString } from '../utils/hotspotCredentials.js';

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
  if (!dataCapMb) return null;
  return Number(dataCapMb) * 1024 * 1024;
}

export function buildPortalUrl(routerToken, mac = '$(mac)') {
  const base = `${FRONTEND_URL.replace(/\/$/, '')}/portal/${routerToken}`;
  if (mac === '$(mac)') {
    return `${base}?mac=$(mac)&link-login-only=$(link-login-only)`;
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
    const uploadMbit = (cmd.payload.uploadSpeedMbPerSec || 1) * 8;
    const profile = `spaihub-${sharedUsers}`;
    const byteLimit = formatBytesLimit(cmd.payload.dataCapMb);
    const limitBytesLine = byteLimit
      ? ` limit-bytes-total=${byteLimit}`
      : '';

    return [
      `# SpaiHub GRANT_ACCESS ${cmd.id}`,
      `:local username "${safeUsername}"`,
      `:local password "${safePassword}"`,
      `:local profile "${profile}"`,
      `:if ([:len [/ip hotspot user profile find name=$profile]] = 0) do={`,
      `  /ip hotspot user profile add name=$profile shared-users=${sharedUsers} mac-cookie-timeout=1d rate-limit="${uploadMbit}M/0"`,
      `}`,
      `/ip hotspot user remove [find name=$username comment~"spaihub"]`,
      `/ip hotspot active remove [find user=$username]`,
      `/ip hotspot user add name=$username password=$password profile=$profile comment=spaihub limit-uptime=${timeout}${limitBytesLine}`,
    ].join('\n');
  }

  if (cmd.type === 'KICK_USER') {
    return [
      `# SpaiHub KICK_USER ${cmd.id}`,
      `:local username "${safeUsername}"`,
      `/ip hotspot active remove [find user=$username]`,
      `/ip hotspot user remove [find name=$username comment~"spaihub"]`,
    ].join('\n');
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

/system scheduler add name=spaihub-commands interval=30s on-event={
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
  const lines = [
    '# SpaiHub user profiles (shared-users controls simultaneous logins per credential)',
    '/ip hotspot user profile remove [find name~"^spaihub-"]',
  ];
  for (let n = 1; n <= 5; n += 1) {
    lines.push(
      `/ip hotspot user profile add name=spaihub-${n} shared-users=${n} mac-cookie-timeout=1d rate-limit=8M/0`
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
    '/ip firewall mangle add chain=forward action=mark-packet new-packet-mark=spaihub-tether passthrough=no ttl=63 comment=spaihub-anti-tether',
    '/ip firewall filter add chain=forward action=drop packet-mark=spaihub-tether comment=spaihub-anti-tether',
  ].join('\n');
}

export function buildHotspotSetupScript(routerToken, location = {}) {
  const portalUrl = buildPortalUrl(routerToken);
  const frontendHost = new URL(FRONTEND_URL).host;
  const apiHost = new URL(API_BASE).host;
  const enableAntiTethering = !location.allowHotspotSharing;

  return `# SpaiHub hotspot setup (run once on your MikroTik)
# Adjust interface names and hotspot profile if yours differ from "hotspot1" / default profile.

# Allow subscribers to reach SpaiHub portal and API before login
/ip hotspot walled-garden ip remove [find comment~"spaihub"]
/ip hotspot walled-garden ip add action=accept dst-host=${frontendHost} comment=spaihub-portal
/ip hotspot walled-garden ip add action=accept dst-host=${apiHost} comment=spaihub-api

${buildProfileSetupLines()}

${buildAntiTetheringLines(enableAntiTethering)}

# Send unauthenticated users to the SpaiHub captive portal
/ip hotspot profile set [find default=yes] login-by=http-chap,http-pap,https html-directory=hotspot login-url="${portalUrl}"

# Optional: test redirect locally by opening this URL in a browser:
# ${buildPreviewPortalUrl(routerToken)}`;
}

export function buildRouterSetup(routerToken, location = {}) {
  const hotspotSetupScript = buildHotspotSetupScript(routerToken, location);
  return {
    portalUrl: buildPortalUrl(routerToken),
    previewPortalUrl: buildPreviewPortalUrl(routerToken),
    connectionScript: buildConnectionScript(routerToken),
    hotspotSetupScript,
    mikrotikScript: `${hotspotSetupScript}\n\n${buildConnectionScript(routerToken)}`,
  };
}
