/**
 * Bridge Tool Routing — Integration test
 *
 * Tests the bridge's tool registration, routing, and /api/tools endpoint.
 * Requires the bridge to be running on ports 9100 (WS) and 9101 (HTTP).
 *
 * Usage: node --import tsx/esm --conditions source src/bridge-routing.test.ts
 */
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function connectWS(url: string, timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS connect timeout')), timeoutMs);
    const ws = new WebSocket(url);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function waitMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    failed++;
    console.log(`  FAIL  ${label}`);
    throw new Error(`Assertion failed: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failed++;
    console.log(`  FAIL  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function pass(label: string): void {
  passed++;
  console.log(`  PASS  ${label}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  const WS_URL = 'ws://localhost:9100';
  const HTTP_URL = 'http://localhost:9101';

  console.log('\n' + '='.repeat(60));
  console.log('  Bridge Tool Routing Integration Tests');
  console.log('='.repeat(60));

  // Check if bridge is running
  try {
    const resp = await fetch(`${HTTP_URL}/health`);
    if (!resp.ok) throw new Error('health check failed');
  } catch {
    console.log('  SKIP — Bridge not running on port 9101');
    console.log('         Start: cd apps/bridge && pnpm dev');
    process.exit(0);
  }

  // ------------------------------------------------------------------
  // Test 1: Tool registration
  // ------------------------------------------------------------------
  let toolWs: WebSocket;
  try {
    toolWs = await connectWS(WS_URL);

    // Register as a test tool
    toolWs.send(JSON.stringify({ type: 'register_tool', name: 'test-tool' }));
    const regResp = await waitMessage(toolWs);
    assertEqual(regResp['type'], 'registered', 'Registration response type');
    assertEqual(regResp['name'], 'test-tool', 'Registration response name');
    pass('Tool registration');
  } catch (err) {
    console.log(`  FAIL  Tool registration: ${err}`);
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // Test 2: /api/tools lists registered tool
  // ------------------------------------------------------------------
  try {
    const resp = await fetch(`${HTTP_URL}/api/tools`);
    const data = await resp.json() as { tools: string[] };
    assert(data.tools.includes('test-tool'), '/api/tools includes test-tool');
    pass('/api/tools endpoint');
  } catch (err) {
    console.log(`  FAIL  /api/tools: ${err}`);
    failed++;
  }

  // ------------------------------------------------------------------
  // Test 3: Health check includes tools
  // ------------------------------------------------------------------
  try {
    const resp = await fetch(`${HTTP_URL}/health`);
    const data = await resp.json() as { tools: string[] };
    assert(Array.isArray(data.tools), 'Health check has tools array');
    assert(data.tools.includes('test-tool'), 'Health check includes test-tool');
    pass('Health check includes tools');
  } catch (err) {
    console.log(`  FAIL  Health check tools: ${err}`);
    failed++;
  }

  // ------------------------------------------------------------------
  // Test 4: Message routing to registered tool
  // ------------------------------------------------------------------
  let clientWs: WebSocket;
  try {
    clientWs = await connectWS(WS_URL);

    // Client sends command targeting "test-tool"
    const cmdPromise = waitMessage(toolWs);
    clientWs.send(JSON.stringify({
      target: 'test-tool',
      cmd: 'get_state',
    }));

    // Tool should receive the forwarded message (with _bridge_id, without target)
    const forwarded = await cmdPromise;
    assertEqual(forwarded['cmd'], 'get_state', 'Forwarded command');
    assert('_bridge_id' in forwarded, 'Forwarded has _bridge_id');
    assert(!('target' in forwarded), 'target field stripped from forwarded message');
    pass('Message routing to tool');

    // ------------------------------------------------------------------
    // Test 5: Tool response routes back to originating client
    // ------------------------------------------------------------------
    const responsePromise = waitMessage(clientWs);
    toolWs.send(JSON.stringify({
      type: 'response',
      cmd: 'get_state',
      data: { test: true },
      _bridge_id: forwarded['_bridge_id'],
    }));

    const response = await responsePromise;
    assertEqual(response['type'], 'response', 'Response type');
    assertEqual(response['cmd'], 'get_state', 'Response cmd');
    assert(!('_bridge_id' in response), '_bridge_id stripped from response');
    const respData = response['data'] as Record<string, unknown>;
    assertEqual(respData['test'], true, 'Response data preserved');
    pass('Response routing back to client');

    clientWs.close();
  } catch (err) {
    console.log(`  FAIL  Message routing: ${err}`);
    failed++;
  }

  // ------------------------------------------------------------------
  // Test 6: Routing to non-existent tool returns error
  // ------------------------------------------------------------------
  try {
    const errClient = await connectWS(WS_URL);
    const errPromise = waitMessage(errClient);
    errClient.send(JSON.stringify({
      target: 'nonexistent-tool',
      cmd: 'test',
    }));

    const errResp = await errPromise;
    assertEqual(errResp['type'], 'error', 'Non-existent tool returns error');
    assert(
      (errResp['error'] as string).includes('nonexistent-tool'),
      'Error mentions tool name',
    );
    pass('Non-existent tool error');
    errClient.close();
  } catch (err) {
    console.log(`  FAIL  Non-existent tool error: ${err}`);
    failed++;
  }

  // ------------------------------------------------------------------
  // Test 7: Multiple commands with correlation
  // ------------------------------------------------------------------
  try {
    const multiClient = await connectWS(WS_URL);

    // Send two commands rapidly
    const cmd1Promise = waitMessage(toolWs);
    multiClient.send(JSON.stringify({ target: 'test-tool', cmd: 'cmd_a' }));
    const fwd1 = await cmd1Promise;

    const cmd2Promise = waitMessage(toolWs);
    multiClient.send(JSON.stringify({ target: 'test-tool', cmd: 'cmd_b' }));
    const fwd2 = await cmd2Promise;

    // Respond to cmd_b first (out of order)
    const resp2Promise = waitMessage(multiClient);
    toolWs.send(JSON.stringify({
      type: 'response',
      cmd: 'cmd_b',
      _bridge_id: fwd2['_bridge_id'],
    }));
    const r2 = await resp2Promise;
    assertEqual(r2['cmd'], 'cmd_b', 'Out-of-order response: cmd_b');

    // Respond to cmd_a
    const resp1Promise = waitMessage(multiClient);
    toolWs.send(JSON.stringify({
      type: 'response',
      cmd: 'cmd_a',
      _bridge_id: fwd1['_bridge_id'],
    }));
    const r1 = await resp1Promise;
    assertEqual(r1['cmd'], 'cmd_a', 'Out-of-order response: cmd_a');

    pass('Multiple commands with correlation');
    multiClient.close();
  } catch (err) {
    console.log(`  FAIL  Multiple commands: ${err}`);
    failed++;
  }

  // Cleanup
  toolWs.close();
  await sleep(100);

  // ------------------------------------------------------------------
  // Test 8: After tool disconnect, /api/tools no longer lists it
  // ------------------------------------------------------------------
  try {
    await sleep(500); // Wait for disconnect to propagate
    const resp = await fetch(`${HTTP_URL}/api/tools`);
    const data = await resp.json() as { tools: string[] };
    assert(!data.tools.includes('test-tool'), 'test-tool removed after disconnect');
    pass('Tool removed after disconnect');
  } catch (err) {
    console.log(`  FAIL  Tool removal: ${err}`);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`  SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
