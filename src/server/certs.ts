// Local certificate authority for secure LAN mode (HTTPS/WSS). The CA is generated once and
// installed/trusted on phones; the server leaf certificate is re-issued whenever the LAN
// addresses change. Keys never leave the host machine.
import fs from 'node:fs';
import tls from 'node:tls';
import path from 'node:path';
import os from 'node:os';
import { generate } from 'selfsigned';
import { lanAddresses } from './lan.js';

export interface CertBundle {
  key: string;
  cert: string;
  caCertPath: string;
  caCert: string;
  sans: string[];
}

const CERT_DIR = path.resolve('.certs');
const CA_KEY = path.join(CERT_DIR, 'pizzeria-roadrash-ca.key');
const CA_CERT = path.join(CERT_DIR, 'pizzeria-roadrash-ca.crt');
const LEAF_KEY = path.join(CERT_DIR, 'server.key');
const LEAF_CERT = path.join(CERT_DIR, 'server.crt');
const LEAF_META = path.join(CERT_DIR, 'server.json');

/** Joins PEM blocks with exactly one newline between them (a missing newline breaks parsing). */
function pemChain(...pems: string[]): string {
  return pems.map((p) => p.trim()).join('\n') + '\n';
}

/** True if the key/cert pair loads into a TLS context (catches corrupt or mismatched files). */
function usable(key: string, cert: string): boolean {
  try {
    tls.createSecureContext({ key, cert });
    return true;
  } catch {
    return false;
  }
}

async function ensureCa(): Promise<{ key: string; cert: string }> {
  if (fs.existsSync(CA_KEY) && fs.existsSync(CA_CERT)) {
    const existing = { key: fs.readFileSync(CA_KEY, 'utf8'), cert: fs.readFileSync(CA_CERT, 'utf8') };
    if (usable(existing.key, existing.cert)) return existing;
    console.warn('[certs] stored local CA is unreadable; generating a new one (phones must trust the new CA)');
  }
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const now = new Date();
  const res = await generate([{ name: 'commonName', value: `Pizzeria Roadrash Local CA (${os.hostname()})` }, { name: 'organizationName', value: 'Pizzeria Roadrash LAN' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: new Date(now.getTime() - 86400000),
    notAfterDate: new Date(now.getTime() + 825 * 86400000),
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    ],
  });
  fs.writeFileSync(CA_KEY, res.private, { mode: 0o600 });
  fs.writeFileSync(CA_CERT, res.cert);
  return { key: res.private, cert: res.cert };
}

/** Returns a CA-signed server certificate covering localhost and every current LAN address. */
export async function ensureServerCert(): Promise<CertBundle> {
  const ca = await ensureCa();
  const ips = ['127.0.0.1', ...lanAddresses().map((l) => l.address)];
  const hostName = os.hostname().toLowerCase();
  const dns = ['localhost', hostName, `${hostName}.local`];
  const sans = [...dns, ...ips];
  const wanted = JSON.stringify(sans);
  if (fs.existsSync(LEAF_KEY) && fs.existsSync(LEAF_CERT) && fs.existsSync(LEAF_META)) {
    const meta = JSON.parse(fs.readFileSync(LEAF_META, 'utf8')) as { sans: string; expires: number };
    const key = fs.readFileSync(LEAF_KEY, 'utf8'), cert = fs.readFileSync(LEAF_CERT, 'utf8');
    if (meta.sans === wanted && meta.expires > Date.now() + 7 * 86400000 && cert.includes(ca.cert.trim()) && usable(key, cert)) {
      return { key, cert, caCertPath: CA_CERT, caCert: ca.cert, sans };
    }
  }
  const now = new Date();
  // Leaf validity kept under the 398/825-day limits enforced by mobile platforms.
  const expires = new Date(now.getTime() + 365 * 86400000);
  const res = await generate([{ name: 'commonName', value: 'Pizzeria Roadrash LAN Host' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: new Date(now.getTime() - 86400000),
    notAfterDate: expires,
    ca: { key: ca.key, cert: ca.cert },
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [...dns.map((d) => ({ type: 2 as const, value: d })), ...ips.map((ip) => ({ type: 7 as const, ip }))],
      },
    ],
  });
  const chain = pemChain(res.cert, ca.cert);
  if (!usable(res.private, chain)) throw new Error('generated server certificate does not load into TLS');
  fs.writeFileSync(LEAF_KEY, res.private, { mode: 0o600 });
  fs.writeFileSync(LEAF_CERT, chain);
  fs.writeFileSync(LEAF_META, JSON.stringify({ sans: wanted, expires: expires.getTime() }));
  return { key: res.private, cert: chain, caCertPath: CA_CERT, caCert: ca.cert, sans };
}
