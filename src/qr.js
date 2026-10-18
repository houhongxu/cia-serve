import QRCode from 'qrcode';
export const MAX_QR_BYTES = 280;
export const MAX_BATCH_FILES = 5;
// 避免 FBI 旧版 quirc 的混段计数缺陷 / Avoid mixed-mode count bugs in FBI's bundled quirc.
export const encodeFbiQr = (payload, options) => QRCode.toString([{ data: payload, mode: 'byte' }], options);
export const fileUrl = (baseUrl, id) => baseUrl + '/cia/' + id + '.cia';
export function splitBatches(urls) {
  const batches = [];
  let current = [];
  for (const url of urls) {
    if (Buffer.byteLength(url) > MAX_QR_BYTES) throw new Error('地址过长 / URL is too long for an install QR');
    if (current.length && (current.length >= MAX_BATCH_FILES ||
        Buffer.byteLength([...current, url].join('\n')) > MAX_QR_BYTES)) {
      batches.push(current);
      current = [];
    }
    current.push(url);
  }
  if (current.length) batches.push(current);
  return batches;
}
export async function makeBatches(urls) {
  return Promise.all(splitBatches(urls).map(async batch => {
    const payload = batch.join('\n');
    return { count: batch.length, payload,
      svg: await encodeFbiQr(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 360 }) };
  }));
}
