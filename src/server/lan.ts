// LAN interface discovery. Never hard-codes a host IP.
import os from 'node:os';

export interface LanAddress {
  address: string;
  iface: string;
  private: boolean;
}

function isPrivateV4(a: string): boolean {
  return /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
}

/** Candidate LAN IPv4 addresses, best first (private ranges, non-virtual adapters). */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  const nets = os.networkInterfaces();
  for (const [name, list] of Object.entries(nets)) {
    for (const n of list ?? []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      if (/^169\.254\./.test(n.address)) continue;
      out.push({ address: n.address, iface: name, private: isPrivateV4(n.address) });
    }
  }
  const virtual = /(vethernet|virtualbox|vmware|hyper-v|docker|wsl|loopback|bluetooth|tailscale|zerotier)/i;
  out.sort((a, b) => {
    const va = virtual.test(a.iface) ? 1 : 0, vb = virtual.test(b.iface) ? 1 : 0;
    if (va !== vb) return va - vb;
    if (a.private !== b.private) return a.private ? -1 : 1;
    const wa = /(wi-?fi|wlan|wireless|ethernet|en\d|eth\d)/i.test(a.iface) ? 0 : 1;
    const wb = /(wi-?fi|wlan|wireless|ethernet|en\d|eth\d)/i.test(b.iface) ? 0 : 1;
    return wa - wb;
  });
  return out;
}

/** True for connections originating on the host machine itself. */
export function isLocalAddress(remote: string | undefined): boolean {
  if (!remote) return false;
  const a = remote.replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1' || a === 'localhost') return true;
  return lanAddresses().some((l) => l.address === a);
}
