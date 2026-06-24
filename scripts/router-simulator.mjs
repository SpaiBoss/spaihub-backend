/**
 * Simulates a MikroTik router for local dev (no hardware required).
 *
 * Usage:
 *   node scripts/router-simulator.mjs YOUR_ROUTER_TOKEN
 *
 * Sends heartbeat every 60s and polls for SpaiHub commands every 30s.
 */

const token = process.argv[2];
const base = process.env.API_BASE_URL || 'http://localhost:4000';

if (!token) {
  console.error('Usage: node scripts/router-simulator.mjs <router-token>');
  process.exit(1);
}

async function heartbeat() {
  const res = await fetch(`${base}/api/router/heartbeat`, {
    method: 'POST',
    headers: { 'X-Router-Token': token },
  });
  console.log(`[heartbeat] ${res.status}`);
}

async function pollCommands() {
  const res = await fetch(`${base}/api/router/commands`, {
    headers: { 'X-Router-Token': token },
  });
  const text = await res.text();
  if (text.includes('GRANT_ACCESS') || text.includes('KICK_USER')) {
    console.log('[commands] received:\n', text);
  } else {
    console.log('[commands] none pending');
  }
}

console.log(`SpaiHub router simulator → ${base}`);
console.log(`Token: ${token.slice(0, 8)}...`);

await heartbeat();
await pollCommands();

setInterval(heartbeat, 60_000);
setInterval(pollCommands, 30_000);
