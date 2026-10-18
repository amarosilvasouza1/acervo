// Import a stopped desktop library into an empty persistent cloud volume.
// This utility never replaces an existing file and rejects symbolic links.
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

async function filesUnder(root) {
  const files = [];
  async function walk(relative) {
    for (const name of await readdir(path.join(root, relative))) {
      const next = path.join(relative, name);
      const info = await lstat(path.join(root, next));
      if (info.isSymbolicLink()) throw new Error('Link simbolico recusado: ' + next);
      if (info.isDirectory()) await walk(next);
      else if (info.isFile()) files.push(next);
      else throw new Error('Tipo de arquivo recusado: ' + next);
    }
  }
  await walk('');
  return files;
}

try {
  if (!process.argv[2]) throw new Error('Uso: node deploy/import-data.mjs PASTA_ORIGEM [PASTA_DESTINO]');
  const source = await realpath(path.resolve(process.argv[2]));
  const target = path.resolve(process.argv[3] || process.env.ACERVO_DATA_DIR || '/app/data');
  await mkdir(target, { recursive: true });
  const resolvedTarget = await realpath(target);
  if (source === resolvedTarget || source.startsWith(resolvedTarget + path.sep) || resolvedTarget.startsWith(source + path.sep)) {
    throw new Error('Origem e destino precisam ser pastas separadas.');
  }
  if ((await filesUnder(resolvedTarget)).length) throw new Error('Destino contem arquivos. Nada foi substituido; use um volume novo.');
  const library = JSON.parse(await readFile(path.join(source, 'library.json'), 'utf8'));
  if (!Array.isArray(library.tracks)) throw new Error('library.json nao contem uma biblioteca valida.');
  const sourceFiles = await filesUnder(source);
  for (const relative of sourceFiles) {
    const destination = path.join(resolvedTarget, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(source, relative), destination, constants.COPYFILE_EXCL);
  }
  console.log('Biblioteca importada: ' + library.tracks.length + ' musicas; ' + sourceFiles.length + ' arquivos.');
} catch (error) {
  console.error('Importacao interrompida: ' + error.message);
  process.exitCode = 1;
}
