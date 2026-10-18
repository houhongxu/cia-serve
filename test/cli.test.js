import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const cli = new URL('../bin/cia-serve.js', import.meta.url);
function run(args) { return spawnSync(process.execPath, [fileURLToPath(cli), ...args], { encoding: 'utf8' }); }
test('CLI 帮助与版本 / CLI help and version', () => {
  assert.match(run(['--help']).stdout, /--public-url/);
  const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const version = run(['--version']);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), packageInfo.version);
  assert.equal(lock.version, packageInfo.version);
  assert.equal(lock.packages[''].version, packageInfo.version);
});
test('CLI 拒绝无效配置 / CLI rejects invalid options', () => {
  for (const args of [['--port', '0'], ['--port', '65536'], ['--port', '12abc'],
    ['--host', 'not-an-ip'], ['--bind', '::'], ['--public-url', 'https://example.com'],
    ['--public-url', 'http://example.com/path'], ['one', 'two'], ['--missing-option']]) {
    assert.notEqual(run(args).status, 0, args.join(' '));
  }
});
