/**
 * AAIMS Zero-Knowledge Autonomous Builder Loop
 *
 * Driven by: composer-2.5[fast=true] (via Cursor ACP Gateway at http://192.168.1.7:8085/v1/chat/completions)
 * Target:    c:\code\projects\AAIMS
 * Spec:      docs/AAIMS_POC_SPEC.md + https://www.bitbop.dev/llms.txt (Sole Authoritative Inputs)
 *
 * Architecture:
 * - Pure plain-text JSON controller via strict Cursor ACP tool interception defense.
 * - Zero-knowledge discovery of BitBop post-quantum endpoints via http_read.
 * - Monorepo orchestration: Node.js/Express backend (port 4000) + React/Vite frontend (port 5173).
 * - Process supervision with Windows PowerShell port clearing and PID tree cleanup.
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 1. Interfaces & Types
// ---------------------------------------------------------------------------

export type ToolName =
  | 'http_read'
  | 'workspace_write_file'
  | 'workspace_read_file'
  | 'workspace_exec'
  | 'done';

export interface AgentAction {
  thought: string;
  tool: ToolName;
  args: Record<string, any>;
}

export interface HistoryEntry {
  turn: number;
  action: AgentAction;
  resultSummary: any;
  durationMs?: number;
}

export interface BuilderReport {
  timestamp: string;
  model: string;
  projectRoot: string;
  totalTurns: number;
  completed: boolean;
  summary?: string;
  verificationStatus?: Record<string, boolean>;
  history: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// 2. Constants & Configuration
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const COMPOSER_URL = process.env.COMPOSER_URL || 'http://192.168.1.7:8085/v1/chat/completions';
const COMPOSER_MODEL = process.env.COMPOSER_MODEL || 'composer-2.5[fast=true]';
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '4000', 10);
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '5173', 10);

const LLM_TIMEOUT_SEC = 90;
const CMD_TIMEOUT_MS = 90000;

// Parse CLI flags
const isProbe = process.argv.includes('--probe') || process.argv.includes('--ping');
const maxTurnsFlagIndex = process.argv.findIndex((arg) => arg === '--max-turns' || arg === '-n');
const maxTurnsArg = maxTurnsFlagIndex !== -1 ? process.argv[maxTurnsFlagIndex + 1] : undefined;
const MAX_TURNS = maxTurnsArg ? parseInt(maxTurnsArg, 10) : isProbe ? 1 : 60;

// ---------------------------------------------------------------------------
// 3. Process Management & Port Guards
// ---------------------------------------------------------------------------

const backgroundProcs: ChildProcess[] = [];

/**
 * Forcefully terminates any process holding a specific TCP port on Windows.
 */
export function killPortListeners(port: number): void {
  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore' }
      );
    } catch {
      // Ignored: Port was already free
    }
  }
}

/**
 * Cleans up all spawned background processes and frees managed ports.
 */
export function cleanupAllProcesses(): void {
  for (const proc of backgroundProcs) {
    try {
      if (proc.pid) {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
        } else {
          proc.kill('SIGKILL');
        }
      }
    } catch {
      // Process may already have terminated
    }
  }
  backgroundProcs.length = 0;
  killPortListeners(BACKEND_PORT);
  killPortListeners(FRONTEND_PORT);
}

// Ensure cleanup on shutdown
process.on('SIGINT', () => {
  cleanupAllProcesses();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupAllProcesses();
  process.exit(143);
});
process.on('exit', () => {
  cleanupAllProcesses();
});

// ---------------------------------------------------------------------------
// 4. Bearer Token Retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieves the bearer token for composer-2.5 via environment variable or WSL SSH gateway probe.
 */
export function getComposerBearer(): string {
  if (process.env.COMPOSER_BEARER && process.env.COMPOSER_BEARER.trim().length > 0) {
    return process.env.COMPOSER_BEARER.trim();
  }

  try {
    const out = execSync(
      `wsl -e ssh -o BatchMode=yes inferadmin@192.168.1.18 "ssh -n -o BatchMode=yes 192.168.1.7 'cat /home/inferadmin/opt/hermes/cursor-acp-gateway/bearer'"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const token = out.trim();
    if (!token) {
      throw new Error('WSL SSH returned empty bearer token.');
    }
    return token;
  } catch (err: any) {
    throw new Error(
      `Failed to retrieve composer-2.5 bearer token: ${err.message}. Ensure WSL and SSH connectivity to 192.168.1.18 are active or set COMPOSER_BEARER.`
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Response Extraction & Parser Robustness
// ---------------------------------------------------------------------------

/**
 * Robust JSON action extractor.
 * 1. Checks markdown JSON code fences first (```json ... ``` or ``` ... ```).
 * 2. Scans for balanced-brace JSON objects containing a 'tool' property.
 * Robust against leading markdown, conversational text, and pre-JSON TypeScript interfaces.
 */
export function extractFirstJsonObject(str: string): string | null {
  // Strategy 1: Check markdown code fences containing JSON
  const fenceMatches = str.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi);
  for (const match of fenceMatches) {
    const candidate = match[1].trim();
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && typeof parsed.tool === 'string') {
        return candidate;
      }
    } catch {
      // Continue
    }
  }

  // Strategy 2: Scan through all balanced-brace candidates
  let fallbackJson: string | null = null;
  for (let start = 0; start < str.length; start++) {
    if (str[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = str.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object') {
              if (typeof parsed.tool === 'string') {
                return candidate;
              }
              if (!fallbackJson) {
                fallbackJson = candidate;
              }
            }
          } catch {
            // Not valid JSON, continue scanning
          }
          break; // break inner loop, advance start
        }
      }
    }
  }

  return fallbackJson;
}

/**
 * Parses raw LLM completion into a typed AgentAction, stripping <think>...</think> reasoning blocks.
 * Handles unclosed <think> tags gracefully.
 */
export function parseComposerResponse(rawContent: string): AgentAction {
  // Strip reasoning thoughts (including unclosed <think> blocks)
  let cleaned = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (cleaned.includes('<think>')) {
    cleaned = cleaned.replace(/<think>[\s\S]*?(?=(?:```|\{\s*"(?:thought|tool)"))/i, '').trim();
    cleaned = cleaned.replace(/<\/?think>/gi, '').trim();
  }

  // Extract JSON
  const jsonStr = extractFirstJsonObject(cleaned);
  if (!jsonStr) {
    throw new Error(`Failed to extract valid JSON action from response: ${rawContent.slice(0, 300)}`);
  }

  const parsed = JSON.parse(jsonStr);
  if (!parsed.tool || typeof parsed.tool !== 'string') {
    throw new Error(`Response JSON missing valid 'tool' property: ${jsonStr.slice(0, 200)}`);
  }

  return {
    thought: parsed.thought || '',
    tool: parsed.tool as ToolName,
    args: parsed.args || {},
  };
}

// ---------------------------------------------------------------------------
// 6. Gateway Communication
// ---------------------------------------------------------------------------

/**
 * Calls composer-2.5[fast=true] with retry logic, exponential backoff, and timeouts.
 */
export async function callComposer(
  bearer: string,
  messages: { role: string; content: string }[],
  maxAttempts = 5
): Promise<{ action: AgentAction; rawText: string; latencyMs: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(COMPOSER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          model: COMPOSER_MODEL,
          messages,
          stream: false,
          timeout: LLM_TIMEOUT_SEC,
        }),
        signal: AbortSignal.timeout((LLM_TIMEOUT_SEC + 10) * 1000),
      });

      const latencyMs = Date.now() - t0;

      if (!res.ok) {
        const errText = await res.text();
        if (attempt < maxAttempts) {
          const delay = attempt * 3000;
          console.warn(`[Composer] Attempt ${attempt} HTTP ${res.status}, retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Composer HTTP ${res.status}: ${errText.slice(0, 400)}`);
      }

      const data = (await res.json()) as any;
      const rawContent: string = data?.choices?.[0]?.message?.content || '';
      const action = parseComposerResponse(rawContent);
      return { action, rawText: rawContent, latencyMs };
    } catch (err: any) {
      if (attempt < maxAttempts) {
        const delay = attempt * 3000;
        console.warn(`[Composer] Attempt ${attempt} error: ${err.message}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable: callComposer exhausted retries.');
}

// ---------------------------------------------------------------------------
// 7. System Prompt Specification (Cursor ACP Defense & Spec Guard)
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `CRITICAL RUNTIME RULE: Do NOT invoke any built-in Cursor tools, MCP tools, terminal commands, file reads, or web fetches yourself! You are acting strictly as a pure text JSON controller. Reply immediately in plain text with ONLY a single JSON object matching {"thought": "...", "tool": "...", "args": {...}}.

You are an expert autonomous software engineer building the corporate-grade AAIMS (AIMI — Australian AI Management & Safety Interface) application.
Your target workspace is the current project directory (c:\\code\\projects\\AAIMS).
You have ZERO prior knowledge of the BitBop API and must discover it using http_read.

### YOUR AUTHORITATIVE SPECIFICATIONS
1. Project Specification: docs/AAIMS_POC_SPEC.md (Read this with workspace_read_file)
2. BitBop Public API: https://www.bitbop.dev/llms.txt (Read this with http_read)
DO NOT read or request any other specifications.

### YOUR MANDATORY BUILD PHASES

Phase 1 — Discovery & Initial Setup (Turns 1–5):
- Read docs/AAIMS_POC_SPEC.md using workspace_read_file.
- Read https://www.bitbop.dev/llms.txt using http_read to discover BitBop API endpoints (/api/keys/free, /consume, /verify, /attestation).
- Set up root package.json and project directories (server/, client/, tests/).

Phase 2 — Backend Service & Domain Model (Turns 6–22):
- Implement Node.js/Express server (server/src/server.ts) on PORT 4000.
- Implement strict Three-Object Domain Model (SOLUTION, CAPABILITY, CONTROL) with SQLite storage (use built-in node:sqlite).
- Enforce the 3 core invariants:
  1. Solution cannot advance past Stage 4 without >= 1 Capability; cannot advance past Stage 5 or be approved (Stage 7) without >= 1 Control and active controls on all linked capabilities (HTTP 400).
  2. Capability cannot be set to AUTHORISED without >= 1 active Control (HTTP 400).
  3. Controls attach directly to Capabilities independently of Solutions.
- Pre-seed database with NAIC May Update (10 Guardrails with G8 DEV/DEP split, AI6 6 Essential Practices, AI Working Group hierarchy).
- Implement supporting governance endpoints: Requests, Meeting Decisions, Risk/NAIC Assessments, Breaches & Remediations, Compliance Audits.
- Implement BitBop Post-Quantum Client (server/src/bitbop.ts):
  - On startup, self-provision free API key via POST https://api.bitbop.dev/api/keys/free using ML-KEM-768 (mlkem package) + AES-256-GCM decapsulation.
  - Attest all 7 governance events via live POST https://api.bitbop.dev/consume (ML-DSA-44 signature, beacon_sequence > 0).
  - Provide live verification endpoint calling POST https://api.bitbop.dev/verify.

Phase 3 — Corporate React Frontend (Turns 23–40):
- Build React + Vite corporate UI (client/) on PORT 5173.
- Professional enterprise styling (executive slate/navy palette, status badges, clean typography).
- Features:
  - 3-Object Navigation: Solutions, Capabilities, Controls (all with Named Owners).
  - 9-Stage Working Group Stepper (Request -> Investigate -> Assign Owner -> Identify Capabilities -> Apply Controls -> Assess -> Approve -> Implement -> Review).
  - Delegated Approval Authority verification at Stage 7 based on Solution risk tier.
  - Interactive "Verify on BitBop" modal displaying beacon_sequence, ML-DSA-44 status, live /verify check, and deep-link to https://www.bitbop.dev/provenance?sequence=...
  - "Powered by BitBop" footer link.
  - Governance Workspaces: Breach logging & remediation workflow, Compliance Audit checklist.

Phase 4 — Integration & Playwright Test Verification (Turns 41–55):
- Launch backend on port 4000 (workspace_exec with background: true).
- Launch frontend on port 5173 (workspace_exec with background: true).
- Execute programmatic invariant API tests: npm run test:api.
- Execute Playwright browser E2E tests: npm run test:e2e.
- If any test fails, inspect errors and self-correct your code.

Phase 5 — Mission Completion (Turns 56–60):
- Emit {"tool": "done", "args": { "summary": "...", "verificationStatus": { ... } }}.

### AVAILABLE COMMANDS (Single JSON object per turn — NEVER call internal tools!)
{
  "thought": "Brief explanation of your observation and next action",
  "tool": "http_read" | "workspace_write_file" | "workspace_read_file" | "workspace_exec" | "done",
  "args": { ... }
}

Argument schemas:
- http_read: { "url": "https://www.bitbop.dev/llms.txt" }
- workspace_write_file: { "relPath": "server/src/server.ts", "content": "..." }
- workspace_read_file: { "relPath": "docs/AAIMS_POC_SPEC.md" }
- workspace_exec: { "command": "npm run test:api", "background": false }
- done: { "summary": "Full report of backend, frontend, BitBop crypto, and test results" }

### WINDOWS HOST GUIDELINES
- Node v22 is installed. Use standard npm / npx / node commands.
- Do NOT use Unix bash idioms like "grep ... | head" or "2>/dev/null" in workspace_exec.
- Write files using workspace_write_file rather than shell echo/cat redirects.
- In client-side React template strings inside Node files, avoid unescaped newlines.
`;

// ---------------------------------------------------------------------------
// 8. Tool Execution Engine & Sandbox
// ---------------------------------------------------------------------------

/**
 * Validates that file paths resolve safely within PROJECT_ROOT and do not leak or overwrite protected areas.
 * Enforces strict boundary verification, canonical relative path checking, and 8.3 short name blocking.
 */
export function validateSafePath(relPath: string, mode: 'read' | 'write'): string {
  const normalized = String(relPath || '').replace(/^[\\/]+/, '');
  const full = path.resolve(PROJECT_ROOT, normalized);

  // 1. Boundary check: Must be inside PROJECT_ROOT (prevents sibling directory traversal e.g. AAIMS_ESCAPE)
  const isInside = full === PROJECT_ROOT || full.startsWith(PROJECT_ROOT + path.sep);
  if (!isInside) {
    throw new Error(`Path traversal outside project root is strictly forbidden: ${relPath}`);
  }

  // 2. Protect internal agent metadata and git directories from corruption regardless of relative traversal prefixes
  const relFromRoot = path.relative(PROJECT_ROOT, full).replace(/\\/g, '/');
  const firstSegment = relFromRoot.split('/')[0]?.toLowerCase();
  if (firstSegment === '.agents' || firstSegment === '.git') {
    throw new Error(`Access to protected directory (${firstSegment}) is forbidden.`);
  }

  // 3. Spec guard: Forbid reading the full enterprise reference spec; composer-2.5 must use only AAIMS_POC_SPEC.md.
  // Blocks both long filename and Windows NTFS 8.3 short name aliases (AAIMS_~1.MD).
  if (mode === 'read') {
    const lowerRel = relFromRoot.toLowerCase();
    if (
      lowerRel.includes('aaims_full_spec.md') ||
      lowerRel.includes('aaims_~1.md') ||
      lowerRel.includes('aaims_~1')
    ) {
      throw new Error(
        `Access to docs/AAIMS_FULL_SPEC.md is forbidden. You must build exclusively from docs/AAIMS_POC_SPEC.md.`
      );
    }
  }

  return full;
}

export async function executeTool(
  action: AgentAction,
  fetchedDocs: Record<string, string>
): Promise<any> {
  const { tool, args } = action;

  if (tool === 'http_read') {
    const url = String(args?.url || '').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(`Invalid URL: ${url}`);
    }
    console.log(`[Tool] http_read fetching ${url}...`);
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    fetchedDocs[url] = text.slice(0, 12000);
    return {
      url,
      status: res.status,
      content: text.slice(0, 28000),
      totalLength: text.length,
    };
  }

  if (tool === 'workspace_write_file') {
    const relPath = String(args?.relPath || '').trim();
    const content = String(args?.content ?? '');
    const fullPath = validateSafePath(relPath, 'write');
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`[Tool] workspace_write_file wrote ${content.length} bytes to ${relPath}`);
    return {
      written: relPath,
      bytes: content.length,
    };
  }

  if (tool === 'workspace_read_file') {
    const relPath = String(args?.relPath || '').trim();
    const fullPath = validateSafePath(relPath, 'read');
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${relPath}`);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    console.log(`[Tool] workspace_read_file read ${content.length} bytes from ${relPath}`);
    return {
      relPath,
      content: content.slice(0, 15000),
      totalBytes: content.length,
    };
  }

  if (tool === 'workspace_exec') {
    const command = String(args?.command || '').trim();
    const background = Boolean(args?.background);

    if (background) {
      console.log(`[Tool] workspace_exec starting background daemon: ${command}`);

      const child = spawn(command, {
        cwd: PROJECT_ROOT,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      backgroundProcs.push(child);
      let logs = '';
      child.stdout?.on('data', (d) => (logs += d.toString()));
      child.stderr?.on('data', (d) => (logs += d.toString()));

      // Settle buffer to catch early boot crashes
      await new Promise((r) => setTimeout(r, 3000));

      return {
        startedBackground: command,
        pid: child.pid,
        initialLogs: logs.slice(0, 2500),
      };
    } else {
      console.log(`[Tool] workspace_exec running: ${command}`);
      const out = execSync(command, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: CMD_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return {
        command,
        stdout: out.slice(0, 4000),
      };
    }
  }

  if (tool === 'done') {
    return {
      status: 'MISSION_COMPLETE',
      summary: args?.summary || 'Autonomous build loop completed.',
      verificationStatus: args?.verificationStatus || {},
    };
  }

  throw new Error(`Unknown tool: ${tool}`);
}

// ---------------------------------------------------------------------------
// 9. Main Controller Loop
// ---------------------------------------------------------------------------

export async function runBuilder(): Promise<void> {
  console.log(`================================================================`);
  console.log(` AAIMS Autonomous Zero-Knowledge Builder Loop`);
  console.log(` Gateway: ${COMPOSER_URL} (${COMPOSER_MODEL})`);
  console.log(` Target:  ${PROJECT_ROOT}`);
  console.log(` Mode:    ${isProbe ? 'Single-Turn Live Probe' : `Autonomous Build (Max ${MAX_TURNS} Turns)`}`);
  console.log(`================================================================\n`);

  // Ensure clean ports before beginning
  killPortListeners(BACKEND_PORT);
  killPortListeners(FRONTEND_PORT);

  // Retrieve token
  const bearer = getComposerBearer();
  console.log(`[Composer] Loaded bearer token (${bearer.length} chars).`);

  if (isProbe) {
    console.log(`[Probe] Running live gateway verification turn against ${COMPOSER_MODEL}...`);
    const probePrompt = JSON.stringify({
      turn: 1,
      probe: true,
      instruction:
        'Respond immediately with a single JSON action object using tool: "workspace_read_file" to read "docs/AAIMS_POC_SPEC.md", with a thought explaining your initial step.',
    });

    const { action, rawText, latencyMs } = await callComposer(bearer, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: probePrompt },
    ]);

    console.log(`[Probe] Success! Gateway responded in ${latencyMs}ms:`);
    console.log(`  Tool:    ${action.tool}`);
    console.log(`  Thought: ${action.thought}`);
    console.log(`  Args:    ${JSON.stringify(action.args)}`);

    if (action.tool === 'workspace_read_file' || action.tool === 'http_read' || action.tool === 'workspace_exec') {
      console.log(`\n[Probe] Verified: composer-2.5 responded with valid plain-text JSON controller action.`);
      return;
    } else {
      console.warn(`[Probe] Unexpected tool returned in probe: ${action.tool}`);
      return;
    }
  }

  const history: HistoryEntry[] = [];
  const fetchedDocs: Record<string, string> = {};
  let lastObservation: any = {
    workspaceFiles: fs.readdirSync(PROJECT_ROOT).filter((f) => !f.startsWith('.')),
    message: 'Harness initialized. Begin Phase 1: Read docs/AAIMS_POC_SPEC.md and https://www.bitbop.dev/llms.txt.',
  };

  try {
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      // Windowed history to preserve token budget
      const compactHistory = history.slice(-14).map((h) => ({
        turn: h.turn,
        tool: h.action.tool,
        args:
          h.action.tool === 'workspace_write_file'
            ? { relPath: h.action.args?.relPath, bytes: String(h.action.args?.content || '').length }
            : h.action.args,
        thought: h.action.thought,
        result: h.resultSummary,
      }));

      const userPrompt = JSON.stringify(
        {
          turn,
          maxTurns: MAX_TURNS,
          fetchedDocsMemory: fetchedDocs,
          recentHistory: compactHistory,
          lastToolOutput: lastObservation,
        },
        null,
        2
      );

      console.log(`\n--- [Turn ${turn}/${MAX_TURNS}] Querying ${COMPOSER_MODEL} ---`);
      const t0 = Date.now();
      let composerResult: { action: AgentAction; rawText: string; latencyMs: number } | null = null;
      try {
        composerResult = await callComposer(bearer, [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ]);
      } catch (err: any) {
        console.warn(`[Turn ${turn}] Failed to parse valid action from ${COMPOSER_MODEL}: ${err.message}`);
        lastObservation = {
          error: `Your previous response could not be parsed into a valid JSON action: ${err.message}. You must respond strictly with a single JSON object matching: {"thought": "...", "tool": "...", "args": {...}}`,
        };
        history.push({
          turn,
          action: { thought: 'PARSE_ERROR', tool: 'workspace_exec', args: {} },
          resultSummary: { error: err.message },
          durationMs: Date.now() - t0,
        });
        continue;
      }

      const { action, latencyMs } = composerResult;
      const turnDuration = Date.now() - t0;
      console.log(`[Turn ${turn}] (${latencyMs}ms) Tool=${action.tool} | Thought: ${action.thought}`);

      let toolOutput: any = null;
      let summaryObj: any = null;

      try {
        toolOutput = await executeTool(action, fetchedDocs);
        if (action.tool === 'done') {
          summaryObj = { status: 'MISSION_COMPLETE', ...toolOutput };
          history.push({ turn, action, resultSummary: summaryObj, durationMs: turnDuration });
          console.log(`\n================================================================`);
          console.log(` BUILDER COMPLETED MISSION ON TURN ${turn}`);
          console.log(`================================================================`);
          console.log(action.args?.summary || action.thought);
          break;
        }

        if (action.tool === 'http_read') {
          summaryObj = {
            url: toolOutput.url,
            status: toolOutput.status,
            totalLength: toolOutput.totalLength,
            savedInFetchedDocsMemory: true,
          };
        } else if (action.tool === 'workspace_write_file') {
          summaryObj = { written: toolOutput.written, bytes: toolOutput.bytes };
        } else if (action.tool === 'workspace_read_file') {
          summaryObj = { relPath: toolOutput.relPath, bytes: toolOutput.totalBytes };
        } else if (action.tool === 'workspace_exec') {
          summaryObj = action.args?.background
            ? { startedBackground: toolOutput.startedBackground, pid: toolOutput.pid }
            : { command: action.args?.command, stdoutHead: String(toolOutput.stdout || '').slice(0, 300) };
        } else {
          summaryObj = toolOutput;
        }
      } catch (err: any) {
        toolOutput = {
          error: err?.message || String(err),
          stdout: err?.stdout ? String(err.stdout).slice(0, 3000) : undefined,
          stderr: err?.stderr ? String(err.stderr).slice(0, 1500) : undefined,
        };
        summaryObj = toolOutput;
        console.warn(`[Turn ${turn}] Tool execution error:`, toolOutput.error);
      }

      history.push({ turn, action, resultSummary: summaryObj, durationMs: turnDuration });
      lastObservation = toolOutput;
    }

    // Write final execution report
    const reportsDir = path.join(PROJECT_ROOT, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, `builder_run_report_${Date.now()}.json`);
    const finalReport: BuilderReport = {
      timestamp: new Date().toISOString(),
      model: COMPOSER_MODEL,
      projectRoot: PROJECT_ROOT,
      totalTurns: history.length,
      completed: history.some((h) => h.action.tool === 'done'),
      summary: history.find((h) => h.action.tool === 'done')?.action.args?.summary,
      history,
    };
    fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2), 'utf8');
    console.log(`\n[+] Saved full builder transcript to ${reportPath}`);
  } finally {
    cleanupAllProcesses();
  }
}

// ---------------------------------------------------------------------------
// 10. CLI Entry Point
// ---------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runBuilder().catch((err) => {
    console.error('Fatal error in AAIMS builder loop:', err);
    cleanupAllProcesses();
    process.exit(1);
  });
}
