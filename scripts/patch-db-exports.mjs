import fs from 'node:fs';
import path from 'node:path';

const dbPath = path.join('server', 'src', 'db.ts');
let content = fs.readFileSync(dbPath, 'utf8');

const exportNames = [
  'setSolutionStage',
  'getSolutionCapabilities',
  'linkCapabilityToSolution',
  'unlinkCapabilityFromSolution',
  'getCapabilityControls',
  'countActiveControlsForCapability',
];

for (const name of exportNames) {
  if (new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(content)) {
    continue;
  }
  if (new RegExp(`^function\\s+${name}\\b`, 'm').test(content)) {
    content = content.replace(
      new RegExp(`^function\\s+${name}\\b`, 'm'),
      `export function ${name}`,
    );
    continue;
  }
  if (new RegExp(`^async function\\s+${name}\\b`, 'm').test(content)) {
    content = content.replace(
      new RegExp(`^async function\\s+${name}\\b`, 'm'),
      `export async function ${name}`,
    );
  }
}

const marker = '// --- server.ts export surface (auto-patched) ---';
const stillMissing = exportNames.filter(
  (name) => !new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(content),
);

if (!content.includes(marker) && stillMissing.length > 0) {
  content += `
${marker}

export function getSolutionCapabilities(solutionId: string): Capability[] {
  const db = getDb();
  const rows = db
    .prepare(
      \`SELECT c.* FROM capabilities c
         INNER JOIN solution_capabilities sc ON sc.capability_id = c.id
         WHERE sc.solution_id = ?\`,
    )
    .all(solutionId) as CapabilityRow[];
  return rows.map(mapCapabilityRow);
}

export function getCapabilityControls(capabilityId: string): Control[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM controls WHERE capability_id = ? ORDER BY created_at ASC')
    .all(capabilityId) as ControlRow[];
  return rows.map(mapControlRow);
}

export function countActiveControlsForCapability(capabilityId: string): number {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM controls WHERE capability_id = ? AND lifecycle_status = 'ACTIVE'",
    )
    .get(capabilityId) as { count: number };
  return row?.count ?? 0;
}

export function linkCapabilityToSolution(solutionId: string, capabilityId: string): Solution {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO solution_capabilities (solution_id, capability_id) VALUES (?, ?)',
  ).run(solutionId, capabilityId);
  syncSolutionCapabilityIds(solutionId);
  const solution = getSolution(solutionId);
  if (!solution) throw new Error('Solution not found');
  return solution;
}

export function unlinkCapabilityFromSolution(
  solutionId: string,
  capabilityId: string,
): Solution {
  const db = getDb();
  db.prepare(
    'DELETE FROM solution_capabilities WHERE solution_id = ? AND capability_id = ?',
  ).run(solutionId, capabilityId);
  syncSolutionCapabilityIds(solutionId);
  const solution = getSolution(solutionId);
  if (!solution) throw new Error('Solution not found');
  return solution;
}

export function setSolutionStage(id: string, stage: SolutionStage): Solution {
  const current = getSolution(id);
  if (!current) throw new Error('Solution not found');
  assertSolutionStageInvariants({ ...current, stage }, stage);
  return updateSolution(id, { stage });
}
`;
}

fs.writeFileSync(dbPath, content);
console.log('Patched', dbPath, 'stillMissing before append:', stillMissing.join(', ') || 'none');
