import { execFileSync } from 'node:child_process';

import { DEFAULT_TENANT_ID, POSTGRES_CONTAINER_NAME, POSTGRES_DB, POSTGRES_USER } from './platform-env.js';
import { runPsql } from './workflows-runtime.js';
import { sqlUuid } from './workflows-common.js';

export function clearFixtureWorkflowActivations(): void {
  runPsql(`
    DELETE FROM public.workflow_activations
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND COALESCE(name, '') LIKE 'E2E %'
       );
  `);
}

export async function settleFixtureWorkflowActivations(): Promise<void> {
  let zeroCountStreak = 0;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    clearFixtureWorkflowActivations();
    const activationCount = countFixtureWorkflowActivations();
    if (activationCount === 0) {
      zeroCountStreak += 1;
      if (zeroCountStreak >= 2) {
        return;
      }
    } else {
      zeroCountStreak = 0;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }
}

export function assertSeededScenarioIsInert(): void {
  const activationCount = countFixtureWorkflowActivations();
  if (activationCount !== 0) {
    throw new Error(`Deterministic workflow seed created ${activationCount} workflow activations.`);
  }

  const runtimeNames = listSpecialistRuntimeContainers();
  if (runtimeNames.length > 0) {
    throw new Error(
      `Deterministic workflow seed started specialist runtime containers: ${runtimeNames.join(', ')}`,
    );
  }
}

export function countFixtureWorkflowActivations(): number {
  const sql = `
    SELECT COUNT(*)
      FROM workflow_activations wa
      JOIN workflows w ON w.id = wa.workflow_id
     WHERE w.tenant_id = '${DEFAULT_TENANT_ID}'::uuid
       AND w.name LIKE 'E2E %';
  `;
  const output = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      POSTGRES_CONTAINER_NAME,
      'psql',
      '-t',
      '-A',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
  return Number.parseInt(output, 10);
}

export function listSpecialistRuntimeContainers(): string[] {
  const output = execFileSync(
    'docker',
    ['ps', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  ).trim();
  return output
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.startsWith('runtime-speciali-'));
}
