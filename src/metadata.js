import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

// CIA 区段与 TMD 结构 / CIA sections and TMD layout:
// https://github.com/d0k3/GodMode9/blob/master/arm9/source/game/cia.c
// https://www.3dbrew.org/wiki/Title_metadata
const SIGNATURE_BYTES = new Map([
  [0x10000, 0x240], [0x10001, 0x140], [0x10002, 0x80],
  [0x10003, 0x240], [0x10004, 0x140], [0x10005, 0x80],
]);
const TYPES = new Map([['00040000', 'base'], ['0004000e', 'update'], ['0004008c', 'dlc']]);
const MAX_TMD_BYTES = BigInt(0x240 + 0x9c4 + 0xffff * 0x30 + 0x700);
const RANK = { base: 0, update: 1, dlc: 2, unknown: 3 };
const unknown = reason => ({ type: 'unknown', source: 'unknown', titleId: null, groupId: null, reason });
const align = value => (value + 63n) / 64n * 64n;

export function metadataFromTitleId(titleId, source = 'tmd') {
  const normalized = titleId.toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(normalized)) return unknown('invalid-title-id');
  const type = TYPES.get(normalized.slice(0, 8)) || 'unknown';
  return { type, source, titleId: normalized,
    groupId: source === 'tmd' && type !== 'unknown' ? normalized.slice(8) : null,
    reason: type === 'unknown' ? 'unsupported-title-type' : null };
}

export function guessFromFilename(filename, reason = 'metadata-unavailable') {
  // 仅检查文件名，避免父目录中的“补丁/DLC”误导 / Inspect basename, never parent directory hints.
  const name = filename.split(/[\\/]/).at(-1).replace(/\.cia$/i, '');
  const ids = [...name.matchAll(/(?:^|[^0-9a-f])([0-9a-f]{16})(?=$|[^0-9a-f])/gi)].map(match => match[1].toLowerCase());
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 1) return unknown('ambiguous-filename');
  if (uniqueIds.length === 1) {
    const metadata = metadataFromTitleId(uniqueIds[0], 'filename');
    return { ...metadata, reason };
  }
  const hints = new Set();
  const token = word => new RegExp('(?:^|[\\s._()\\[\\]-])(?:' + word + ')(?=$|[\\s._()\\[\\]-])', 'i').test(name);
  if (token('update|patch') || /更新|补丁|升级/.test(name)) hints.add('update');
  if (token('dlc') || /追加内容|下载内容/.test(name)) hints.add('dlc');
  if (token('base') || /本体/.test(name)) hints.add('base');
  if (hints.size !== 1) return unknown(hints.size ? 'ambiguous-filename' : reason);
  return { ...unknown(reason), type: [...hints][0], source: 'filename' };
}

async function readExactly(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error('truncated');
    offset += bytesRead;
  }
  return buffer;
}

// 每文件最多读取 232 字节，不读内容区 / At most 232 bytes per file; never read content data.
export async function readCiaMetadata(handle, fileSize) {
  try {
    if (!Number.isSafeInteger(fileSize) || fileSize < 0x2020) return unknown('invalid-size');
    const size = BigInt(fileSize);
    const header = await readExactly(handle, 0, 0x20);
    if (header.readUInt32LE(0) !== 0x2020) return unknown('invalid-header');
    const certificateSize = BigInt(header.readUInt32LE(8));
    const ticketSize = BigInt(header.readUInt32LE(12));
    const tmdSize = BigInt(header.readUInt32LE(16));
    const metaSize = BigInt(header.readUInt32LE(20));
    const contentSize = header.readBigUInt64LE(24);
    const tmdOffset = align(0x2020n) + align(certificateSize) + align(ticketSize);
    const contentOffset = tmdOffset + align(tmdSize);
    const contentEnd = contentOffset + contentSize;
    if (tmdSize < 4n || tmdSize > MAX_TMD_BYTES || contentSize === 0n ||
        contentEnd > size || (metaSize && align(contentEnd) + metaSize > size)) {
      return unknown('invalid-section-bounds');
    }
    const signature = await readExactly(handle, Number(tmdOffset), 4);
    const signatureBytes = SIGNATURE_BYTES.get(signature.readUInt32BE(0));
    if (!signatureBytes) return unknown('unsupported-signature');
    if (tmdSize < BigInt(signatureBytes + 0x9c4)) return unknown('truncated-tmd');
    const body = await readExactly(handle, Number(tmdOffset) + signatureBytes, 0xc4);
    const contentCount = body.readUInt16BE(0x9e);
    if (body[0x40] !== 1 || !body.subarray(0, 0x40).toString('ascii').startsWith('Root-') ||
        !contentCount || tmdSize < BigInt(signatureBytes + 0x9c4 + contentCount * 0x30)) {
      return unknown('invalid-tmd-header');
    }
    return metadataFromTitleId(body.subarray(0x4c, 0x54).toString('hex'));
  } catch {
    return unknown('metadata-read-failed');
  }
}

export async function identifyCia(filePath) {
  let handle;
  let metadata;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    metadata = stat.isFile() ? await readCiaMetadata(handle, stat.size) : unknown('not-a-file');
  } catch {
    metadata = unknown('metadata-read-failed');
  } finally {
    if (handle) await handle.close();
  }
  return metadata.source === 'tmd' ? metadata : guessFromFilename(filePath, metadata.reason);
}

export function sortCatalogEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.source === 'tmd' && entry.groupId ? 'title:' + entry.groupId : 'file:' + entry.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const sorted = [...groups.entries()].map(([key, files]) => ({
    key, files: files.sort((a, b) => RANK[a.type] - RANK[b.type] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    name: files.map(file => file.name).sort((a, b) => a.localeCompare(b))[0],
  })).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return sorted.flatMap(group => group.files);
}
