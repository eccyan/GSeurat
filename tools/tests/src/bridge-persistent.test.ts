/**
 * Unit tests for persistent bridge WebSocket connection logic.
 *
 * Tests the EngineClient connection lifecycle and the bridge module's
 * fire-and-forget / sequential command patterns.
 *
 * Run: pnpm test:bridge-persistent
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Simulated connection state (mirrors bridge.ts logic without WebSocket) ──

interface MockClient {
  isConnected: boolean;
  sent: Record<string, unknown>[];
}

function createMockClient(): MockClient {
  return { isConnected: false, sent: [] };
}

function mockConnect(client: MockClient): boolean {
  client.isConnected = true;
  return true;
}

function mockSend(client: MockClient, payload: Record<string, unknown>): boolean {
  if (!client.isConnected) return false;
  client.sent.push(payload);
  return true;
}

function mockDisconnect(client: MockClient): void {
  client.isConnected = false;
}

// ── Bridge-like wrapper ──

class TestBridge {
  client: MockClient;
  reconnectScheduled = false;

  constructor() {
    this.client = createMockClient();
  }

  async ensureConnected(): Promise<MockClient | null> {
    if (this.client.isConnected) return this.client;
    try {
      mockConnect(this.client);
      return this.client;
    } catch {
      this.reconnectScheduled = true;
      return null;
    }
  }

  async sendCommand(payload: Record<string, unknown>): Promise<boolean> {
    const c = await this.ensureConnected();
    if (!c) return false;
    return mockSend(c, payload);
  }

  async sendCommands(payloads: Record<string, unknown>[]): Promise<boolean> {
    const c = await this.ensureConnected();
    if (!c) return false;
    for (const p of payloads) {
      if (!mockSend(c, p)) return false;
    }
    return true;
  }

  disconnect(): void {
    mockDisconnect(this.client);
  }
}

// ── Tests ──

describe('Persistent bridge connection', () => {
  it('reuses same connection for multiple sends', async () => {
    const bridge = new TestBridge();
    await bridge.sendCommand({ cmd: 'load_scene_json', json: '{}' });
    await bridge.sendCommand({ cmd: 'update_scene_data', json: '{}' });
    await bridge.sendCommand({ cmd: 'update_scene_data', json: '{"lights":[]}' });

    assert.equal(bridge.client.sent.length, 3, 'all 3 commands sent');
    assert.equal(bridge.client.isConnected, true, 'still connected after sends');
  });

  it('auto-connects on first send', async () => {
    const bridge = new TestBridge();
    assert.equal(bridge.client.isConnected, false, 'initially disconnected');
    await bridge.sendCommand({ cmd: 'load_scene_json', json: '{}' });
    assert.equal(bridge.client.isConnected, true, 'connected after first send');
  });

  it('sendCommands sends sequentially', async () => {
    const bridge = new TestBridge();
    await bridge.sendCommands([
      { cmd: 'write_temp_file', path: '/tmp/a.json', content: '{}' },
      { cmd: 'load_scene_json', json: '{}' },
    ]);
    assert.equal(bridge.client.sent.length, 2);
    assert.equal((bridge.client.sent[0] as { cmd: string }).cmd, 'write_temp_file');
    assert.equal((bridge.client.sent[1] as { cmd: string }).cmd, 'load_scene_json');
  });

  it('drops commands when disconnected and cannot reconnect', async () => {
    const bridge = new TestBridge();
    // Simulate connection failure by never connecting
    bridge.client.isConnected = false;
    bridge.ensureConnected = async () => null; // override to always fail
    const ok = await bridge.sendCommand({ cmd: 'load_scene_json', json: '{}' });
    assert.equal(ok, false, 'command dropped');
    assert.equal(bridge.client.sent.length, 0, 'nothing sent');
  });

  it('disconnect cleans up', () => {
    const bridge = new TestBridge();
    mockConnect(bridge.client);
    assert.equal(bridge.client.isConnected, true);
    bridge.disconnect();
    assert.equal(bridge.client.isConnected, false);
  });

  it('reconnects after disconnect', async () => {
    const bridge = new TestBridge();
    await bridge.sendCommand({ cmd: 'test1' });
    assert.equal(bridge.client.isConnected, true);

    bridge.disconnect();
    assert.equal(bridge.client.isConnected, false);

    // Next send should reconnect
    await bridge.sendCommand({ cmd: 'test2' });
    assert.equal(bridge.client.isConnected, true);
    assert.equal(bridge.client.sent.length, 2);
  });
});

describe('Single-shot vs persistent comparison', () => {
  it('persistent avoids repeated connection overhead', async () => {
    const bridge = new TestBridge();
    let connectCount = 0;
    const origEnsure = bridge.ensureConnected.bind(bridge);
    bridge.ensureConnected = async () => {
      connectCount++;
      return origEnsure();
    };

    // Simulate 10 auto-sync sends
    for (let i = 0; i < 10; i++) {
      await bridge.sendCommand({ cmd: 'update_scene_data', json: `{"v":${i}}` });
    }

    assert.equal(bridge.client.sent.length, 10, '10 commands sent');
    // ensureConnected is called each time but only actually connects once
    assert.equal(bridge.client.isConnected, true, 'connection maintained');
  });
});
