import { CostError } from './errors.mjs';
import { normalizeBillQuery, normalizeStatsQuery, billOutputSchema, statsOutputSchema } from './schemas.mjs';

export const RESULT_LIMIT = 256 * 1024;
const limitations = [
  '金额单位为整数分；收支差额不是资金账户余额；转账不计收支。',
  '复用后端当前口径；预留 exclude_stats、退款抵扣和多币种折算尚未纳入统计。',
  '仅后端已登录账本；不包含尚未登录合并的本机游客数据。',
];
export function bounded(value) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > RESULT_LIMIT) throw new CostError('RESPONSE_TOO_LARGE');
  return value;
}
function validated(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CostError('UPSTREAM_INVALID_RESPONSE');
  return bounded(parsed.data);
}
function names(categories, warnings) {
  const map = new Map();
  for (const category of categories) {
    if (map.has(category.id)) throw new CostError('UPSTREAM_INVALID_RESPONSE');
    map.set(category.id, category);
  }
  const missing = new Set();
  return (id, kind) => {
    const category = map.get(id);
    if (!category) {
      if (!missing.has(id)) { warnings.push(`分类 ${id} 的名称不可用；按原分类 ID 返回。`); missing.add(id); }
      return null;
    }
    if (category.kind !== kind) throw new CostError('UPSTREAM_INVALID_RESPONSE');
    return category.name;
  };
}
const signalFor = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);

export function createTools(client, { now = () => new Date(), shutdownSignal } = {}) {
  const callSignal = signal => signalFor(shutdownSignal ? AbortSignal.any([shutdownSignal, ...(signal ? [signal] : [])]) : signal);
  return {
    async listBills(args, { signal } = {}) {
      const { query, period } = normalizeBillQuery(args, now());
      const api = await client.forCall(callSignal(signal));
      const data = await api.listEntries(query);
      if (data.page !== query.page || data.page_size !== query.page_size || data.items.length > query.page_size) throw new CostError('UPSTREAM_INVALID_RESPONSE');
      const categories = await api.categories(); const warnings = [];
      const nameOf = names(categories, warnings);
      const items = data.items.map(item => ({ ...item, category_name: nameOf(item.category_id, item.kind),
        currency: item.currency ?? 'CNY', currency_source: item.currency ? 'entry' : 'backend_default' }));
      return validated(billOutputSchema, { timezone: 'Asia/Shanghai', period, page: data.page, page_size: data.page_size,
        total: data.total, has_more: query.page * query.page_size < data.total, items, summary: data.summary,
        aggregation_policy: 'backend_current', limitations, warnings });
    },
    async categoryStats(args, { signal } = {}) {
      const { query, period, limit } = normalizeStatsQuery(args, now());
      const api = await client.forCall(callSignal(signal)); const data = await api.stats(query);
      if (data.range !== query.range || data.start !== period.start_date || data.end !== period.end_date) throw new CostError('UPSTREAM_INVALID_RESPONSE');
      const metadata = await api.categories(); const warnings = [], nameOf = names(metadata, warnings);
      const ids = new Set();
      for (const c of data.categories) { if (ids.has(c.category_id)) throw new CostError('UPSTREAM_INVALID_RESPONSE'); ids.add(c.category_id); }
      const categories = [...data.categories].sort((a, b) => b.amount_cent - a.amount_cent || a.category_id - b.category_id).slice(0, limit)
        .map(c => ({ ...c, category_name: nameOf(c.category_id, 'expense') }));
      return validated(statsOutputSchema, { timezone: 'Asia/Shanghai', period, summary: data.summary, category_count: data.categories.length,
        returned_count: categories.length, has_more: data.categories.length > categories.length, categories,
        aggregation_policy: 'backend_current', limitations, warnings });
    },
  };
}
