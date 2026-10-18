#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { createApp } from '../src/server.js';
import QRCode from 'qrcode';

const help = `cia-serve [directory] [options]
局域网 CIA 安装二维码 / LAN CIA install QR codes for FBI

  --port, -p <port>       HTTP 端口 / HTTP port (8080)
  --host <IPv4>           二维码中的局域网地址 / Advertised LAN IPv4
  --bind <IPv4>           监听地址 / Listen address (0.0.0.0)
  --public-url <URL>      显式可达 HTTP 地址 / Reachable HTTP base URL
  --no-qr                关闭终端二维码 / Disable terminal QR
  --help, -h             帮助 / Help
  --version, -v          版本 / Version

示例 / Examples:
  npx cia-serve
  npx cia-serve ./cias --host 192.168.1.20 --port 8080
`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    port: { type: 'string', short: 'p', default: '8080' },
    host: { type: 'string' }, bind: { type: 'string', default: '0.0.0.0' },
    'public-url': { type: 'string' }, 'no-qr': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  } });
  if (values.help) return console.log(help);
  if (values.version) {
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(version);
  }
  if (positionals.length > 1) throw new Error('仅接受一个目录 / Expected one directory');
  if (!/^\d+$/.test(values.port) || Number(values.port) > 65535 || Number(values.port) < 1) {
    throw new Error('端口须为 1–65535 / Port must be 1–65535');
  }
  if (isIP(values.bind) !== 4 || (values.host && isIP(values.host) !== 4)) {
    throw new Error('--bind/--host 须为 IPv4 / --bind/--host must be IPv4');
  }
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    list.filter(item => item.family === 'IPv4' && !item.internal).map(item => ({ name, address: item.address })));
  candidates.sort((a, b) => Number(/docker|veth|br-|tun|tap/i.test(a.name)) - Number(/docker|veth|br-|tun|tap/i.test(b.name)));
  const host = values.host || (values.bind !== '0.0.0.0' ? values.bind : candidates[0]?.address) || '127.0.0.1';
  let baseUrl = 'http://' + host + ':' + Number(values.port);
  if (values['public-url']) {
    const url = new URL(values['public-url']);
    if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('--public-url 须为无路径、凭据或查询的 HTTP 地址 / --public-url must be an HTTP origin');
    }
    baseUrl = url.origin;
  }
  if (baseUrl.length > 180) throw new Error('公开地址过长 / Public URL is too long');
  const { server, catalog } = await createApp({ directory: resolve(positionals[0] || '.'), getBaseUrl: () => baseUrl });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(Number(values.port), values.bind, done); });
  console.log('\ncia-serve · ' + catalog.entries.length + ' 个 CIA 文件 / CIA files');
  console.log('目录 / Directory: ' + catalog.root);
  console.log('浏览器 / Browser: ' + baseUrl);
  console.log('3DS: FBI → Remote Install → Scan QR Code');
  console.log('浏览器打开页面查看安装二维码 / Open the page for install QR codes.');
  if (candidates.length > 1) console.log('候选地址 / LAN candidates: ' + candidates.map(item => item.address + ' (' + item.name + ')').join(', '));
  console.log('若地址不可达，用 --host 指定 IPv4 / Override unreachable addresses with --host.');
  console.log('WSL2 NAT: 3DS 需可访问主机端口；防火墙需手动配置 / 3DS must reach the host port; firewall setup is manual.');
  if (!values['no-qr']) {
    console.log('\n手机浏览器入口（FBI 使用页面安装码） / Browser entry (use page install codes in FBI):');
    console.log(await QRCode.toString(baseUrl, { type: 'terminal', small: true }));
  }
  const stop = () => { server.close(); server.closeIdleConnections(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
main().catch(error => { console.error('错误 / Error: ' + error.message); process.exitCode = 1; });
