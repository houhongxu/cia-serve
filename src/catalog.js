import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readCiaMetadata, guessFromFilename, sortCatalogEntries } from './metadata.js';

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};
export async function createCatalog(directory) {
  const root = await realpath(directory);
  if (!(await lstat(root)).isDirectory()) throw new Error('目录无效 / Not a directory');
  const entries = [];
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) await walk(absolute);
      else if (item.isFile() && /\.cia$/i.test(item.name)) {
        const relative = path.relative(root, absolute);
        const stat = await lstat(absolute);
        entries.push({ id: createHash('sha256').update(relative).digest('hex').slice(0, 24),
          name: relative.split(path.sep).join('/'), size: stat.size, absolute });
      }
    }
  }
  await walk(root);
  for (const entry of entries) {
    const opened = await openCatalogFile({ root }, entry);
    let metadata;
    if (opened) {
      try { metadata = await readCiaMetadata(opened.handle, opened.stat.size); }
      finally { await opened.handle.close(); }
    }
    Object.assign(entry, metadata?.source === 'tmd' ? metadata : guessFromFilename(entry.name, metadata?.reason));
  }
  const sorted = sortCatalogEntries(entries);
  return { root, entries: sorted, byId: new Map(sorted.map(entry => [entry.id, entry])) };
}
export async function openCatalogFile(catalog, entry) {
  if (!entry || !inside(catalog.root, entry.absolute)) return null;
  let handle;
  try {
    let current = catalog.root;
    for (const part of path.relative(catalog.root, entry.absolute).split(path.sep)) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink()) return null;
    }
    const resolved = await realpath(entry.absolute);
    if (!inside(catalog.root, resolved)) return null;
    handle = await open(entry.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    const after = await lstat(entry.absolute);
    if (!stat.isFile() || stat.ino !== after.ino || stat.dev !== after.dev ||
        (await realpath(entry.absolute)) !== resolved) {
      await handle.close();
      return null;
    }
    // 校验实际打开的文件 / Validate the actual opened file.
    if (process.platform === 'linux' && !inside(catalog.root, await realpath('/proc/self/fd/' + handle.fd))) {
      await handle.close();
      return null;
    }
    return { handle, stat };
  } catch (error) {
    if (handle) await handle.close();
    if (['ENOENT', 'ELOOP', 'ENOTDIR', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}
