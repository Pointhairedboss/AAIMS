import fs from 'fs';
import path from 'path';

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
  console.log('Wrote', rel, content.length, 'bytes');
}

// --- db.ts: remove broken auto-appended block ---
const dbPath = 'server/src/db.ts';
let db = read(dbPath);
const markers = [
  '// === Auto-appended by patch-db-exports.mjs ===',
  '// Auto-appended exports',
  '// --- patch-db-exports append ---'
];
for (const marker of markers) {
  const idx = db.indexOf(marker);
  if (idx !== -1) {
    db = db.slice(0, idx).replace(/\s+$/, '') + '\n';
    console.log('Stripped appended block at marker:', marker);
    break;
  }
}
// Fallback: remove trailing duplicate export block starting at last getSolutionCapabilities append
if (db.includes('export function getSolutionCapabilities') && (db.match(/export function getSolutionCapabilities/g) || []).length > 1) {
  const last = db.lastIndexOf('export function getSolutionCapabilities');
  const first = db.indexOf('export function getSolutionCapabilities');
  if (last !== first) {
    db = db.slice(0, last).replace(/\s+$/, '') + '\n';
    console.log('Stripped duplicate trailing getSolutionCapabilities block');
  }
}

// Ensure single export keywords on canonical implementations
function ensureExported(fnName) {
  const re = new RegExp(`(?<!export\\s+)function\\s+${fnName}\\s*\\(`);
  if (re.test(db)) {
    db = db.replace(re, `export function ${fnName}(`);
  }
}
[
  'getSolutionCapabilities',
  'linkCapabilityToSolution',
  'unlinkCapabilityFromSolution',
  'setSolutionStage',
  'getCapabilityControls',
  'countActiveControlsForCapability'
].forEach(ensureExported);

const append = [];
function addAlias(exportName, targetName) {
  if (db.includes(`export function ${exportName}`)) return;
  if (!db.includes(`function ${targetName}`) && !db.includes(`export function ${targetName}`)) {
    console.warn('Missing target for alias', exportName, '->', targetName);
    return;
  }
  append.push(
    `export function ${exportName}(...args: Parameters<typeof ${targetName}>): ReturnType<typeof ${targetName}> {\n` +
      `  return ${targetName}(...args);\n` +
      `}\n`
  );
}

addAlias('linkSolutionCapability', 'linkCapabilityToSolution');
addAlias('unlinkSolutionCapability', 'unlinkCapabilityFromSolution');

// Control link helpers — try common internal names
const controlLinkTargets = [
  ['linkCapabilityControl', 'attachControlToCapability'],
  ['linkCapabilityControl', 'linkControlToCapability'],
  ['unlinkCapabilityControl', 'detachControlFromCapability'],
  ['unlinkCapabilityControl', 'unlinkControlFromCapability']
];
for (const [exp, target] of controlLinkTargets) {
  if (db.includes(`function ${target}`) || db.includes(`export function ${target}`)) {
    if (!db.includes(`export function ${exp}`)) {
      append.push(
        `export function ${exp}(...args: Parameters<typeof ${target}>): ReturnType<typeof ${target}> {\n` +
          `  return ${target}(...args);\n` +
          `}\n`
      );
    }
    break;
  }
}

if (append.length) {
  db += '\n// --- fix-final-tsc aliases ---\n' + append.join('\n');
}
write(dbPath, db);

// --- index.ts ---
let index = read('server/src/index.ts');
if (index.includes("import { startServer }")) {
  index = `import { createApp } from './server.js';\nimport { initDb } from './db.js';\n\nconst PORT = Number(process.env.PORT ?? 4000);\n\nasync function main(): Promise<void> {\n  await initDb();\n  const app = createApp();\n  app.listen(PORT, () => {\n    console.log(\`AAIMS server listening on http://localhost:\${PORT}\`);\n  });\n}\n\nmain().catch((err: unknown) => {\n  console.error('Fatal startup error:', err);\n  process.exit(1);\n});\n`;
  write('server/src/index.ts', index);
} else {
  index = index
    .replace(/\.then\(\(\{ url \}\) =>/g, '.then(({ url }: { url: string }) =>')
    .replace(/\.catch\((err)\)/g, '.catch((err: unknown)');
  write('server/src/index.ts', index);
}

// --- server.ts patches ---
let server = read('server/src/server.ts');

if (!server.includes('function paramId')) {
  server = server.replace(
    /import type \{ Request, Response \}/,
    `import type { Request, Response } from 'express';\n\nfunction paramId(value: string | string[]): string {\n  return Array.isArray(value) ? value[0] : value;\n}\n\nfunction stageIndex(stage: import('./types.js').SolutionStage): number {\n  const order = [\n    'REQUEST','INVESTIGATE','ASSIGN_OWNER','IDENTIFY_CAPABILITIES',\n    'APPLY_CONTROLS','ASSESS','APPROVE','IMPLEMENT','REVIEW'\n  ] as const;\n  return order.indexOf(stage as typeof order[number]);\n}\n\nimport type { Request as _ReqDup, Response as _ResDup }`
  );
  // undo duplicate import if created — simpler inject after first express import
  server = read('server/src/server.ts');
  const inject = `\nfunction paramId(value: string | string[]): string {\n  return Array.isArray(value) ? value[0] : value;\n}\n\nconst STAGE_ORDER = [\n  'REQUEST','INVESTIGATE','ASSIGN_OWNER','IDENTIFY_CAPABILITIES',\n  'APPLY_CONTROLS','ASSESS','APPROVE','IMPLEMENT','REVIEW'\n] as const;\n\nfunction stageIndex(stage: import('./types.js').SolutionStage): number {\n  const i = (STAGE_ORDER as readonly string[]).indexOf(stage);\n  return i === -1 ? 0 : i;\n}\n`;
  server = server.replace(/from 'express';\n/, `from 'express';${inject}`);
}

server = server
  .replace(/\.stage\s*>\s*(\d+)/g, (_, n) => `.stage index comparison replaced`)
  .replace(/solution\.stage\s*>\s*4/g, 'stageIndex(solution.stage) > 3')
  .replace(/solution\.stage\s*>\s*5/g, 'stageIndex(solution.stage) > 4')
  .replace(/solution\.stage\s*===\s*7/g, "solution.stage === 'APPROVE'")
  .replace(/stage\s*<\s*1\s*\|\|\s*stage\s*>\s*9/g, 'stageIndex(stage as import(\'./types.js\').SolutionStage) < 0 || stageIndex(stage as import(\'./types.js\').SolutionStage) > 8')
  .replace(/stage\s*<\s*(\d+)/g, (m, n) => `stageIndex(stage as import('./types.js').SolutionStage) < ${Number(n) - 1}`)
  .replace(/stage\s*>\s*(\d+)/g, (m, n) => `stageIndex(stage as import('./types.js').SolutionStage) > ${Number(n) - 1}`)
  .replace(/Number\(req\.params\.id\)/g, 'paramId(req.params.id)')
  .replace(/req\.params\.id(?![\w])/g, 'paramId(req.params.id)')
  .replace(/req\.params\.solutionId(?![\w])/g, 'paramId(req.params.solutionId)')
  .replace(/req\.params\.capabilityId(?![\w])/g, 'paramId(req.params.capabilityId)')
  .replace(/req\.params\.controlId(?![\w])/g, 'paramId(req.params.controlId)')
  .replace(/as SolutionStage\)/g, "as import('./types.js').SolutionStage)")
  .replace(/solution\.name\b/g, 'solution.title')
  .replace(/decision\.summary\b/g, 'decision.minutesSummary')
  .replace(/return res\.(status\([^)]+\)\.)?json\(/g, 'res.$1json(');

// Ensure createApp is exported
if (!/export function createApp/.test(server) && /function createApp/.test(server)) {
  server = server.replace('function createApp', 'export function createApp');
}
if (!/export function createApp/.test(server) && /export default/.test(server)) {
  server = server.replace(/export default function/createApp/g, 'export function createApp');
}

write('server/src/server.ts', server);
console.log('fix-final-tsc complete');
