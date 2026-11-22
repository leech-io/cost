import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, readCredentials } from '../src/config.mjs';

test('configuration accepts only explicit origins and separates authentication modes', () => {
  const env = { COST_MCP_BASE_URL: 'https://cost.example/', COST_MCP_CREDENTIALS_FILE: '/tmp/private-token.json' };
  assert.deepEqual(loadConfig(env), { baseURL: 'https://cost.example', authMode: 'session', credentialsFile: '/tmp/private-token.json' });
  for (const url of ['', 'https://x/path', 'https://x/?q=x', 'https://x/#frag', 'https://u:p@x', 'http://example.com', 'http://192.168.1.3', 'file:///tmp/x']) {
    assert.throws(() => loadConfig({ ...env, COST_MCP_BASE_URL: url }), { code: 'INVALID_CONFIG' }, url);
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(loadConfig({ ...env, COST_MCP_BASE_URL: `http://${host}:8080`, COST_MCP_AUTH_MODE: 'development' }).authMode, 'development');
  }
  assert.throws(() => loadConfig({ ...env, COST_MCP_AUTH_MODE: 'development' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => loadConfig({ ...env, COST_MCP_AUTH_MODE: 'auto' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => loadConfig({ ...env, COST_MCP_CREDENTIALS_FILE: 'relative.json' }), { code: 'INVALID_CONFIG' });
});

test('credentials are re-read and invalid, oversized, linked, repository or shared files are refused', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cost-mcp-credentials-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'credentials.json');
  const config = loadConfig({ COST_MCP_BASE_URL: 'https://cost.example', COST_MCP_CREDENTIALS_FILE: file });
  await assert.rejects(readCredentials(config), { code: 'CREDENTIAL_UNAVAILABLE' });
  await writeFile(file, JSON.stringify({ token: 'a'.repeat(64) }), { mode: 0o600 });
  assert.equal(await readCredentials(config), 'a'.repeat(64));
  await writeFile(file, JSON.stringify({ token: 'b'.repeat(64) }));
  assert.equal(await readCredentials(config), 'b'.repeat(64));
  await chmod(file, 0o400);
  assert.equal(await readCredentials(config), 'b'.repeat(64));
  await chmod(file, 0o644);
  await assert.rejects(readCredentials(config), { code: 'CREDENTIAL_UNAVAILABLE' });
  await chmod(file, 0o600);
  for (const value of ['{}', '{bad', JSON.stringify({ token: 'short' }), JSON.stringify({ token: 'a'.repeat(64), url: 'https://evil.example' }), 'x'.repeat(4097)]) {
    await writeFile(file, value);
    await assert.rejects(readCredentials(config), { code: 'CREDENTIAL_UNAVAILABLE' });
  }
  await writeFile(file, JSON.stringify({ token: 'a'.repeat(64) }));
  const link = join(dir, 'link'); await symlink(file, link);
  await assert.rejects(readCredentials({ ...config, credentialsFile: link }), { code: 'CREDENTIAL_UNAVAILABLE' });
  await assert.rejects(readCredentials({ ...config, credentialsFile: dir }), { code: 'CREDENTIAL_UNAVAILABLE' });
  const repo = resolve(import.meta.dirname, '../..');
  assert.throws(() => loadConfig({ COST_MCP_BASE_URL: 'https://x', COST_MCP_CREDENTIALS_FILE: join(repo, 'token.json') }), { code: 'INVALID_CONFIG' });
  const repositoryAlias = join(dir, 'repo'); await symlink(repo, repositoryAlias);
  await assert.rejects(readCredentials({ ...config, credentialsFile: join(repositoryAlias, 'README.md') }), { code: 'CREDENTIAL_UNAVAILABLE' });
  const dev = { ...config, authMode: 'development' };
  await writeFile(file, JSON.stringify({ token: 'local-test-token' }));
  assert.equal(await readCredentials(dev), 'local-test-token');
});
