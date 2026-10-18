import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readCiaMetadata, identifyCia, metadataFromTitleId, guessFromFilename, sortCatalogEntries } from '../src/metadata.js';
import { createApp } from '../src/server.js';

const align = value => Math.ceil(value / 64) * 64;
const signatures = [[0x10000, 0x240], [0x10001, 0x140], [0x10002, 0x80],
  [0x10003, 0x240], [0x10004, 0x140], [0x10005, 0x80]];
function makeCia({ titleId = '0004000000166b00', signature = 0x10004,
  certificateSize = 0xa01, ticketSize = 0x2c1, count = 1, metaSize = 0x23 } = {}) {
  const signatureBytes = signatures.find(([type]) => type === signature)[1];
  const tmdSize = signatureBytes + 0x9c4 + count * 0x30;
  const tmdOffset = align(0x2020) + align(certificateSize) + align(ticketSize);
  const contentOffset = tmdOffset + align(tmdSize);
  const buffer = Buffer.alloc(align(contentOffset + 1) + metaSize);
  buffer.writeUInt32LE(0x2020, 0);
  buffer.writeUInt32LE(certificateSize, 8);
  buffer.writeUInt32LE(ticketSize, 12);
  buffer.writeUInt32LE(tmdSize, 16);
  buffer.writeUInt32LE(metaSize, 20);
  buffer.writeBigUInt64LE(1n, 24);
  buffer.writeUInt32BE(signature, tmdOffset);
  const bodyOffset = tmdOffset + signatureBytes;
  buffer.write('Root-CA00000003-CP0000000b', bodyOffset, 'ascii');
  buffer[bodyOffset + 0x40] = 1;
  Buffer.from(titleId, 'hex').copy(buffer, bodyOffset + 0x4c);
  buffer.writeUInt16BE(count, bodyOffset + 0x9e);
  return { buffer, tmdOffset, bodyOffset, tmdSize, signatureBytes };
}
function memoryReader(buffer, maxChunk = Infinity) {
  const calls = [];
  return { calls, async read(target, offset, length, position) {
    calls.push({ length, position });
    const bytesRead = Math.max(0, Math.min(length, buffer.length - position, maxChunk));
    if (bytesRead) buffer.copy(target, offset, position, position + bytesRead);
    return { bytesRead };
  } };
}
async function directory(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'cia-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('解析六种签名布局及64字节对齐 / Parses six signature layouts and 64-byte alignment', async () => {
  for (const [signature, signatureBytes] of signatures) {
    for (const [certificateSize, ticketSize] of [[0xa01, 0x2c1], [0x40, 0x3f], [0, 1]]) {
      const fixture = makeCia({ signature, certificateSize, ticketSize });
      const reader = memoryReader(fixture.buffer);
      const result = await readCiaMetadata(reader, fixture.buffer.length);
      assert.equal(result.type, 'base');
      assert.equal(result.source, 'tmd');
      assert.equal(result.titleId, '0004000000166b00');
      assert.equal(result.groupId, '00166b00');
      assert.deepEqual(reader.calls, [
        { length: 32, position: 0 },
        { length: 4, position: fixture.tmdOffset },
        { length: 196, position: fixture.tmdOffset + signatureBytes },
      ]);
      assert.equal(reader.calls.reduce((sum, call) => sum + call.length, 0), 232);
    }
  }
});

test('分类与精确低32位分组 / Classifies by high word and groups by the exact low word', () => {
  for (const [prefix, type] of [['00040000', 'base'], ['0004000E', 'update'], ['0004008C', 'dlc']]) {
    const result = metadataFromTitleId(prefix + '00166B00');
    assert.equal(result.type, type);
    assert.equal(result.groupId, '00166b00');
  }
  assert.equal(metadataFromTitleId('0004001000166b00').type, 'unknown');
  assert.equal(metadataFromTitleId('0004001000166b00').groupId, null);
  assert.equal(metadataFromTitleId('broken').source, 'unknown');
  assert.notEqual(metadataFromTitleId('0004000000166b00').groupId,
    metadataFromTitleId('0004000000166b01').groupId);
});

test('异常区段、截断及不支持签名保持未知 / Invalid sections, truncation and signatures remain unknown', async () => {
  const cases = [
    fixture => fixture.buffer.writeUInt32LE(0xffffffff, 0),
    fixture => fixture.buffer.writeUInt32LE(0xffffffff, 8),
    fixture => fixture.buffer.writeUInt32LE(0xffffffff, 12),
    fixture => fixture.buffer.writeUInt32LE(0xffffffff, 16),
    fixture => fixture.buffer.writeUInt32LE(0xffffffff, 20),
    fixture => fixture.buffer.writeBigUInt64LE(2n ** 63n, 24),
    fixture => fixture.buffer.writeUInt32BE(0x10006, fixture.tmdOffset),
    fixture => fixture.buffer.writeUInt32BE(0x04000100, fixture.tmdOffset),
    fixture => fixture.buffer.writeUInt32LE(4, 16),
    fixture => { fixture.buffer[fixture.bodyOffset + 0x40] = 2; },
    fixture => fixture.buffer.fill(0, fixture.bodyOffset, fixture.bodyOffset + 0x40),
    fixture => fixture.buffer.writeUInt16BE(0xffff, fixture.bodyOffset + 0x9e),
    fixture => fixture.buffer.writeUInt16BE(0, fixture.bodyOffset + 0x9e),
  ];
  for (const mutate of cases) {
    const fixture = makeCia();
    mutate(fixture);
    const reader = memoryReader(fixture.buffer);
    const result = await readCiaMetadata(reader, fixture.buffer.length);
    assert.equal(result.type, 'unknown');
    assert.equal(result.source, 'unknown');
    assert.equal(result.titleId, null);
    assert.ok(reader.calls.reduce((sum, call) => sum + call.length, 0) <= 232);
  }
  const fixture = makeCia();
  const truncated = memoryReader(fixture.buffer.subarray(0, fixture.bodyOffset + 10));
  assert.equal((await readCiaMetadata(truncated, fixture.buffer.length)).source, 'unknown');
  const unsafe = memoryReader(fixture.buffer);
  assert.equal((await readCiaMetadata(unsafe, Number.MAX_SAFE_INTEGER + 1)).type, 'unknown');
  assert.equal(unsafe.calls.length, 0);
  assert.equal((await readCiaMetadata(memoryReader(Buffer.alloc(10)), 10)).type, 'unknown');
});

test('短读取重试且不扩大读取范围 / Retries short reads within bounded regions', async () => {
  const fixture = makeCia({ titleId: '0004000e00166b00' });
  const reader = memoryReader(fixture.buffer, 7);
  assert.equal((await readCiaMetadata(reader, fixture.buffer.length)).type, 'update');
  assert.ok(reader.calls.every(call => call.length <= 196));
});

test('超过4GiB的元数据偏移不发生32位溢出 / Metadata offsets over 4 GiB do not wrap', async t => {
  const root = await directory(t);
  const fixture = makeCia({ metaSize: 0 });
  const header = Buffer.from(fixture.buffer.subarray(0, 32));
  header.writeUInt32LE(0xffffffff, 8);
  const tmdOffset = align(0x2020) + align(0xffffffff) + align(header.readUInt32LE(12));
  const size = tmdOffset + align(fixture.tmdSize) + 1;
  const file = path.join(root, 'sparse.cia');
  const handle = await open(file, 'w+');
  try {
    await handle.truncate(size);
    await handle.write(header, 0, header.length, 0);
    const tmd = fixture.buffer.subarray(fixture.tmdOffset, fixture.tmdOffset + fixture.tmdSize);
    await handle.write(tmd, 0, tmd.length, tmdOffset);
    const result = await readCiaMetadata(handle, size);
    assert.equal(result.source, 'tmd');
    assert.equal(result.type, 'base');
  } finally { await handle.close(); }
});

test('文件名回退仅作为推测且不读取父路径提示 / Filename fallback is a guess and ignores parent hints', () => {
  const base = guessFromFilename('/Game[1.7升级补丁][DLC汉化]/Shin Megami Tensei IV FINAL.cia');
  assert.equal(base.type, 'unknown');
  for (const [name, type] of [['Game_update.cia', 'update'], ['Game[补丁].cia', 'update'],
    ['Game DLC.cia', 'dlc'], ['0004008c00166b00.cia', 'dlc'], ['Game_本体.cia', 'base']]) {
    const result = guessFromFilename(name);
    assert.equal(result.type, type, name);
    assert.equal(result.source, 'filename');
    assert.equal(result.groupId, null);
  }
  for (const name of ['Game_database.cia', 'Unknown.cia', 'Game_update_DLC.cia',
    '0004000000166b00_0004008c00166b00.cia']) {
    assert.equal(guessFromFilename(name).type, 'unknown', name);
  }
});

test('真实TMD优先于误导文件名，未知类型不回退 / TMD overrides filenames and unknown title types stay unknown', async t => {
  const root = await directory(t);
  const file = path.join(root, 'Misleading_DLC.cia');
  await writeFile(file, makeCia().buffer);
  assert.equal((await identifyCia(file)).type, 'base');
  await writeFile(file, makeCia({ titleId: '0004001000166b00' }).buffer);
  const unknown = await identifyCia(file);
  assert.equal(unknown.type, 'unknown');
  assert.equal(unknown.source, 'tmd');
  await writeFile(file, 'not a CIA');
  const guessed = await identifyCia(file);
  assert.equal(guessed.type, 'dlc');
  assert.equal(guessed.source, 'filename');
  assert.equal(guessed.groupId, null);
});

test('严格分组排序，同名推测不混入 / Exact groups sort while similarly named guesses stay separate', () => {
  const entries = [
    { id: 'd', name: 'A DLC.cia', ...metadataFromTitleId('0004008c00166b00') },
    { id: 'u', name: 'Z Update.cia', ...metadataFromTitleId('0004000e00166b00') },
    { id: 'b', name: 'Y Base.cia', ...metadataFromTitleId('0004000000166b00') },
    { id: 'x', name: 'A Base.cia', ...metadataFromTitleId('0004000000166b01') },
    { id: 'f', name: 'A DLC guess.cia', ...guessFromFilename('0004008c00166b00.cia') },
    { id: 'n', name: 'A unknown.cia', ...guessFromFilename('A unknown.cia') },
  ];
  const sorted = sortCatalogEntries(entries);
  const group = sorted.filter(entry => entry.groupId === '00166b00');
  assert.deepEqual(group.map(entry => entry.type), ['base', 'update', 'dlc']);
  const first = sorted.findIndex(entry => entry.id === 'b');
  assert.deepEqual(sorted.slice(first, first + 3).map(entry => entry.id), ['b', 'u', 'd']);
  assert.equal(sorted.find(entry => entry.id === 'f').groupId, null);
  assert.equal(sorted.find(entry => entry.id === 'x').groupId, '00166b01');
});

test('服务器逆序选择仍生成本体、更新、DLC批次 / Server orders reversed selections as base, update, DLC', async t => {
  const root = await directory(t);
  for (const [name, titleId] of [['Z base.cia', '0004000000166b00'], ['M update.cia', '0004000e00166b00'], ['A dlc.cia', '0004008c00166b00']]) {
    await writeFile(path.join(root, name), makeCia({ titleId }).buffer);
  }
  let origin;
  const { server } = await createApp({ directory: root, getBaseUrl: () => origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  origin = 'http://127.0.0.1:' + server.address().port;
  const { files } = await (await fetch(origin + '/api/files')).json();
  assert.deepEqual(files.map(file => file.type), ['base', 'update', 'dlc']);
  assert.ok(files.every(file => file.source === 'tmd' && file.groupId === '00166b00'));
  const ids = [...files].reverse().map(file => file.id);
  const { batches } = await (await fetch(origin + '/api/qr?ids=' + ids.join(','))).json();
  assert.deepEqual(batches.flatMap(batch => batch.payload.split('\n')), files.map(file => file.url));
});
