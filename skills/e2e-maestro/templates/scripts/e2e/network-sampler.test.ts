// scripts/e2e/network-sampler.test.ts
import {
  addressFromHex,
  appProcessPattern,
  canonicalHost,
  disallowedPeers,
  hostOf,
  lsofPeers,
  pidsOf,
  procNetPeers,
  uidOfPackage,
} from './network-sampler.ts';

const LSOF = [
  'COMMAND  PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
  'Tasks 4242 dev 12u IPv4 0x1 0t0 TCP 192.168.1.20:50111->142.250.1.1:443 (ESTABLISHED)',
  'Tasks 4242 dev 13u IPv4 0x2 0t0 TCP 127.0.0.1:50112->127.0.0.1:8081 (ESTABLISHED)',
  'Tasks 4242 dev 14u IPv6 0x3 0t0 UDP [2a00:1450::1]:5353->[2a00:1450::200e]:443',
  'Tasks 4242 dev 15u IPv4 0x4 0t0 TCP *:50113 (LISTEN)',
].join('\n');

const TCP = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0F02000A:C350 0101FA8E:01BB 01 00000000:00000000 00:00000000 00000000 10190        0 1',
  '   1: 0100007F:1F90 0100007F:C351 01 00000000:00000000 00:00000000 00000000 10190        0 2',
  '   2: 0F02000A:C352 0101FA8E:01BB 01 00000000:00000000 00:00000000 00000000 10055        0 3',
  '   3: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 10190        0 4',
].join('\n');

describe('lsofPeers', () => {
  it('lists connected sockets to other hosts and skips loopback and listening ones', () => {
    expect(lsofPeers(LSOF)).toStrictEqual([
      { proto: 'TCP', peer: '142.250.1.1:443' },
      { proto: 'UDP', peer: '[2a00:1450::200e]:443' },
    ]);
  });
});

describe('uidOfPackage', () => {
  const LISTED = [
    'package:com.example.app.dev.test uid:10191',
    'package:com.example.app.dev uid:10190',
  ].join('\n');

  it('takes the uid of exactly the package, not of one it prefixes', () => {
    expect(uidOfPackage(LISTED, 'com.example.app.dev')).toBe('10190');
    expect(uidOfPackage(LISTED, 'com.example.app.dev.test')).toBe('10191');
  });

  it('finds nothing for a package that is only a prefix or not installed', () => {
    expect(uidOfPackage(LISTED, 'com.example.app')).toBeNull();
    expect(uidOfPackage('', 'com.example.app.dev')).toBeNull();
  });
});

describe('procNetPeers', () => {
  it("keeps the app uid's connected rows to other hosts", () => {
    expect(procNetPeers(TCP, '10190', 'tcp')).toStrictEqual([
      { proto: 'tcp', peer: '142.250.1.1:443' },
    ]);
  });
});

describe('addressFromHex', () => {
  it('reads IPv4, IPv6 and IPv4-mapped IPv6 rows', () => {
    expect(addressFromHex('0100007F')).toBe('127.0.0.1');
    expect(addressFromHex('0000000000000000FFFF00000100007F')).toBe('::ffff:127.0.0.1');
    expect(addressFromHex('B80D0120000000000000000001000000')).toBe('2001:db8:0:0:0:0:0:1');
  });
});

describe('hostOf and canonicalHost', () => {
  it('drops the port and spells an IPv6 address one way', () => {
    expect(hostOf('142.250.1.1:443')).toBe('142.250.1.1');
    expect(hostOf('[2a00:1450::200e]:443')).toBe('2a00:1450::200e');
    expect(canonicalHost('2A00:1450::200E')).toBe(canonicalHost('2a00:1450:0:0:0:0:0:200e'));
    expect(canonicalHost('10.0.2.2')).toBe('10.0.2.2');
  });
});

describe('disallowedPeers', () => {
  const peers = [
    { proto: 'TCP', peer: '142.250.1.1:443' },
    { proto: 'TCP', peer: '[2a00:1450::200e]:443' },
  ];

  it('allows nothing offline, the resolved hosts with an allowlist, and everything when off', () => {
    expect(disallowedPeers(peers, 'offline-only', new Set())).toHaveLength(2);
    const allowed = new Set([canonicalHost('2a00:1450::200e')]);
    expect(disallowedPeers(peers, 'allowlist', allowed)).toStrictEqual([peers[0]]);
    expect(disallowedPeers(peers, 'off', new Set())).toStrictEqual([]);
  });
});

describe('pidsOf and appProcessPattern', () => {
  it('matches the app on one simulator only, in any bundle folder', () => {
    expect(pidsOf('4242\n\n4343\n')).toStrictEqual(['4242', '4343']);
    const pattern = new RegExp(appProcessPattern('Tasks', 'UDID-1'));
    expect(
      pattern.test(
        '/Devices/UDID-1/data/Containers/Bundle/Application/X/com.example.tasks-123.app/Tasks',
      ),
    ).toBe(true);
    expect(
      pattern.test('/Devices/UDID-2/data/Containers/Bundle/Application/X/Tasks.app/Tasks'),
    ).toBe(false);
  });
});
