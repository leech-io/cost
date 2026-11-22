import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.mjs';
import { createTools } from '../src/tools.mjs';
import { createCostClient } from '../src/client.mjs';
import { CostError } from '../src/errors.mjs';
import { credentials, startAPI, fixtureAPI } from './helpers.mjs';

async function connect(t, tools) {
  const server = createServer({ tools });
  const client = new Client({ name: 'synthetic-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(b); await client.connect(a); return client;
}
test('official MCP client discovers exactly two tools and validates structured results', async t => {
  const origin = await startAPI(t, fixtureAPI), file = await credentials(t);
  const tools = createTools(createCostClient({ baseURL: origin, credentialsFile: file, authMode: 'session' }), { now: () => new Date('2026-11-22') });
  const client = await connect(t, tools);
  const { tools: listed } = await client.listTools();
  assert.deepEqual(listed.map(t => t.name).sort(), ['cost_category_stats', 'cost_list_bills']);
  for (const tool of listed) {
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.outputSchema);
  }
  const result = await client.callTool({ name: 'cost_list_bills', arguments: { month: '2026-11', page_size: 1 } });
  assert.ok(!result.isError); assert.equal(result.structuredContent.summary.expense_cent, 505);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  const stats = await client.callTool({ name: 'cost_category_stats', arguments: { ref: '2026-11-22', limit: 1 } });
  assert.equal(stats.structuredContent.returned_count, 1);
  assert.equal((await client.callTool({ name: 'cost_list_bills', arguments: { ledger_id: 9 } })).isError, true);
  assert.equal((await client.callTool({ name: 'unknown', arguments: {} })).isError, true);
});
test('tool errors are fixed and the complete duplicated MCP envelope is limited', async t => {
  const client = await connect(t, {
    listBills: async () => { throw new CostError('AUTH_REQUIRED', { cause: new Error('SECRET_SENTINEL') }); },
    categoryStats: async () => ({ payload: 'x'.repeat(140000) }),
  });
  const error = await client.callTool({ name: 'cost_list_bills', arguments: {} });
  assert.equal(JSON.parse(error.content[0].text).code, 'AUTH_REQUIRED');
  assert.ok(!JSON.stringify(error).includes('SECRET_SENTINEL'));
  const tooLarge = await client.callTool({ name: 'cost_category_stats', arguments: {} });
  assert.equal(tooLarge.isError, true);
  assert.equal(JSON.parse(tooLarge.content[0].text).code, 'RESPONSE_TOO_LARGE');
});
