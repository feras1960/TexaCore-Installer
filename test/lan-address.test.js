'use strict';
// The address shown in «رابط الموظفين (داخل المكتب)». Fixtures have the exact shape of os.networkInterfaces().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../src/lan-address');

const v4 = (address, extra) => Object.assign({ address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: address + '/24' }, extra);
const v6 = (address) => ({ address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: address + '/64', scopeid: 0 });
const loop = [v4('127.0.0.1', { internal: true, netmask: '255.0.0.0' }), v6('::1')];

// The owner's Mac on 2026-10-17: the VPN tunnel is listed BEFORE the Wi-Fi adapter.
const OWNER_MAC = {
  lo0: loop,
  utun9: [v4('12.1.1.4', { netmask: '255.255.255.255' })],
  en0: [v6('fe80::1c2b:3d4e:5f60:7182'), v4('172.20.10.2', { netmask: '255.255.255.240' })],
  awdl0: [v6('fe80::a0b1:c2ff:fed3:e4f5')],
  llw0: [v6('fe80::a0b1:c2ff:fed3:e4f5')],
  bridge100: [v4('192.168.2.1')],
  utun0: [v6('fe80::aaaa')],
};

test('the owner Mac: the VPN tunnel (utun9, 12.1.1.4) is skipped and the Wi-Fi adapter (en0) is shown, with or without a known default route', () => {
  assert.equal(L.pickLanAddress(OWNER_MAC), '172.20.10.2');
  assert.equal(L.pickLanAddress(OWNER_MAC, null), '172.20.10.2');
  assert.equal(L.pickLanAddress(OWNER_MAC, { name: 'en0' }), '172.20.10.2');
});

test('rule 1: the default route interface wins; a tunnel default route (full-tunnel VPN) is not used', () => {
  const two = { lo0: loop, en0: [v4('192.168.1.20')], en5: [v4('10.0.0.7')] };
  assert.equal(L.pickLanAddress(two), '192.168.1.20');                       // no route known: en0 before en5
  assert.equal(L.pickLanAddress(two, { name: 'en5' }), '10.0.0.7');          // the route says en5
  assert.equal(L.pickLanAddress(OWNER_MAC, { name: 'utun9' }), '172.20.10.2');   // default route on the tunnel → ignored
  assert.equal(L.pickLanAddress(OWNER_MAC, { name: 'bridge100' }), '172.20.10.2');
  assert.equal(L.pickLanAddress(two, { name: 'en9' }), '192.168.1.20');      // a route interface that has no IPv4 → fall through
  assert.equal(L.pickLanAddress(two, { address: '10.0.0.7' }), '10.0.0.7');  // found by its address (Windows `route print`)
});

test('rule 2: en* / eth* / Wi-Fi / Ethernet beat other adapters, private addresses first, en0 before en1 and en2 before en10', () => {
  assert.equal(L.pickLanAddress({ en10: [v4('192.168.0.10')], en2: [v4('192.168.0.2')], other: [v4('10.9.9.9')] }), '192.168.0.2');
  assert.equal(L.pickLanAddress({ en0: [v4('203.0.113.9')], en1: [v4('192.168.0.5')] }), '192.168.0.5');   // private before public inside the group
  assert.equal(L.pickLanAddress({ eth0: [v4('10.1.2.3')], strange: [v4('192.168.7.7')] }), '10.1.2.3');
});

test('Windows names: Wi-Fi / Ethernet are chosen over vEthernet (WSL), VirtualBox, VMware, Tailscale and a link-local adapter', () => {
  const win = {
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', { internal: true })],
    'vEthernet (WSL)': [v4('172.28.0.1')],
    'vEthernet (Default Switch)': [v4('172.17.48.1')],
    'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    'VMware Network Adapter VMnet8': [v4('192.168.190.1')],
    Tailscale: [v4('100.101.102.103')],
    Ethernet: [v4('169.254.10.20')],                                    // link-local: no DHCP answered
    'Wi-Fi': [v6('fe80::1'), v4('192.168.1.44')],
  };
  assert.equal(L.pickLanAddress(win), '192.168.1.44');
  assert.equal(L.pickLanAddress(win, { address: '192.168.1.44' }), '192.168.1.44');
  assert.equal(L.pickLanAddress(win, { address: '172.28.0.1' }), '192.168.1.44');   // the route points at a virtual adapter → ignored
  assert.equal(L.pickLanAddress({ 'Ethernet 2': [v4('10.20.30.40')], 'Wi-Fi': [v4('192.168.1.44')] }), '10.20.30.40');   // both physical: names sort, Ethernet < Wi-Fi
});

test('rule 3: a localised adapter name falls back to the private ranges (10/8, 172.16/12, 192.168/16) - and never to a tunnel', () => {
  assert.equal(L.pickLanAddress({ 'Беспроводная сеть': [v4('192.168.43.5')], tun0: [v4('10.8.0.2')] }), '192.168.43.5');
  assert.equal(L.pickLanAddress({ 'شبكة لاسلكية': [v4('203.0.113.9')], 'اتصال محلي': [v4('172.16.4.4')] }), '172.16.4.4');   // private beats public
  for (const [addr, priv] of [['10.0.0.1', true], ['10.255.255.255', true], ['172.16.0.1', true], ['172.31.255.255', true], ['172.15.255.255', false], ['172.32.0.1', false], ['192.168.0.1', true], ['192.169.0.1', false], ['11.0.0.1', false], ['100.64.0.1', false]]) {
    assert.equal(L.isPrivateV4(addr), priv, addr);
  }
});

test('rule 4: a usable public address on an unfamiliar adapter is still better than nothing', () => {
  assert.equal(L.pickLanAddress({ lo0: loop, 'Some Adapter': [v4('203.0.113.9')] }), '203.0.113.9');
});

test('never chosen: tunnels, virtual adapters, link-local, loopback, IPv6; and 127.0.0.1 only when nothing else exists', () => {
  const junk = {
    lo0: loop,
    utun1: [v4('10.1.1.1')], tun0: [v4('10.2.2.2')], tap0: [v4('10.3.3.3')], ppp0: [v4('10.4.4.4')], ipsec0: [v4('10.5.5.5')],
    awdl0: [v4('10.6.6.6')], llw0: [v4('10.7.7.7')], bridge0: [v4('10.8.8.8')], vmnet1: [v4('10.9.9.9')], docker0: [v4('172.17.0.1')], vboxnet0: [v4('192.168.99.1')],
    en0: [v4('169.254.77.88'), v6('fe80::1')],
    en1: [v6('2001:db8::1')],
  };
  assert.equal(L.pickLanAddress(junk), '127.0.0.1');
  assert.equal(L.pickLanAddress(junk, { name: 'utun1' }), '127.0.0.1');
  assert.equal(L.pickLanAddress({}), '127.0.0.1');
  assert.equal(L.pickLanAddress(undefined), '127.0.0.1');
  assert.equal(L.pickLanAddress({ lo0: loop }), '127.0.0.1');
  // the same junk plus one real adapter → the real one
  assert.equal(L.pickLanAddress(Object.assign({}, junk, { en3: [v4('192.168.10.30')] })), '192.168.10.30');
});

test('older Node reported the family as the number 4: still understood', () => {
  assert.equal(L.pickLanAddress({ en0: [{ address: '192.168.5.5', family: 4, internal: false }], utun2: [{ address: '12.1.1.4', family: 4, internal: false }] }), '192.168.5.5');
  assert.equal(L.pickLanAddress({ en0: [{ address: '::1', family: 6, internal: false }] }), '127.0.0.1');
});

test('macOS: `route -n get default` is read for the interface name', () => {
  const sample = '   route to: default\ndestination: default\n       mask: default\n    gateway: 172.20.10.1\n  interface: en0\n      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>\n recvpipe  sendpipe  ssthresh  rtt,msec    rttvar  hopcount      mtu     expire\n       0         0         0         0         0         0      1500         0 \n';
  assert.deepEqual(L.parseDarwinRouteGet(sample), { name: 'en0' });
  assert.deepEqual(L.parseDarwinRouteGet(sample.replace('en0', 'utun4')), { name: 'utun4' });
  assert.equal(L.parseDarwinRouteGet('route: writing to routing socket: not in table'), null);
  assert.equal(L.parseDarwinRouteGet(''), null);
});

test('Windows: `route print -4 0.0.0.0` is read by its numbers only (any display language), the lowest metric wins', () => {
  const sample = [
    '===========================================================================',
    'Interface List',
    '  7...a4 c3 f0 11 22 33 ......Intel(R) Wi-Fi 6 AX201 160MHz',
    '===========================================================================',
    'IPv4 Route Table',
    '===========================================================================',
    'Active Routes:',
    'Network Destination        Netmask          Gateway       Interface  Metric',
    '          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.44     50',
    '          0.0.0.0          0.0.0.0       10.8.0.1        10.8.0.2        90',
    '          0.0.0.0        128.0.0.0         On-link        10.8.0.2       291',
    '===========================================================================',
  ].join('\r\n');
  assert.deepEqual(L.parseWindowsRoutePrint(sample), { address: '192.168.1.44' });
  assert.equal(L.parseWindowsRoutePrint('Active Routes:\r\n  nothing here'), null);
  assert.equal(L.parseWindowsRoutePrint(''), null);
});

test('detectDefaultRoute runs the right command per platform and survives a failing one', async () => {
  const calls = [];
  const run = (out) => (cmd, args) => { calls.push([cmd, ...args].join(' ')); return Promise.resolve(out); };
  assert.deepEqual(await L.detectDefaultRoute('darwin', run('  interface: en0\n')), { name: 'en0' });
  assert.deepEqual(await L.detectDefaultRoute('win32', run('          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.44     50\n')), { address: '192.168.1.44' });
  assert.equal(await L.detectDefaultRoute('linux', run('whatever')), null);
  assert.equal(await L.detectDefaultRoute('darwin', run('')), null);
  assert.deepEqual(calls, ['/sbin/route -n get default', 'route print -4 0.0.0.0', '/sbin/route -n get default']);
});

test('the provider answers at once from the names, learns the default route in the background, and re-asks only after the TTL', async () => {
  let t = 1000, detections = 0;
  const detect = async () => { detections++; return { name: 'en5' }; };
  const ifs = { lo0: loop, en0: [v4('192.168.1.20')], en5: [v4('10.0.0.7')] };
  const p = L.createLanAddressProvider({ networkInterfaces: () => ifs, platform: 'darwin', ttlMs: 60000, now: () => t, detect });
  assert.equal(p.get(), '192.168.1.20');                 // first answer: names only (en0 first)
  await new Promise((r) => setImmediate(r));
  assert.equal(p.get(), '10.0.0.7');                     // the route is known now
  assert.equal(detections, 1);
  t += 59000; p.get(); await new Promise((r) => setImmediate(r));
  assert.equal(detections, 1);                           // still fresh
  t += 2000; p.get(); await new Promise((r) => setImmediate(r));
  assert.equal(detections, 2);                           // expired → asked again
  const failing = L.createLanAddressProvider({ networkInterfaces: () => ifs, platform: 'darwin', detect: async () => { throw new Error('no route'); } });
  failing.get(); await new Promise((r) => setImmediate(r));
  assert.equal(failing.get(), '192.168.1.20');           // a failing lookup never breaks the answer
});

test('main.js uses this picker (not the first non-internal address of any interface)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const i = main.indexOf('function getLocalIpAddress');
  assert.ok(i > 0);
  const body = main.slice(i, main.indexOf('\n}\n', i));
  assert.match(body, /lanAddressProvider\.get\(\)/);
  assert.doesNotMatch(body, /for \(const devName in interfaces\)/);
});
