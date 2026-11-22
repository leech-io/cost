import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
export const fixture = JSON.parse(readFileSync(new URL('./fixtures/cost-api.json', import.meta.url), 'utf8'));
export async function startAPI(t, handler) {
  const server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
export function json(res, body, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
export async function credentials(t, token = 'a'.repeat(64)) {
  const dir = await mkdtemp(join(tmpdir(), 'cost-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'credentials.json'); await writeFile(file, JSON.stringify({ token }), { mode: 0o600 }); return file;
}
export function fixtureAPI(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname;
  const data = { '/api/v1/entries': fixture.entries, '/api/v1/stats': fixture.stats, '/api/v1/categories': fixture.categories }[path];
  json(response, data ?? { error: 'not_found' }, data ? 200 : 404);
}
