import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBillQuery, normalizeStatsQuery } from '../src/schemas.mjs';
const now = new Date('2026-11-30T16:01:00Z'); // December 1 in Shanghai.
test('bill dates are explicit Shanghai inclusive periods and preserve zero filters', () => {
  const result = normalizeBillQuery({ account_id: 0, min_amount_cent: 0, page_size: 1 }, now);
  assert.deepEqual(result.period, { start_date: '2026-12-01', end_date: '2026-12-31', inclusive_end: true });
  assert.deepEqual(result.query, { month: '2026-12', page: 1, page_size: 1, account_id: 0, min_amount_cent: 0 });
  assert.equal(normalizeBillQuery({ month: '2024-02' }, now).period.end_date, '2024-02-29');
  assert.deepEqual(normalizeBillQuery({ start_date: '2026-10-31', end_date: '2026-11-01', q: '餐饮%_' }, now).query,
    { start_date: '2026-10-31', end_date: '2026-11-01', page: 1, page_size: 20, q: '餐饮%_' });
});
test('bill arguments reject ambiguous, unbounded, invalid and unsafe inputs', () => {
  for (const args of [{ month: '2026-13' }, { month: '2026-1' }, { month: '0999-12' }, { start_date: '2026-01-01' },
    { month: '2026-11', start_date: '2026-01-01', end_date: '2026-01-02' },
    { start_date: '2026-02-30', end_date: '2026-03-01' }, { start_date: '2026-11-02', end_date: '2026-11-01' },
    { start_date: '2024-01-01', end_date: '2025-01-01' }, { page: 0 }, { page_size: 101 }, { kind: 'transfer' },
    { account_id: -1 }, { category_id: 0 }, { category_id: 9007199254740992 }, { q: '中'.repeat(501) },
    { min_amount_cent: -1 }, { min_amount_cent: 2, max_amount_cent: 1 }, { max_amount_cent: 1e11 + 1 },
    { page: '2' }, { ledger_id: 2 }, { url: 'https://evil.example' }]) {
    assert.throws(() => normalizeBillQuery(args, now), { code: 'INVALID_ARGUMENT' }, JSON.stringify(args));
  }
});
test('statistics normalize periods independently of host timezone', () => {
  assert.deepEqual(normalizeStatsQuery({}, now), { query: { range: 'month', ref: '2026-12-01' }, limit: 10,
    period: { start_date: '2026-12-01', end_date: '2026-12-31', inclusive_end: true } });
  assert.equal(normalizeStatsQuery({ range: 'week', ref: '2026-11-22' }, now).period.start_date, '2026-11-16');
  assert.equal(normalizeStatsQuery({ range: 'week', ref: '2026-11-22' }, now).period.end_date, '2026-11-22');
  assert.equal(normalizeStatsQuery({ range: 'year', ref: '2024-06-01' }, now).period.end_date, '2024-12-31');
  assert.equal(normalizeStatsQuery({ range: 'custom', start_date: '2024-01-01', end_date: '2024-12-31', limit: 1 }, now).limit, 1);
  for (const args of [{ range: 'all' }, { kind: 'income' }, { range: 'custom' }, { range: 'custom', start_date: '2026-01-01', end_date: '2026-01-02', ref: '2026-01-01' },
    { range: 'month', start_date: '2026-01-01', end_date: '2026-01-02' }, { ref: '2026-02-29' }, { limit: 0 }, { limit: 101 }, { account_id: 1 }]) {
    assert.throws(() => normalizeStatsQuery(args, now), { code: 'INVALID_ARGUMENT' });
  }
});
