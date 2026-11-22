import test from 'node:test';
import assert from 'node:assert/strict';
import { createCostClient } from '../src/client.mjs';
import { loadConfig } from '../src/config.mjs';
import { startAPI, json, credentials, fixture } from './helpers.mjs';

test('client encodes literal query and only sends correct authentication to fixed GET routes', async t => {
  const requests = [];
  const url = await startAPI(t, (req, res) => { requests.push({ method: req.method, url: req.url, headers: req.headers }); json(res, req.url.startsWith('/api/v1/categories') ? fixture.categories : fixture.entries); });
  const config = loadConfig({ COST_MCP_BASE_URL: url, COST_MCP_CREDENTIALS_FILE: await credentials(t) });
  const client = createCostClient(config);
  const page = await client.listEntries({ q: '餐饮%_ &', account_id: 0, page: 1, page_size: 1 }, AbortSignal.timeout(1000));
  assert.equal(page.summary.expense_cent, 505);
  assert.equal(requests[0].method, 'GET');
  assert.equal(new URL(requests[0].url, url).searchParams.get('q'), '餐饮%_ &');
  assert.equal(new URL(requests[0].url, url).pathname, '/api/v1/entries');
  assert.equal(requests[0].headers.authorization, `Bearer ${'a'.repeat(64)}`);
  assert.equal(requests[0].headers['x-dev-token'], undefined);
  const dev = createCostClient({ ...config, authMode: 'development', credentialsFile: await credentials(t, 'synthetic-dev') });
  await dev.categories(AbortSignal.timeout(1000));
  assert.equal(requests[1].headers['x-dev-token'], 'synthetic-dev');
  assert.equal(requests[1].headers.authorization, undefined);
});

test('client never follows redirect or exposes sensitive upstream bodies', async t => {
  let leaked = false;
  const target = await startAPI(t, (_req, res) => { leaked = true; json(res, fixture.categories); });
  const redirect = await startAPI(t, (_req, res) => { res.writeHead(302, { location: target }); res.end(); });
  const file = await credentials(t);
  await assert.rejects(createCostClient({ baseURL: redirect, authMode: 'session', credentialsFile: file }).categories(), { code: 'UPSTREAM_UNAVAILABLE' });
  assert.equal(leaked, false);
  for (const [status, body, code] of [[401, { secret: 'SENSITIVE' }, 'AUTH_REQUIRED'], [403, { error: 'nickname_required' }, 'PROFILE_REQUIRED'],
    [403, {}, 'ACCESS_DENIED'], [500, { error: 'SENSITIVE' }, 'UPSTREAM_UNAVAILABLE']]) {
    const url = await startAPI(t, (_req, res) => json(res, body, status));
    await assert.rejects(createCostClient({ baseURL: url, authMode: 'session', credentialsFile: file }).categories(), error => error.code === code && !error.message.includes('SENSITIVE'));
  }
});

test('client rejects malformed, oversized, unsafe and cancelled responses', async t => {
  const file = await credentials(t);
  for (const [body, type, code] of [['not-json', 'application/json', 'UPSTREAM_INVALID_RESPONSE'], ['[]', 'text/html', 'UPSTREAM_INVALID_RESPONSE'],
    [JSON.stringify([{ id: 9007199254740992, name: 'x', kind: 'expense' }]), 'application/json', 'UPSTREAM_INVALID_RESPONSE'],
    ['x'.repeat(2 * 1024 * 1024 + 1), 'application/json', 'RESPONSE_TOO_LARGE']]) {
    const url = await startAPI(t, (_req, res) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); });
    await assert.rejects(createCostClient({ baseURL: url, authMode: 'session', credentialsFile: file }).categories(), { code });
  }
  const hang = await startAPI(t, () => {});
  await assert.rejects(createCostClient({ baseURL: hang, authMode: 'session', credentialsFile: file }).categories(AbortSignal.timeout(25)), { code: 'UPSTREAM_UNAVAILABLE' });
});
