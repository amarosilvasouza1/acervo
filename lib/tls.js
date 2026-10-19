import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const KEY_FILE = 'private-key.pem';
const CERT_FILE = 'certificate.pem';
const RECORD_FILE = 'identity.json';
const INVALID = 'A identidade segura do Acervo está inválida. Restaure a pasta de identidade original; ela não será substituída automaticamente.';

async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function readRegular(directory, name, limit) {
  const file = path.join(directory, name);
  const entry = await fs.lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > limit) throw new Error(INVALID);
  return fs.readFile(file);
}

async function readIdentity(directory) {
  try {
    const entry = await fs.lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(INVALID);
    const [key, cert, recordBytes] = await Promise.all([
      readRegular(directory, KEY_FILE, 16384), readRegular(directory, CERT_FILE, 32768), readRegular(directory, RECORD_FILE, 4096)
    ]);
    const record = JSON.parse(recordBytes.toString('utf8'));
    const certificate = new crypto.X509Certificate(cert);
    const privateKey = crypto.createPrivateKey(key);
    const now = Date.now();
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
        || !certificate.checkPrivateKey(privateKey) || !certificate.verify(certificate.publicKey)
        || certificate.ca || Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) throw new Error(INVALID);
    const spkiPin = crypto.createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    const fingerprint = crypto.createHash('sha256').update(certificate.raw).digest('hex');
    if (!record || record.version !== 1 || record.spkiPin !== spkiPin || record.fingerprint !== fingerprint) throw new Error(INVALID);
    await fs.chmod(directory, 0o700);
    await Promise.all([KEY_FILE, CERT_FILE, RECORD_FILE].map(name => fs.chmod(path.join(directory, name), 0o600)));
    return { key, cert, spkiPin, fingerprint };
  } catch { throw new Error(INVALID); }
}

async function generateCertificate(directory, requested) {
  const candidates = requested ? [requested] : [...new Set([
    process.env.OPENSSL_BIN, process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : null, 'openssl'
  ].filter(Boolean))];
  const args = ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-sha256', '-nodes', '-days', '3650',
    '-subj', '/CN=Acervo Device Link', '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature',
    '-addext', 'extendedKeyUsage=serverAuth', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1',
    '-keyout', path.join(directory, KEY_FILE), '-out', path.join(directory, CERT_FILE)];
  for (const executable of candidates) {
    try {
      await execute(executable, args, { timeout: 30000, maxBuffer: 262144, windowsHide: true });
      return;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new Error('Não foi possível criar a identidade TLS do Acervo com OpenSSL. Confira a instalação e as permissões da pasta de dados.');
    }
  }
  throw new Error('OpenSSL não foi encontrado. Instale-o ou configure OPENSSL_BIN para criar a identidade segura do Acervo.');
}

/** Persisted TLS identity; its SHA-256 SPKI pin is authenticated by scanning the PC's QR code. */
export async function loadTlsIdentity({ directory, opensslPath } = {}) {
  if (typeof directory !== 'string' || !directory.trim() || (opensslPath !== undefined && (typeof opensslPath !== 'string' || !opensslPath.trim()))) {
    throw new Error('Informe uma pasta válida para a identidade TLS do Acervo.');
  }
  const target = path.resolve(directory);
  if (await exists(target)) return readIdentity(target);
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const staged = await fs.mkdtemp(path.join(parent, '.acervo-identity-'));
  try {
    await fs.chmod(staged, 0o700);
    await generateCertificate(staged, opensslPath);
    const certificate = new crypto.X509Certificate(await fs.readFile(path.join(staged, CERT_FILE)));
    const spkiPin = crypto.createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    const fingerprint = crypto.createHash('sha256').update(certificate.raw).digest('hex');
    await fs.writeFile(path.join(staged, RECORD_FILE), JSON.stringify({ version: 1, spkiPin, fingerprint }) + '\n', { mode: 0o600, flag: 'wx' });
    await Promise.all([KEY_FILE, CERT_FILE, RECORD_FILE].map(async name => {
      const file = path.join(staged, name);
      await fs.chmod(file, 0o600);
      const descriptor = await fs.open(file, 'r+');
      try { await descriptor.sync(); } finally { await descriptor.close(); }
    }));
    await readIdentity(staged);
    try { await fs.rename(staged, target); }
    catch (error) { if (!await exists(target)) throw error; }
    return await readIdentity(target);
  } finally {
    const relative = path.relative(parent, staged);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(staged).startsWith('.acervo-identity-')) {
      await fs.rm(staged, { recursive: true, force: true });
    }
  }
}
