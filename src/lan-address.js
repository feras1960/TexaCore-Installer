'use strict';
// The address office PCs type to reach this computer («رابط الموظفين داخل المكتب»).
//
// WHY THIS EXISTS: the first non-internal IPv4 of ANY interface was used. On a Mac with a VPN that is often a tunnel
// (utun9 = 12.1.1.4): the link was shown, copied and sent to staff, and no office PC could ever open it. The real LAN
// address belongs to the Wi-Fi / Ethernet adapter (en0 = 172.20.10.2 on a phone hotspot).
//
// pickLanAddress() is a PURE function over the shape of os.networkInterfaces(), so it is unit-tested with fixtures
// (test/lan-address.test.js). Order of preference:
//   1. the interface that carries the default route, unless it is a tunnel / virtual adapter;
//   2. a physical adapter by name: en* / eth* / Wi-Fi / Ethernet (private addresses first);
//   3. any other adapter holding a private address: 10/8, 172.16/12, 192.168/16;
//   4. anything else that is still a usable unicast IPv4 (never a tunnel, never link-local);
//   5. 127.0.0.1, only when nothing at all exists.
// Never chosen: loopback, link-local 169.254/16, IPv6, and the adapters named in VIRTUAL_NAME_RE.

const { execFile } = require('child_process');

// Tunnels and virtual adapters. The first group is the list agreed for macOS; the rest are the names Windows and common VPN /
// virtualisation products give their adapters (a "vEthernet (WSL)" or a Tailscale adapter must not beat the real Wi-Fi).
const VIRTUAL_NAME_RE = new RegExp('^(?:'
  + 'utun|tun|tap|ppp|ipsec|awdl|llw|bridge|vmnet|docker|vboxnet'
  + '|lo\\d*$|veth|virbr|br-|gif|stf|anpi|ap\\d|p2p'
  + '|vethernet|vmware|virtualbox|hyper-v|wsl|loopback|bluetooth|tailscale|zerotier|zt|wireguard|wg\\d|openvpn|nordlynx|proton|cloudflare|warp'
  + ')', 'i');

// A physical-looking adapter: macOS / Linux names, and the English Windows names (other languages fall to rule 3, the private ranges).
const PHYSICAL_NAME_RE = /^(?:en\d+|eth\d+|enp\w+|eno\w+|ens\w+|wlan\d*|wlp\w+|wi-?fi(?:\s*\d+)?|wireless(?:\s+network\s+connection)?(?:\s*\d+)?|ethernet(?:\s*\d+)?|local area connection(?:\s*\d+)?)$/i;

function isIPv4(a) { return !!a && (a.family === 'IPv4' || a.family === 4); }
function octets(addr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(addr || ''));
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}
function isPrivateV4(addr) {
  const o = octets(addr);
  if (!o) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}
function isUsableUnicastV4(addr) {
  const o = octets(addr);
  if (!o) return false;
  if (o[0] === 127 || o[0] === 0) return false;                  // loopback / "this network"
  if (o[0] === 169 && o[1] === 254) return false;                // link-local (no DHCP answered)
  if (o[0] >= 224) return false;                                 // multicast / reserved / broadcast
  return true;
}
function isVirtualName(name) { return VIRTUAL_NAME_RE.test(String(name || '').trim()); }
function isPhysicalName(name) { return PHYSICAL_NAME_RE.test(String(name || '').trim()); }

// natural order so en0 comes before en1 and en10 after en2
function byName(a, b) { return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }); }

/**
 * @param {Record<string, Array<{address:string, family:string|number, internal?:boolean}>>} interfaces  os.networkInterfaces()
 * @param {{ name?: string|null, address?: string|null }} [defaultRoute]  the interface carrying the default route, by name and/or by its IPv4 address
 * @returns {string} the IPv4 address to show, or '127.0.0.1' when none exists
 */
function pickLanAddress(interfaces, defaultRoute) {
  const all = [];
  for (const name of Object.keys(interfaces || {})) {
    for (const a of (interfaces[name] || [])) {
      if (!isIPv4(a) || a.internal || !isUsableUnicastV4(a.address)) continue;
      all.push({ name, address: a.address, tunnel: isVirtualName(name) });
    }
  }
  const usable = all.filter((c) => !c.tunnel);
  const best = (list) => list.slice().sort((x, y) => (Number(isPrivateV4(y.address)) - Number(isPrivateV4(x.address))) || byName(x, y))[0];

  // 1. the default route's interface (named, or found by its address), if it is not a tunnel / virtual adapter
  const dr = defaultRoute || {};
  if (dr.name || dr.address) {
    const onRoute = usable.filter((c) => (dr.name && c.name === dr.name) || (dr.address && c.address === dr.address));
    if (onRoute.length) return best(onRoute).address;
  }
  // 2. a physical adapter by name
  const physical = usable.filter((c) => isPhysicalName(c.name));
  if (physical.length) return best(physical).address;
  // 3. any other adapter with a private address
  const priv = usable.filter((c) => isPrivateV4(c.address));
  if (priv.length) return best(priv).address;
  // 4. whatever usable address is left
  if (usable.length) return best(usable).address;
  return '127.0.0.1';
}

// ─── the default route (which interface carries the traffic to the internet / the office router) ───
// macOS: `route -n get default`  →  "  interface: en0"
function parseDarwinRouteGet(text) {
  const m = /^\s*interface:\s*(\S+)\s*$/m.exec(String(text || ''));
  return m ? { name: m[1] } : null;
}
// Windows: `route print -4 0.0.0.0`  →  numeric active-route lines "0.0.0.0  0.0.0.0  <gateway>  <interface address>  <metric>"
// (numbers only, so it does not depend on the Windows display language). The lowest metric wins.
function parseWindowsRoutePrint(text) {
  let best = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const metric = Number(m[3]);
    if (!best || metric < best.metric) best = { address: m[2], metric };
  }
  return best ? { address: best.address } : null;
}

function detectDefaultRoute(platform, run) {
  const exec = run || ((cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { timeout: 2000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  }));
  if (platform === 'darwin') return exec('/sbin/route', ['-n', 'get', 'default']).then(parseDarwinRouteGet);
  if (platform === 'win32') return exec('route', ['print', '-4', '0.0.0.0']).then(parseWindowsRoutePrint);
  return Promise.resolve(null);
}

// A tiny cache: the answer is read on every status poll (about every 5 s) and never waits for a child process. The first call
// answers from the interface names alone and starts the lookup; later calls use the default route once it is known.
function createLanAddressProvider({ networkInterfaces, platform, ttlMs = 60000, now = Date.now, detect = detectDefaultRoute }) {
  let route = null;
  let at = 0;
  let pending = false;
  function refresh() {
    if (pending) return;
    pending = true;
    at = now();
    Promise.resolve().then(() => detect(platform)).then((r) => { route = r || null; }, () => { route = null; }).then(() => { pending = false; });
  }
  return {
    get() {
      if (!at || now() - at > ttlMs) refresh();
      return pickLanAddress(networkInterfaces(), route);
    },
    refresh,
  };
}

module.exports = {
  pickLanAddress, createLanAddressProvider, detectDefaultRoute, parseDarwinRouteGet, parseWindowsRoutePrint,
  isPrivateV4, isUsableUnicastV4, isVirtualName, isPhysicalName,
};
