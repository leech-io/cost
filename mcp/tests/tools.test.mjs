import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/tools.mjs';
import { createCostClient } from '../src/client.mjs';
import { startAPI, credentials, json, fixture, fixtureAPI } from './helpers.mjs';
const now = () => new Date('2026-11-22T04:00:00Z');
async function setup(t, handler = fixtureAPI) {
  const url = await startAPI(t, handler);
  return createTools(createCostClient({ baseURL: url, authMode: 'session', credentialsFile: await credentials(t) }), { now });
}
test('bill projection returns full matching summary, pagination and no internal identity fields', async t => {
  const tools = await setup(t); const result = await tools.listBills({ page_size: 1 });
  assert.equal(result.total, 4); assert.equal(result.items.length, 1); assert.equal(result.has_more, true);
  assert.deepEqual(result.summary, { income_cent: 500, expense_cent: 505, balance_cent: -5 });
  assert.equal(result.items[0].category_name, '工资');
  assert.equal(result.items[0].currency, 'CNY'); assert.equal(result.items[0].currency_source, 'entry');
  assert.equal(result.items[0].created_by, undefined); assert.equal(result.items[0].client_request_id, undefined);
  assert.equal(result.aggregation_policy, 'backend_current');
  assert.equal(result.period.end_date, '2026-11-30');
});
test('category limit never changes totals and ranking ties are deterministic', async t => {
  const tools = await setup(t, (req, res) => {
    if (req.url.startsWith('/api/v1/stats')) json(res, { ...fixture.stats, categories: [
      { category_id: 2, amount_cent: 202, count: 1 }, { category_id: 1, amount_cent: 202, count: 2 }] });
    else json(res, fixture.categories);
  });
  const result = await tools.categoryStats({ limit: 1 });
  assert.deepEqual(result.categories, [{ category_id: 1, category_name: '餐饮', amount_cent: 202, count: 2 }]);
  assert.equal(result.category_count, 2); assert.equal(result.returned_count, 1); assert.equal(result.has_more, true);
  assert.equal(result.summary.expense_cent, 505); assert.equal(result.series, undefined); assert.equal(result.budget, undefined);
});
test('empty pages, missing names, default currency and empty statistics are not invented', async t => {
  const tools = await setup(t, (req, res) => {
    if (req.url.startsWith('/api/v1/categories')) json(res, []);
    else if (req.url.startsWith('/api/v1/stats')) json(res, { ...fixture.stats, summary: { income_cent: 0, expense_cent: 0, balance_cent: 0 }, categories: [] });
    else {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const item = { ...fixture.entries.items[0] }; delete item.currency;
      json(res, { ...fixture.entries, page: Number(q.get('page')), items: q.get('page') === '99' ? [] : [item] });
    }
  });
  const first = await tools.listBills({ page_size: 1 });
  assert.equal(first.items[0].category_name, null); assert.equal(first.items[0].currency_source, 'backend_default'); assert.equal(first.warnings.length, 1);
  const tail = await tools.listBills({ page: 99, page_size: 1 });
  assert.equal(tail.total, 4); assert.deepEqual(tail.items, []); assert.equal(tail.has_more, false);
  const stats = await tools.categoryStats({}); assert.equal(stats.category_count, 0); assert.equal(stats.summary.expense_cent, 0);
});
test('invalid parameters cause zero upstream requests, and final results are bounded', async t => {
  let requests = 0;
  const tools = await setup(t, (req, res) => {
    requests++;
    if (req.url.startsWith('/api/v1/categories')) json(res, fixture.categories);
    else json(res, { ...fixture.entries, total: 100, page_size: 100,
      items: Array.from({ length: 100 }, (_, i) => ({ ...fixture.entries.items[0], id: i + 1, note: '\u0000'.repeat(500) })) });
  });
  await assert.rejects(tools.listBills({ ledger_id: 9 }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(tools.categoryStats({ kind: 'income' }), { code: 'INVALID_ARGUMENT' });
  assert.equal(requests, 0);
  await assert.rejects(tools.listBills({ page_size: 100 }), { code: 'RESPONSE_TOO_LARGE' });
});
