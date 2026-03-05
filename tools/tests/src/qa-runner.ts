/**
 * QA Test Runner — connects to each tool's test harness WebSocket and
 * executes automated test scenarios.
 *
 * Usage:
 *   pnpm test                           # Run all tool tests (unit + scenario)
 *   pnpm test --tool keyframe-animator  # Run one tool's tests
 *   pnpm test --scenario                # Run only scenario tests
 *   pnpm test --tool sfx-designer --scenario  # One tool, scenarios only
 */
import { existsSync } from 'fs';
import { TestClient } from '@vulkan-game-tools/test-harness/client';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { runLevelDesignerTests } from './level-designer.test.js';
import { runKeyframeAnimatorTests } from './keyframe-animator.test.js';
import { runPixelPainterTests } from './pixel-painter.test.js';
import { runParticleDesignerTests } from './particle-designer.test.js';
import { runAudioComposerTests } from './audio-composer.test.js';
import { runSfxDesignerTests } from './sfx-designer.test.js';
import { runLevelDesignerScenarios } from './level-designer.scenario.js';
import { runPixelPainterScenarios } from './pixel-painter.scenario.js';
import { runKeyframeAnimatorScenarios } from './keyframe-animator.scenario.js';
import { runParticleDesignerScenarios } from './particle-designer.scenario.js';
import { runAudioComposerScenarios } from './audio-composer.scenario.js';
import { runSfxDesignerScenarios } from './sfx-designer.scenario.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface TestSuite {
  tool: string;
  port: number;
  results: TestResult[];
}

export type TestFn = (client: TestClient) => Promise<void>;

/**
 * Helper to define and collect test cases.
 */
export class TestRunner {
  private tests: Array<{ name: string; fn: TestFn }> = [];

  test(name: string, fn: TestFn): void {
    this.tests.push({ name, fn });
  }

  async run(client: TestClient): Promise<TestResult[]> {
    const results: TestResult[] = [];
    for (const { name, fn } of this.tests) {
      try {
        await fn(client);
        results.push({ name, passed: true });
      } catch (err) {
        results.push({
          name,
          passed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }
}

/**
 * Simple assertion helpers.
 */
export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertTruthy(value: unknown, label: string): void {
  if (!value) {
    throw new Error(`${label}: expected truthy value, got ${JSON.stringify(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Chrome discovery
// ---------------------------------------------------------------------------

function findChromePath(): string {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    'Chrome/Chromium not found. Install Chrome or set CHROME_PATH env var.',
  );
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  devPort: number;
  testPort: number;
  runUnit: (runner: TestRunner) => void;
  runScenarios: (runner: TestRunner) => void;
}

const TOOLS: ToolDef[] = [
  { name: 'level-designer', devPort: 5173, testPort: 6173, runUnit: runLevelDesignerTests, runScenarios: runLevelDesignerScenarios },
  { name: 'pixel-painter', devPort: 5174, testPort: 6174, runUnit: runPixelPainterTests, runScenarios: runPixelPainterScenarios },
  { name: 'keyframe-animator', devPort: 5175, testPort: 6175, runUnit: runKeyframeAnimatorTests, runScenarios: runKeyframeAnimatorScenarios },
  { name: 'particle-designer', devPort: 5176, testPort: 6176, runUnit: runParticleDesignerTests, runScenarios: runParticleDesignerScenarios },
  { name: 'audio-composer', devPort: 5177, testPort: 6177, runUnit: runAudioComposerTests, runScenarios: runAudioComposerScenarios },
  { name: 'sfx-designer', devPort: 5178, testPort: 6178, runUnit: runSfxDesignerTests, runScenarios: runSfxDesignerScenarios },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait for the test client to successfully ping the browser bridge.
 */
async function waitForBrowserBridge(
  client: TestClient,
  timeoutMs = 15000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = await client.ping();
      if (ok) return true;
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const toolFilter = args.includes('--tool') ? args[args.indexOf('--tool') + 1] : null;
  const scenarioOnly = args.includes('--scenario');

  const toolsToRun = toolFilter
    ? TOOLS.filter((t) => t.name === toolFilter)
    : TOOLS;

  if (toolsToRun.length === 0) {
    console.error(`Unknown tool: ${toolFilter}`);
    console.error(`Available: ${TOOLS.map((t) => t.name).join(', ')}`);
    process.exit(1);
  }

  // Launch headless Chrome
  const chromePath = process.env.CHROME_PATH || findChromePath();
  console.log(`Using Chrome: ${chromePath}`);

  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
  } catch (err) {
    console.error('Failed to launch Chrome:', err);
    process.exit(1);
  }

  const suites: TestSuite[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  const pages: Page[] = [];

  for (const tool of toolsToRun) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${tool.name} (dev:${tool.devPort} test:${tool.testPort})`);
    console.log('='.repeat(60));

    // Check if dev server is running
    const client = new TestClient(tool.testPort);
    try {
      await client.connect(3000);
    } catch {
      console.log(`  SKIP — Dev server not running on port ${tool.testPort}`);
      console.log(`         Start: cd apps/${tool.name} && pnpm dev`);
      suites.push({ tool: tool.name, port: tool.testPort, results: [] });
      continue;
    }

    // Open the tool in headless Chrome so the browser bridge connects
    console.log(`  Opening http://localhost:${tool.devPort}/ in headless Chrome...`);
    let page: Page;
    try {
      page = await browser.newPage();
      pages.push(page);
      // Capture browser console for debugging
      page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('test-harness')) {
          console.log(`  [browser] ${text}`);
        }
      });
      page.on('pageerror', (err) => {
        console.log(`  [browser error] ${err.message}`);
      });
      await page.goto(`http://localhost:${tool.devPort}/`, {
        waitUntil: 'networkidle2',
        timeout: 15000,
      });
    } catch (err) {
      console.log(`  SKIP — Failed to load page: ${err instanceof Error ? err.message : err}`);
      client.disconnect();
      suites.push({ tool: tool.name, port: tool.testPort, results: [] });
      continue;
    }

    // Wait for the browser bridge to connect
    console.log('  Waiting for browser bridge...');
    const bridgeReady = await waitForBrowserBridge(client);
    if (!bridgeReady) {
      console.log('  SKIP — Browser bridge did not connect in time');
      client.disconnect();
      suites.push({ tool: tool.name, port: tool.testPort, results: [] });
      continue;
    }

    console.log('  Running tests...');
    const runner = new TestRunner();
    if (!scenarioOnly) {
      tool.runUnit(runner);
    }
    tool.runScenarios(runner);
    const results = await runner.run(client);

    for (const r of results) {
      if (r.passed) {
        totalPassed++;
        console.log(`  PASS  ${r.name}`);
      } else {
        totalFailed++;
        console.log(`  FAIL  ${r.name}`);
        console.log(`        ${r.error}`);
      }
    }

    suites.push({ tool: tool.name, port: tool.testPort, results });
    client.disconnect();
  }

  // Clean up
  for (const page of pages) {
    await page.close().catch(() => {});
  }
  await browser.close().catch(() => {});

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SUMMARY: ${totalPassed} passed, ${totalFailed} failed`);
  console.log('='.repeat(60));

  for (const suite of suites) {
    const passed = suite.results.filter((r) => r.passed).length;
    const failed = suite.results.filter((r) => !r.passed).length;
    const skipped = suite.results.length === 0;
    if (skipped) {
      console.log(`  ${suite.tool}: SKIPPED (not running)`);
    } else {
      console.log(`  ${suite.tool}: ${passed} passed, ${failed} failed`);
    }
  }

  // Output JSON results
  const jsonPath = 'qa-results.json';
  const { writeFileSync } = await import('fs');
  writeFileSync(jsonPath, JSON.stringify(suites, null, 2));
  console.log(`\nResults written to ${jsonPath}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
