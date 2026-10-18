import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createCatalog, openCatalogFile } from './catalog.js';
import { fileUrl, makeBatches } from './qr.js';

const assets = new Map([
  ['/', ['../public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['../public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['../public/style.css', 'text/css; charset=utf-8']],
]);
export async function createApp({ directory, getBaseUrl }) {
  const catalog = await createCatalog(directory);
  const staticFiles = new Map(await Promise.all([...assets].map(async ([route, [file, type]]) =>
    [route, { body: await readFile(new URL(file, import.meta.url)), type }])));
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    function send(status, body, type = 'text/plain; charset=utf-8', headers = {}) {
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    }
    const json = (status, value) => send(status, JSON.stringify(value), 'application/json; charset=utf-8');
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, '仅支持 GET/HEAD / GET/HEAD only', undefined, { Allow: 'GET, HEAD' });
      const url = new URL(req.url, 'http://localhost');
      if (staticFiles.has(url.pathname)) {
        const asset = staticFiles.get(url.pathname);
        return send(200, asset.body, asset.type);
      }
      if (url.pathname === '/api/files') return json(200, {
        baseUrl: getBaseUrl(),
        files: catalog.entries.map(({ id, name, size, type, source, titleId, groupId, reason }) =>
          ({ id, name, size, type, source, titleId, groupId, reason, url: fileUrl(getBaseUrl(), id) })),
      });
      if (url.pathname === '/api/qr') {
        const ids = [...new Set((url.searchParams.get('ids') || '').split(',').filter(Boolean))];
        if (!ids.length || ids.length > 1000 || ids.some(id => !catalog.byId.has(id))) {
          return json(400, { error: '选择 1–1000 个有效文件 / Select 1–1000 valid files' });
        }
        const chosen = new Set(ids);
        const ordered = catalog.entries.filter(entry => chosen.has(entry.id));
        return json(200, { batches: await makeBatches(ordered.map(entry => fileUrl(getBaseUrl(), entry.id))) });
      }
      const match = /^\/cia\/([a-f0-9]{24})\.cia$/.exec(url.pathname);
      if (!match) return send(404, '未找到 / Not found');
      const opened = await openCatalogFile(catalog, catalog.byId.get(match[1]));
      if (!opened) return send(404, '文件已移除或不可用 / File removed or unavailable');
      const { handle, stat } = opened;
      let start = 0;
      let end = stat.size - 1;
      let status = 200;
      if (req.headers.range && req.method === 'GET') {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (range && (range[1] || range[2])) {
          if (range[1]) {
            start = Number(range[1]);
            if (range[2]) end = Math.min(Number(range[2]), end);
          } else start = Math.max(0, stat.size - Number(range[2]));
        }
        if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) || start > end || start >= stat.size) {
          await handle.close();
          return send(416, '', undefined, { 'Content-Range': 'bytes */' + stat.size });
        }
        status = 206;
      }
      res.writeHead(status, { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes',
        'Content-Length': stat.size ? end - start + 1 : 0,
        ...(status === 206 ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size } : {}) });
      if (req.method === 'HEAD' || !stat.size) { await handle.close(); res.end(); return; }
      await pipeline(handle.createReadStream({ start, end }), res);
    } catch (error) {
      if (!res.headersSent) json(500, { error: '请求失败 / Request failed' });
      else res.destroy();
      if (!['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code)) console.error(error.message);
    }
  });
  server.requestTimeout = 0;
  return { server, catalog };
}
