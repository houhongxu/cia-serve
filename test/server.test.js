import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rename, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

async function fixture(t, setup) {
  const root = await mkdtemp(path.join(tmpdir(), 'cia-serve-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'library');
  await mkdir(directory);
  await setup(directory, root);
  let origin;
  const { server, catalog } = await createApp({ directory, getBaseUrl: () => origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { root, directory, origin, catalog };
}

test('递归列出 CIA，忽略其他文件 / Lists recursive CIA files only', async t => {
  const { origin } = await fixture(t, async dir => {
    await mkdir(path.join(dir, '中文 <nested>'));
    await writeFile(path.join(dir, '中文 <nested>', 'space & name.CIA'), 'payload');
    await writeFile(path.join(dir, 'ignore.txt'), 'private');
  });
  const response = await fetch(origin + '/api/files', { headers: { Host: 'untrusted.example' } });
  const data = await response.json();
  assert.equal(data.files.length, 1);
  assert.equal(data.files[0].name, '中文 <nested>/space & name.CIA');
  assert.equal(data.files[0].size, 7);
  assert.match(data.files[0].url, /^http:\/\/127\.0\.0\.1:\d+\/cia\/[a-f0-9]{24}\.cia$/);
  assert.equal((await fetch(data.files[0].url)).status, 200);
});

test('传输、HEAD 与字节范围 / Streams bytes, HEAD and byte ranges', async t => {
  const { origin, catalog } = await fixture(t, dir => writeFile(path.join(dir, 'demo.cia'), '0123456789'));
  const url = origin + '/cia/' + catalog.entries[0].id + '.cia';
  const response = await fetch(url);
  assert.equal(response.headers.get('content-length'), '10');
  assert.equal(await response.text(), '0123456789');
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  for (const [range, expected, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=8-', '89', 'bytes 8-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=7-100', '789', 'bytes 7-9/10'],
  ]) {
    const part = await fetch(url, { headers: { Range: range } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), contentRange);
    assert.equal(await part.text(), expected);
  }
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=-', 'items=1-2']) {
    const bad = await fetch(url, { headers: { Range: range } });
    assert.equal(bad.status, 416, range);
    assert.equal(bad.headers.get('content-range'), 'bytes */10');
  }
});

test('大文件不会缓冲入内存 / Handles file lengths over 4 GiB', async t => {
  const bytes = 2 ** 32 + 3;
  const { origin, catalog } = await fixture(t, async dir => {
    const handle = await open(path.join(dir, 'large.cia'), 'w');
    await handle.truncate(bytes);
    await handle.close();
  });
  const url = origin + '/cia/' + catalog.entries[0].id + '.cia';
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(bytes));
  const tail = await fetch(url, { headers: { Range: 'bytes=-2' } });
  assert.equal(tail.status, 206);
  assert.equal((await tail.arrayBuffer()).byteLength, 2);
});

test('二维码包含直接 URL 和换行批次 / QR batches contain direct newline-separated URLs', async t => {
  const { origin, catalog } = await fixture(t, async dir => {
    for (let i = 0; i < 12; i++) await writeFile(path.join(dir, i + '.cia'), String(i));
  });
  const ids = catalog.entries.map(entry => entry.id);
  const response = await fetch(origin + '/api/qr?ids=' + ids.join(','));
  const { batches } = await response.json();
  assert.ok(batches.length > 1);
  const urls = batches.flatMap(batch => {
    assert.ok(batch.count <= 5);
    assert.ok(Buffer.byteLength(batch.payload) <= 280);
    assert.match(batch.svg, /^<svg/);
    assert.equal(batch.payload.split('\n').length, batch.count);
    return batch.payload.split('\n');
  });
  assert.equal(urls.length, ids.length);
  for (const url of urls) assert.equal((await fetch(url)).status, 200);
  const single = await (await fetch(origin + '/api/qr?ids=' + ids[0])).json();
  assert.equal(single.batches.length, 1);
  assert.equal(single.batches[0].count, 1);
  assert.equal((await fetch(origin + '/api/qr?ids=unknown')).status, 400);
  assert.equal((await fetch(origin + '/api/qr')).status, 400);
});

test('拒绝遍历、非 CIA 路由和写入请求 / Rejects traversal, non-CIA routes and writes', async t => {
  const { origin } = await fixture(t, async dir => {
    await writeFile(path.join(dir, 'safe.cia'), 'cia');
    await writeFile(path.join(dir, 'secret.txt'), 'secret');
  });
  for (const route of ['/secret.txt', '/package.json', '/cia/../../secret.txt',
    '/cia/%2e%2e%2fsecret.cia', '/cia/%00.cia', '/cia/000000000000000000000000.cia']) {
    assert.equal((await fetch(origin + route)).status, 404, route);
  }
  const denied = await fetch(origin + '/api/files', { method: 'POST', body: 'no' });
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('allow'), 'GET, HEAD');
  const page = await fetch(origin);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /type="module" src="\/app.js"/);
});

test('不扫描符号链接且阻止启动后的替换 / Excludes symlinks and blocks post-start replacements',
  { skip: process.platform === 'win32' }, async t => {
  const { origin, catalog, directory, root } = await fixture(t, async (dir, outer) => {
    await writeFile(path.join(outer, 'outside.cia'), 'SECRET');
    await mkdir(path.join(outer, 'outside'));
    await writeFile(path.join(outer, 'outside', 'inside.cia'), 'SECRET');
    await symlink(path.join(outer, 'outside.cia'), path.join(dir, 'linked.cia'));
    await symlink(path.join(outer, 'outside'), path.join(dir, 'linked-dir'));
    await writeFile(path.join(dir, 'replace.cia'), 'SAFE');
    await mkdir(path.join(dir, 'folder'));
    await writeFile(path.join(dir, 'folder', 'inside.cia'), 'SAFE');
  });
  assert.equal(catalog.entries.length, 2);
  const file = catalog.entries.find(entry => entry.name === 'replace.cia');
  await rm(file.absolute);
  await symlink(path.join(root, 'outside.cia'), file.absolute);
  assert.equal((await fetch(origin + '/cia/' + file.id + '.cia')).status, 404);
  const nested = catalog.entries.find(entry => entry.name.startsWith('folder/'));
  await rename(path.join(directory, 'folder'), path.join(directory, 'old'));
  await symlink(path.join(root, 'outside'), path.join(directory, 'folder'));
  assert.equal((await fetch(origin + '/cia/' + nested.id + '.cia')).status, 404);
});

test('空目录和空文件 / Handles empty directories and files', async t => {
  const empty = await fixture(t, async () => {});
  assert.deepEqual((await (await fetch(empty.origin + '/api/files')).json()).files, []);
  const { origin, catalog } = await fixture(t, dir => writeFile(path.join(dir, 'empty.cia'), ''));
  const result = await fetch(origin + '/cia/' + catalog.entries[0].id + '.cia');
  assert.equal(result.headers.get('content-length'), '0');
  assert.equal(await result.text(), '');
});
