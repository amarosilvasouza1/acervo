import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createConnectManager } from '../../lib/connect.js';

// Use the real server pairing generator and qrcode package, with deterministic
// network/token inputs, so this catches incompatibility across the Node/Java edge.
const folder = resolve(process.argv[2] || 'android/tests/generated');
await mkdir(folder, { recursive: true });
const manager = createConnectManager({
  port: 4313,
  secureTransport: { port: 4314, pin: 'ab'.repeat(32) },
  randomToken: () => '4O0jMsz_Bs9YD2xHhQ3rY8kEbP6NfvZWaLG7a-CuTqI',
  networkInterfaces: () => ({ WiFi: [{ address: '192.168.15.8', internal: false, family: 'IPv4' }] }),
});
const pairing = await manager.createPairing({ local: true });
await writeFile(resolve(folder, 'server-pairing.png'), Buffer.from(pairing.qrDataUrl.split(',')[1], 'base64'));
await writeFile(resolve(folder, 'server-pairing.url'), pairing.url + '\n');
console.log('Server QR fixture generated in ' + folder);
