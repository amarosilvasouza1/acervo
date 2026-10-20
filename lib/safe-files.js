import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

function denied() {
  return Object.assign(new Error('Acesso ao arquivo recusado.'), { code: 'EACCES', statusCode: 403 });
}

function failure(error) {
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
    return Object.assign(new Error('Arquivo não encontrado.'), { code: 'ENOENT', statusCode: 404 });
  }
  return denied();
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

/** Only regular files below a real directory; no symlink or junction descendants. */
export async function safeFile(root, targetAbsolute) {
  try {
    if (typeof root !== 'string' || typeof targetAbsolute !== 'string'
        || !path.isAbsolute(root) || !path.isAbsolute(targetAbsolute)
        || root.includes('\0') || targetAbsolute.includes('\0')) throw denied();
    const base = path.resolve(root);
    const target = path.resolve(targetAbsolute);
    if (!contained(base, target)) throw denied();
    const baseInfo = await lstat(base);
    if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw denied();
    const canonicalRoot = await realpath(base);
    const components = path.relative(base, target).split(path.sep);
    let entry = base;
    for (let index = 0; index < components.length; index++) {
      entry = path.join(entry, components[index]);
      const info = await lstat(entry);
      if (info.isSymbolicLink() || (index === components.length - 1 ? !info.isFile() : !info.isDirectory())) throw denied();
    }
    const canonicalTarget = await realpath(target);
    if (!contained(canonicalRoot, canonicalTarget)) throw denied();
    return canonicalTarget;
  } catch (error) {
    throw failure(error);
  }
}

/** The caller owns the descriptor and must close it or stream with autoClose. */
export async function openSafeFile(root, targetAbsolute) {
  let handle;
  try {
    const canonical = await safeFile(root, targetAbsolute);
    const before = await lstat(canonical);
    handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino
        || canonical !== await safeFile(root, targetAbsolute)) throw denied();
    return handle;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    throw failure(error);
  }
}
