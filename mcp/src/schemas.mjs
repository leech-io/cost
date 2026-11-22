import { z } from 'zod';
import { CostError } from './errors.mjs';

const safe = () => z.number().int().safe();
const id = () => safe().positive();
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const date = () => z.string().regex(dayPattern);
export const billInputSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(), start_date: date().optional(), end_date: date().optional(),
  kind: z.enum(['income', 'expense']).optional(), category_id: id().optional(), account_id: safe().nonnegative().optional(),
  q: z.string().refine(s => [...s].length <= 500).optional(),
  min_amount_cent: safe().min(0).max(100000000000).optional(), max_amount_cent: safe().min(0).max(100000000000).optional(),
  page: safe().min(1).max(1000000000).optional(), page_size: safe().min(1).max(100).optional(),
});
export const statsInputSchema = z.strictObject({ range: z.enum(['week', 'month', 'year', 'custom']).optional(),
  ref: date().optional(), start_date: date().optional(), end_date: date().optional(), limit: safe().min(1).max(100).optional() });

function parse(schema, value) { const result = schema.safeParse(value); if (!result.success) throw new CostError('INVALID_ARGUMENT'); return result.data; }
function validDay(value) {
  if (!dayPattern.test(value) || +value.slice(0, 4) < 1000) throw new CostError('INVALID_ARGUMENT');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new CostError('INVALID_ARGUMENT');
  return date;
}
function today(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = name => parts.find(p => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const formatDay = d => d.toISOString().slice(0, 10);
function period(start, end) {
  const a = validDay(start), b = validDay(end);
  const days = (b - a) / 86400000 + 1;
  if (days < 1 || days > 366) throw new CostError('INVALID_ARGUMENT');
  return { start_date: start, end_date: end, inclusive_end: true };
}
function monthPeriod(month) {
  const start = `${month}-01`; const d = validDay(start);
  return period(start, formatDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))));
}
export function normalizeBillQuery(value, now = new Date()) {
  const args = parse(billInputSchema, value);
  let query, bounds;
  if (args.start_date !== undefined || args.end_date !== undefined) {
    if (args.month !== undefined || args.start_date === undefined || args.end_date === undefined) throw new CostError('INVALID_ARGUMENT');
    bounds = period(args.start_date, args.end_date);
    query = { start_date: args.start_date, end_date: args.end_date };
  } else {
    const month = args.month ?? today(now).slice(0, 7); bounds = monthPeriod(month); query = { month };
  }
  query.page = args.page ?? 1; query.page_size = args.page_size ?? 20;
  for (const key of ['kind', 'category_id', 'account_id', 'q', 'min_amount_cent', 'max_amount_cent']) if (args[key] !== undefined) query[key] = args[key];
  if (args.min_amount_cent !== undefined && args.max_amount_cent !== undefined && args.min_amount_cent > args.max_amount_cent) throw new CostError('INVALID_ARGUMENT');
  return { query, period: bounds };
}
export function normalizeStatsQuery(value, now = new Date()) {
  const args = parse(statsInputSchema, value); const range = args.range ?? 'month';
  let query, bounds;
  if (range === 'custom') {
    if (args.ref !== undefined || args.start_date === undefined || args.end_date === undefined) throw new CostError('INVALID_ARGUMENT');
    bounds = period(args.start_date, args.end_date); query = { range, start_date: args.start_date, end_date: args.end_date };
  } else {
    if (args.start_date !== undefined || args.end_date !== undefined) throw new CostError('INVALID_ARGUMENT');
    const ref = args.ref ?? today(now), d = validDay(ref); query = { range, ref };
    if (range === 'month') bounds = monthPeriod(ref.slice(0, 7));
    else if (range === 'year') bounds = period(`${ref.slice(0, 4)}-01-01`, `${ref.slice(0, 4)}-12-31`);
    else {
      const start = new Date(d); start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
      bounds = period(formatDay(start), formatDay(end));
    }
  }
  return { query, limit: args.limit ?? 10, period: bounds };
}

export const summarySchema = z.object({ income_cent: safe(), expense_cent: safe(), balance_cent: safe() });
export const categorySchema = z.object({ id: id(), name: z.string(), kind: z.enum(['income', 'expense']) });
export const entrySchema = z.object({ id: id(), kind: z.enum(['income', 'expense']), amount_cent: safe().positive(), category_id: id(),
  occurred_at: z.iso.datetime({ offset: true }), note: z.string(), account_id: safe().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/).optional() });
export const entryPageSchema = z.object({ items: z.array(entrySchema), total: safe().nonnegative(), page: safe().positive(), page_size: safe().min(1).max(100), summary: summarySchema });
export const statsResponseSchema = z.object({ range: z.enum(['week', 'month', 'year', 'custom']), start: date(), end: date(), summary: summarySchema,
  categories: z.array(z.object({ category_id: id(), amount_cent: safe().nonnegative(), count: safe().nonnegative() })) });
const periodSchema = z.strictObject({ start_date: date(), end_date: date(), inclusive_end: z.literal(true) });
const commonOutput = { timezone: z.literal('Asia/Shanghai'), period: periodSchema, summary: summarySchema,
  aggregation_policy: z.literal('backend_current'), limitations: z.array(z.string()), warnings: z.array(z.string()) };
export const billOutputSchema = z.strictObject({ ...commonOutput, page: safe().positive(), page_size: safe().positive(), total: safe().nonnegative(), has_more: z.boolean(),
  items: z.array(entrySchema.extend({ category_name: z.string().nullable(), currency: z.string(), currency_source: z.enum(['entry', 'backend_default']) })) });
export const statsOutputSchema = z.strictObject({ ...commonOutput, category_count: safe().nonnegative(), returned_count: safe().nonnegative(), has_more: z.boolean(),
  categories: z.array(z.object({ category_id: id(), category_name: z.string().nullable(), amount_cent: safe().nonnegative(), count: safe().nonnegative() })) });
