import test from 'node:test';
import assert from 'node:assert/strict';
import { splitBatches, makeBatches } from '../src/qr.js';

test('批次保持顺序、数量和字节边界 / Batches preserve order and limits', async () => {
  const urls = Array.from({ length: 30 }, (_, i) => 'http://192.168.1.2:8080/cia/' + i.toString().padStart(24, '0') + '.cia');
  const batches = splitBatches(urls);
  assert.deepEqual(batches.flat(), urls);
  assert.ok(batches.every(batch => batch.length <= 5 && Buffer.byteLength(batch.join('\n')) <= 280));
  assert.deepEqual(splitBatches([]), []);
  const output = await makeBatches(urls.slice(0, 2));
  assert.equal(output[0].payload, urls.slice(0, 2).join('\n'));
  assert.match(output[0].svg, /viewBox=/);
  assert.throws(() => splitBatches(['http://a/' + 'x'.repeat(280)]), /too long/);
});
