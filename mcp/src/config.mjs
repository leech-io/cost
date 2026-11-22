import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { CostError } from './errors.mjs';

const repository = resolve(import.meta.dirname, '../..');
const insideRepository = path => { const rel = relative(repository, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

export function loadConfig(env = process.env) {
  try {
    const raw = env.COST_MCP_BASE_URL;
    if (!raw || raw !== raw.trim()) throw new Error();
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || raw.includes('?') || raw.includes('#')) throw new Error();
    if (url.protocol === 'http:' && !loopback(url)) throw new Error();
    const authMode = env.COST_MCP_AUTH_MODE ?? 'session';
    if (!['session', 'development'].includes(authMode)) throw new Error();
    if (authMode === 'development' && !(url.protocol === 'http:' && loopback(url))) throw new Error();
    const file = env.COST_MCP_CREDENTIALS_FILE;
    if (!file || !isAbsolute(file) || insideRepository(resolve(file))) throw new Error();
    return { baseURL: url.origin, authMode, credentialsFile: file };
  } catch { throw new CostError('INVALID_CONFIG'); }
}

export async function readCredentials(config) {
  let handle;
  try {
    if ((await lstat(config.credentialsFile)).isSymbolicLink()) throw new Error();
    const path = await realpath(config.credentialsFile);
    if (insideRepository(path)) throw new Error();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || ![0o400, 0o600].includes(stat.mode & 0o777) || stat.size > 4096) throw new Error();
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error();
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
    if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.token !== 'string') throw new Error();
    if (config.authMode === 'session' ? !/^[a-fA-F0-9]{64}$/.test(value.token) : !value.token.trim() || value.token.length > 1024 || /[\r\n]/.test(value.token)) throw new Error();
    return value.token;
  } catch { throw new CostError('CREDENTIAL_UNAVAILABLE'); }
  finally { await handle?.close(); }
}
