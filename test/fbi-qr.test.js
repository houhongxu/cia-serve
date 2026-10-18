import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import QRCode from 'qrcode';
import { makeBatches, encodeFbiQr } from '../src/qr.js';

const decoder = process.env.FBI_QUIRC_DECODER;
const options = { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 360 };
const urls = [
  '526ac531ef43ae095dc167c2', '7b7f10c1f186ec2d923f189e',
  '864179950c410c01a3255ede', 'b468cdde1d00fd249cd3767a',
].map(id => 'http://192.168.5.17:8082/cia/' + id + '.cia');

// 读取实际生产 SVG 的模块矩阵 / Extract modules from the actual production SVG.
function svgMatrix(svg) {
  const total = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)[1]);
  const size = total - 8;
  const cells = new Uint8Array(size * size);
  const drawing = /<path stroke="#000000" d="([^"]*)"/.exec(svg)[1];
  let x = 0;
  let y = 0;
  for (const [, command, values] of drawing.matchAll(/([Mmh])([^Mmh]+)/g)) {
    const [first, second] = values.trim().split(/\s+/).map(Number);
    if (command === 'M') { x = first; y = second; }
    else if (command === 'm') { x += first; y += second; }
    else {
      for (let column = 0; column < first; column++) cells[(Math.floor(y) - 4) * size + x + column - 4] = 1;
      x += first;
    }
  }
  return size + '\n' + cells.join('');
}
function decode(svg) {
  return spawnSync(decoder, [], { input: svgMatrix(svg), encoding: 'utf8' });
}

test('FBI旧解码器复现默认混段乱码 / Reproduces mixed-mode corruption in FBI decoder',
  { skip: !decoder }, async () => {
    const payload = urls.join('\n');
    const result = decode(await QRCode.toString(payload, options));
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, payload);
    assert.match(result.stdout, /^http\/GZP/);
  });

test('FBI逐字节解码单包及批量生产SVG / FBI decodes production single and batch SVGs byte for byte',
  { skip: !decoder }, async () => {
    for (let count = 1; count <= urls.length; count++) {
      const batches = await makeBatches(urls.slice(0, count));
      assert.equal(batches.length, 1);
      const result = decode(batches[0].svg);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, urls.slice(0, count).join('\n'));
    }
  });

test('浏览器入口和版本10字节计数兼容 / Browser entry and version-10 byte count remain compatible',
  { skip: !decoder }, async () => {
    for (const payload of ['http://192.168.5.17:8082', 'http://' + 'A'.repeat(100) + '.test:8082']) {
      for (const version of [7, 9, 10, 11]) {
        const result = decode(await encodeFbiQr(payload, { ...options, version }));
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, payload);
      }
    }
  });
