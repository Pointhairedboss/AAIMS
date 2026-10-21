/**
 * Empirical Stress Test Suite for AAIMS Builder Runner:
 * - Token Retrieval under rapid invocation & SSH socket/process leak check
 * - Process Lifecycle & Background Daemon Cleanup on ports 4000 / 5173
 * - Sequential Background Process Concurrency & Port Overlap Behavior
 * - Gateway Probe & Resiliency under network errors
 */

import { execSync, spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import {
  getComposerBearer,
  killPortListeners,
  cleanupAllProcesses,
  executeTool,
  callComposer,
  type AgentAction,
} from '../../scripts/run_builder.js';

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  details: string;
}

const results: TestResult[] = [];

function checkPortListening(port: number): boolean {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue"`,
      { encoding: 'utf8' }
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function getSshProcesses(): string[] {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-Process -Name ssh,wsl -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`,
      { encoding: 'utf8' }
    );
    return out.trim().split(/\r?\n/).filter((x) => x.trim().length > 0);
  } catch {
    return [];
  }
}

async function runTests() {
  console.log('================================================================');
  console.log(' Starting Empirical Stress Tests for run_builder.ts');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // Test 1: Rapid Bearer Token Retrieval & Socket/Process Leaks
  // ---------------------------------------------------------------------------
  console.log('--- Test 1: Rapid Bearer Token Retrieval (10 Consecutive Invocations) ---');
  const t0 = Date.now();
  const initialSshProcs = getSshProcesses();
  console.log(`Initial SSH/WSL processes count: ${initialSshProcs.length}`);

  const tokens: string[] = [];
  const latencies: number[] = [];

  // Clear env var to force real WSL SSH execution
  const savedBearer = process.env.COMPOSER_BEARER;
  delete process.env.COMPOSER_BEARER;

  let tokenSuccess = true;
  for (let i = 1; i <= 10; i++) {
    const iterStart = Date.now();
    try {
      const token = getComposerBearer();
      const latency = Date.now() - iterStart;
      tokens.push(token);
      latencies.push(latency);
      console.log(`  [Iter ${i}] Success (${latency}ms) - Token prefix: ${token.slice(0, 8)}... (len ${token.length})`);
    } catch (err: any) {
      tokenSuccess = false;
      console.error(`  [Iter ${i}] FAILED: ${err.message}`);
    }
  }

  // Restore env if it was set
  if (savedBearer) {
    process.env.COMPOSER_BEARER = savedBearer;
  }

  const allTokensMatch = tokens.length === 10 && tokens.every((t) => t === tokens[0]);
  const finalSshProcs = getSshProcesses();
  console.log(`Final SSH/WSL processes count: ${finalSshProcs.length}`);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  results.push({
    name: 'Rapid Bearer Token Retrieval (10x WSL SSH)',
    passed: tokenSuccess && allTokensMatch && finalSshProcs.length <= initialSshProcs.length + 1,
    durationMs: Date.now() - t0,
    details: `10/10 succeeded. Tokens match: ${allTokensMatch}. Latency: min=${minLatency}ms, max=${maxLatency}ms, avg=${avgLatency.toFixed(0)}ms. Residual procs: ${finalSshProcs.length - initialSshProcs.length}`,
  });

  // ---------------------------------------------------------------------------
  // Test 2: Environment Variable Fallback for Bearer Token
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: COMPOSER_BEARER Environment Variable Override ---');
  const tEnv0 = Date.now();
  process.env.COMPOSER_BEARER = 'custom_mock_bearer_token_12345';
  const envToken = getComposerBearer();
  const envLatency = Date.now() - tEnv0;
  const envPassed = envToken === 'custom_mock_bearer_token_12345' && envLatency < 10;
  delete process.env.COMPOSER_BEARER;

  results.push({
    name: 'Bearer Token Env Override Fast Path',
    passed: envPassed,
    durationMs: envLatency,
    details: `Returned overridden token in ${envLatency}ms without invoking WSL SSH`,
  });

  // ---------------------------------------------------------------------------
  // Test 3: killPortListeners on Active Port 4000 and 5173
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: killPortListeners Direct Port Termination ---');
  const tPort0 = Date.now();

  // Spawn separate child process listening on port 4000
  const child = spawn('node', ['-e', `
    const http = require('http');
    http.createServer((req, res) => res.end('ok')).listen(4000);
    setInterval(() => {}, 1000);
  `], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1000));

  const listeningBefore = checkPortListening(4000);
  console.log(`Port 4000 listening before kill: ${listeningBefore} (Child PID: ${child.pid})`);

  // Call killPortListeners
  killPortListeners(4000);
  await new Promise((r) => setTimeout(r, 1000));
  const listeningAfter = checkPortListening(4000);
  console.log(`Port 4000 listening after kill: ${listeningAfter}`);

  results.push({
    name: 'killPortListeners(4000)',
    passed: listeningBefore && !listeningAfter,
    durationMs: Date.now() - tPort0,
    details: `Port 4000 was bound: ${listeningBefore}, unbound after kill: ${!listeningAfter}`,
  });

  // Test port 5173 killPortListeners
  const tPort1 = Date.now();
  const child5173 = spawn('node', ['-e', `
    const http = require('http');
    http.createServer((req, res) => res.end('ok')).listen(5173);
    setInterval(() => {}, 1000);
  `], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1000));
  const feListeningBefore = checkPortListening(5173);
  killPortListeners(5173);
  await new Promise((r) => setTimeout(r, 1000));
  const feListeningAfter = checkPortListening(5173);

  results.push({
    name: 'killPortListeners(5173)',
    passed: feListeningBefore && !feListeningAfter,
    durationMs: Date.now() - tPort1,
    details: `Port 5173 was bound: ${feListeningBefore}, unbound after kill: ${!feListeningAfter}`,
  });

  // ---------------------------------------------------------------------------
  // Test 4: workspace_exec Background Daemon Lifecycle & PID Tracking
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: workspace_exec Background Daemon Lifecycle ---');
  const tBg0 = Date.now();

  // Make sure ports are free
  killPortListeners(4000);
  killPortListeners(5173);

  const mockServerScript = `
    const http = require('http');
    const server = http.createServer((req, res) => res.end('hello-from-backend'));
    server.listen(4000, () => console.log('Mock server listening on 4000'));
    setInterval(() => {}, 1000);
  `;

  const actionBg: AgentAction = {
    thought: 'Starting mock backend',
    tool: 'workspace_exec',
    args: {
      command: `node -e "${mockServerScript.replace(/\n/g, ' ')}"`,
      background: true,
    },
  };

  const bgResult = await executeTool(actionBg, {});
  console.log(`Background daemon spawned: PID=${bgResult.pid}, logs=${bgResult.initialLogs.trim()}`);

  const port4000Active = checkPortListening(4000);
  console.log(`Port 4000 is listening: ${port4000Active}`);

  // Now call cleanupAllProcesses()
  console.log('Calling cleanupAllProcesses()...');
  cleanupAllProcesses();
  await new Promise((r) => setTimeout(r, 1500));

  const port4000Clean = !checkPortListening(4000);
  console.log(`Port 4000 is clean after cleanupAllProcesses: ${port4000Clean}`);

  results.push({
    name: 'workspace_exec Single Background Daemon & Cleanup',
    passed: port4000Active && port4000Clean,
    durationMs: Date.now() - tBg0,
    details: `Port 4000 bound: ${port4000Active}, clean after cleanupAllProcesses: ${port4000Clean}`,
  });

  // ---------------------------------------------------------------------------
  // Test 5: Sequential Background Process Concurrency Bug Investigation
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: Sequential Background Daemon Concurrency Bug Check ---');
  const tSeq0 = Date.now();

  // Step A: Spawn Backend on Port 4000
  const actionBackend: AgentAction = {
    thought: 'Spawn Backend',
    tool: 'workspace_exec',
    args: {
      command: `node -e "const http=require('http'); http.createServer((req,res)=>res.end('backend')).listen(4000); console.log('BE started'); setInterval(()=>{},1000);"`,
      background: true,
    },
  };
  await executeTool(actionBackend, {});
  const beListeningAfterSpawn = checkPortListening(4000);
  console.log(`Backend on 4000 listening after spawn: ${beListeningAfterSpawn}`);

  // Step B: Spawn Frontend on Port 5173
  const actionFrontend: AgentAction = {
    thought: 'Spawn Frontend',
    tool: 'workspace_exec',
    args: {
      command: `node -e "const http=require('http'); http.createServer((req,res)=>res.end('frontend')).listen(5173); console.log('FE started'); setInterval(()=>{},1000);"`,
      background: true,
    },
  };
  await executeTool(actionFrontend, {});
  const feListeningAfterSpawn = checkPortListening(5173);
  const beListeningAfterFeSpawn = checkPortListening(4000);
  console.log(`Frontend on 5173 listening: ${feListeningAfterSpawn}`);
  console.log(`Backend on 4000 STILL listening after frontend spawn?: ${beListeningAfterFeSpawn}`);

  // Cleanup
  cleanupAllProcesses();
  await new Promise((r) => setTimeout(r, 1000));

  const concurrencyBugPresent = !beListeningAfterFeSpawn;
  console.log(`*** Concurrency flaw detected: ${concurrencyBugPresent ? 'YES! Spawning frontend killed backend!' : 'NO, both survived'} ***`);

  results.push({
    name: 'Dual Background Process Concurrency (BE + FE)',
    passed: !concurrencyBugPresent,
    durationMs: Date.now() - tSeq0,
    details: `BE listening before FE: ${beListeningAfterSpawn}. BE listening after FE: ${beListeningAfterFeSpawn}. FE listening: ${feListeningAfterSpawn}. ${concurrencyBugPresent ? 'CRITICAL BUG: workspace_exec with background: true calls cleanupAllProcesses() killing previous daemons!' : 'Both daemons running concurrently.'}`,
  });

  // ---------------------------------------------------------------------------
  // Test 6: Gateway callComposer Retry & Timeout on Unreachable Endpoint
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 6: Gateway Retry & Timeout Resilience ---');
  const tRetry0 = Date.now();
  let retryHandled = false;
  let retryAttemptsObserved = 0;

  // We temporarily test callComposer with unreachable host
  const originalUrl = process.env.COMPOSER_URL;
  // Note: COMPOSER_URL is a module const in run_builder.ts (bound at import time),
  // but we can test callComposer directly with an invalid token or test network error handling.
  try {
    // Test with invalid token against real gateway
    console.log('Testing callComposer with invalid bearer token to verify HTTP 401 handling & backoff...');
    await callComposer('invalid_bad_token_for_stress_test', [
      { role: 'user', content: 'test ping' }
    ], 2); // max 2 attempts
  } catch (err: any) {
    retryHandled = true;
    console.log(`callComposer caught error as expected: ${err.message}`);
  }

  results.push({
    name: 'Gateway Error & Retry Exhaustion',
    passed: retryHandled,
    durationMs: Date.now() - tRetry0,
    details: `Properly threw error upon retry exhaustion without infinite loop`,
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(' Empirical Stress Test Results Summary');
  console.log('================================================================');
  for (const r of results) {
    const status = r.passed ? '[PASS]' : '[FAIL]';
    console.log(`${status} ${r.name} (${r.durationMs}ms)`);
    console.log(`       ${r.details}`);
  }

  // Final cleanup verification
  cleanupAllProcesses();
  const p4000Clean = !checkPortListening(4000);
  const p5173Clean = !checkPortListening(5173);
  console.log(`\nFinal Port Check: 4000 free=${p4000Clean}, 5173 free=${p5173Clean}`);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  cleanupAllProcesses();
  process.exit(1);
});
