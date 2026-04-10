import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  startBridgeForTesting,
  stopBridgeForTesting,
  getActiveProjectDir,
  getTestPort,
} from '../src/index.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gseurat-bridge-test-'));
  await fs.mkdir(path.join(tmpRoot, 'assets', 'scenes'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'assets', 'textures'), { recursive: true });
  await startBridgeForTesting({ port: 0 });
});

afterEach(async () => {
  await stopBridgeForTesting();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function postJson(port: number, urlPath: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data).toString(),
      },
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: buf });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getRequest(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'GET',
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('POST /api/project/root', () => {
  it('sets activeProjectDir and returns 200', async () => {
    const port = getTestPort();
    const res = await postJson(port, '/api/project/root', { path: tmpRoot });
    expect(res.status).toBe(200);
    expect(getActiveProjectDir()).toBe(tmpRoot);
  });

  it('rejects missing path with 400', async () => {
    const port = getTestPort();
    const res = await postJson(port, '/api/project/root', {});
    expect(res.status).toBe(400);
  });

  it('rejects nonexistent directory with 400', async () => {
    const port = getTestPort();
    const res = await postJson(port, '/api/project/root', {
      path: '/no/such/dir/anywhere/nonexistent_12345_xyz',
    });
    expect(res.status).toBe(400);
  });
});

describe('endpoint asset paths reflect active project root', () => {
  it('GET /api/files/scenes/:name reads from <activeProjectDir>/assets/scenes', async () => {
    const port = getTestPort();
    await postJson(port, '/api/project/root', { path: tmpRoot });

    // Write a test scene file under the test root
    await fs.writeFile(
      path.join(tmpRoot, 'assets', 'scenes', 'town.json'),
      '{"hello":"world"}',
    );

    const res = await getRequest(port, '/api/files/scenes/town');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ hello: 'world' });
  });
});
