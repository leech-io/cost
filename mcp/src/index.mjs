import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, readCredentials } from './config.mjs';
import { createCostClient } from './client.mjs';
import { createTools } from './tools.mjs';
import { createServer } from './server.mjs';
import { publicError } from './errors.mjs';

const shutdown = new AbortController();
let server;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  shutdown.abort();
  await server?.close();
  process.stdin.destroy();
}
try {
  const config = loadConfig();
  await readCredentials(config);
  server = createServer({ tools: createTools(createCostClient(config), { shutdownSignal: shutdown.signal }) });
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  process.stdin.once('end', close);
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(JSON.stringify(publicError(error)));
  process.exitCode = 1;
  await close();
}
