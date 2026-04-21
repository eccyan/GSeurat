import http from 'node:http';
import { type Express } from 'express';
import { type ProjectContext } from './context.js';

let testServer: http.Server | null = null;
let testPort = 0;

export async function startBridgeForTesting(app: Express, opts: { port: number }): Promise<void> {
  testServer = app.listen(opts.port);
  await new Promise<void>(r => testServer!.once('listening', () => r()));
  const addr = testServer!.address();
  testPort = typeof addr === 'object' && addr ? addr.port : 0;
}

export function getTestPort(): number {
  return testPort;
}

export async function stopBridgeForTesting(ctx: ProjectContext): Promise<void> {
  if (testServer) {
    await new Promise<void>(r => testServer!.close(() => r()));
    testServer = null;
    testPort = 0;
  }
  ctx.activeProjectDir = null;
}
