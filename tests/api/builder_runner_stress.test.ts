import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  extractFirstJsonObject,
  parseComposerResponse,
  validateSafePath,
  executeTool,
  type AgentAction,
} from '../../scripts/run_builder.js';

describe('Zero-Knowledge Builder Runner Stress Tests', () => {
  describe('Challenge 1: Parser Robustness', () => {
    it('1.1 Handles standard well-formed JSON action', () => {
      const raw = JSON.stringify({
        thought: 'Reading spec',
        tool: 'workspace_read_file',
        args: { relPath: 'docs/AAIMS_POC_SPEC.md' },
      });
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('workspace_read_file');
      expect(parsed.args.relPath).toBe('docs/AAIMS_POC_SPEC.md');
    });

    it('1.2 Handles escaped quotes containing braces inside string value', () => {
      const raw = `{"thought": "Writing code with braces", "tool": "workspace_write_file", "args": {"relPath": "test.json", "content": "{\\"foo\\": 1}"}}`;
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('workspace_write_file');
      expect(parsed.args.content).toBe('{"foo": 1}');
    });

    it('1.3 Handles escaped backslashes before quote', () => {
      const raw = `{"thought": "path testing", "tool": "workspace_read_file", "args": {"relPath": "C:\\\\test\\\\file.txt"}}`;
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('workspace_read_file');
      expect(parsed.args.relPath).toBe('C:\\test\\file.txt');
    });

    it('1.4 Strips <think>...</think> tags with nested braces', () => {
      const raw = `<think>
I need to check the spec.
Let config = { nested: { deep: true } };
Thinking done.
</think>
\`\`\`json
{
  "thought": "Spec read action",
  "tool": "workspace_read_file",
  "args": { "relPath": "docs/AAIMS_POC_SPEC.md" }
}
\`\`\``;
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('workspace_read_file');
      expect(parsed.thought).toBe('Spec read action');
    });

    it('1.5 Case sensitivity of <think> tags (e.g. <THINK> or mixed case)', () => {
      const raw = `<THINK>
Some reasoning with { curly braces }
</THINK>
{
  "thought": "Thinking in uppercase",
  "tool": "done",
  "args": { "summary": "Done" }
}`;
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('done');
    });

    it('1.6 Multiple trailing JSON objects — extracts the first', () => {
      const raw = `{"thought": "First action", "tool": "workspace_read_file", "args": {"relPath": "a.txt"}}
{"thought": "Second action", "tool": "done", "args": {}}`;
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('workspace_read_file');
      expect(parsed.thought).toBe('First action');
    });

    it('1.7 Malformed: Incomplete JSON throws informative error', () => {
      const raw = `{"thought": "Incomplete string without closing`;
      expect(() => parseComposerResponse(raw)).toThrow(/Failed to extract valid JSON action/);
    });

    it('1.8 Malformed: Missing tool property throws error', () => {
      const raw = `{"thought": "Missing tool", "args": {}}`;
      expect(() => parseComposerResponse(raw)).toThrow(/missing valid 'tool' property/);
    });

    it('1.9 Leading text/markdown block with internal braces is parsed successfully', () => {
      const raw = `Here is the TypeScript interface for our domain:
\`\`\`typescript
interface SolutionRecord {
  id: string;
  name: string;
}
\`\`\`
Now here is the action:
\`\`\`json
{
  "thought": "Read POC spec",
  "tool": "workspace_read_file",
  "args": { "relPath": "docs/AAIMS_POC_SPEC.md" }
}
\`\`\``;
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('workspace_read_file');
      expect(parsed.thought).toBe('Read POC spec');
    });

    it('1.10 Conversational text with braces before JSON is parsed successfully', () => {
      const raw = `I will start by checking {step: "init"}.
{
  "thought": "Read spec",
  "tool": "workspace_read_file",
  "args": { "relPath": "docs/AAIMS_POC_SPEC.md" }
}`;
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('workspace_read_file');
    });

    it('1.11 Unclosed <think> tag is stripped cleanly and JSON is parsed', () => {
      const raw = `<think>
Unclosed reasoning with { some: "state" }
{
  "thought": "Actual action",
  "tool": "workspace_read_file",
  "args": { "relPath": "docs/AAIMS_POC_SPEC.md" }
}`;
      const parsed = parseComposerResponse(raw);
      expect(parsed.tool).toBe('workspace_read_file');
    });
  });

  describe('Challenge 2: Path Traversal & Tool Security', () => {
    it('2.1 Blocks classic parent directory traversal (../../secret.txt)', () => {
      expect(() => validateSafePath('../../secret.txt', 'read')).toThrow(/Path traversal outside project root/);
      expect(() => validateSafePath('../../secret.txt', 'write')).toThrow(/Path traversal outside project root/);
    });

    it('2.2 Blocks deep parent traversal (../../../../windows/system32/cmd.exe)', () => {
      expect(() => validateSafePath('../../../../windows/system32/cmd.exe', 'read')).toThrow(/Path traversal outside project root/);
    });

    it('2.3 Blocks absolute paths outside workspace', () => {
      expect(() => validateSafePath('C:\\Windows\\System32\\drivers\\etc\\hosts', 'read')).toThrow(/Path traversal outside project root/);
    });

    it('2.4 Blocks direct reading of AAIMS_FULL_SPEC.md (Spec guard)', () => {
      expect(() => validateSafePath('docs/AAIMS_FULL_SPEC.md', 'read')).toThrow(/Access to docs\/AAIMS_FULL_SPEC.md is forbidden/);
      expect(() => validateSafePath('docs/aaims_full_spec.md', 'read')).toThrow(/Access to docs\/AAIMS_FULL_SPEC.md is forbidden/);
    });

    it('2.5 Blocks sibling directory prefix traversal (AAIMS_ESCAPE)', () => {
      expect(() => validateSafePath('../AAIMS_ESCAPE/secret.txt', 'read')).toThrow(/Path traversal outside project root/);
    });

    it('2.6 Blocks protected directory bypass using ./ or relative traversal', () => {
      expect(() => validateSafePath('./.agents/teamwork/ORIGINAL_REQUEST.md', 'read')).toThrow(/Access to protected directory/);
      expect(() => validateSafePath('server/../.agents/teamwork/ORIGINAL_REQUEST.md', 'read')).toThrow(/Access to protected directory/);
      expect(() => validateSafePath('docs/../.git/config', 'read')).toThrow(/Access to protected directory/);
    });

    it('2.7 Blocks spec guard bypass via Windows 8.3 short names (AAIMS_~1.MD)', async () => {
      const fetchedDocs: Record<string, string> = {};
      await expect(
        executeTool(
          {
            thought: 'Reading spec via short name',
            tool: 'workspace_read_file',
            args: { relPath: 'docs/AAIMS_~1.MD' },
          },
          fetchedDocs
        )
      ).rejects.toThrow(/Access to docs\/AAIMS_FULL_SPEC.md is forbidden/);
    });

    it('2.8 VULNERABILITY: workspace_exec lacks command filtering / blacklist / whitelist', async () => {
      const fetchedDocs: Record<string, string> = {};
      const action: AgentAction = {
        thought: 'Running arbitrary shell command',
        tool: 'workspace_exec',
        args: { command: 'node -e "console.log(\'EXECUTED_ARBITRARY_COMMAND\')"', background: false },
      };

      const result = await executeTool(action, fetchedDocs);
      expect(result.stdout).toContain('EXECUTED_ARBITRARY_COMMAND');
      console.log('[SECURITY OBSERVATION] workspace_exec executes arbitrary shell commands with no restrictions.');
    });

    it('2.9 http_read rejects non-http protocols', async () => {
      const fetchedDocs: Record<string, string> = {};
      const action: AgentAction = {
        thought: 'Reading file protocol',
        tool: 'http_read',
        args: { url: 'file:///etc/passwd' },
      };
      await expect(executeTool(action, fetchedDocs)).rejects.toThrow(/Invalid URL/);
    });
  });
});
