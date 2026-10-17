const el = id => document.getElementById(id);
let files = [];
const selected = new Set();
let request = 0;
const size = bytes => bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KiB' : (bytes / 1048576).toFixed(1) + ' MiB';
function render() {
  const query = el('search').value.toLocaleLowerCase();
  el('files').replaceChildren();
  for (const file of files.filter(item => item.name.toLocaleLowerCase().includes(query))) {
    const row = document.createElement('div');
    row.className = 'file';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'f-' + file.id;
    input.checked = selected.has(file.id);
    input.addEventListener('change', () => { input.checked ? selected.add(file.id) : selected.delete(file.id); updateCount(); });
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = file.name;
    const meta = document.createElement('small');
    meta.textContent = size(file.size);
    label.append(meta);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '单包码 / Single QR';
    button.addEventListener('click', () => generate([file.id]));
    row.append(input, label, button);
    el('files').append(row);
  }
  updateCount();
}
function updateCount() {
  el('count').textContent = selected.size + ' / ' + files.length;
  el('generate').disabled = !selected.size;
}
async function generate(ids) {
  const current = ++request;
  el('status').textContent = '生成中 / Generating…';
  try {
    if (ids.length > 1000) throw new Error('每次最多 1000 个文件，请缩小选择 / Select at most 1000 files at a time');
    const batches = [];
    // 保持请求 URL 较短 / Keep request URLs short.
    for (let offset = 0; offset < ids.length; offset += 100) {
      const response = await fetch('/api/qr?ids=' + ids.slice(offset, offset + 100).join(','));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      batches.push(...data.batches);
    }
    if (current !== request) return;
    el('batches').replaceChildren();
    batches.forEach((batch, index) => {
      const card = document.createElement('article');
      card.className = 'batch';
      const title = document.createElement('h3');
      title.textContent = '批次 / Batch ' + (index + 1) + ' · ' + batch.count + ' 个文件 / files';
      const image = document.createElement('img');
      image.alt = 'FBI 安装二维码 / FBI install QR ' + (index + 1);
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(batch.svg);
      const payload = document.createElement('textarea');
      payload.readOnly = true;
      payload.setAttribute('aria-label', '安装地址 / Install URLs');
      payload.value = batch.payload;
      card.append(title, image, payload);
      el('batches').append(card);
    });
    el('status').textContent = ids.length + ' 个文件，' + batches.length + ' 个安装码 / files, install codes';
  } catch (error) {
    if (current === request) el('status').textContent = error.message;
  }
}
el('search').addEventListener('input', render);
el('all').addEventListener('click', () => { files.forEach(file => selected.add(file.id)); render(); });
el('none').addEventListener('click', () => { selected.clear(); render(); });
el('generate').addEventListener('click', () => generate([...selected]));
try {
  const response = await fetch('/api/files');
  if (!response.ok) throw new Error('读取失败 / Failed to list files');
  const data = await response.json();
  files = data.files;
  el('address').textContent = data.baseUrl;
  files.slice(0, 1000).forEach(file => selected.add(file.id));
  render();
  if (files.length) await generate([...selected]);
  else el('status').textContent = '没有 CIA 文件，添加后重启服务 / No CIA files. Add files and restart the server.';
} catch (error) {
  el('status').textContent = error.message;
}
