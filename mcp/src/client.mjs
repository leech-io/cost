import { z } from 'zod';
import { loadConfig, readCredentials } from './config.mjs';
import { CostError } from './errors.mjs';
import { categorySchema, entryPageSchema, statsResponseSchema } from './schemas.mjs';

const BODY_LIMIT = 2 * 1024 * 1024;
async function readJSON(response) {
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel(); throw new CostError('UPSTREAM_INVALID_RESPONSE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new CostError('UPSTREAM_INVALID_RESPONSE');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel(); throw new CostError('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
  catch { throw new CostError('UPSTREAM_INVALID_RESPONSE'); }
}

export function createCostClient(config, { fetchImpl = fetch } = {}) {
  config = loadConfig({ COST_MCP_BASE_URL: config.baseURL, COST_MCP_AUTH_MODE: config.authMode, COST_MCP_CREDENTIALS_FILE: config.credentialsFile });
  async function forCall(signal = AbortSignal.timeout(10000)) {
    // Snapshot once per tool, so rotating the file cannot mix two users across its GETs.
    const token = await readCredentials(config);
    const headers = config.authMode === 'session' ? { Authorization: `Bearer ${token}` } : { 'X-Dev-Token': token };
    async function get(path, query, schema, allowed) {
      try {
        if (signal.aborted) throw new CostError('UPSTREAM_UNAVAILABLE');
        const url = new URL(path, config.baseURL);
        for (const [key, value] of Object.entries(query)) {
          if (!allowed.includes(key)) throw new CostError('INVALID_ARGUMENT');
          url.searchParams.set(key, String(value));
        }
        const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal });
        if (response.status === 401 || response.status >= 500 || (response.status !== 200 && response.status !== 403)) {
          await response.body?.cancel(); throw new CostError(response.status === 401 ? 'AUTH_REQUIRED' : 'UPSTREAM_UNAVAILABLE');
        }
        const body = await readJSON(response);
        if (response.status === 403) throw new CostError(body?.error === 'nickname_required' ? 'PROFILE_REQUIRED' : 'ACCESS_DENIED');
        const parsed = schema.safeParse(body);
        if (!parsed.success) throw new CostError('UPSTREAM_INVALID_RESPONSE');
        return parsed.data;
      } catch (error) {
        if (error instanceof CostError) throw error;
        throw new CostError('UPSTREAM_UNAVAILABLE');
      }
    }
    return {
      listEntries: query => get('/api/v1/entries', query, entryPageSchema, ['month', 'start_date', 'end_date', 'kind', 'category_id', 'account_id', 'q', 'min_amount_cent', 'max_amount_cent', 'page', 'page_size']),
      stats: query => get('/api/v1/stats', query, statsResponseSchema, ['range', 'ref', 'start_date', 'end_date']),
      categories: () => get('/api/v1/categories', {}, z.array(categorySchema), []),
    };
  }
  return { forCall,
    listEntries: async (query, signal) => (await forCall(signal)).listEntries(query),
    stats: async (query, signal) => (await forCall(signal)).stats(query),
    categories: async signal => (await forCall(signal)).categories(),
  };
}
