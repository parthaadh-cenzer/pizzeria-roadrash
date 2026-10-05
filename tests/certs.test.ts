// Secure LAN mode certificates: a local CA plus a CA-signed leaf covering localhost and the LAN
// addresses, usable by Node's TLS; a corrupted stored chain is regenerated instead of crashing.
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cwd = process.cwd();
let dir = '';
let certs: typeof import('../src/server/certs.js');

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-certs-'));
  process.chdir(dir); // the certificate store lives in ./.certs of the working directory
  certs = await import('../src/server/certs.js');
});

afterAll(() => {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

async function handshake(key: string, cert: string, ca: string): Promise<{ status: number; authorized: boolean; san: string }> {
  const server = https.createServer({ key, cert }, (_req, res) => res.end('ok'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await new Promise((resolve, reject) => {
      https
        .get({ host: 'localhost', port, path: '/', ca, rejectUnauthorized: true }, (res) => {
          const peer = (res.socket as import('node:tls').TLSSocket).getPeerCertificate();
          res.resume();
          resolve({ status: res.statusCode ?? 0, authorized: (res.socket as import('node:tls').TLSSocket).authorized, san: peer.subjectaltname ?? '' });
        })
        .on('error', reject);
    });
  } finally {
    server.close();
  }
}

describe('secure LAN certificates', () => {
  it('issues a CA-signed server certificate that verifies against the local CA only', async () => {
    const b = await certs.ensureServerCert();
    expect(b.cert.match(/BEGIN CERTIFICATE/g)).toHaveLength(2); // leaf + CA chain
    expect(fs.existsSync(b.caCertPath)).toBe(true);
    const r = await handshake(b.key, b.cert, b.caCert);
    expect(r.status).toBe(200);
    expect(r.authorized).toBe(true);
    expect(r.san).toContain('DNS:localhost');
    expect(r.san).toContain('IP Address:127.0.0.1');
    expect(b.sans).toContain('localhost');
  });

  it('reuses a valid stored certificate and regenerates a corrupted chain', async () => {
    const first = await certs.ensureServerCert();
    const again = await certs.ensureServerCert();
    expect(again.cert).toBe(first.cert);
    const leafPath = path.join(dir, '.certs', 'server.crt');
    fs.writeFileSync(leafPath, first.cert.replace(/\n-----BEGIN/g, '-----BEGIN')); // the old concatenation bug
    const fixed = await certs.ensureServerCert();
    const stored = fs.readFileSync(leafPath, 'utf8');
    expect(stored).not.toContain('----------BEGIN');
    expect(stored.match(/-----END CERTIFICATE-----\n/g)).toHaveLength(2);
    const r = await handshake(fixed.key, fixed.cert, fixed.caCert);
    expect(r.authorized).toBe(true);
  });
});
