import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { credentials, startAPI, fixtureAPI } from './helpers.mjs';

const entry = new URL('../src/index.mjs', import.meta.url).pathname;
test('real stdio server is usable with official SDK and stdout contains only protocol messages', async t => {
  const origin = await startAPI(t, fixtureAPI), file = await credentials(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe', env: {
    COST_MCP_BASE_URL: origin, COST_MCP_CREDENTIALS_FILE: file,
  } });
  let stderr = ''; transport.stderr.on('data', b => { stderr += b; });
  const client = new Client({ name: 'synthetic-stdio', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 2);
  for (const [name, args] of [['cost_list_bills', { month: '2026-11', page_size: 1 }], ['cost_category_stats', { ref: '2026-11-22' }]]) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.structuredContent.summary.expense_cent, 505);
  }
  assert.equal(stderr, '');
  const pid = transport.pid; await client.close();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

async function child(t, env) {
  const p = spawn(process.execPath, [entry], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (p.exitCode === null) p.kill('SIGKILL'); });
  let stdout = '', stderr = ''; const lines = []; let pending = '';
  p.stdout.on('data', b => {
    stdout += b; pending += b;
    let i;
    while ((i = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, i); pending = pending.slice(i + 1); lines.push(JSON.parse(line)); }
  });
  p.stderr.on('data', b => { stderr += b; });
  return { p, lines, finished: once(p, 'exit'), output: () => ({ stdout, stderr, pending }) };
}
test('bad startup fails without echoing configuration or secrets', async t => {
  const c = await child(t, { COST_MCP_BASE_URL: 'https://SECRET_SENTINEL@example.invalid', COST_MCP_CREDENTIALS_FILE: '/SECRET_SENTINEL' });
  const [code] = await c.finished; assert.equal(code, 1);
  assert.equal(c.output().stdout, ''); assert.ok(!c.output().stderr.includes('SECRET_SENTINEL'));
  assert.equal(JSON.parse(c.output().stderr).code, 'INVALID_CONFIG');
});
for (const mode of ['stdin', 'SIGTERM']) {
  test(`stdio exits cleanly on ${mode} with an in-flight request`, { timeout: 5000 }, async t => {
    let requested;
    const seen = new Promise(resolve => { requested = resolve; });
    const origin = await startAPI(t, () => requested()), file = await credentials(t);
    const c = await child(t, { COST_MCP_BASE_URL: origin, COST_MCP_CREDENTIALS_FILE: file });
    const send = value => c.p.stdin.write(JSON.stringify(value) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cost_list_bills', arguments: {} } });
    await seen;
    if (mode === 'stdin') c.p.stdin.end(); else c.p.kill('SIGTERM');
    const [code] = await c.finished; assert.equal(code, 0);
    assert.equal(c.output().stderr, ''); assert.equal(c.output().pending, '');
    assert.ok(c.lines.some(line => line.id === 1 && line.result));
  });
}
