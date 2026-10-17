// scripts/e2e/network-sampler.ts
// The runtime half of the network proof, pure: which sockets the app under test opened, read from
// `lsof` for an iOS simulator app (a macOS process) and from /proc/net for an Android emulator app
// (rows owned by the app's uid), and which of them the app's network policy does not allow.
// Loopback is always allowed (the test build may talk to itself); everything else is either a host
// of contracts/e2e.json "allowHosts" (allowlist mode) or a finding (offline-only mode).
import type { NetworkMode } from './e2e-config.ts';

/** One connected socket: its protocol and its peer address with the port. */
export type Peer = { readonly proto: string; readonly peer: string };

const LOOPBACK = /^(127\.|::1$|localhost$|::ffff:127\.)/;

/** The host part of `addr:port`, `[v6]:port` or a bare address. */
export function hostOf(peer: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(peer);
  if (bracketed) return bracketed[1] ?? peer;
  const parts = peer.split(':');
  return parts.length === 2 ? (parts[0] ?? peer) : peer;
}

export const isLoopback = (host: string): boolean => LOOPBACK.test(host);

/** One spelling per address: IPv6 as eight 4-digit lowercase groups, IPv4 and names unchanged. */
export function canonicalHost(host: string): string {
  if (!host.includes(':') || host.includes('.')) return host.toLowerCase();
  const [head = '', tail = ''] = host.toLowerCase().split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const missing = host.includes('::') ? 8 - left.length - right.length : 0;
  return [...left, ...Array<string>(missing).fill('0'), ...right]
    .map((group) => group.padStart(4, '0'))
    .join(':');
}

/** iOS: the connected, non-loopback sockets of `lsof -nP -i -a -p <pid>` ("->" marks a peer). */
export function lsofPeers(lsofOutput: string): Peer[] {
  return lsofOutput
    .split('\n')
    .filter((line) => line.includes('->'))
    .map((line) => ({
      proto: /\b(TCP|UDP)\b/.exec(line)?.[1] ?? 'IP',
      peer: line.split('->')[1]?.trim().split(/\s/)[0] ?? '',
    }))
    .filter(({ peer }) => peer !== '' && !isLoopback(hostOf(peer)));
}

/** `pgrep` prints one pid per line. */
export function pidsOf(pgrepOutput: string): string[] {
  return pgrepOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

/**
 * The `pgrep -f` pattern of the app's process on one simulator: Devices/<udid>/, any bundle folder
 * (Maestro's clearState reinstalls the app as <bundle id>-<timestamp>.app), then the executable.
 * Without the udid it would also match other sessions' copies of the same app on this Mac.
 */
export function appProcessPattern(executable: string, udid: string): string {
  const escaped = executable.replace(/[.[\]()*+?{}|^$\\]/g, (char) => `\\${char}`);
  return `Devices/${udid}/.*\\.app/${escaped}( |$)`;
}

/** Four bytes as a dotted address, in the order given. */
const dotted = (bytes: readonly string[]): string =>
  bytes.map((byte) => String(Number.parseInt(byte, 16))).join('.');

/** /proc/net addresses are host-order words: IPv4 is 8 hex digits, IPv6 four 32-bit words. */
export function addressFromHex(hex: string): string {
  const words = (hex.toLowerCase().match(/.{8}/g) ?? []).map((word) =>
    (word.match(/../g) ?? []).reverse(),
  );
  if (words.length === 1) return dotted(words[0] ?? []);
  const groups = words.flat().join('').match(/.{4}/g) ?? [];
  if (groups.slice(0, 5).every((group) => group === '0000') && groups[5] === 'ffff') {
    return `::ffff:${dotted(words[3] ?? [])}`;
  }
  return groups.map((group) => group.replace(/^0+(?=.)/, '')).join(':');
}

/**
 * Android: the uid of exactly `pkg` from `pm list packages -U <pkg>`, or null. pm filters by
 * substring, so com.example.app.dev also lists com.example.app.dev.test; only the line naming the
 * package itself counts.
 */
export function uidOfPackage(listed: string, pkg: string): string | null {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^package:${escaped} uid:(\\d+)\\s*$`, 'm').exec(listed)?.[1] ?? null;
}

/** Android: the connected, non-loopback rows of one /proc/net table that belong to `uid`. */
export function procNetPeers(table: string, uid: string, proto: string): Peer[] {
  const peers: Peer[] = [];
  for (const line of table.split('\n').slice(1)) {
    const columns = line.trim().split(/\s+/);
    const [remHex, remPortHex] = (columns[2] ?? '').split(':');
    if (columns[7] !== uid || remHex === undefined || /^0+$/.test(remHex)) continue;
    const host = addressFromHex(remHex);
    if (isLoopback(host)) continue;
    const port = String(Number.parseInt(remPortHex ?? '0', 16));
    peers.push({ proto, peer: host.includes(':') ? `[${host}]:${port}` : `${host}:${port}` });
  }
  return peers;
}

/**
 * The peers the policy does not allow. `allowed` holds the canonical addresses the allowed hosts
 * resolve to (sample-sockets.ts resolves them while it samples, through the same resolver the
 * simulator or emulator uses).
 */
export function disallowedPeers(
  peers: readonly Peer[],
  mode: NetworkMode,
  allowed: ReadonlySet<string>,
): Peer[] {
  if (mode === 'off') return [];
  if (mode === 'offline-only') return [...peers];
  return peers.filter(({ peer }) => !allowed.has(canonicalHost(hostOf(peer))));
}
