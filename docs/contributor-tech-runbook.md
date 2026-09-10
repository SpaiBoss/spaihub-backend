# Contributor link — technician notes

Not customer-facing. Path A/B owner scripts stay unchanged.

## On the contributor LAN
1. Dumb switch on their router LAN.
2. One port for home devices; one port for the SpaiHub run (CAT6 or CPE210 pair).

## On the hotspot Hex
1. Dedicated ethernet (or VLAN) for the contributor uplink.
2. DHCP client or static IP on that interface as needed.
3. `/queue simple` (or interface queue) capped to agreed Mbps with margin under claimed excess.
4. NAT masquerade for that out-interface if required.
5. Add to load-balance / PCC with existing WAN — failover if link dies.
6. Record interface name (e.g. `ether5`) in Admin → Contributor links.

## Metering
- Read cumulative RX+TX (or outbound bytes) for the interface.
- Post monotonic `bytesTotal` via Admin → Links → Post meter (or `POST /api/admin/contributor-links/:id/meters`).
- Only `ACTIVE` links accrue; `PAUSED` stores samples without credit.
