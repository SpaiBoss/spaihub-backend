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
  if (cmd.type === 'UPDATE_ACCESS_POLICY') {
    return [
      `# SpaiHub UPDATE_ACCESS_POLICY ${cmd.id}`,
      buildRemoveAntiTetheringLines(),
    ].join('\n');
  }

  const username = cmd.payload?.username;
  if (!username) {
    return `# SpaiHub: missing username for command ${cmd.id}`;
  }

  const safeUsername = escapeRouterOsString(username);

  if (cmd.type === 'REBIND_MAC') {
    const macAddress = cmd.payload?.macAddress;
    if (!macAddress) {
      return `# SpaiHub REBIND_MAC ${cmd.id}: missing macAddress`;
    }
    const safeMac = escapeRouterOsString(macAddress);
    return [
      `# SpaiHub REBIND_MAC ${cmd.id}`,
      `:local username "${safeUsername}"`,
      `:local mac "${safeMac}"`,
      `/ip hotspot user set [find name=$username comment~"spaihub"] mac-address=$mac`,
      `/ip hotspot active remove [find user=$username]`,
      `/ip hotspot cookie remove [find user=$username]`,
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

  const password = cmd.payload?.password;
  if (!password) {
    return `# SpaiHub: missing password for command ${cmd.id}`;
  }

  const safePassword = escapeRouterOsString(password);

  if (cmd.type === 'GRANT_ACCESS') {
    const timeout = formatMikrotikTimeout(cmd.payload.sessionMinutes);
    const sharedUsers = Math.max(1, Number(cmd.payload.sharedUsers) || 1);
    const cookieMinutes = Math.max(
      15,
      Math.min(24 * 60, Number(cmd.payload.macCookieMinutes) || Number(cmd.payload.sessionMinutes) || 60)
    );
    const cookieTimeout = formatMikrotikTimeout(cookieMinutes);
    const rateLimit = buildMikrotikRateLimit(
      cmd.payload.uploadSpeedMbPerSec,
      cmd.payload.downloadSpeedMbPerSec
    );
    const profile = `spaihub-s${sharedUsers}-c${cookieMinutes}`;
    const byteLimit = resolveByteLimit(cmd.payload);
    const limitBytesLine = byteLimit
      ? ` limit-bytes-total=${byteLimit}`
      : '';
    const bindMac =
      sharedUsers === 1 && cmd.payload?.macAddress
        ? escapeRouterOsString(cmd.payload.macAddress)
        : null;
    const macAddressLine = bindMac ? ` mac-address="${bindMac}"` : '';

    return [
      `# SpaiHub GRANT_ACCESS ${cmd.id}`,
      `:local username "${safeUsername}"`,
      `:local password "${safePassword}"`,
      `:local profile "${profile}"`,
      `:if ([:len [/ip hotspot user profile find name=$profile]] = 0) do={`,
      `  /ip hotspot user profile add name=$profile shared-users=${sharedUsers} mac-cookie-timeout=${cookieTimeout} rate-limit="${rateLimit}"`,
      `} else={`,
      `  /ip hotspot user profile set [find name=$profile] shared-users=${sharedUsers} mac-cookie-timeout=${cookieTimeout} rate-limit="${rateLimit}"`,
      `}`,
      `/ip hotspot user remove [find name=$username comment~"spaihub"]`,
      `/ip hotspot active remove [find user=$username]`,
      `/ip hotspot user add name=$username password=$password profile=$profile comment=spaihub limit-uptime=${timeout}${limitBytesLine}${macAddressLine}`,
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
  // Keep lines short and use /system script — long scheduler on-event lines truncate in Terminal paste.
  return `# SpaiHub router connection script
# Paste into MikroTik terminal after you have a working hotspot.

/system scheduler remove [find name=spaihub-heartbeat]
/system scheduler remove [find name=spaihub-commands]
/system scheduler remove [find name=spaihub-hotspot-active]
/system script remove [find name=spaihub-heartbeat]
/system script remove [find name=spaihub-commands]
/system script remove [find name=spaihub-hotspot-active]

/system script add name=spaihub-heartbeat source={
:local token "${routerToken}"
:local api "${API_BASE}/api/router/heartbeat"
:local hdr ("X-Router-Token: " . $token)
/tool fetch url=$api http-method=post http-header-field=$hdr mode=${mode} keep-result=no
}

/system script add name=spaihub-commands source={
:local token "${routerToken}"
:local api "${API_BASE}/api/router/commands"
:local ackUrl "${API_BASE}/api/router/commands/ack"
:local hdr ("X-Router-Token: " . $token)
:local ackHdr ($hdr . ",Content-Type: application/json")
:local body "{\\"success\\":true}"
/tool fetch url=$api http-method=get http-header-field=$hdr mode=${mode} dst-path=spaihub-cmd.rsc
:if ([:len [/file find name=spaihub-cmd.rsc]] > 0) do={
/import file-name=spaihub-cmd.rsc
/tool fetch url=$ackUrl http-method=post http-header-field=$ackHdr http-data=$body mode=${mode} keep-result=no
/file remove spaihub-cmd.rsc
}
}

/system script add name=spaihub-hotspot-active source={
:local token "${routerToken}"
:local api "${API_BASE}/api/router/hotspot-active"
:local hdr ("X-Router-Token: " . $token . ",Content-Type: text/plain")
:local body ""
:foreach i in=[/ip hotspot active find] do={
:local u [/ip hotspot active get $i user]
:local m [/ip hotspot active get $i mac-address]
:set body ($body . $u . "," . $m . ";")
}
/tool fetch url=$api http-method=post http-header-field=$hdr http-data=$body mode=${mode} keep-result=no
}

/system scheduler add name=spaihub-heartbeat interval=1m on-event="/system script run spaihub-heartbeat"
/system scheduler add name=spaihub-commands interval=15s on-event="/system script run spaihub-commands"
/system scheduler add name=spaihub-hotspot-active interval=2m on-event="/system script run spaihub-hotspot-active"`;
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

/** Always remove legacy TTL anti-tether rules — they blocked legitimate phone traffic. */
function buildRemoveAntiTetheringLines() {
  return [
    '# Remove legacy SpaiHub anti-tether rules (TTL=63 drop is unsafe on phones)',
    '/ip firewall mangle remove [find comment~"spaihub-anti-tether"]',
    '/ip firewall filter remove [find comment~"spaihub-anti-tether"]',
  ].join('\n');
}

/** Captive-portal page for MikroTik html-directory — redirects to cloud MoMo portal. */
export function buildMikrotikLoginHtml(routerToken) {
  const portalUrl = buildPortalUrl(routerToken);
  const portalUrlHtml = portalUrl.replace(/&/g, '&amp;');
  const portalUrlJs = JSON.stringify(portalUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="pragma" content="no-cache">
<meta http-equiv="expires" content="-1">
<meta http-equiv="refresh" content="0;url=${portalUrlHtml}">
<title>SpaiHub</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#0E141B;color:#fff;padding:1.25rem}
  .card{width:100%;max-width:22rem;text-align:center}
  h1{font-size:1.35rem;margin:0;font-weight:700;letter-spacing:-0.02em}
  .sub{margin:0.45rem 0 1.25rem;opacity:0.7;font-size:0.9rem;line-height:1.45}
  a.btn{display:block;width:100%;margin-top:0.5rem;padding:0.85rem 1.25rem;background:#0F766E;color:#fff;
    border-radius:0.5rem;font-weight:600;font-size:1rem;text-decoration:none}
  .hint{margin-top:1rem;opacity:0.55;font-size:0.75rem;line-height:1.4}
</style>
<script>
  location.replace(${portalUrlJs});
</script>
</head>
<body>
  <div class="card">
    <h1>SpaiHub</h1>
    <p class="sub">Opening WiFi portal — pay with Mobile Money or use a voucher.</p>
    <a class="btn" href="${portalUrlHtml}">Continue to portal</a>
    <p class="hint">After payment, your username and PIN stay on screen. Tap Connect when ready.</p>
  </div>
</body>
</html>
`;
}

export function buildMikrotikLoginHtmlUrl(routerToken) {
  return `${API_BASE.replace(/\/$/, '')}/portal/${routerToken}/mikrotik-login.html`;
}

/** Hotspot status page (served from router after login). Keep MikroTik $(…) macros literal. */
export function buildMikrotikStatusHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
$(if refresh-timeout)
<meta http-equiv="refresh" content="$(refresh-timeout-secs)">
$(endif)
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="pragma" content="no-cache">
<meta http-equiv="expires" content="-1">
<title>SpaiHub — Connected</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#0E141B;color:#fff;padding:1.25rem}
  .card{width:100%;max-width:22rem;text-align:center}
  .brand{font-size:1.35rem;margin:0;font-weight:700;letter-spacing:-0.02em}
  .badge{display:inline-flex;align-items:center;gap:0.4rem;margin:0.85rem 0 0.25rem;
    padding:0.35rem 0.75rem;border-radius:999px;background:rgba(15,118,110,0.2);
    color:#5eead4;font-size:0.75rem;font-weight:600;letter-spacing:0.02em}
  .badge-dot{width:0.45rem;height:0.45rem;border-radius:50%;background:#14b8a6}
  h1{font-size:1.15rem;margin:0.85rem 0 0.35rem;font-weight:600;letter-spacing:-0.01em}
  .sub{margin:0 0 1.25rem;opacity:0.65;font-size:0.875rem;line-height:1.45}
  .stats{text-align:left;border:1px solid #2a3441;border-radius:0.65rem;overflow:hidden;
    background:#161d27;margin:0 0 1.15rem}
  .row{display:flex;justify-content:space-between;gap:0.75rem;padding:0.7rem 0.85rem;
    border-bottom:1px solid #2a3441;font-size:0.85rem}
  .row:last-child{border-bottom:0}
  .label{opacity:0.55;flex-shrink:0}
  .value{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600;
    text-align:right;word-break:break-all;color:#e8eef5}
  a.warn{color:#5eead4;text-decoration:underline}
  .actions{display:flex;flex-direction:column;gap:0.65rem}
  button,.btn{display:block;width:100%;padding:0.85rem 1.25rem;background:#0F766E;color:#fff;
    border:0;border-radius:0.5rem;font-weight:600;font-size:1rem;cursor:pointer;text-decoration:none;
    text-align:center;font-family:inherit}
  .credit{margin-top:1.25rem;opacity:0.4;font-size:0.7rem}
  .credit a{color:inherit;text-decoration:none}
</style>
<script>
$(if advert-pending == 'yes')
  var popup = '';
  function focusAdvert() {
    if (window.focus) popup.focus();
  }
  function openAdvert() {
    popup = open('$(link-advert)', 'hotspot_advert', '');
    setTimeout("focusAdvert()", 1000);
  }
$(endif)
  function openLogout() {
    if (window.name != 'hotspot_status') return true;
    open('$(link-logout)', 'hotspot_logout', 'toolbar=0,location=0,directories=0,status=0,menubars=0,resizable=1,width=280,height=250');
    window.close();
    return false;
  }
</script>
</head>
<body $(if advert-pending == 'yes') onLoad="openAdvert()" $(endif)>
  <div class="card">
    <p class="brand">SpaiHub</p>
    <div class="badge"><span class="badge-dot"></span> Online</div>

    $(if login-by == 'trial')
      <h1>Hi, trial user</h1>
      <p class="sub">You are connected to this hotspot.</p>
    $(elif login-by != 'mac')
      <h1>Hi, $(username)</h1>
      <p class="sub">You are connected to this hotspot.</p>
    $(else)
      <h1>You&apos;re online</h1>
      <p class="sub">This device is connected to the hotspot.</p>
    $(endif)

    <div class="stats">
      <div class="row"><span class="label">IP address</span><span class="value">$(ip)</span></div>
      <div class="row"><span class="label">Up / down</span><span class="value">$(bytes-in-nice) / $(bytes-out-nice)</span></div>
      $(if session-time-left)
      <div class="row"><span class="label">Connected / left</span><span class="value">$(uptime) / $(session-time-left)</span></div>
      $(else)
      <div class="row"><span class="label">Connected</span><span class="value">$(uptime)</span></div>
      $(endif)
      $(if blocked == 'yes')
      <div class="row"><span class="label">Status</span><span class="value"><a class="warn" href="$(link-advert)" target="hotspot_advert">Advertisement required</a></span></div>
      $(elif refresh-timeout)
      <div class="row"><span class="label">Refresh</span><span class="value">$(refresh-timeout)</span></div>
      $(endif)
    </div>

    <form action="$(link-logout)" name="logout" onSubmit="return openLogout()">
      <div class="actions">
        $(if login-by-mac != 'yes')
        <button type="submit">Log out</button>
        $(endif)
      </div>
    </form>

    <p class="credit"><a href="https://www.spaitrace.com">Powered by www.spaitrace.com</a></p>
  </div>
</body>
</html>
`;
}

export function buildMikrotikStatusHtmlUrl(routerToken) {
  return `${API_BASE.replace(/\/$/, '')}/portal/${routerToken}/mikrotik-status.html`;
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

function buildSpaiHubHotspotOverlayScript(routerToken, chrConfig = null) {
  const frontendHost = new URL(FRONTEND_URL).host;
  const apiHost = new URL(API_BASE).host;
  const hotspotTarget = chrConfig?.hotspotName
    ? `[find name="${escapeRouterOsString(chrConfig.hotspotName)}"]`
    : '[find]';
  const loginHtmlUrl = buildMikrotikLoginHtmlUrl(routerToken);
  const statusHtmlUrl = buildMikrotikStatusHtmlUrl(routerToken);
  const mode = fetchMode(loginHtmlUrl);

  return `# SpaiHub overlay — walled garden, profiles, captive HTML
# Allow subscribers to reach SpaiHub portal, API, Campay, and TLS OCSP before login
# Do not add Google Fonts or OS captive-probe hosts (they break or suppress the portal)
/ip hotspot walled-garden ip remove [find comment~"spaihub"]
/ip hotspot walled-garden ip add action=accept dst-host=${frontendHost} comment=spaihub-portal
/ip hotspot walled-garden ip add action=accept dst-host=${apiHost} comment=spaihub-api
/ip hotspot walled-garden ip add action=accept dst-host=www.campay.net comment=spaihub-campay
/ip hotspot walled-garden ip add action=accept dst-host=demo.campay.net comment=spaihub-campay-demo
/ip hotspot walled-garden ip add action=accept dst-host=ocsp.letsencrypt.org comment=spaihub-ocsp

${buildProfileSetupLines()}

${buildRemoveAntiTetheringLines()}

# Apply login methods + html directory on every profile used by a hotspot
:foreach hsId in=[/ip hotspot find] do={
  :local p [/ip hotspot get $hsId profile]
  # Prefer http-pap for captive phone forms (plaintext password). http-chap needs md5.js.
  /ip hotspot profile set $p login-by=http-pap,https html-directory=hotspot
}
/ip hotspot set ${hotspotTarget} disabled=no

# Download SpaiHub captive pages into the hotspot HTML directory
/tool fetch url="${loginHtmlUrl}" mode=${mode} dst-path=hotspot/login.html
/tool fetch url="${statusHtmlUrl}" mode=${mode} dst-path=hotspot/status.html

# If fetch fails, upload via Winbox Files → hotspot/ from:
# ${loginHtmlUrl}
# ${statusHtmlUrl}

# Optional: test the portal in a browser (does not need the router):
# ${buildPreviewPortalUrl(routerToken)}`;
}

/** Path A — SpaiHub on an existing hotspot (does not create interfaces/DHCP/NAT). */
export function buildHotspotSetupScript(routerToken, location = {}, chrConfig = null) {
  return `# SpaiHub hotspot setup — Path A: existing hotspot
# Prerequisite: a working hotspot (clients get DHCP + captive page). Verify: /ip hotspot print
# RouterOS has no login-url property — redirect is installed as hotspot/login.html

${buildSpaiHubHotspotOverlayScript(routerToken, chrConfig)}`;
}

/**
 * Path B — add-if-missing guest hotspot on lanIf (default ether2), then SpaiHub overlay.
 * Does not wipe WAN, bridges, or wireless. Skips hotspot create if any hotspot already exists.
 */
export function buildPhysicalGuestHotspotBootstrapScript({
  lanInterface = 'ether2',
  wanInterface = 'ether1',
} = {}) {
  const lanIf = escapeRouterOsString(lanInterface);
  const wanIf = escapeRouterOsString(wanInterface);

  return `# SpaiHub guest hotspot bootstrap — Path B (add-if-missing only)
# Edit interfaces if needed. Guest subnet: 10.10.10.0/24 on LAN.
:local lanIf "${lanIf}"
:local wanIf "${wanIf}"
:local gw "10.10.10.1"
:local poolName "spaihub-hs-pool"
:local hsName "hotspot1"

# Gateway IP on guest LAN (skip if this interface already has a 10.10.10.x address)
:if ([:len [/ip address find interface=$lanIf address~"10.10.10."]] = 0) do={
  /ip address add address=10.10.10.1/24 interface=$lanIf comment=spaihub-guest
}

# DHCP pool
:if ([:len [/ip pool find name=$poolName]] = 0) do={
  /ip pool add name=$poolName ranges=10.10.10.2-10.10.10.254
}

# DHCP network
:if ([:len [/ip dhcp-server network find address="10.10.10.0/24"]] = 0) do={
  /ip dhcp-server network add address=10.10.10.0/24 gateway=$gw dns-server=$gw comment=spaihub-guest
}

# DHCP server on guest LAN
:if ([:len [/ip dhcp-server find interface=$lanIf]] = 0) do={
  /ip dhcp-server add name=$poolName interface=$lanIf address-pool=$poolName disabled=no
}

# Hotspot server — only if none exist (safe if Path B was chosen by mistake)
:if ([:len [/ip hotspot find]] = 0) do={
  /ip hotspot add name=$hsName interface=$lanIf address-pool=$poolName profile=default disabled=no
}

# Masquerade — only if no srcnat masquerade exists yet
:if ([:len [/ip firewall nat find chain=srcnat action=masquerade]] = 0) do={
  /ip firewall nat add chain=srcnat out-interface=$wanIf action=masquerade comment=spaihub-guest-nat
}`;
}

export function buildHotspotSetupScriptCreate(routerToken, { lanInterface, wanInterface, chrConfig } = {}) {
  return `# SpaiHub hotspot setup — Path B: create guest hotspot (add-if-missing) + SpaiHub overlay
# Defaults: LAN=${lanInterface || 'ether2'} WAN=${wanInterface || 'ether1'} guest 10.10.10.0/24
# Does not reset WAN, bridges, or wireless.

${buildPhysicalGuestHotspotBootstrapScript({ lanInterface, wanInterface })}

${buildSpaiHubHotspotOverlayScript(routerToken, chrConfig)}`;
}

const INTERFACE_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

export function normalizePhysicalSetupOptions(options = {}) {
  const modeRaw = options.physicalSetupMode || options.mode || 'existing';
  const physicalSetupMode = modeRaw === 'create' ? 'create' : 'existing';
  const lanInterface = String(options.lanInterface || options.lanIf || 'ether2').trim();
  const wanInterface = String(options.wanInterface || options.wanIf || 'ether1').trim();

  if (!INTERFACE_NAME_RE.test(lanInterface)) {
    return { error: 'Invalid LAN interface name' };
  }
  if (!INTERFACE_NAME_RE.test(wanInterface)) {
    return { error: 'Invalid WAN interface name' };
  }

  return {
    physicalSetupMode,
    lanInterface,
    wanInterface,
  };
}

export function buildRouterSetup(routerToken, location = {}, options = {}) {
  const { deploymentType = 'PHYSICAL', chrConfig = null } = options;
  const physical = normalizePhysicalSetupOptions(options);
  if (physical.error) {
    return { error: physical.error };
  }

  const effectiveChrConfig = deploymentType === 'CHR' ? { ...DEFAULT_CHR_CONFIG, ...chrConfig } : null;

  const hotspotSetupScriptExisting = buildHotspotSetupScript(
    routerToken,
    location,
    effectiveChrConfig
  );
  const hotspotSetupScriptCreate = buildHotspotSetupScriptCreate(routerToken, {
    lanInterface: physical.lanInterface,
    wanInterface: physical.wanInterface,
    chrConfig: effectiveChrConfig,
  });

  const hotspotSetupScript =
    deploymentType === 'PHYSICAL' && physical.physicalSetupMode === 'create'
      ? hotspotSetupScriptCreate
      : hotspotSetupScriptExisting;

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
    physicalSetupMode: physical.physicalSetupMode,
    lanInterface: physical.lanInterface,
    wanInterface: physical.wanInterface,
    hotspotSetupScript,
    hotspotSetupScriptExisting,
    hotspotSetupScriptCreate,
    connectionScript,
    portalUrl: buildPortalUrl(routerToken),
    previewPortalUrl: buildPreviewPortalUrl(routerToken),
    scriptOrder,
    mikrotikScript: parts.join('\n\n'),
  };
}
